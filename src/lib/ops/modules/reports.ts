"use client";

/* ------------------------------------------------------------------ */
/* Módulo RELATÓRIOS · definições de colunas, consultas e exportação    */
/*   Cada relatório tem 1+ "modos" (abas). Cada modo diz quais filtros  */
/*   aceita, suas colunas e como buscar (página no banco ou RPC).       */
/*   A exportação busca TODAS as linhas do filtro em lotes de 1000      */
/*   (teto 20.000) e gera CSV, Excel (exceljs) ou PDF (jspdf).          */
/* ------------------------------------------------------------------ */

import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { downloadBlob, EXPIRY_META, fmtDate, fmtDateTime, fmtMoney, fmtPct, fmtQty, LEVEL_META, num, slug, toCSV, todayISO } from "@/lib/ops/format";
import {
  COUNT_STATUS_LABEL, CORRECTIVE_LABEL, EXEC_STATUS_LABEL, CHECKLIST_KIND_LABEL, LOT_STATUS_LABEL, MOVEMENT_LABEL, PO_STATUS_LABEL, PRODUCTION_STATUS_LABEL,
  RECEIPT_RESULT_LABEL, RECEIPT_STATUS_LABEL,
  type ChecklistExecutionStatus, type ChecklistKind, type CorrectiveAction, type ExpiryStatus, type InventoryCountStatus, type LotStatus, type MovementType,
  type Product, type ProductionStatus, type PurchaseOrderStatus, type ReceiptResult, type ReceiptStatus, type StockLevel,
} from "@/lib/ops/types";
import type { Tone } from "@/components/ops/ui";
import type { IconName } from "@/components/ops/Icon";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
export type ReportRow = Record<string, unknown>;
export type ColumnKind = "text" | "qty" | "money" | "int" | "date" | "datetime" | "pct" | "bool" | "badge";

export type ReportColumn = {
  key: string;
  label: string;
  kind?: ColumnKind;
  /** valor bruto (exportação e formatação). Padrão: row[key] */
  value?: (r: ReportRow) => unknown;
  /** unidade de medida (sufixo em quantidades) */
  unit?: (r: ReportRow) => string | null | undefined;
  /** selo (kind = badge) */
  badge?: (r: ReportRow) => { label: string; tone: Tone };
  total?: "sum" | "count";
  /** largura em caracteres (Excel/PDF) */
  width?: number;
  hideOnMobile?: boolean;
};

export type FilterKey = "period" | "product" | "category" | "supplier" | "user" | "term" | "equipment";
export type SelectOption = { value: string; label: string };
export type SelectFilter = { key: string; label: string; options: SelectOption[]; allLabel?: string; default?: string };

export type ReportFilters = {
  from: string; to: string;
  product: Product | null;
  category: string; supplier: string; user: string; term: string; equipment: string;
  sel: Record<string, string>;
};

export type ReportCtx = { storeId: string; companyId: string };

export type ReportMode = {
  key: string;
  label: string;
  filters: FilterKey[];
  selects?: SelectFilter[];
  columns: ReportColumn[] | ((f: ReportFilters) => ReportColumn[]);
  /** página no banco (.range + count) */
  fetchPage?: (ctx: ReportCtx, f: ReportFilters, from: number, to: number) => Promise<{ rows: ReportRow[]; total: number }>;
  /** tudo de uma vez (RPC agregada) — a paginação é feita na tela */
  fetchAll?: (ctx: ReportCtx, f: ReportFilters) => Promise<ReportRow[]>;
  landscape?: boolean;
  rowHref?: (r: ReportRow) => string | undefined;
  /** abre um painel com os itens do registro */
  detail?: "inventory_count" | "purchase_order" | "receipt";
  rowKey?: (r: ReportRow, i: number) => string;
  note?: string;
  /** permissão de leitura da tabela base (se faltar, a lista pode vir vazia) */
  perm?: string;
  requiresProduct?: boolean;
  mobile?: { title: string; subtitle: string[]; value?: string };
};

export type Report = { key: string; title: string; description: string; emoji: string; icon: IconName; modes: ReportMode[] };

export const EXPORT_BATCH = 1000;
export const EXPORT_MAX = 20000;

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
const sb = () => supabaseBrowser();

