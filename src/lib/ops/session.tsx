"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import { toOpsError } from "./errors";
import type { Company, Membership, Profile, Store } from "./types";

export type SessionStatus = "carregando" | "pronto" | "sem_acesso" | "erro" | "deslogado";

type PermRow = { store_id: string; company_id: string; permission_code: string };

export type OpsSession = {
  status: SessionStatus;
  error: string | null;
  user: User | null;
  profile: Profile | null;
  memberships: Membership[];
  companies: Company[];
  /** unidades acessíveis ao usuário */
  stores: Store[];
  /** unidade selecionada */
  store: Store | null;
  company: Company | null;
  setStore: (id: string) => void;
  /** permissão na unidade atual (ou em outra, se informada) */
  can: (perm: string, storeId?: string) => boolean;
  canCompany: (perm: string, companyId?: string) => boolean;
  isAdmin: boolean;
  permissions: Set<string>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  supabase: () => SupabaseClient;
  displayName: string;
};

const Ctx = createContext<OpsSession | null>(null);
const STORE_KEY = "vr.store";

export function useSession(): OpsSession {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession precisa estar dentro de <OpsSessionProvider>");
  return c;
}

/** Atalho: pode fazer X na unidade atual? */
export function useCan(perm: string): boolean {
  return useSession().can(perm);
}

export function OpsSessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("carregando");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [permRows, setPermRows] = useState<PermRow[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setStatus("erro");
      setError("Supabase não configurado.");
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const sb = supabaseBrowser();
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) {
        setUser(null);
        setStatus("deslogado");
        return;
      }
      setUser(auth.user);

      const loadMemberships = async () => {
        const { data, error: e } = await sb
          .from("memberships")
          .select("*, access_roles(id, code, name), companies(id, name, emoji, color)")
          .eq("user_id", auth.user.id)
          .eq("active", true);
        if (e) throw toOpsError(e);
        return (data ?? []) as Membership[];
      };

      let ms = await loadMemberships();
      if (ms.length === 0) {
        // primeiro acesso do sistema? vira administrador das empresas existentes
        const { data: needs } = await sb.rpc("ops_needs_bootstrap");
        if (needs === true) {
          const { error: be } = await sb.rpc("ops_bootstrap_admin");
          if (be) throw toOpsError(be);
          ms = await loadMemberships();
        }
      }
      setMemberships(ms);

      const { data: prof } = await sb.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
      if (!prof) {
        await sb.from("profiles").upsert({ id: auth.user.id, email: auth.user.email ?? "", full_name: (auth.user.user_metadata?.full_name as string) ?? "" });
      }
      const p = (prof as Profile | null) ?? null;
      setProfile(p);

      if (ms.length === 0) {
        setCompanies([]);
        setStores([]);
        setPermRows([]);
        setStatus("sem_acesso");
        return;
      }

      const [{ data: comps, error: ce }, { data: perms, error: pe }, { data: sts, error: se }] = await Promise.all([
        sb.from("companies").select("*").order("position"),
        sb.rpc("ops_my_permissions"),
        sb.from("stores").select("*").eq("active", true).order("position"),
      ]);
      if (ce) throw toOpsError(ce);
      if (pe) throw toOpsError(pe);
      if (se) throw toOpsError(se);
      const rows = (perms ?? []) as PermRow[];
      const accessible = new Set(rows.map((r) => r.store_id));
      const accessibleStores = ((sts ?? []) as Store[]).filter((s) => accessible.has(s.id));
      setCompanies((comps ?? []) as Company[]);
      setPermRows(rows);
      setStores(accessibleStores);

      // unidade atual: salva no aparelho > perfil > primeira
      let chosen: string | null = null;
      try {
        chosen = window.localStorage.getItem(STORE_KEY);
      } catch {
        /* ignora */
      }
      if (!chosen || !accessible.has(chosen)) chosen = p?.last_store_id && accessible.has(p.last_store_id) ? p.last_store_id : (accessibleStores[0]?.id ?? null);
      setStoreId(chosen);
      setStatus("pronto");
      setError(null);
    } catch (e) {
      setError(toOpsError(e as Error).message);
      setStatus("erro");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    if (!isSupabaseConfigured) return;
    const sb = supabaseBrowser();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setStatus("deslogado");
        window.location.href = "/login";
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void load();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const setStore = useCallback(
    (id: string) => {
      if (!stores.some((s) => s.id === id)) return;
      setStoreId(id);
      try {
        window.localStorage.setItem(STORE_KEY, id);
      } catch {
        /* ignora */
      }
      if (user) void supabaseBrowser().from("profiles").update({ last_store_id: id }).eq("id", user.id);
    },
    [stores, user],
  );

  const permissions = useMemo(() => new Set(permRows.map((r) => `${r.store_id}:${r.permission_code}`)), [permRows]);
  const companyPerms = useMemo(() => new Set(permRows.map((r) => `${r.company_id}:${r.permission_code}`)), [permRows]);

  const store = useMemo(() => stores.find((s) => s.id === storeId) ?? null, [stores, storeId]);
  const company = useMemo(() => companies.find((c) => c.id === store?.company_id) ?? companies[0] ?? null, [companies, store]);

  const can = useCallback(
    (perm: string, sid?: string) => {
      const id = sid ?? storeId;
      return Boolean(id && permissions.has(`${id}:${perm}`));
    },
    [permissions, storeId],
  );
  const canCompany = useCallback(
    (perm: string, cid?: string) => {
      const id = cid ?? company?.id;
      return Boolean(id && companyPerms.has(`${id}:${perm}`));
    },
    [companyPerms, company],
  );
  const isAdmin = useMemo(
    () => memberships.some((m) => m.company_id === company?.id && m.access_roles?.code === "admin"),
    [memberships, company],
  );

  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  }, []);

  const value: OpsSession = {
    status, error, user, profile, memberships, companies, stores, store, company, setStore, can, canCompany, isAdmin, permissions,
    refresh: load, signOut, supabase: supabaseBrowser,
    displayName: profile?.full_name || user?.user_metadata?.full_name || user?.email || "",
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
