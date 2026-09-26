"use client";

/* ------------------------------------------------------------------ */
/* Módulo INVENTÁRIO · tipos, rótulos, utilitários e consultas          */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { useUnits } from "@/lib/ops/hooks";
import { useSession } from "@/lib/ops/session";
import { todayISO } from "@/lib/ops/format";
import type { InventoryCount, InventoryItem, Product, StockBalance, StockLot, Unit, UUID } from "@/lib/ops/types";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
export type CountKind = InventoryCount["kind"];

/** Linha de inventory_counts com os relacionamentos usados nas telas. */
export type CountRow = InventoryCount & { categories?: { id: UUID; name: string } | null };

export type CountItemProduct = Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor">;

/** Linha de inventory_items com produto, lote e local. */
export type CountItemRow = Omit<InventoryItem, "products"> & { products: CountItemProduct | null };

/** Retorno de ops_finalize_count. */
export type FinalizeResult = { ok: boolean; adjustments: number; difference_value: number };

export type ItemFilter = "todos" | "nao_contados" | "com_diferenca";

/** Lote lido pelo QR, com o produto e onde há saldo (para pré-preencher a contagem). */
export type ScannedLot = {
  lot: StockLot;
  product: Product;
  balances: StockBalance[];
};

export type UnitOption = { id: UUID; code: string; label: string; factor: number };

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */
export const COUNT_KIND_LABEL: Record<CountKind, string> = { rapida: "Rápida", completa: "Completa" };

export const COUNT_KIND_OPTIONS: { value: CountKind; label: string; hint: string }[] = [
  { value: "rapida", label: "Rápida", hint: "Você adiciona só o que quiser contar. O resto do estoque não muda." },
  { value: "completa", label: "Completa", hint: "Já carrega todos os itens com saldo do local. O que não for contado pode virar zero." },
];

export const ITEM_FILTER_OPTIONS: { value: ItemFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "nao_contados", label: "Só não contados" },
  { value: "com_diferenca", label: "Só com diferença" },
];

/** Motivos oferecidos quando a contagem difere do sistema. */
export const DIFF_REASONS: { value: string; label: string }[] = [
  { value: "quebra", label: "Quebra" },
  { value: "vencimento", label: "Vencimento" },
  { value: "erro de lançamento", label: "Erro de lançamento" },
  { value: "consumo não registrado", label: "Consumo não registrado" },
  { value: "outro", label: "Outro" },
];

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
/** Termo seguro para `ilike` (remove caracteres que quebram o filtro do PostgREST). */
export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, "%")}%`;
}

/** Só dígitos com 6+ caracteres = provável código de barras (EAN/UPC/ITF). */
export function looksLikeBarcode(t: string): boolean {
  return /^\d{6,}$/.test(t.trim());
}

export function isUuid(t: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.trim());
}

/** Início do dia de hoje (fuso do aparelho) em ISO, para filtrar created_at. */
export function startOfTodayISO(): string {
  return new Date(`${todayISO()}T00:00:00`).toISOString();
}

/** Cor da diferença: sobra em verde, falta em vermelho, igual em cinza. */
export function diffTone(diff: number | null | undefined): "green" | "red" | "slate" {
  if (diff === null || diff === undefined) return "slate";
  if (diff > 1e-9) return "green";
  if (diff < -1e-9) return "red";
  return "slate";
}
export const DIFF_TEXT: Record<"green" | "red" | "slate", string> = {
  green: "text-emerald-300",
  red: "text-rose-300",
  slate: "text-slate-400",
};

/** Sinal explícito: +2, -1,5. */
export function signed(n: number | null | undefined, fmt: (v: number) => string): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 1e-9) return fmt(0);
  return `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
}

/** Descrição curta do escopo da contagem. */
export function countScopeLabel(c: Pick<CountRow, "stock_locations" | "categories">): string {
  const loc = c.stock_locations?.name ?? "Toda a unidade";
  return c.categories?.name ? `${loc} · ${c.categories.name}` : loc;
}

const ITEM_SELECT =
  "*, products(id, name, internal_code, stock_unit_id, purchase_unit_id, purchase_factor), stock_lots(id, lot_code, expires_at), stock_locations(id, name)";

