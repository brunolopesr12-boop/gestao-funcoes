"use client";

/* ------------------------------------------------------------------ */
/* Módulo PERDAS · tipos, consultas e utilitários                       */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { todayISO } from "@/lib/ops/format";
import type { Loss, Product, StockLot, StorageType, UUID } from "@/lib/ops/types";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
/** Retorno de ops_losses_kpis (migration 0012_inventario_perdas). */
export type LossKpis = {
  from: string; to: string; days: number;
  count: number; total_cost: number; total_quantity: number;
  prev_from: string; prev_to: string; prev_count: number; prev_total_cost: number;
  top_reason: { name: string; cost: number; count: number } | null;
};

/** Uma linha de ops_report_losses. */
export type LossReportRow = { label: string; quantity: number; cost: number; occurrences: number };

export type ReportGroup = "motivo" | "produto" | "usuario" | "dia" | "categoria";

/** Linha do relatório com a comparação ao período anterior. */
export type LossReportCompared = LossReportRow & { prev_cost: number; prev_quantity: number; prev_occurrences: number; variation: number | null };

/** Filtros da lista de perdas. */
export type LossFilters = { from: string; to: string; reason: string; product: Product | null; user: string; term: string };

/** Retorno de ops_lot_summary(p_lot), no que interessa para registrar perda. */
export type LossLotSummary = {
  lot: StockLot;
  product: { id: UUID; name: string; internal_code: string; photo_url: string; unit: string; unit_name: string; storage_type: StorageType; category: string | null; cost: number };
  store: { id: UUID; name: string } | null;
  balance: number;
  balances: { location_id: UUID; location: string; quantity: number }[];
  days_to_expire: number | null;
};

export const REPORT_GROUPS: { value: ReportGroup; title: string; subtitle: string; kind: "bar" | "line"; limit?: number }[] = [
  { value: "motivo", title: "Perdas por motivo", subtitle: "Onde o dinheiro está indo embora", kind: "bar" },
  { value: "produto", title: "Produtos que mais perdem", subtitle: "Os 10 maiores em R$", kind: "bar", limit: 10 },
  { value: "usuario", title: "Perdas por funcionário", subtitle: "Quem registrou", kind: "bar" },
  { value: "dia", title: "Perdas por dia", subtitle: "R$ perdidos a cada dia do período", kind: "line" },
  { value: "categoria", title: "Perdas por categoria", subtitle: "Categoria do produto", kind: "bar" },
];

export const LOSS_SELECT = "*";

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, "%")}%`;
}

export function defaultFilters(): LossFilters {
  return { from: todayISO(-29), to: todayISO(), reason: "", product: null, user: "", term: "" };
}

/** yyyy-mm-dd válido? */
export function isISODate(s: string | null | undefined): s is string {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00`).getTime()));
}

