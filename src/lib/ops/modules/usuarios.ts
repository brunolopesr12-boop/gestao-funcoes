"use client";

/* ------------------------------------------------------------------ */
/* Módulo USUÁRIOS E PERMISSÕES · tipos, consultas e utilitários       */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { OpsError, toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import type { AccessRole, Permission, Profile, Store, UUID } from "@/lib/ops/types";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
/** Linha de v_memberships (vínculo + perfil + perfil de acesso + unidades). */
export type MembershipRow = {
  id: UUID; company_id: UUID; user_id: UUID | null; invited_email: string; access_role_id: UUID; all_stores: boolean; active: boolean;
  employee_id: UUID | null; created_by: UUID | null; created_at: string; updated_at: string;
  full_name: string; email: string; phone: string; profile_active: boolean;
  role_code: string; role_name: string; role_system: boolean;
  store_names: string[]; store_ids: UUID[]; overrides_count: number;
};
export type MembershipPermission = { membership_id: UUID; permission_code: string; granted: boolean };
export type RolePermission = { access_role_id: UUID; permission_code: string };
/** Override por usuário: padrão do perfil, permitir ou negar. */
export type OverrideValue = "padrao" | "permitir" | "negar";
export type PermissionGroup = { module: string; label: string; items: Permission[] };

export type MembershipFilters = { term: string; roleId: string; status: "ativos" | "inativos" | "pendentes" | "todos" };

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */
export const MODULE_LABEL: Record<string, string> = {
  painel: "Painel", produtos: "Produtos", fornecedores: "Fornecedores", estoque: "Estoque", recebimento: "Recebimento", producao: "Produção",
  fichas: "Fichas técnicas", inventario: "Inventário", perdas: "Perdas", compras: "Compras", temperaturas: "Temperaturas", checklists: "Checklists",
  tarefas: "Tarefas", etiquetas: "Etiquetas", alertas: "Alertas", relatorios: "Relatórios", auditoria: "Auditoria", usuarios: "Usuários",
  configuracoes: "Configurações", treinamentos: "Funções e treinamentos",
};
export function moduleLabel(m: string): string {
  return MODULE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
}
export const OVERRIDE_LABEL: Record<OverrideValue, string> = { padrao: "Padrão do perfil", permitir: "Permitir", negar: "Negar" };

export const ROLE_TONE: Record<string, "red" | "amber" | "blue" | "green" | "violet" | "cyan" | "slate"> = {
  admin: "red", gerente: "amber", estoquista: "blue", cozinha: "green", auditor: "violet", funcionario: "cyan",
};
export function roleTone(code: string) {
  return ROLE_TONE[code] ?? "slate";
}

/** Nome para mostrar de um vínculo (nome > e-mail > convite). */
export function memberLabel(m: Pick<MembershipRow, "full_name" | "email" | "invited_email" | "user_id">): string {
  return m.full_name || m.email || m.invited_email || "—";
}
export function isPending(m: Pick<MembershipRow, "user_id">): boolean {
  return !m.user_id;
}

/** Agrupa o catálogo de permissões por módulo, respeitando a posição. */
export function groupPermissions(perms: Permission[]): PermissionGroup[] {
  const map = new Map<string, Permission[]>();
  for (const p of [...perms].sort((a, b) => a.position - b.position)) {
    if (!map.has(p.module)) map.set(p.module, []);
    map.get(p.module)!.push(p);
  }
  return Array.from(map.entries()).map(([module, items]) => ({ module, label: moduleLabel(module), items }));
}

/** Permissão efetiva: admin tem tudo; senão override > perfil. */
export function effectivePermission(isAdminRole: boolean, inherited: boolean, override: OverrideValue): boolean {
  if (isAdminRole) return true;
  if (override === "permitir") return true;
  if (override === "negar") return false;
  return inherited;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */
export function usePermissionsCatalog() {
  return useQuery({
    queryKey: ["permissions", "catalog"],
    staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("permissions").select("*").order("position")) as Permission[],
  });
}

/** Perfis de acesso: do sistema (company_id null) + da empresa atual. */
export function useAccessRoles() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["access_roles", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabaseBrowser().from("access_roles").select("*").or(`company_id.is.null,company_id.eq.${company!.id}`).order("system", { ascending: false }).order("position").order("name"),
      ) as AccessRole[],
  });
}

