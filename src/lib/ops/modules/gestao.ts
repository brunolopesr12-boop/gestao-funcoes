"use client";

/* ------------------------------------------------------------------ */
/* Módulo GESTÃO · alertas, painel gerencial e auditoria               */
/* Tipos, rótulos, utilitários e consultas compartilhadas pelas telas.  */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, todayISO } from "@/lib/ops/format";
import type { Alert, AlertKind, AlertSeverity, AuditLog, DashboardData, UUID } from "@/lib/ops/types";
import { ALERT_KIND_LABEL } from "@/lib/ops/types";
import type { Tone } from "@/components/ops/ui";
import type { IconName } from "@/components/ops/Icon";

/* ------------------------------------------------------------------ */
/* Período                                                             */
/* ------------------------------------------------------------------ */
export type Range = { from: string; to: string };
export type PeriodPreset = "7" | "30" | "90" | "custom";

export function presetRange(days: number): Range {
  return { from: todayISO(-(days - 1)), to: todayISO() };
}

export function detectPreset(r: Range): PeriodPreset {
  for (const d of [7, 30, 90] as const) {
    const p = presetRange(d);
    if (p.from === r.from && p.to === r.to) return String(d) as PeriodPreset;
  }
  return "custom";
}

export function rangeLabel(r: Range): string {
  return `${fmtDate(r.from)} a ${fmtDate(r.to)}`;
}

/** Garante de ≤ até e limita a 366 dias (relatórios pesados). */
export function normalizeRange(r: Range): Range {
  if (!r.from || !r.to) return r;
  if (r.from > r.to) return { from: r.to, to: r.from };
  return r;
}

/* ------------------------------------------------------------------ */
/* Alertas                                                             */
/* ------------------------------------------------------------------ */
export type AlertStatus = Alert["status"];
export type AlertTab = "aberto" | "lido" | "resolvido" | "todos";

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = { aberto: "Aberto", lido: "Lido", resolvido: "Resolvido" };

export const SEVERITY_META: Record<AlertSeverity, { label: string; tone: Tone; icon: IconName; border: string; bg: string; text: string; dot: string }> = {
  critico: { label: "Crítico", tone: "red", icon: "alert", border: "border-rose-500/50", bg: "bg-rose-500/15", text: "text-rose-300", dot: "🔴" },
  atencao: { label: "Atenção", tone: "amber", icon: "clock", border: "border-amber-500/40", bg: "bg-amber-500/15", text: "text-amber-300", dot: "🟡" },
  info: { label: "Informação", tone: "blue", icon: "info", border: "border-blue-500/40", bg: "bg-blue-500/15", text: "text-blue-300", dot: "🔵" },
};

export const ALERT_KIND_OPTIONS: { value: AlertKind; label: string }[] = (Object.keys(ALERT_KIND_LABEL) as AlertKind[]).map((k) => ({ value: k, label: ALERT_KIND_LABEL[k] }));

/** Link para a entidade do alerta (quando a tela existe). */
export function alertHref(a: Pick<Alert, "entity_type" | "entity_id">): { href: string; label: string } | null {
  const id = a.entity_id;
  switch (a.entity_type) {
    case "stock_lot": return id ? { href: `/lote/${id}`, label: "Ver lote" } : null;
    case "product": return id ? { href: `/estoque/produto/${id}`, label: "Ver produto" } : null;
    case "checklist_execution": return id ? { href: `/checklists/executar/${id}`, label: "Abrir checklist" } : null;
    case "production": return id ? { href: `/producao/${id}`, label: "Ver produção" } : null;
    case "receipt": return id ? { href: `/recebimento/${id}`, label: "Ver recebimento" } : null;
    case "task": return { href: "/tarefas", label: "Ver tarefas" };
    case "temperature_log": return { href: "/temperaturas", label: "Ver temperaturas" };
    case "temperature_equipment": return { href: "/temperaturas", label: "Ver temperaturas" };
    case "purchase_order": return id ? { href: `/compras/${id}`, label: "Ver pedido" } : null;
    case "inventory_count": return id ? { href: `/inventario/${id}`, label: "Ver contagem" } : null;
    default: return null;
  }
}