/** Dias inclusivos entre duas datas yyyy-mm-dd. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime(), b = new Date(`${to}T12:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/** Período imediatamente anterior, com a mesma duração. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const n = daysBetween(from, to);
  const pTo = shiftISO(from, -1);
  return { from: shiftISO(pTo, -(n - 1)), to: pTo };
}

/** Variação percentual (null quando não dá para comparar). */
export function variationPct(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (Math.abs(prev) < 1e-9) return Math.abs(cur) < 1e-9 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

/** Preenche os dias sem perda com zero, para a linha do gráfico ficar contínua. */
export function fillDays(rows: LossReportRow[], from: string, to: string): LossReportRow[] {
  const map = new Map(rows.map((r) => [r.label, r] as const));
  const out: LossReportRow[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i < n && i < 400; i++) {
    const d = shiftISO(from, i);
    out.push(map.get(d) ?? { label: d, quantity: 0, cost: 0, occurrences: 0 });
  }
  return out;
}

/** Junta período atual e anterior pelo rótulo. */
export function compareRows(cur: LossReportRow[], prev: LossReportRow[]): LossReportCompared[] {
  const pm = new Map(prev.map((r) => [r.label, r] as const));
  return cur.map((r) => {
    const p = pm.get(r.label);
    return {
      ...r,
      prev_cost: Number(p?.cost ?? 0),
      prev_quantity: Number(p?.quantity ?? 0),
      prev_occurrences: Number(p?.occurrences ?? 0),
      variation: variationPct(Number(r.cost), Number(p?.cost ?? 0)),
    };
  });
}

/** Custo estimado da perda: quantidade (na unidade de estoque) × custo unitário. */
export function estimateLossCost(qty: number | null, factor: number, unitCost: number | null | undefined): number | null {
  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;
  const c = Number(unitCost ?? 0);
  return qty * (Number.isFinite(factor) && factor > 0 ? factor : 1) * c;
}

function applyLossFilters<T extends { eq: (c: string, v: string) => T; gte: (c: string, v: string) => T; lt: (c: string, v: string) => T; ilike: (c: string, v: string) => T; or: (f: string) => T }>(qb: T, storeId: string, f: LossFilters): T {
  qb = qb.eq("store_id", storeId);
  if (isISODate(f.from)) qb = qb.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (isISODate(f.to)) qb = qb.lt("created_at", new Date(`${shiftISO(f.to, 1)}T00:00:00`).toISOString());
  if (f.reason) qb = qb.eq("loss_reason_id", f.reason);
  if (f.product) qb = qb.eq("product_id", f.product.id);
  if (f.user.trim()) qb = qb.ilike("created_by_name", likeTerm(f.user));
  if (f.term.trim()) {
    const like = likeTerm(f.term);
    qb = qb.or(`product_name.ilike.${like},internal_code.ilike.${like},lot_code.ilike.${like},notes.ilike.${like},reason_name.ilike.${like}`);
  }
  return qb;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */
/** Lista paginada de v_losses com os filtros aplicados no banco. */
export function useLosses(storeId: string | undefined, f: LossFilters, range: { from: number; to: number }) {
  return useQuery({
    queryKey: ["losses", "list", storeId, f.from, f.to, f.reason, f.product?.id ?? "", f.user, f.term, range.from, range.to],
    enabled: Boolean(storeId),
    queryFn: async () => {
      const base = supabaseBrowser().from("v_losses").select("*", { count: "exact" });
      const qb = applyLossFilters(base, storeId!, f).order("created_at", { ascending: false }).range(range.from, range.to);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as Loss[], total: res.count ?? 0 };
    },
  });
}

/** Todas as perdas filtradas (para CSV), em páginas de 1000 — no máximo 10.000 linhas. */
export async function fetchAllLosses(storeId: string, f: LossFilters): Promise<Loss[]> {
  const out: Loss[] = [];
  const page = 1000;
  for (let from = 0; from < 10_000; from += page) {
    const base = supabaseBrowser().from("v_losses").select("*");
    const res = await applyLossFilters(base, storeId, f).order("created_at", { ascending: false }).range(from, from + page - 1);
    if (res.error) throw toOpsError(res.error);
    const rows = (res.data ?? []) as Loss[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/** Indicadores do período (RPC ops_losses_kpis, exige perdas.ver). */
export function useLossKpis(storeId: string | undefined, f: LossFilters, enabled = true) {
  return useQuery({
    queryKey: ["losses", "kpis", storeId, f.from, f.to, f.reason, f.product?.id ?? "", f.user, f.term],
    enabled: Boolean(storeId) && enabled && isISODate(f.from) && isISODate(f.to),
    queryFn: () =>
      rpc<LossKpis>("ops_losses_kpis", {
        p_store: storeId!,
        p_from: f.from,
        p_to: f.to,
        p_reason: f.reason || null,
        p_product: f.product?.id ?? null,
        p_user: f.user.trim(),
        p_term: f.term.trim(),
      }),
  });
}

/** Relatório agregado (RPC ops_report_losses, exige relatorios.ver). */
export function useLossReport(storeId: string | undefined, from: string, to: string, group: ReportGroup, enabled = true) {
  return useQuery({
    queryKey: ["losses", "report", storeId, from, to, group],
    enabled: Boolean(storeId) && enabled && isISODate(from) && isISODate(to),
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await rpc<LossReportRow[] | null>("ops_report_losses", { p_store: storeId!, p_from: from, p_to: to, p_group: group });
      return (rows ?? []).map((r) => ({ label: String(r.label ?? "—"), quantity: Number(r.quantity ?? 0), cost: Number(r.cost ?? 0), occurrences: Number(r.occurrences ?? 0) }));
    },
  });
}

/** Ficha do lote (QR) para registrar perda de um lote fixo. */
export function useLossLotSummary(lotId: string | null | undefined) {
  return useQuery({
    queryKey: ["stock_lots", "summary", lotId],
    enabled: Boolean(lotId),
    queryFn: async () => (await rpc<LossLotSummary | null>("ops_lot_summary", { p_lot: lotId! })) ?? null,
  });
}

/** Opções de consulta do relatório (para useQueries no painel: vários grupos/períodos de uma vez). */
export function lossReportOptions(storeId: string | undefined, from: string, to: string, group: ReportGroup, enabled = true) {
  return {
    queryKey: ["losses", "report", storeId, from, to, group] as const,
    enabled: Boolean(storeId) && enabled && isISODate(from) && isISODate(to),
    staleTime: 60_000,
    queryFn: async (): Promise<LossReportRow[]> => {
      const rows = await rpc<LossReportRow[] | null>("ops_report_losses", { p_store: storeId!, p_from: from, p_to: to, p_group: group });
      return (rows ?? []).map((r) => ({ label: String(r.label ?? "—"), quantity: Number(r.quantity ?? 0), cost: Number(r.cost ?? 0), occurrences: Number(r.occurrences ?? 0) }));
    },
  };
}

/** Compara dia a dia pela posição (1º dia do período com 1º dia do anterior…). */
export function compareByIndex(cur: LossReportRow[], prev: LossReportRow[]): LossReportCompared[] {
  return cur.map((r, i) => {
    const p = prev[i];
    return {
      ...r,
      prev_cost: Number(p?.cost ?? 0),
      prev_quantity: Number(p?.quantity ?? 0),
      prev_occurrences: Number(p?.occurrences ?? 0),
      variation: variationPct(Number(r.cost), Number(p?.cost ?? 0)),
    };
  });
}