export function useRolePermissions(roleId: string | null | undefined) {
  return useQuery({
    queryKey: ["role_permissions", roleId],
    enabled: Boolean(roleId),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("role_permissions").select("*").eq("access_role_id", roleId!)) as RolePermission[],
  });
}

/** Todas as unidades da empresa (ativas e inativas), para liberar acesso. */
export function useCompanyStores(companyId?: string) {
  const { company } = useSession();
  const id = companyId ?? company?.id;
  return useQuery({
    queryKey: ["stores", "company", id],
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("stores").select("*").eq("company_id", id!).order("position").order("name")) as Store[],
  });
}

/** Termo para ilike dentro de .or(): remove só o que quebra a sintaxe do filtro. */
export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%,()"]/g, "")}%`;
}
/** Valor exato para ilike dentro de .or() (e-mail, por exemplo). */
export function exactTerm(t: string): string {
  return t.trim().replace(/[%,()"]/g, "");
}

/** Lista paginada de vínculos (v_memberships) com busca e filtros no banco. */
export function useMembershipsList(f: MembershipFilters, range: { from: number; to: number }, page: number) {
  const { company } = useSession();
  return useQuery({
    queryKey: ["memberships", "list", company?.id, f.term, f.roleId, f.status, page],
    enabled: Boolean(company?.id),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = supabaseBrowser()
        .from("v_memberships")
        .select("*", { count: "exact" })
        .eq("company_id", company!.id)
        .order("active", { ascending: false })
        .order("full_name")
        .order("email")
        .range(range.from, range.to);
      if (f.term.trim()) {
        const like = likeTerm(f.term);
        q = q.or(`full_name.ilike.${like},email.ilike.${like},invited_email.ilike.${like},phone.ilike.${like}`);
      }
      if (f.roleId) q = q.eq("access_role_id", f.roleId);
      if (f.status === "ativos") q = q.eq("active", true).not("user_id", "is", null);
      else if (f.status === "inativos") q = q.eq("active", false);
      else if (f.status === "pendentes") q = q.is("user_id", null);
      const res = await q;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as MembershipRow[], total: res.count ?? 0 };
    },
  });
}

/** Contagem de vínculos por perfil (para a tela de perfis). */
export function useMembershipCounts() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["memberships", "counts", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 30_000,
    queryFn: async () => {
      const rows = unwrap(await supabaseBrowser().from("memberships").select("access_role_id, active").eq("company_id", company!.id)) as { access_role_id: string; active: boolean }[];
      const counts: Record<string, number> = {};
      for (const r of rows) if (r.active) counts[r.access_role_id] = (counts[r.access_role_id] ?? 0) + 1;
      return counts;
    },
  });
}

export function useMembershipRow(id: string | null | undefined) {
  return useQuery({
    queryKey: ["memberships", "row", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("v_memberships").select("*").eq("id", id!).maybeSingle()) as MembershipRow | null,
  });
}

export function useMembershipPermissions(membershipId: string | null | undefined) {
  return useQuery({
    queryKey: ["membership_permissions", membershipId],
    enabled: Boolean(membershipId),
    queryFn: async () => unwrap(await supabaseBrowser().from("membership_permissions").select("*").eq("membership_id", membershipId!)) as MembershipPermission[],
  });
}