/** Filtro PostgREST: alertas da unidade + alertas da empresa (store_id nulo). */
export function alertScopeFilter(storeId: string, companyId: string): string {
  return `store_id.eq.${storeId},and(store_id.is.null,company_id.eq.${companyId})`;
}

/** Contagens por status para as abas. */
export function useAlertCounts(storeId: string | undefined, companyId: string | undefined) {
  return useQuery({
    queryKey: ["alerts", "counts", storeId, companyId],
    enabled: Boolean(storeId && companyId),
    queryFn: async () => {
      const sb = supabaseBrowser();
      const scope = alertScopeFilter(storeId!, companyId!);
      const count = (status?: AlertStatus) => {
        let q = sb.from("alerts").select("id", { count: "exact", head: true }).or(scope);
        if (status) q = q.eq("status", status);
        return q;
      };
      const [a, l, r, t] = await Promise.all([count("aberto"), count("lido"), count("resolvido"), count()]);
      for (const x of [a, l, r, t]) if (x.error) throw x.error;
      return { aberto: a.count ?? 0, lido: l.count ?? 0, resolvido: r.count ?? 0, todos: t.count ?? 0 };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */
export function useDashboard(storeId: string | undefined, range: Range, enabled = true) {
  return useQuery({
    queryKey: ["dashboard", storeId, range.from, range.to],
    enabled: Boolean(storeId) && enabled,
    staleTime: 30_000,
    queryFn: () => rpc<DashboardData>("ops_dashboard", { p_store: storeId, p_from: range.from, p_to: range.to }),
  });
}

export type KpiDef = {
  key: string;
  label: string;
  href?: string;
  icon?: IconName;
  format?: "money" | "int";
  /** cor conforme o valor (0 = verde, >0 = alerta) */
  tone: (cards: Record<string, number>) => Tone;
  hint?: (cards: Record<string, number>) => string | undefined;
};

const warn = (key: string, bad: Tone = "amber"): KpiDef["tone"] => (c) => ((c[key] ?? 0) > 0 ? bad : "green");

export const KPI_SECTIONS: { title: string; items: KpiDef[] }[] = [
  {
    title: "Estoque e validades",
    items: [
      { key: "stock_value", label: "Valor do estoque", format: "money", href: "/estoque", icon: "warehouse", tone: () => "slate", hint: (c) => `${c.stock_products ?? 0} produtos · ${c.stock_lots ?? 0} lotes` },
      { key: "expired", label: "Produtos vencidos", href: "/validades?f=vencido", icon: "alert", tone: warn("expired", "red"), hint: (c) => ((c.expired_value ?? 0) > 0 ? `${fmtMoney(c.expired_value)} parados` : undefined) },
      { key: "expiring_today", label: "Vencendo hoje", href: "/validades?f=hoje", icon: "clock", tone: warn("expiring_today", "red") },
      { key: "expiring_3d", label: "Vencendo em 3 dias", href: "/validades?f=3dias", icon: "clock", tone: warn("expiring_3d") },
      { key: "expiring_7d", label: "Vencendo em 7 dias", href: "/validades?f=7dias", icon: "calendar", tone: warn("expiring_7d") },
      { key: "below_min", label: "Abaixo do mínimo", href: "/reposicao", icon: "cart", tone: warn("below_min", "red"), hint: (c) => ((c.near_min ?? 0) > 0 ? `${c.near_min} próximos do mínimo` : undefined) },
      { key: "critical", label: "Estoque crítico", href: "/reposicao", icon: "alert", tone: warn("critical", "red") },
    ],
  },
  {
    title: "Operação de hoje",
    items: [
      { key: "pending_productions", label: "Produções pendentes", href: "/producao", icon: "flame", tone: warn("pending_productions") },
      { key: "pending_receipts", label: "Recebimentos em conferência", href: "/recebimento", icon: "truck", tone: warn("pending_receipts") },
      { key: "pending_orders", label: "Pedidos em aberto", href: "/compras", icon: "file", tone: warn("pending_orders", "blue") },
      { key: "pending_tasks", label: "Tarefas pendentes", href: "/tarefas", icon: "checkSquare", tone: (c) => ((c.late_tasks ?? 0) > 0 ? "red" : (c.pending_tasks ?? 0) > 0 ? "amber" : "green"), hint: (c) => ((c.late_tasks ?? 0) > 0 ? `${c.late_tasks} atrasadas` : undefined) },
      { key: "pending_checklists", label: "Checklists de hoje", href: "/checklists", icon: "list", tone: (c) => ((c.late_checklists ?? 0) > 0 ? "red" : (c.pending_checklists ?? 0) > 0 ? "amber" : "green"), hint: (c) => ((c.late_checklists ?? 0) > 0 ? `${c.late_checklists} atrasados` : undefined) },
      { key: "open_counts", label: "Contagens abertas", href: "/inventario", icon: "clipboard", tone: warn("open_counts", "blue") },
    ],
  },
  {
    title: "Alertas e temperatura",
    items: [
      { key: "open_alerts", label: "Alertas abertos", href: "/alertas", icon: "bell", tone: (c) => ((c.critical_alerts ?? 0) > 0 ? "red" : (c.open_alerts ?? 0) > 0 ? "amber" : "green"), hint: (c) => ((c.critical_alerts ?? 0) > 0 ? `${c.critical_alerts} críticos` : undefined) },
      { key: "critical_alerts", label: "Alertas críticos", href: "/alertas", icon: "alert", tone: warn("critical_alerts", "red") },
      { key: "temp_out_of_range", label: "Temperatura fora da faixa", href: "/temperaturas", icon: "thermometer", tone: warn("temp_out_of_range", "red") },
    ],
  },
  {
    title: "No período",
    items: [
      { key: "losses_value", label: "Perdas (R$)", format: "money", href: "/perdas", icon: "trash", tone: warn("losses_value", "red"), hint: (c) => `${c.losses_count ?? 0} registro(s)` },
      { key: "losses_count", label: "Perdas (nº)", href: "/perdas", icon: "trash", tone: warn("losses_count") },
      { key: "receipts_period_value", label: "Compras recebidas (R$)", format: "money", href: "/recebimento", icon: "truck", tone: () => "blue" },
      { key: "consumption_period_value", label: "Consumo (R$)", format: "money", href: "/relatorios/consumo", icon: "chart", tone: () => "violet" },
      { key: "productions_period", label: "Produções concluídas", href: "/producao", icon: "flame", tone: () => "cyan" },
    ],
  },
];

export function fmtKpi(def: KpiDef, cards: Record<string, number>): string {
  const v = cards[def.key] ?? 0;
  return def.format === "money" ? fmtMoney(v) : fmtQty(v);
}

/* Paleta de gráficos (dataviz · modo escuro, validada) */
export const CHART = {
  grid: "#24314f",
  ink: "#94a3b8",
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
  yellow: "#c98500",
  magenta: "#d55181",
  green: "#008300",
  violet: "#9085e9",
  red: "#e66767",
};
export const CATEGORICAL = [CHART.blue, CHART.orange, CHART.aqua, CHART.yellow, CHART.magenta, CHART.green, CHART.violet, CHART.red];

/* ------------------------------------------------------------------ */
/* Auditoria                                                           */
/* ------------------------------------------------------------------ */
export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  products: "Produtos", categories: "Categorias", units: "Unidades de medida", suppliers: "Fornecedores", supplier_products: "Produto × fornecedor",
  stock_locations: "Locais de estoque", stock_lots: "Lotes", stock_movements: "Movimentações", stock_items: "Saldos", losses: "Perdas", loss_reasons: "Motivos de perda",
  transfers: "Transferências", receipts: "Recebimentos", receipt_items: "Itens de recebimento", purchase_orders: "Pedidos de compra", purchase_order_items: "Itens de pedido",
  recipes: "Fichas técnicas", recipe_items: "Ingredientes", productions: "Produções", production_items: "Itens de produção",
  inventory_counts: "Inventários", inventory_items: "Itens de inventário", temperature_equipment: "Equipamentos", temperature_logs: "Temperaturas",
  checklists: "Checklists", checklist_tasks: "Tarefas de checklist", checklist_executions: "Execuções de checklist", tasks: "Tarefas",
  label_templates: "Modelos de etiqueta", labels: "Etiquetas", alerts: "Alertas", memberships: "Usuários", membership_permissions: "Permissões de usuário",
  access_roles: "Perfis de acesso", settings: "Configurações", companies: "Empresa", stores: "Unidades", profiles: "Perfis", product_store_settings: "Parâmetros por unidade",
  api_keys: "Chaves de API", integration_events: "Integrações",
};

export const KNOWN_AUDIT_ENTITIES = Object.keys(AUDIT_ENTITY_LABEL);

export function entityLabel(entity: string): string {
  return AUDIT_ENTITY_LABEL[entity] ?? entity;
}

const ACTION_LABEL: Record<string, string> = {
  criou: "Criou", editou: "Editou", excluiu: "Excluiu", bootstrap_admin: "Primeiro administrador", concluiu_checklist: "Concluiu checklist",
  concluiu_producao: "Concluiu produção", finalizou_inventario: "Finalizou inventário", finalizou_recebimento: "Finalizou recebimento", registrou_perda: "Registrou perda",
  recebeu: "Recebeu", produziu: "Produziu", cancelou: "Cancelou", ajustou: "Ajustou", transferiu: "Transferiu", consumiu: "Consumiu", movimentou: "Movimentou",
  aprovou: "Aprovou", imprimiu: "Imprimiu", convidou: "Convidou", ativou: "Ativou", inativou: "Inativou", bloqueou: "Bloqueou", desbloqueou: "Desbloqueou",
};

export function actionLabel(action: string): string {
  if (action.startsWith("status:")) return `Status → ${action.slice(7).replace(/_/g, " ")}`;
  return ACTION_LABEL[action] ?? action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function actionTone(action: string): Tone {
  if (action === "criou" || action.startsWith("concluiu") || action.startsWith("finalizou") || action === "aprovou") return "green";
  if (action === "excluiu" || action.includes("cancel") || action === "bloqueou" || action === "inativou" || action === "registrou_perda") return "red";
  if (action === "editou" || action.startsWith("status:")) return "amber";
  return "blue";
}

/** Link para o registro auditado (quando a tela existe). */
export function auditHref(entity: string, id: UUID | null): string | null {
  if (!id) return null;
  switch (entity) {
    case "products": return `/estoque/produto/${id}`;
    case "stock_lots": return `/lote/${id}`;
    case "receipts": return `/recebimento/${id}`;
    case "purchase_orders": return `/compras/${id}`;
    case "productions": return `/producao/${id}`;
    case "inventory_counts": return `/inventario/${id}`;
    case "checklist_executions": return `/checklists/executar/${id}`;
    case "recipes": return `/fichas/${id}`;
    case "suppliers": return `/fornecedores/${id}`;
    default: return null;
  }
}

const FIELD_LABEL: Record<string, string> = {
  name: "Nome", title: "Título", status: "Status", quantity: "Quantidade", unit_cost: "Custo unitário", total_cost: "Custo total", cost: "Custo", price: "Preço",
  min_stock: "Estoque mínimo", max_stock: "Estoque máximo", reorder_point: "Ponto de reposição", ideal_stock: "Estoque ideal", expires_at: "Validade", notes: "Observações",
  active: "Ativo", lot_code: "Lote", invoice_number: "Nota fiscal", received_at: "Recebido em", finished_at: "Finalizado em", planned_quantity: "Qtd. planejada",
  produced_quantity: "Qtd. produzida", total: "Total", supplier_id: "Fornecedor", product_id: "Produto", category_id: "Categoria", store_id: "Unidade",
  location_id: "Local", description: "Descrição", priority: "Prioridade", due_at: "Prazo", assigned_to: "Responsável", result: "Resultado", full_name: "Nome completo",
  email: "E-mail", phone: "Telefone", all_stores: "Todas as unidades", access_role_id: "Perfil", internal_code: "Código", sku: "SKU", barcode: "Código de barras",
  shelf_life_days: "Validade (dias)", storage_type: "Armazenamento", created_at: "Criado em", updated_at: "Atualizado em", key: "Chave", value: "Valor",
  temperature: "Temperatura", min_temp: "Temp. mínima", max_temp: "Temp. máxima", scheduled_for: "Programado para", number: "Número", kind: "Tipo", origin: "Origem",
};

export function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key.replace(/_/g, " ");
}

const HIDDEN_FIELDS = new Set(["id", "company_id", "client_op_id", "search", "tsv"]);

/** Chaves a exibir no comparativo antes/depois (união, sem técnicas). */
export function auditKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set<string>();
  for (const o of [before, after]) if (o) for (const k of Object.keys(o)) if (!HIDDEN_FIELDS.has(k)) keys.add(k);
  return Array.from(keys).sort((a, b) => {
    const pa = a in FIELD_LABEL ? 0 : 1, pb = b in FIELD_LABEL ? 0 : 1;
    return pa - pb || a.localeCompare(b);
  });
}

export function isChanged(key: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): boolean {
  if (!before || !after) return true;
  return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
}

/** Valor legível para funcionário. */
export function fmtAuditValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") {
    if (/cost|price|total|value/.test(key)) return fmtMoney(v);
    return fmtQty(v);
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
    if (/^\d+(\.\d+)?$/.test(v) && /cost|price|total|value|quantity|stock|factor/.test(key)) return /cost|price|total|value/.test(key) ? fmtMoney(v) : fmtQty(v);
    return v;
  }
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  return JSON.stringify(v);
}