const PRODUCT_SELECT = "*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)";

/* ------------------------------------------------------------------ */
/* Consultas · contagens                                               */
/* ------------------------------------------------------------------ */
export function useCount(id: string | null | undefined) {
  return useQuery({
    queryKey: ["inventory_counts", "one", id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("inventory_counts").select("*, stock_locations(id, name), categories(id, name)").eq("id", id!).single()) as CountRow,
  });
}

/** Quantidade de contagens por situação (para as abas). */
export function useCountStatusTotals(storeId: string | undefined) {
  return useQuery({
    queryKey: ["inventory_counts", "totals", storeId],
    enabled: Boolean(storeId),
    queryFn: async () => {
      const sb = supabaseBrowser();
      const statuses = ["aberta", "finalizada", "cancelada"] as const;
      const res = await Promise.all(statuses.map((s) => sb.from("inventory_counts").select("id", { count: "exact" }).eq("store_id", storeId!).eq("status", s).range(0, 0)));
      const out: Record<(typeof statuses)[number], number> = { aberta: 0, finalizada: 0, cancelada: 0 };
      statuses.forEach((s, i) => {
        if (res[i].error) throw toOpsError(res[i].error);
        out[s] = res[i].count ?? 0;
      });
      return out;
    },
  });
}

/** Itens de uma contagem, paginados e filtrados no banco. A busca por produto
 *  resolve os ids primeiro (nome/código) e depois filtra os itens. */
export function useCountItems(
  countId: string | null | undefined,
  opts: { filter: ItemFilter; term: string; from: number; to: number },
) {
  const { company } = useSession();
  return useQuery({
    queryKey: ["inventory_items", countId, opts.filter, opts.term, opts.from, opts.to],
    enabled: Boolean(countId && company?.id),
    queryFn: async () => {
      const sb = supabaseBrowser();
      let ids: string[] | null = null;
      if (opts.term.trim()) {
        const t = opts.term.trim();
        const like = likeTerm(t);
        const raw = /^\S+$/.test(t) ? t.replace(/[,()]/g, "") : "";
        const pr = await sb
          .from("products")
          .select("id")
          .eq("company_id", company!.id)
          .or(`name.ilike.${like},internal_code.ilike.${like}${raw ? `,barcode.eq.${raw}` : ""}`)
          .limit(300);
        if (pr.error) throw toOpsError(pr.error);
        ids = ((pr.data ?? []) as { id: string }[]).map((p) => p.id);
        if (ids.length === 0) return { rows: [] as CountItemRow[], total: 0 };
      }
      let qb = sb
        .from("inventory_items")
        .select(ITEM_SELECT, { count: "exact" })
        .eq("count_id", countId!)
        .order("counted_at", { ascending: false, nullsFirst: true })
        .order("created_at", { ascending: true })
        .range(opts.from, opts.to);
      if (ids) qb = qb.in("product_id", ids);
      if (opts.filter === "nao_contados") qb = qb.is("counted_quantity", null);
      if (opts.filter === "com_diferenca") qb = qb.not("difference", "is", null).neq("difference", 0);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as unknown as CountItemRow[], total: res.count ?? 0 };
    },
  });
}

/** Itens contados agora (modo contagem rápida): os mais recentes primeiro. */
export function useRecentCountItems(countId: string | null | undefined, limit = 100) {
  return useQuery({
    queryKey: ["inventory_items", countId, "recent", limit],
    enabled: Boolean(countId),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("inventory_items")
          .select(ITEM_SELECT)
          .eq("count_id", countId!)
          .not("counted_quantity", "is", null)
          .order("counted_at", { ascending: false })
          .limit(limit),
      ) as unknown as CountItemRow[],
  });
}