/** A chave de serviço está configurada no servidor? (libera criar com senha / redefinir senha) */
export function useServiceRole() {
  return useQuery({
    queryKey: ["api", "users", "serviceRole"],
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      const res = await fetch("/api/ops/users", { method: "GET", cache: "no-store" });
      if (!res.ok) return false;
      const j = (await res.json()) as { serviceRole?: boolean };
      return Boolean(j.serviceRole);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutações                                                            */
/* ------------------------------------------------------------------ */
/** Sincroniza membership_stores com a lista desejada (insere/remove só a diferença). */
export async function syncMembershipStores(membershipId: string, wanted: string[]): Promise<void> {
  const sb = supabaseBrowser();
  const current = unwrap(await sb.from("membership_stores").select("store_id").eq("membership_id", membershipId)) as { store_id: string }[];
  const cur = new Set(current.map((c) => c.store_id));
  const want = new Set(wanted);
  const toDelete = [...cur].filter((id) => !want.has(id));
  const toInsert = [...want].filter((id) => !cur.has(id));
  if (toDelete.length) unwrap(await sb.from("membership_stores").delete().eq("membership_id", membershipId).in("store_id", toDelete));
  if (toInsert.length) unwrap(await sb.from("membership_stores").insert(toInsert.map((store_id) => ({ membership_id: membershipId, store_id }))));
}

/** Grava (ou remove) o ajuste fino de uma permissão para um vínculo. */
export async function setMembershipOverride(membershipId: string, code: string, value: OverrideValue): Promise<void> {
  const sb = supabaseBrowser();
  if (value === "padrao") {
    unwrap(await sb.from("membership_permissions").delete().eq("membership_id", membershipId).eq("permission_code", code));
  } else {
    unwrap(await sb.from("membership_permissions").upsert({ membership_id: membershipId, permission_code: code, granted: value === "permitir" }, { onConflict: "membership_id,permission_code" }));
  }
}

/** Substitui as permissões de um perfil da empresa (só a diferença). */
export async function saveRolePermissions(roleId: string, wanted: string[]): Promise<void> {
  const sb = supabaseBrowser();
  const current = unwrap(await sb.from("role_permissions").select("permission_code").eq("access_role_id", roleId)) as { permission_code: string }[];
  const cur = new Set(current.map((c) => c.permission_code));
  const want = new Set(wanted);
  const toDelete = [...cur].filter((c) => !want.has(c));
  const toInsert = [...want].filter((c) => !cur.has(c));
  if (toDelete.length) unwrap(await sb.from("role_permissions").delete().eq("access_role_id", roleId).in("permission_code", toDelete));
  if (toInsert.length) unwrap(await sb.from("role_permissions").insert(toInsert.map((permission_code) => ({ access_role_id: roleId, permission_code }))));
}

/** Atualiza nome/telefone de um colega (policy profiles_update_admin). */
export async function updateProfileByAdmin(userId: string, data: Pick<Profile, "full_name" | "phone">): Promise<void> {
  unwrap(await supabaseBrowser().from("profiles").update({ full_name: data.full_name.trim(), phone: data.phone.trim() }).eq("id", userId));
}

/* ------------------------------------------------------------------ */
/* API do servidor (/api/ops/users)                                    */
/* ------------------------------------------------------------------ */
export type CreateUserInput = {
  company_id: string; email: string; password: string; full_name: string; phone: string; access_role_id: string; all_stores: boolean; store_ids: string[];
};
export type CreateUserResult = { ok: true; user_id: string; membership_id: string; created_user: boolean };

async function callUsersApi<T>(method: "POST" | "PATCH", body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/ops/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new OpsError("Sem conexão com o servidor. Verifique a internet.", undefined, true);
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; erro?: string };
  if (!res.ok || j.ok === false) throw new OpsError(j.erro ?? `Falha na chamada (${res.status}).`, String(res.status));
  return j as T;
}

export function apiCreateUser(input: CreateUserInput): Promise<CreateUserResult> {
  return callUsersApi<CreateUserResult>("POST", input);
}
export function apiResetPassword(user_id: string, password: string): Promise<{ ok: true }> {
  return callUsersApi<{ ok: true }>("PATCH", { user_id, password });
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
/** Senha aleatória fácil de ditar: sem caracteres ambíguos (0/O, 1/l/I). */
export function generatePassword(length = 10): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => all[b % all.length]);
  // garante ao menos um dígito e uma letra
  const b2 = new Uint8Array(2);
  crypto.getRandomValues(b2);
  chars[b2[0] % length] = digits[b2[1] % digits.length];
  if (!/[a-zA-Z]/.test(chars.join(""))) chars[(b2[0] + 1) % length] = letters[b2[1] % letters.length];
  return chars.join("");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}
