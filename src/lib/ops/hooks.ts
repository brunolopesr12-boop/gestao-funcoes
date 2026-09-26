"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "./rpc";
import { useSession } from "./session";
import type { Category, LossReason, Membership, Product, StockLocation, Supplier, TemperatureEquipment, Unit } from "./types";

/** id da unidade atual (lança se não houver) */
export function useStoreId(): string {
  const { store } = useSession();
  return store?.id ?? "";
}

export function useUnits() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["units", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("units").select("*").or(`company_id.is.null,company_id.eq.${company!.id}`).eq("active", true).order("position")) as Unit[],
  });
}

export function useCategories() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["categories", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("categories").select("*").eq("company_id", company!.id).order("position").order("name")) as Category[],
  });
}

export function useLocations(storeId?: string) {
  const sid = useStoreId();
  const id = storeId ?? sid;
  return useQuery({
    queryKey: ["stock_locations", id],
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("stock_locations").select("*").eq("store_id", id).eq("active", true).order("position")) as StockLocation[],
  });
}

export function useSuppliers() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["suppliers", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("suppliers").select("*").eq("company_id", company!.id).eq("active", true).order("name")) as Supplier[],
  });
}

export function useLossReasons() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["loss_reasons", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("loss_reasons").select("*").eq("company_id", company!.id).eq("active", true).order("position")) as LossReason[],
  });
}

export function useEquipment(storeId?: string) {
  const sid = useStoreId();
  const id = storeId ?? sid;
  return useQuery({
    queryKey: ["temperature_equipment", id],
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabaseBrowser().from("temperature_equipment").select("*").eq("store_id", id).eq("active", true).order("position")) as TemperatureEquipment[],
  });
}

/** Membros da empresa (para atribuir tarefas, filtrar por funcionário). */
export function useMembers() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["memberships", "members", company?.id],
    enabled: Boolean(company?.id),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("memberships")
          .select("*, access_roles(id, code, name), profiles(id, email, full_name, phone, active), membership_stores(store_id)")
          .eq("company_id", company!.id)
          .order("created_at"),
      ) as Membership[],
  });
}

/** Busca de produtos (nome, código, código de barras) — paginada no banco. */
export function useProductSearch(term: string, opts: { onlyActive?: boolean; limit?: number; kind?: string } = {}) {
  const { company } = useSession();
  const t = term.trim();
  return useQuery({
    queryKey: ["products", "search", company?.id, t, opts],
    enabled: Boolean(company?.id),
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabaseBrowser()
        .from("products")
        .select("*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)")
        .eq("company_id", company!.id)
        .order("name")
        .limit(opts.limit ?? 30);
      if (opts.onlyActive !== false) q = q.eq("active", true);
      if (opts.kind) q = q.eq("product_kind", opts.kind);
      if (t) {
        const like = `%${t.replace(/[%_]/g, "")}%`;
        q = q.or(`name.ilike.${like},internal_code.ilike.${like},barcode.eq.${t},sku.ilike.${like}`);
      }
      return unwrap(await q) as Product[];
    },
  });
}

export function useProduct(id: string | null | undefined) {
  return useQuery({
    queryKey: ["products", id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("products")
          .select("*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name), suppliers:default_supplier_id(id, name)")
          .eq("id", id!)
          .single(),
      ) as Product,
  });
}

/** Lotes com saldo de um produto na unidade (ordem FEFO). */
export function useProductLots(productId: string | null | undefined, storeId?: string, includeExpired = true) {
  const sid = useStoreId();
  const id = storeId ?? sid;
  return useQuery({
    queryKey: ["stock_items", "lots", id, productId, includeExpired],
    enabled: Boolean(id && productId),
    queryFn: async () => {
      let q = supabaseBrowser()
        .from("v_stock_balances")
        .select("*")
        .eq("store_id", id)
        .eq("product_id", productId!)
        .gt("quantity", 0)
        .order("expires_at", { ascending: true, nullsFirst: false })
        .order("received_at", { ascending: true });
      if (!includeExpired) q = q.neq("expiry_status", "vencido");
      return unwrap(await q) as import("./types").StockBalance[];
    },
  });
}