export type AuditFiltersData = { entities: { entity: string; total: number }[]; actions: { action: string; total: number }[] };

/** Entidades e ações existentes na auditoria da empresa (RPC ops_audit_filters). */
export function useAuditFilters(companyId: string | undefined) {
  return useQuery({
    queryKey: ["audit_logs", "filters", companyId],
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        return await rpc<AuditFiltersData>("ops_audit_filters", { p_company: companyId });
      } catch {
        // função ausente (banco desatualizado): usa a lista conhecida
        return { entities: KNOWN_AUDIT_ENTITIES.map((e) => ({ entity: e, total: 0 })), actions: [] } as AuditFiltersData;
      }
    },
  });
}

export type AuditQueryFilters = {
  from: string; to: string; userId: string; userText: string; entity: string; action: string; storeId: string; term: string;
};

export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, "%")}%`;
}

/** Monta a consulta de auditoria com os filtros (usada na lista e na exportação). */
export function auditQuery(companyId: string, f: AuditQueryFilters, from: number, to: number, withCount = true) {
  let q = supabaseBrowser().from("v_audit_logs").select("*", withCount ? { count: "exact" } : undefined).eq("company_id", companyId).order("created_at", { ascending: false }).range(from, to);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00`);
  if (f.to) q = q.lt("created_at", `${f.to}T23:59:59.999`);
  if (f.userId) q = q.eq("user_id", f.userId);
  if (f.userText.trim()) q = q.ilike("user_name", likeTerm(f.userText));
  if (f.entity) q = q.eq("entity", f.entity);
  if (f.action) q = q.eq("action", f.action);
  if (f.storeId) q = q.eq("store_id", f.storeId);
  if (f.term.trim()) {
    const like = likeTerm(f.term);
    q = q.or(`entity_label.ilike.${like},detail.ilike.${like}`);
  }
  return q;
}

export async function fetchAuditPage(companyId: string, f: AuditQueryFilters, from: number, to: number): Promise<{ rows: AuditLog[]; total: number }> {
  const res = await auditQuery(companyId, f, from, to);
  const data = unwrap(res) as AuditLog[];
  return { rows: data ?? [], total: res.count ?? 0 };
}