/** Todos os itens de uma contagem (para exportar CSV) — em páginas de 1000. */
export async function fetchAllCountItems(countId: string, onlyDifferences: boolean): Promise<CountItemRow[]> {
  const sb = supabaseBrowser();
  const out: CountItemRow[] = [];
  const page = 1000;
  for (let from = 0; from < 50_000; from += page) {
    let qb = sb.from("inventory_items").select(ITEM_SELECT).eq("count_id", countId).order("created_at").range(from, from + page - 1);
    if (onlyDifferences) qb = qb.not("difference", "is", null).neq("difference", 0);
    const res = await qb;
    if (res.error) throw toOpsError(res.error);
    const rows = (res.data ?? []) as unknown as CountItemRow[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/** Contagens rápidas abertas hoje na unidade (uma por local, no modo /contar). */
export function useOpenQuickCounts(storeId: string | undefined) {
  return useQuery({
    queryKey: ["inventory_counts", "quick_open", storeId, todayISO()],
    enabled: Boolean(storeId),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("inventory_counts")
          .select("*, stock_locations(id, name), categories(id, name)")
          .eq("store_id", storeId!)
          .eq("kind", "rapida")
          .eq("status", "aberta")
          .gte("created_at", startOfTodayISO())
          .order("created_at", { ascending: false }),
      ) as CountRow[],
  });
}

/**
 * Garante a contagem rápida do dia para o local: reaproveita a que estiver
 * aberta (criada hoje) ou abre uma nova via ops_count_open. Exige conexão.
 */
export async function ensureQuickCount(storeId: string, locationId: string): Promise<CountRow> {
  const sb = supabaseBrowser();
  const found = await sb
    .from("inventory_counts")
    .select("*, stock_locations(id, name), categories(id, name)")
    .eq("store_id", storeId)
    .eq("location_id", locationId)
    .eq("kind", "rapida")
    .eq("status", "aberta")
    .gte("created_at", startOfTodayISO())
    .order("created_at", { ascending: false })
    .limit(1);
  if (found.error) throw toOpsError(found.error);
  const existing = (found.data ?? [])[0] as CountRow | undefined;
  if (existing) return existing;
  const id = await rpc<string>("ops_count_open", { p_store: storeId, p_kind: "rapida", p_location: locationId, p_category: null, p_notes: "Contagem rápida do dia" });
  const row = await sb.from("inventory_counts").select("*, stock_locations(id, name), categories(id, name)").eq("id", id).single();
  if (row.error) throw toOpsError(row.error);
  return row.data as CountRow;
}

/* ------------------------------------------------------------------ */
/* Consultas · saldos, produtos e lotes                                */
/* ------------------------------------------------------------------ */
/** Saldo teórico por lote de um produto num local (ou em toda a unidade). Inclui vencidos e bloqueados. */
export function useLocationBalances(storeId: string | undefined, productId: string | null | undefined, locationId: string | null | undefined) {
  return useQuery({
    queryKey: ["stock_items", "count_balances", storeId, productId, locationId ?? ""],
    enabled: Boolean(storeId && productId),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("v_stock_balances")
        .select("*")
        .eq("store_id", storeId!)
        .eq("product_id", productId!)
        .order("expires_at", { ascending: true, nullsFirst: false })
        .order("received_at", { ascending: true });
      if (locationId) qb = qb.eq("location_id", locationId);
      return unwrap(await qb) as StockBalance[];
    },
  });
}

/** Lote lido pelo QR: lote + produto + onde há saldo. `null` quando não existe. */
export async function fetchScannedLot(lotId: string): Promise<ScannedLot | null> {
  const sb = supabaseBrowser();
  const lr = await sb.from("stock_lots").select("*").eq("id", lotId).maybeSingle();
  if (lr.error) throw toOpsError(lr.error);
  if (!lr.data) return null;
  const lot = lr.data as StockLot;
  const [pr, br] = await Promise.all([
    sb.from("products").select(PRODUCT_SELECT).eq("id", lot.product_id).single(),
    sb.from("v_stock_balances").select("*").eq("lot_id", lot.id).order("quantity", { ascending: false }),
  ]);
  if (pr.error) throw toOpsError(pr.error);
  if (br.error) throw toOpsError(br.error);
  return { lot, product: pr.data as Product, balances: (br.data ?? []) as StockBalance[] };
}

/** Produto pelo código de barras (ou código interno) da empresa. */
export async function fetchProductByCode(companyId: string, code: string): Promise<Product[]> {
  const t = code.trim();
  if (!t) return [];
  const sb = supabaseBrowser();
  const filters = looksLikeBarcode(t) ? `barcode.eq.${t}` : `barcode.eq.${t.replace(/[,()]/g, "")},internal_code.ilike.${likeTerm(t)},sku.ilike.${likeTerm(t)}`;
  const r = await sb.from("products").select(PRODUCT_SELECT).eq("company_id", companyId).or(filters).limit(5);
  if (r.error) throw toOpsError(r.error);
  return (r.data ?? []) as Product[];
}

export async function fetchProduct(productId: string): Promise<Product | null> {
  const r = await supabaseBrowser().from("products").select(PRODUCT_SELECT).eq("id", productId).maybeSingle();
  if (r.error) throw toOpsError(r.error);
  return (r.data as Product | null) ?? null;
}

/**
 * Unidades em que o funcionário pode informar a quantidade de um produto:
 * a de estoque, as conversões cadastradas, a de compra e as da mesma
 * grandeza (mesma regra de ops_convert_qty no banco).
 */
export function useProductUnitOptions(product: Pick<Product, "id" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor"> | null | undefined) {
  const units = useUnits();
  const pu = useQuery({
    queryKey: ["product_units", product?.id],
    enabled: Boolean(product?.id),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("product_units").select("id, unit_id, factor, label").eq("product_id", product!.id)) as { id: UUID; unit_id: UUID; factor: number; label: string }[],
  });
  const all: Unit[] = units.data ?? [];
  const stock = product ? all.find((u) => u.id === product.stock_unit_id) : undefined;
  const options: UnitOption[] = [];
  if (product && stock) {
    options.push({ id: stock.id, code: stock.code, label: `${stock.code} — ${stock.name}`, factor: 1 });
    for (const x of pu.data ?? []) {
      const u = all.find((y) => y.id === x.unit_id);
      if (u && !options.some((o) => o.id === u.id)) options.push({ id: u.id, code: u.code, label: `${u.code} — ${x.label || u.name} (= ${x.factor} ${stock.code})`, factor: Number(x.factor) });
    }
    if (product.purchase_unit_id && Number(product.purchase_factor) > 0) {
      const u = all.find((y) => y.id === product.purchase_unit_id);
      if (u && !options.some((o) => o.id === u.id)) options.push({ id: u.id, code: u.code, label: `${u.code} — ${u.name} (compra, = ${product.purchase_factor} ${stock.code})`, factor: Number(product.purchase_factor) });
    }
    if (stock.base_factor) {
      for (const u of all) {
        if (u.kind === stock.kind && u.base_factor && !options.some((o) => o.id === u.id)) {
          options.push({ id: u.id, code: u.code, label: `${u.code} — ${u.name}`, factor: Number(u.base_factor) / Number(stock.base_factor) });
        }
      }
    }
  }
  return { options, stockUnit: stock ?? null, loading: units.isLoading || pu.isLoading };
}

/** Código da unidade de estoque de um produto (pela lista de unidades já carregada). */
export function useUnitCode() {
  const units = useUnits();
  const map = new Map((units.data ?? []).map((u) => [u.id, u.code] as const));
  return (unitId: string | null | undefined) => (unitId ? (map.get(unitId) ?? "") : "");
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */
export type OpenCountArgs = { storeId: string; kind: CountKind; locationId: string | null; categoryId: string | null; notes: string };

export async function openCount(a: OpenCountArgs): Promise<string> {
  return rpc<string>("ops_count_open", { p_store: a.storeId, p_kind: a.kind, p_location: a.locationId, p_category: a.categoryId, p_notes: a.notes });
}

export async function finalizeCount(countId: string, uncountedAsZero: boolean, notes: string): Promise<FinalizeResult> {
  return rpc<FinalizeResult>("ops_finalize_count", { p_count: countId, p_uncounted_as_zero: uncountedAsZero, p_notes: notes });
}

export async function cancelCount(countId: string, reason: string): Promise<void> {
  await rpc("ops_count_cancel", { p_count: countId, p_reason: reason });
}