export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, "%")}%`;
}

export function defaultFilters(mode?: ReportMode): ReportFilters {
  const sel: Record<string, string> = {};
  for (const s of mode?.selects ?? []) sel[s.key] = s.default ?? "";
  return { from: todayISO(-29), to: todayISO(), product: null, category: "", supplier: "", user: "", term: "", equipment: "", sel };
}

export function resolveColumns(mode: ReportMode, f: ReportFilters): ReportColumn[] {
  return typeof mode.columns === "function" ? mode.columns(f) : mode.columns;
}

export function rawValue(col: ReportColumn, r: ReportRow): unknown {
  return col.value ? col.value(r) : r[col.key];
}

/** Texto formatado para a tela, CSV e PDF. */
export function cellText(col: ReportColumn, r: ReportRow): string {
  const v = rawValue(col, r);
  switch (col.kind) {
    case "qty": return v === null || v === undefined ? "—" : fmtQty(v, col.unit?.(r));
    case "money": return v === null || v === undefined ? "—" : fmtMoney(v);
    case "int": return v === null || v === undefined ? "—" : fmtQty(v, undefined, 0);
    case "pct": return v === null || v === undefined ? "—" : fmtPct(v);
    case "date": return fmtDate(v as string | null);
    case "datetime": return fmtDateTime(v as string | null);
    case "bool": return v === null || v === undefined ? "—" : v ? "Sim" : "Não";
    case "badge": return col.badge ? col.badge(r).label : String(v ?? "");
    default: return v === null || v === undefined ? "" : String(v);
  }
}

export function isNumeric(col: ReportColumn): boolean {
  return col.kind === "qty" || col.kind === "money" || col.kind === "int" || col.kind === "pct";
}

export function computeTotals(cols: ReportColumn[], rows: ReportRow[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of cols) {
    if (c.total === "sum") t[c.key] = rows.reduce((s, r) => s + num(rawValue(c, r)), 0);
    else if (c.total === "count") t[c.key] = rows.length;
  }
  return t;
}

const opt = <T extends string>(labels: Record<T, string>): SelectOption[] => (Object.keys(labels) as T[]).map((k) => ({ value: k, label: labels[k] }));
const badgeOf = <T extends string>(labels: Record<T, string>, tones?: Partial<Record<T, Tone>>) => (key: string) => (r: ReportRow) => {
  const v = String(r[key] ?? "") as T;
  return { label: labels[v] ?? (v || "—"), tone: tones?.[v] ?? toneForStatus(v) };
};
function toneForStatus(status: string): Tone {
  if (/conclu|finaliz|aprovado$|recebido|ativo|normal|ok|concluido|entrada|producao_entrada/.test(status)) return "green";
  if (/andamento|pedido|solicitado|atencao|ressalva|3dias|7dias|hoje|planejada|aberta|ajuste|transferencia|inventario/.test(status)) return "amber";
  if (/cancel|recusado|vencido|critico|baixo|atrasad|bloqueado|erro|perda/.test(status)) return "red";
  if (/rascunho|esgotado|pendente/.test(status)) return "slate";
  return "blue";
}

type Period = { from: string; to: string };
/** timestamptz: [from 00:00, to 23:59:59.999] */
function tsRange<Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(q: Q, col: string, p: Period): Q {
  if (p.from) q = q.gte(col, `${p.from}T00:00:00`);
  if (p.to) q = q.lt(col, `${p.to}T23:59:59.999`);
  return q;
}
/** date: [from, to] */
function dateRange<Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q, col: string, p: Period): Q {
  if (p.from) q = q.gte(col, p.from);
  if (p.to) q = q.lte(col, p.to);
  return q;
}

async function run<T>(p: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null; count?: number | null }>): Promise<{ rows: T; total: number }> {
  const res = await p;
  if (res.error) throw toOpsError(res.error);
  return { rows: (res.data ?? []) as T, total: res.count ?? (Array.isArray(res.data) ? res.data.length : 0) };
}

const name = (rel: string) => (r: ReportRow) => ((r[rel] as { name?: string } | null)?.name ?? "—");

/* ------------------------------------------------------------------ */
/* Colunas reutilizáveis                                               */
/* ------------------------------------------------------------------ */
const GROUP_LABEL: Record<string, string> = { produto: "Produto", categoria: "Categoria", dia: "Dia", usuario: "Funcionário", motivo: "Motivo", tipo: "Tipo de movimento" };

function groupColumn(f: ReportFilters, selKey = "group"): ReportColumn {
  const g = f.sel[selKey] ?? "";
  if (g === "dia") return { key: "label", label: "Dia", kind: "date", width: 12 };
  if (g === "tipo") return { key: "label", label: "Tipo", value: (r) => MOVEMENT_LABEL[String(r.label) as MovementType] ?? String(r.label ?? ""), width: 24 };
  return { key: "label", label: GROUP_LABEL[g] ?? "Item", width: 32 };
}

/* ------------------------------------------------------------------ */
/* Relatórios                                                          */
/* ------------------------------------------------------------------ */
const LEVEL_OPTIONS: SelectOption[] = (Object.keys(LEVEL_META) as StockLevel[]).map((k) => ({ value: k, label: LEVEL_META[k].label }));

const estoqueAtual: Report = {
  key: "estoque-atual", title: "Estoque atual", emoji: "📦", icon: "warehouse",
  description: "Saldo, custo e valor de cada produto na unidade, com nível de estoque e próxima validade.",
  modes: [{
    key: "lista", label: "Por produto", filters: ["category", "product", "term"], perm: "estoque.ver",
    selects: [
      { key: "level", label: "Nível", options: LEVEL_OPTIONS, allLabel: "Todos os níveis" },
      { key: "saldo", label: "Saldo", options: [{ value: "com", label: "Só com saldo" }, { value: "todos", label: "Todos os produtos" }], default: "com" },
    ],
    columns: [
      { key: "internal_code", label: "Código", width: 10, hideOnMobile: true },
      { key: "product_name", label: "Produto", width: 34 },
      { key: "category_name", label: "Categoria", width: 18, value: (r) => r.category_name ?? "—" },
      { key: "unit", label: "Un.", width: 6 },
      { key: "quantity", label: "Saldo", kind: "qty", width: 12 },
      { key: "cost", label: "Custo", kind: "money", width: 12 },
      { key: "total_value", label: "Valor", kind: "money", total: "sum", width: 14 },
      { key: "min_stock", label: "Mínimo", kind: "qty", width: 10, hideOnMobile: true },
      { key: "level", label: "Nível", kind: "badge", width: 14, badge: (r) => ({ label: LEVEL_META[r.level as StockLevel]?.short ?? "—", tone: toneForStatus(String(r.level)) }) },
      { key: "next_expiry", label: "Próx. validade", kind: "date", width: 12, hideOnMobile: true },
      { key: "lots_count", label: "Lotes", kind: "int", width: 7, hideOnMobile: true },
    ],
    rowHref: (r) => `/estoque/produto/${r.product_id}`,
    rowKey: (r) => String(r.product_id),
    mobile: { title: "product_name", subtitle: ["category_name", "quantity", "level"], value: "total_value" },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("v_stock_by_product").select("*", { count: "exact" }).eq("store_id", ctx.storeId).eq("active", true).order("product_name").range(from, to);
      if ((f.sel.saldo ?? "com") === "com") q = q.gt("quantity", 0);
      if (f.category) q = q.eq("category_id", f.category);
      if (f.sel.level) q = q.eq("level", f.sel.level);
      if (f.product) q = q.eq("product_id", f.product.id);
      if (f.term.trim()) q = q.or(`product_name.ilike.${likeTerm(f.term)},internal_code.ilike.${likeTerm(f.term)},barcode.eq.${f.term.trim()}`);
      return run<ReportRow[]>(q);
    },
  }],
};

const inventarios: Report = {
  key: "inventarios", title: "Inventários", emoji: "📋", icon: "clipboard",
  description: "Contagens realizadas, diferenças encontradas e valor ajustado. Clique para ver os itens.",
  modes: [{
    key: "lista", label: "Contagens", filters: ["period"], perm: "inventario.ver",
    selects: [{ key: "status", label: "Status", options: opt(COUNT_STATUS_LABEL), allLabel: "Todos os status" }],
    columns: [
      { key: "number", label: "Número", width: 12 },
      { key: "created_at", label: "Aberta em", kind: "datetime", width: 16 },
      { key: "kind", label: "Tipo", width: 10, value: (r) => (r.kind === "completa" ? "Completa" : "Rápida") },
      { key: "location", label: "Local", width: 20, value: (r) => (r.stock_locations as { name?: string } | null)?.name ?? "Toda a unidade" },
      { key: "status", label: "Status", kind: "badge", width: 12, badge: badgeOf<InventoryCountStatus>(COUNT_STATUS_LABEL)("status") },
      { key: "items_count", label: "Itens", kind: "int", total: "sum", width: 8 },
      { key: "differences", label: "Diferenças", kind: "int", total: "sum", width: 10 },
      { key: "difference_value", label: "Valor ajustado", kind: "money", total: "sum", width: 14 },
      { key: "started_by_name", label: "Iniciada por", width: 20, hideOnMobile: true },
      { key: "finished_at", label: "Finalizada em", kind: "datetime", width: 16, hideOnMobile: true },
    ],
    detail: "inventory_count",
    mobile: { title: "number", subtitle: ["created_at", "location", "status"], value: "difference_value" },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("inventory_counts").select("*, stock_locations(id, name)", { count: "exact" }).eq("store_id", ctx.storeId).order("created_at", { ascending: false }).range(from, to);
      q = tsRange(q, "created_at", f);
      if (f.sel.status) q = q.eq("status", f.sel.status);
      return run<ReportRow[]>(q);
    },
  }],
};

const movimentacoes: Report = {
  key: "movimentacoes", title: "Movimentações", emoji: "🔄", icon: "swap",
  description: "Todas as entradas e saídas de estoque: tipo, lote, local, quantidade, custo e quem fez.",
  modes: [{
    key: "lista", label: "Movimentações", filters: ["period", "product", "user", "term"], perm: "estoque.ver", landscape: true,
    selects: [{ key: "type", label: "Tipo", options: opt(MOVEMENT_LABEL), allLabel: "Todos os tipos" }],
    columns: [
      { key: "created_at", label: "Data/hora", kind: "datetime", width: 16 },
      { key: "movement_type", label: "Tipo", kind: "badge", width: 18, badge: badgeOf<MovementType>(MOVEMENT_LABEL)("movement_type") },
      { key: "product_name", label: "Produto", width: 30 },
      { key: "lot_code", label: "Lote", width: 14, hideOnMobile: true },
      { key: "location_name", label: "Local", width: 16, hideOnMobile: true },
      { key: "quantity", label: "Quantidade", kind: "qty", width: 12, unit: (r) => r.unit as string },
      { key: "unit_cost", label: "Custo unit.", kind: "money", width: 12, hideOnMobile: true },
      { key: "total_cost", label: "Total", kind: "money", total: "sum", width: 14 },
      { key: "balance_after", label: "Saldo após", kind: "qty", width: 12, hideOnMobile: true },
      { key: "reason", label: "Motivo", width: 20, hideOnMobile: true },
      { key: "created_by_name", label: "Funcionário", width: 20 },
    ],
    mobile: { title: "product_name", subtitle: ["created_at", "movement_type", "created_by_name"], value: "quantity" },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("v_movements").select("*", { count: "exact" }).eq("store_id", ctx.storeId).order("created_at", { ascending: false }).range(from, to);
      q = tsRange(q, "created_at", f);
      if (f.sel.type) q = q.eq("movement_type", f.sel.type);
      if (f.product) q = q.eq("product_id", f.product.id);
      if (f.user.trim()) q = q.ilike("created_by_name", likeTerm(f.user));
      if (f.term.trim()) {
        const l = likeTerm(f.term);
        q = q.or(`product_name.ilike.${l},internal_code.ilike.${l},lot_code.ilike.${l},reason.ilike.${l},notes.ilike.${l}`);
      }
      return run<ReportRow[]>(q);
    },
  }],
};

const compras: Report = {
  key: "compras", title: "Compras", emoji: "🛒", icon: "cart",
  description: "Pedidos de compra por período, fornecedor e status, com totais. Clique para ver os itens.",
  modes: [{
    key: "lista", label: "Pedidos", filters: ["period", "supplier"], perm: "compras.ver",
    selects: [{ key: "status", label: "Status", options: opt(PO_STATUS_LABEL), allLabel: "Todos os status" }],
    columns: [
      { key: "number", label: "Número", width: 12 },
      { key: "created_at", label: "Criado em", kind: "datetime", width: 16 },
      { key: "supplier", label: "Fornecedor", width: 26, value: name("suppliers") },
      { key: "status", label: "Status", kind: "badge", width: 16, badge: badgeOf<PurchaseOrderStatus>(PO_STATUS_LABEL)("status") },
      { key: "expected_at", label: "Previsto para", kind: "date", width: 12, hideOnMobile: true },
      { key: "total", label: "Total", kind: "money", total: "sum", width: 14 },
      { key: "created_by_name", label: "Criado por", width: 20, hideOnMobile: true },
      { key: "received_at", label: "Recebido em", kind: "datetime", width: 16, hideOnMobile: true },
    ],
    detail: "purchase_order",
    mobile: { title: "supplier", subtitle: ["number", "created_at", "status"], value: "total" },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("purchase_orders").select("*, suppliers(id, name)", { count: "exact" }).eq("store_id", ctx.storeId).order("created_at", { ascending: false }).range(from, to);
      q = tsRange(q, "created_at", f);
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      if (f.sel.status) q = q.eq("status", f.sel.status);
      return run<ReportRow[]>(q);
    },
  }],
};

const recebimentos: Report = {
  key: "recebimentos", title: "Recebimentos", emoji: "🚚", icon: "truck",
  description: "Mercadorias recebidas por período, fornecedor e resultado da conferência. Clique para ver os itens.",
  modes: [{
    key: "lista", label: "Recebimentos", filters: ["period", "supplier"], perm: "recebimento.ver",
    selects: [
      { key: "status", label: "Status", options: opt(RECEIPT_STATUS_LABEL), allLabel: "Todos os status" },
      { key: "result", label: "Resultado", options: opt(RECEIPT_RESULT_LABEL), allLabel: "Todos os resultados" },
    ],
    columns: [
      { key: "number", label: "Número", width: 12 },
      { key: "received_at", label: "Recebido em", kind: "datetime", width: 16 },
      { key: "supplier", label: "Fornecedor", width: 26, value: name("suppliers") },
      { key: "invoice_number", label: "Nota fiscal", width: 14, hideOnMobile: true },
      { key: "status", label: "Status", kind: "badge", width: 14, badge: badgeOf<ReceiptStatus>(RECEIPT_STATUS_LABEL)("status") },
      { key: "result", label: "Resultado", kind: "badge", width: 18, badge: badgeOf<ReceiptResult>(RECEIPT_RESULT_LABEL)("result") },
      { key: "total", label: "Total", kind: "money", total: "sum", width: 14 },
      { key: "received_by_name", label: "Recebido por", width: 20, hideOnMobile: true },
    ],
    detail: "receipt",
    mobile: { title: "supplier", subtitle: ["number", "received_at", "result"], value: "total" },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("receipts").select("*, suppliers(id, name)", { count: "exact" }).eq("store_id", ctx.storeId).order("received_at", { ascending: false }).range(from, to);
      q = tsRange(q, "received_at", f);
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      if (f.sel.status) q = q.eq("status", f.sel.status);
      if (f.sel.result) q = q.eq("result", f.sel.result);
      return run<ReportRow[]>(q);
    },
  }],
};

const producao: Report = {
  key: "producao", title: "Produção", emoji: "🔥", icon: "flame",
  description: "Produções realizadas: quantidade, rendimento e custo — em lista ou agrupadas por produto, dia ou funcionário.",
  modes: [
    {
      key: "lista", label: "Lista", filters: ["period", "product"], perm: "producao.ver", landscape: true,
      selects: [{ key: "status", label: "Status", options: opt(PRODUCTION_STATUS_LABEL), allLabel: "Todos os status" }],
      columns: [
        { key: "number", label: "Número", width: 12 },
        { key: "created_at", label: "Criada em", kind: "datetime", width: 16 },
        { key: "product", label: "Produto", width: 28, value: name("products") },
        { key: "recipe", label: "Ficha", width: 22, value: name("recipes"), hideOnMobile: true },
        { key: "status", label: "Status", kind: "badge", width: 14, badge: badgeOf<ProductionStatus>(PRODUCTION_STATUS_LABEL)("status") },
        { key: "planned_quantity", label: "Planejado", kind: "qty", width: 12, hideOnMobile: true },
        { key: "produced_quantity", label: "Produzido", kind: "qty", width: 12 },
        { key: "actual_yield_pct", label: "Rendimento", kind: "pct", width: 11, hideOnMobile: true },
        { key: "total_cost", label: "Custo total", kind: "money", total: "sum", width: 14 },
        { key: "unit_cost", label: "Custo unit.", kind: "money", width: 12, hideOnMobile: true },
        { key: "produced_by_name", label: "Produzido por", width: 20, hideOnMobile: true },
      ],
      rowHref: (r) => `/producao/${r.id}`,
      mobile: { title: "product", subtitle: ["number", "created_at", "status"], value: "produced_quantity" },
      fetchPage: async (ctx, f, from, to) => {
        let q = sb().from("productions").select("*, products(id, name, internal_code), recipes(id, name)", { count: "exact" }).eq("store_id", ctx.storeId).order("created_at", { ascending: false }).range(from, to);
        q = tsRange(q, "created_at", f);
        if (f.product) q = q.eq("product_id", f.product.id);
        if (f.sel.status) q = q.eq("status", f.sel.status);
        return run<ReportRow[]>(q);
      },
    },
    {
      key: "agrupado", label: "Agrupado", filters: ["period"], perm: "relatorios.ver",
      note: "Só produções concluídas no período (data de conclusão).",
      selects: [{ key: "group", label: "Agrupar por", options: [{ value: "produto", label: "Produto" }, { value: "dia", label: "Dia" }, { value: "usuario", label: "Funcionário" }], default: "produto" }],
      columns: (f) => [
        groupColumn(f),
        { key: "unit", label: "Un.", width: 6, value: (r) => r.unit ?? "" },
        { key: "productions", label: "Produções", kind: "int", total: "sum", width: 10 },
        { key: "planned", label: "Planejado", kind: "qty", width: 12 },
        { key: "produced", label: "Produzido", kind: "qty", width: 12 },
        { key: "avg_yield_pct", label: "Rendimento médio", kind: "pct", width: 14 },
        { key: "cost", label: "Custo", kind: "money", total: "sum", width: 14 },
      ],
      rowKey: (r, i) => `${r.label}-${i}`,
      mobile: { title: "label", subtitle: ["productions", "produced"], value: "cost" },
      fetchAll: async (ctx, f) => (await rpc<ReportRow[]>("ops_report_production", { p_store: ctx.storeId, p_from: f.from, p_to: f.to, p_group: f.sel.group || "produto" })) ?? [],
    },
  ],
};

const perdas: Report = {
  key: "perdas", title: "Perdas", emoji: "🗑️", icon: "trash",
  description: "Perdas registradas com motivo, custo e responsável — em lista ou agrupadas por motivo, produto, dia, funcionário ou categoria.",
  modes: [
    {
      key: "lista", label: "Lista", filters: ["period", "product", "user", "term"], perm: "perdas.ver", landscape: true,
      columns: [
        { key: "created_at", label: "Data/hora", kind: "datetime", width: 16 },
        { key: "product_name", label: "Produto", width: 30 },
        { key: "lot_code", label: "Lote", width: 14, value: (r) => r.lot_code ?? "—", hideOnMobile: true },
        { key: "location_name", label: "Local", width: 16, value: (r) => r.location_name ?? "—", hideOnMobile: true },
        { key: "quantity", label: "Quantidade", kind: "qty", width: 12, unit: (r) => r.unit as string },
        { key: "unit_cost", label: "Custo unit.", kind: "money", width: 12, hideOnMobile: true },
        { key: "total_cost", label: "Valor perdido", kind: "money", total: "sum", width: 14 },
        { key: "reason_name", label: "Motivo", width: 20 },
        { key: "created_by_name", label: "Funcionário", width: 20, hideOnMobile: true },
        { key: "notes", label: "Observações", width: 30, hideOnMobile: true },
      ],
      mobile: { title: "product_name", subtitle: ["created_at", "reason_name", "quantity"], value: "total_cost" },
      fetchPage: async (ctx, f, from, to) => {
        let q = sb().from("v_losses").select("*", { count: "exact" }).eq("store_id", ctx.storeId).order("created_at", { ascending: false }).range(from, to);
        q = tsRange(q, "created_at", f);
        if (f.product) q = q.eq("product_id", f.product.id);
        if (f.user.trim()) q = q.ilike("created_by_name", likeTerm(f.user));
        if (f.term.trim()) {
          const l = likeTerm(f.term);
          q = q.or(`product_name.ilike.${l},internal_code.ilike.${l},lot_code.ilike.${l},reason_name.ilike.${l},notes.ilike.${l}`);
        }
        return run<ReportRow[]>(q);
      },
    },
    {
      key: "agrupado", label: "Agrupado", filters: ["period"], perm: "relatorios.ver",
      selects: [{ key: "group", label: "Agrupar por", default: "motivo", options: [
        { value: "motivo", label: "Motivo" }, { value: "produto", label: "Produto" }, { value: "categoria", label: "Categoria" }, { value: "dia", label: "Dia" }, { value: "usuario", label: "Funcionário" },
      ] }],
      columns: (f) => [
        groupColumn(f),
        { key: "quantity", label: "Quantidade", kind: "qty", width: 12 },
        { key: "cost", label: "Valor perdido", kind: "money", total: "sum", width: 14 },
        { key: "occurrences", label: "Registros", kind: "int", total: "sum", width: 10 },
      ],
      rowKey: (r, i) => `${r.label}-${i}`,
      mobile: { title: "label", subtitle: ["occurrences", "quantity"], value: "cost" },
      fetchAll: async (ctx, f) => (await rpc<ReportRow[]>("ops_report_losses", { p_store: ctx.storeId, p_from: f.from, p_to: f.to, p_group: f.sel.group || "motivo" })) ?? [],
    },
  ],
};

const EXPIRY_SETS: Record<string, ExpiryStatus[] | null> = {
  vencido: ["vencido"], hoje: ["hoje"], "3dias": ["hoje", "3dias"], "7dias": ["hoje", "3dias", "7dias"], risco: ["vencido", "hoje", "3dias", "7dias"], todos: null,
};
const validades: Report = {
  key: "validades", title: "Validades", emoji: "⏰", icon: "clock",
  description: "Lotes vencidos e vencendo, com quantidade, valor parado e onde estão. Clique para abrir o lote.",
  modes: [{
    key: "lista", label: "Lotes", filters: ["category", "product", "term"], perm: "estoque.ver",
    selects: [{ key: "expiry", label: "Situação", default: "risco", options: [
      { value: "risco", label: "Vencidos + próximos 7 dias" }, { value: "vencido", label: "Vencidos" }, { value: "hoje", label: "Vencem hoje" }, { value: "3dias", label: "Até 3 dias" }, { value: "7dias", label: "Até 7 dias" }, { value: "todos", label: "Todos com validade" },
    ] }],
    columns: [
      { key: "product_name", label: "Produto", width: 30 },
      { key: "lot_code", label: "Lote", width: 14 },
      { key: "expires_at", label: "Validade", kind: "date", width: 12 },
      { key: "days_to_expire", label: "Dias", kind: "int", width: 7 },
      { key: "expiry_status", label: "Situação", kind: "badge", width: 16, badge: (r) => ({ label: EXPIRY_META[r.expiry_status as ExpiryStatus]?.label ?? "—", tone: EXPIRY_META[r.expiry_status as ExpiryStatus]?.tone ?? "slate" }) },
      { key: "quantity", label: "Quantidade", kind: "qty", width: 12, unit: (r) => r.unit as string },
      { key: "total_value", label: "Valor", kind: "money", total: "sum", width: 14 },
      { key: "locations", label: "Locais", width: 20, hideOnMobile: true },
      { key: "supplier_name", label: "Fornecedor", width: 20, value: (r) => r.supplier_name ?? "—", hideOnMobile: true },
      { key: "lot_status", label: "Lote", kind: "badge", width: 10, badge: badgeOf<LotStatus>(LOT_STATUS_LABEL)("lot_status"), hideOnMobile: true },
    ],
    rowHref: (r) => `/lote/${r.lot_id}`,
    rowKey: (r) => String(r.lot_id),
    mobile: { title: "product_name", subtitle: ["lot_code", "expires_at", "expiry_status"], value: "quantity" },
    fetchPage: async (ctx, f, from, to) => {
      // v_expiring_lots não expõe category_id: o filtro de categoria vira filtro pelo nome
      let categoryName: string | null = null;
      if (f.category) {
        const c = await sb().from("categories").select("name").eq("id", f.category).maybeSingle();
        categoryName = (c.data as { name?: string } | null)?.name ?? null;
      }
      let q = sb().from("v_expiring_lots").select("*", { count: "exact" }).eq("store_id", ctx.storeId).order("expires_at").range(from, to);
      const set = EXPIRY_SETS[f.sel.expiry || "risco"];
      if (set) q = q.in("expiry_status", set);
      if (categoryName) q = q.eq("category_name", categoryName);
      if (f.product) q = q.eq("product_id", f.product.id);
      if (f.term.trim()) q = q.or(`product_name.ilike.${likeTerm(f.term)},lot_code.ilike.${likeTerm(f.term)},internal_code.ilike.${likeTerm(f.term)}`);
      return run<ReportRow[]>(q);
    },
  }],
};
const fmtTemp = (v: unknown) => (v === null || v === undefined ? "—" : `${fmtQty(v, undefined, 1)} °C`);
const temperaturas: Report = {
  key: "temperaturas", title: "Temperaturas", emoji: "🌡️", icon: "thermometer",
  description: "Medições por equipamento e período, com faixa aceitável, medições fora da faixa e ação corretiva.",
  modes: [{
    key: "lista", label: "Medições", filters: ["period", "equipment", "user"], perm: "temperaturas.ver",
    selects: [{ key: "range", label: "Faixa", options: [{ value: "fora", label: "Só fora da faixa" }, { value: "dentro", label: "Só dentro da faixa" }], allLabel: "Todas as medições" }],
    columns: [
      { key: "measured_at", label: "Data/hora", kind: "datetime", width: 16 },
      { key: "equipment", label: "Equipamento", width: 24, value: name("temperature_equipment") },
      { key: "temperature", label: "Temperatura", width: 12, value: (r) => fmtTemp(r.temperature) },
      { key: "faixa", label: "Faixa", width: 16, value: (r) => (r.min_temp === null && r.max_temp === null ? "—" : `${fmtTemp(r.min_temp)} a ${fmtTemp(r.max_temp)}`), hideOnMobile: true },
      { key: "in_range", label: "Situação", kind: "badge", width: 14, badge: (r) => (r.in_range ? { label: "Dentro da faixa", tone: "green" } : { label: "Fora da faixa", tone: "red" }) },
      { key: "corrective_action", label: "Ação corretiva", width: 22, value: (r) => CORRECTIVE_LABEL[(r.corrective_action as CorrectiveAction) ?? ""] ?? "—", hideOnMobile: true },
      { key: "measured_by_name", label: "Medido por", width: 20, hideOnMobile: true },
      { key: "notes", label: "Observações", width: 30, hideOnMobile: true },
    ],
    mobile: { title: "equipment", subtitle: ["measured_at", "in_range", "measured_by_name"], value: "temperature" },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("temperature_logs").select("*, temperature_equipment(id, name, kind)", { count: "exact" }).eq("store_id", ctx.storeId).order("measured_at", { ascending: false }).range(from, to);
      q = tsRange(q, "measured_at", f);
      if (f.equipment) q = q.eq("equipment_id", f.equipment);
      if (f.sel.range === "fora") q = q.eq("in_range", false);
      if (f.sel.range === "dentro") q = q.eq("in_range", true);
      if (f.user.trim()) q = q.ilike("measured_by_name", likeTerm(f.user));
      return run<ReportRow[]>(q);
    },
  }],
};

const checklists: Report = {
  key: "checklists", title: "Checklists", emoji: "✅", icon: "list",
  description: "Execuções de checklists por período e status: o que foi concluído, o que atrasou e quem fez.",
  modes: [{
    key: "lista", label: "Execuções", filters: ["period", "user"], perm: "checklists.ver",
    selects: [{ key: "status", label: "Status", options: opt(EXEC_STATUS_LABEL), allLabel: "Todos os status" }],
    columns: [
      { key: "due_date", label: "Data", kind: "date", width: 12 },
      { key: "checklist", label: "Checklist", width: 28, value: name("checklists") },
      { key: "kind", label: "Tipo", width: 16, value: (r) => CHECKLIST_KIND_LABEL[((r.checklists as { kind?: ChecklistKind } | null)?.kind ?? "outro") as ChecklistKind], hideOnMobile: true },
      { key: "shift", label: "Turno", width: 10, value: (r) => r.shift || "—", hideOnMobile: true },
      { key: "status", label: "Status", kind: "badge", width: 14, badge: badgeOf<ChecklistExecutionStatus>(EXEC_STATUS_LABEL)("status") },
      { key: "progress", label: "Itens", width: 10, value: (r) => `${r.done_items ?? 0}/${r.total_items ?? 0}` },
      { key: "finished_by_name", label: "Concluído por", width: 20, value: (r) => r.finished_by_name || "—", hideOnMobile: true },
      { key: "finished_at", label: "Concluído em", kind: "datetime", width: 16, hideOnMobile: true },
    ],
    rowHref: (r) => `/checklists/executar/${r.id}`,
    mobile: { title: "checklist", subtitle: ["due_date", "status", "progress"] },
    fetchPage: async (ctx, f, from, to) => {
      let q = sb().from("checklist_executions").select("*, checklists(id, name, kind)", { count: "exact" }).eq("store_id", ctx.storeId).order("due_date", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
      q = dateRange(q, "due_date", f);
      if (f.sel.status) q = q.eq("status", f.sel.status);
      if (f.user.trim()) q = q.ilike("finished_by_name", likeTerm(f.user));
      return run<ReportRow[]>(q);
    },
  }],
};

const consumo: Report = {
  key: "consumo", title: "Consumo", emoji: "📉", icon: "chart",
  description: "O que saiu do estoque para uso (consumo, produção e saídas), em quantidade e custo, por produto, categoria, dia ou tipo.",
  modes: [{
    key: "agrupado", label: "Consumo", filters: ["period"], perm: "relatorios.ver",
    selects: [{ key: "group", label: "Agrupar por", default: "produto", options: [
      { value: "produto", label: "Produto" }, { value: "categoria", label: "Categoria" }, { value: "dia", label: "Dia" }, { value: "tipo", label: "Tipo de movimento" },
    ] }],
    columns: (f) => [
      groupColumn(f),
      { key: "unit", label: "Un.", width: 6, value: (r) => r.unit ?? "" },
      { key: "quantity", label: "Quantidade", kind: "qty", width: 12 },
      { key: "cost", label: "Custo", kind: "money", total: "sum", width: 14 },
      { key: "movements", label: "Movimentos", kind: "int", total: "sum", width: 10 },
    ],
    rowKey: (r, i) => `${r.label}-${r.unit}-${i}`,
    mobile: { title: "label", subtitle: ["quantity", "movements"], value: "cost" },
    fetchAll: async (ctx, f) => (await rpc<ReportRow[]>("ops_report_consumption", { p_store: ctx.storeId, p_from: f.from, p_to: f.to, p_group: f.sel.group || "produto" })) ?? [],
  }],
};

const custos: Report = {
  key: "custos", title: "Custos", emoji: "💰", icon: "scale",
  description: "Valor do estoque (custo × saldo), custo das produções e variação de preço de compra por produto.",
  modes: [
    {
      key: "estoque", label: "Valor em estoque", filters: ["category", "product", "term"], perm: "estoque.ver",
      note: "Valor = custo do lote × saldo. Só produtos com saldo, do maior valor para o menor.",
      columns: [
        { key: "internal_code", label: "Código", width: 10, hideOnMobile: true },
        { key: "product_name", label: "Produto", width: 34 },
        { key: "category_name", label: "Categoria", width: 18, value: (r) => r.category_name ?? "—", hideOnMobile: true },
        { key: "quantity", label: "Saldo", kind: "qty", width: 12, unit: (r) => r.unit as string },
        { key: "cost", label: "Custo atual", kind: "money", width: 12 },
        { key: "total_value", label: "Valor em estoque", kind: "money", total: "sum", width: 16 },
        { key: "lots_count", label: "Lotes", kind: "int", width: 7, hideOnMobile: true },
      ],
      rowHref: (r) => `/estoque/produto/${r.product_id}`,
      rowKey: (r) => String(r.product_id),
      mobile: { title: "product_name", subtitle: ["quantity", "cost"], value: "total_value" },
      fetchPage: async (ctx, f, from, to) => {
        let q = sb().from("v_stock_by_product").select("*", { count: "exact" }).eq("store_id", ctx.storeId).gt("quantity", 0).order("total_value", { ascending: false }).range(from, to);
        if (f.category) q = q.eq("category_id", f.category);
        if (f.product) q = q.eq("product_id", f.product.id);
        if (f.term.trim()) q = q.or(`product_name.ilike.${likeTerm(f.term)},internal_code.ilike.${likeTerm(f.term)}`);
        return run<ReportRow[]>(q);
      },
    },
    {
      key: "producao", label: "Custo de produção", filters: ["period", "product"], perm: "producao.ver",
      note: "Produções concluídas no período, com custo total dos ingredientes e custo por unidade produzida.",
      columns: [
        { key: "number", label: "Número", width: 12 },
        { key: "finished_at", label: "Concluída em", kind: "datetime", width: 16 },
        { key: "product", label: "Produto", width: 28, value: name("products") },
        { key: "recipe", label: "Ficha", width: 22, value: name("recipes"), hideOnMobile: true },
        { key: "produced_quantity", label: "Produzido", kind: "qty", width: 12 },
        { key: "total_cost", label: "Custo total", kind: "money", total: "sum", width: 14 },
        { key: "unit_cost", label: "Custo unitário", kind: "money", width: 14 },
        { key: "actual_yield_pct", label: "Rendimento", kind: "pct", width: 11, hideOnMobile: true },
      ],
      rowHref: (r) => `/producao/${r.id}`,
      mobile: { title: "product", subtitle: ["number", "finished_at", "produced_quantity"], value: "total_cost" },
      fetchPage: async (ctx, f, from, to) => {
        let q = sb().from("productions").select("*, products(id, name, internal_code), recipes(id, name)", { count: "exact" }).eq("store_id", ctx.storeId).eq("status", "concluida").order("finished_at", { ascending: false }).range(from, to);
        q = tsRange(q, "finished_at", f);
        if (f.product) q = q.eq("product_id", f.product.id);
        return run<ReportRow[]>(q);
      },
    },
    {
      key: "variacao", label: "Variação de preço", filters: ["period", "supplier", "product"], perm: "relatorios.ver", landscape: true,
      note: "Preços de compra registrados nos recebimentos de toda a empresa (histórico por fornecedor). Variação = último preço em relação ao primeiro do período.",
      columns: [
        { key: "internal_code", label: "Código", width: 10, hideOnMobile: true },
        { key: "product_name", label: "Produto", width: 30 },
        { key: "unit", label: "Un.", width: 6 },
        { key: "first_price", label: "Primeiro preço", kind: "money", width: 13 },
        { key: "last_price", label: "Último preço", kind: "money", width: 13 },
        { key: "variation_pct", label: "Variação", kind: "pct", width: 10 },
        { key: "min_price", label: "Mínimo", kind: "money", width: 12, hideOnMobile: true },
        { key: "max_price", label: "Máximo", kind: "money", width: 12, hideOnMobile: true },
        { key: "avg_price", label: "Médio", kind: "money", width: 12, hideOnMobile: true },
        { key: "purchases", label: "Compras", kind: "int", total: "sum", width: 9 },
        { key: "spent", label: "Total gasto", kind: "money", total: "sum", width: 14 },
        { key: "last_supplier_name", label: "Último fornecedor", width: 22, value: (r) => r.last_supplier_name ?? "—", hideOnMobile: true },
        { key: "current_cost", label: "Custo atual", kind: "money", width: 12, hideOnMobile: true },
      ],
      rowHref: (r) => `/estoque/produto/${r.product_id}`,
      rowKey: (r) => String(r.product_id),
      mobile: { title: "product_name", subtitle: ["first_price", "last_price", "purchases"], value: "variation_pct" },
      fetchAll: async (ctx, f) =>
        (await rpc<ReportRow[]>("ops_report_price_variation", { p_store: ctx.storeId, p_from: f.from, p_to: f.to, p_supplier: f.supplier || null, p_product: f.product?.id ?? null })) ?? [],
    },
  ],
};

const fornecedores: Report = {
  key: "fornecedores", title: "Fornecedores", emoji: "🏢", icon: "building",
  description: "Resumo de compras por fornecedor, histórico de preços e comparação de preços entre fornecedores para um produto.",
  modes: [
    {
      key: "resumo", label: "Resumo", filters: ["period"], perm: "relatorios.ver",
      note: "Recebimentos finalizados na unidade no período.",
      columns: [
        { key: "supplier_name", label: "Fornecedor", width: 30 },
        { key: "receipts", label: "Recebimentos", kind: "int", total: "sum", width: 12 },
        { key: "receipts_total", label: "Total comprado", kind: "money", total: "sum", width: 16 },
        { key: "avg_ticket", label: "Média por recebimento", kind: "money", width: 16, hideOnMobile: true },
        { key: "products", label: "Produtos", kind: "int", width: 10, hideOnMobile: true },
        { key: "problems", label: "Com problema", kind: "int", total: "sum", width: 12 },
        { key: "rejected_items", label: "Itens recusados", kind: "int", total: "sum", width: 12, hideOnMobile: true },
        { key: "last_receipt_at", label: "Último recebimento", kind: "datetime", width: 16, hideOnMobile: true },
      ],
      rowHref: (r) => (r.supplier_id ? `/fornecedores/${r.supplier_id}` : undefined),
      rowKey: (r, i) => String(r.supplier_id ?? i),
      mobile: { title: "supplier_name", subtitle: ["receipts", "problems"], value: "receipts_total" },
      fetchAll: async (ctx, f) => (await rpc<ReportRow[]>("ops_report_suppliers", { p_store: ctx.storeId, p_from: f.from, p_to: f.to })) ?? [],
    },
    {
      key: "historico", label: "Histórico de preços", filters: ["period", "supplier", "product"], perm: "fornecedores.ver",
      note: "Cada preço registrado em recebimentos da empresa (por unidade de estoque).",
      columns: [
        { key: "recorded_at", label: "Data", kind: "datetime", width: 16 },
        { key: "supplier", label: "Fornecedor", width: 26, value: name("suppliers") },
        { key: "product", label: "Produto", width: 30, value: name("products") },
        { key: "price", label: "Preço", kind: "money", width: 12 },
        { key: "quantity", label: "Quantidade", kind: "qty", width: 12, unit: (r) => (r.units as { code?: string } | null)?.code },
        { key: "total", label: "Total", kind: "money", total: "sum", width: 14, value: (r) => num(r.price) * num(r.quantity) },
        { key: "store", label: "Unidade", width: 18, value: name("stores"), hideOnMobile: true },
      ],
      mobile: { title: "product", subtitle: ["recorded_at", "supplier", "quantity"], value: "price" },
      fetchPage: async (ctx, f, from, to) => {
        let q = sb().from("supplier_price_history").select("*, suppliers(id, name), products(id, name, internal_code), units(code), stores(id, name)", { count: "exact" })
          .eq("company_id", ctx.companyId).order("recorded_at", { ascending: false }).range(from, to);
        q = tsRange(q, "recorded_at", f);
        if (f.supplier) q = q.eq("supplier_id", f.supplier);
        if (f.product) q = q.eq("product_id", f.product.id);
        return run<ReportRow[]>(q);
      },
    },
    {
      key: "comparacao", label: "Comparar preços", filters: ["product"], perm: "fornecedores.ver", requiresProduct: true,
      note: "Escolha um produto para comparar os fornecedores que já o venderam.",
      columns: [
        { key: "supplier_name", label: "Fornecedor", width: 30 },
        { key: "last_price", label: "Último preço", kind: "money", width: 13 },
        { key: "avg_price_180d", label: "Média 180 dias", kind: "money", width: 13 },
        { key: "min_price", label: "Mínimo", kind: "money", width: 12 },
        { key: "max_price", label: "Máximo", kind: "money", width: 12 },
        { key: "purchases", label: "Compras", kind: "int", width: 9 },
        { key: "last_purchase_at", label: "Última compra", kind: "datetime", width: 16 },
        { key: "preferred", label: "Preferido", kind: "bool", width: 9 },
        { key: "supplier_code", label: "Cód. no fornecedor", width: 14, value: (r) => r.supplier_code || "—", hideOnMobile: true },
      ],
      rowHref: (r) => `/fornecedores/${r.supplier_id}`,
      rowKey: (r) => String(r.supplier_id),
      mobile: { title: "supplier_name", subtitle: ["avg_price_180d", "purchases"], value: "last_price" },
      fetchAll: async (_ctx, f) => (f.product ? (await rpc<ReportRow[]>("ops_supplier_price_comparison", { p_product: f.product.id })) ?? [] : []),
    },
  ],
};

export const REPORTS: Report[] = [estoqueAtual, inventarios, movimentacoes, compras, recebimentos, producao, perdas, validades, temperaturas, checklists, consumo, custos, fornecedores];

export function findReport(key: string): Report | undefined {
  return REPORTS.find((r) => r.key === key);
}

/* ------------------------------------------------------------------ */
/* Buscar tudo (exportação e totais gerais)                            */
/* ------------------------------------------------------------------ */
export type AllRows = { rows: ReportRow[]; total: number; truncated: boolean };

export async function fetchAllRows(mode: ReportMode, ctx: ReportCtx, f: ReportFilters, onProgress?: (loaded: number, total: number) => void): Promise<AllRows> {
  if (mode.fetchAll) {
    const rows = await mode.fetchAll(ctx, f);
    onProgress?.(rows.length, rows.length);
    return { rows, total: rows.length, truncated: false };
  }
  if (!mode.fetchPage) return { rows: [], total: 0, truncated: false };
  const all: ReportRow[] = [];
  let total = 0;
  for (let from = 0; from < EXPORT_MAX; from += EXPORT_BATCH) {
    const page = await mode.fetchPage(ctx, f, from, Math.min(from + EXPORT_BATCH, EXPORT_MAX) - 1);
    total = page.total;
    all.push(...page.rows);
    onProgress?.(all.length, total);
    if (page.rows.length < EXPORT_BATCH || all.length >= total) break;
  }
  return { rows: all.slice(0, EXPORT_MAX), total, truncated: total > EXPORT_MAX };
}

/* ------------------------------------------------------------------ */
/* Exportação                                                          */
/* ------------------------------------------------------------------ */
export type ExportMeta = {
  title: string;
  store: string;
  period?: string;
  user: string;
  /** descrição dos filtros aplicados */
  filters?: string[];
  truncated?: boolean;
};

function fileName(meta: ExportMeta, ext: string): string {
  return `${slug(meta.title)}-${slug(meta.store)}-${todayISO()}.${ext}`;
}

/** Valor para células numéricas: número puro (Excel/CSV), texto para o resto. */
function exportCell(col: ReportColumn, r: ReportRow): unknown {
  if (isNumeric(col)) {
    const v = rawValue(col, r);
    return v === null || v === undefined ? "" : num(v);
  }
  return cellText(col, r);
}

export function exportCsv(cols: ReportColumn[], rows: ReportRow[], meta: ExportMeta) {
  const data = rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, exportCell(c, r)])));
  const totals = computeTotals(cols, rows);
  if (Object.keys(totals).length > 0) {
    const t: Record<string, unknown> = {};
    cols.forEach((c, i) => { t[c.key] = c.key in totals ? totals[c.key] : i === 0 ? "TOTAL" : ""; });
    data.push(t);
  }
  const csv = toCSV(data, cols.map((c) => ({ key: c.key, label: c.label })));
  downloadBlob(fileName(meta, "csv"), csv, "text/csv;charset=utf-8");
}

const NUM_FMT: Record<string, string> = { money: '"R$" #,##0.00', qty: "#,##0.###", int: "0", pct: '0.0"%"' };

export async function exportXlsx(cols: ReportColumn[], rows: ReportRow[], meta: ExportMeta) {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vila Rica · Gestão Operacional de Cozinha";
  wb.created = new Date();
  const ws = wb.addWorksheet(meta.title.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));

  const header: string[] = [meta.title, `Unidade: ${meta.store}`];
  if (meta.period) header.push(`Período: ${meta.period}`);
  if (meta.filters && meta.filters.length > 0) header.push(`Filtros: ${meta.filters.join(" · ")}`);
  header.push(`Gerado por ${meta.user} em ${fmtDateTime(new Date().toISOString())}`);
  if (meta.truncated) header.push(`Atenção: exportação limitada às primeiras ${EXPORT_MAX.toLocaleString("pt-BR")} linhas.`);
  header.forEach((h, i) => {
    const row = ws.addRow([h]);
    ws.mergeCells(row.number, 1, row.number, Math.max(cols.length, 1));
    row.font = i === 0 ? { bold: true, size: 14 } : { color: { argb: "FF64748B" }, size: 10 };
  });
  ws.addRow([]);

  const head = ws.addRow(cols.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle" };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172344" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF24314F" } } };
  });
  const headRow = head.number;

  for (const r of rows) {
    const values = cols.map((c) => {
      if (c.kind === "date" || c.kind === "datetime") {
        const v = rawValue(c, r) as string | null;
        if (!v) return "";
        const d = c.kind === "date" && v.length === 10 ? new Date(`${v}T12:00:00`) : new Date(v);
        return Number.isNaN(d.getTime()) ? "" : d;
      }
      return exportCell(c, r);
    });
    ws.addRow(values);
  }

  const totals = computeTotals(cols, rows);
  if (Object.keys(totals).length > 0) {
    const t = ws.addRow(cols.map((c, i) => (c.key in totals ? totals[c.key] : i === 0 ? "TOTAL" : "")));
    t.font = { bold: true };
    t.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: "FF24314F" } } }; });
  }

  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(8, Math.min(60, c.width ?? Math.max(c.label.length + 2, 12)));
    if (c.kind && NUM_FMT[c.kind]) col.numFmt = NUM_FMT[c.kind];
    if (c.kind === "date") col.numFmt = "dd/mm/yyyy";
    if (c.kind === "datetime") col.numFmt = "dd/mm/yyyy hh:mm";
    if (isNumeric(c)) col.alignment = { horizontal: "right" };
    // cabeçalho e título não herdam o formato
    for (let rIdx = 1; rIdx <= headRow; rIdx++) ws.getCell(rIdx, i + 1).numFmt = "@";
  });
  ws.views = [{ state: "frozen", ySplit: headRow }];
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: cols.length } };

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(fileName(meta, "xlsx"), buffer as ArrayBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export async function exportPdf(cols: ReportColumn[], rows: ReportRow[], meta: ExportMeta, landscape?: boolean) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default ?? autoTableMod.autoTable;
  const isLandscape = landscape ?? cols.length > 7;
  const doc = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const generated = `Gerado por ${meta.user} em ${fmtDateTime(new Date().toISOString())}`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(meta.title, 14, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90);
  const lines = [`Unidade: ${meta.store}${meta.period ? `   ·   Período: ${meta.period}` : ""}`];
  if (meta.filters && meta.filters.length > 0) lines.push(`Filtros: ${meta.filters.join(" · ")}`);
  lines.push(`${generated}   ·   ${rows.length.toLocaleString("pt-BR")} registro(s)${meta.truncated ? ` (limitado a ${EXPORT_MAX.toLocaleString("pt-BR")})` : ""}`);
  lines.forEach((l, i) => doc.text(l, 14, 21 + i * 4.5));
  doc.setTextColor(0);

  const totals = computeTotals(cols, rows);
  const foot = Object.keys(totals).length > 0 ? [cols.map((c, i) => (c.key in totals ? cellText({ ...c, value: () => totals[c.key] }, {}) : i === 0 ? "Total" : ""))] : undefined;
  const columnStyles: Record<number, { halign: "right" | "left" | "center"; cellWidth?: number | "auto" | "wrap" }> = {};
  cols.forEach((c, i) => { if (isNumeric(c)) columnStyles[i] = { halign: "right" }; });

  autoTable(doc, {
    head: [cols.map((c) => c.label)],
    body: rows.map((r) => cols.map((c) => cellText(c, r))),
    foot,
    startY: 21 + lines.length * 4.5 + 2,
    styles: { fontSize: cols.length > 9 ? 7 : 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: [23, 35, 68], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [235, 238, 245], textColor: 20, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 251] },
    columnStyles,
    margin: { left: 10, right: 10, bottom: 14 },
    didDrawPage: (data) => {
      const n = data.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`${meta.title} · ${meta.store}`, 10, doc.internal.pageSize.getHeight() - 7);
      doc.text(`Página ${n}`, pageW - 10, doc.internal.pageSize.getHeight() - 7, { align: "right" });
      doc.setTextColor(0);
    },
  });
  doc.save(fileName(meta, "pdf"));
}
