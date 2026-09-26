"use client";

/* ------------------------------------------------------------------ */
/* Módulo ROTINAS · temperaturas, checklists e tarefas                  */
/* Tipos, rótulos, utilitários e consultas compartilhadas pelas telas.  */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import type {
  Checklist, ChecklistExecution, ChecklistFrequency, ChecklistKind, ChecklistTask, CorrectiveAction, EquipmentKind, TaskPriority, TaskStatus,
  TemperatureEquipment, UUID,
} from "@/lib/ops/types";
import { CHECKLIST_KIND_LABEL, CORRECTIVE_LABEL, EQUIPMENT_KIND_LABEL, FREQUENCY_LABEL, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/ops/types";
import type { Tone } from "@/components/ops/ui";

/* ------------------------------------------------------------------ */
/* Temperaturas                                                        */
/* ------------------------------------------------------------------ */
export type EquipmentStatus = "ok" | "fora" | "vencida" | "sem_medicao";

/** Linha de v_temperature_equipment_status (equipamento + última medição). */
export type EquipmentStatusRow = TemperatureEquipment & {
  created_at: string; updated_at: string;
  last_log_id: UUID | null; last_temperature: number | null; last_in_range: boolean | null; last_measured_at: string | null;
  last_measured_by_name: string | null; last_corrective_action: CorrectiveAction | null; last_notes: string | null;
  minutes_since: number | null; stale: boolean; status: EquipmentStatus;
};

export const EQUIPMENT_STATUS_META: Record<EquipmentStatus, { label: string; tone: Tone; dot: string; hint: string; border: string }> = {
  ok:          { label: "Dentro da faixa",   tone: "green", dot: "🟢", hint: "Última medição dentro da faixa e no prazo.",     border: "border-emerald-500/40" },
  fora:        { label: "Fora da faixa",     tone: "red",   dot: "🔴", hint: "Última medição fora da faixa aceitável.",         border: "border-rose-500/50" },
  vencida:     { label: "Medição atrasada",  tone: "amber", dot: "🟡", hint: "Passou do intervalo de medição. Meça de novo.",   border: "border-amber-500/50" },
  sem_medicao: { label: "Sem medição",       tone: "slate", dot: "⚪", hint: "Nenhuma medição registrada ainda.",              border: "border-[var(--line)]" },
};

/** Faixas sugeridas por tipo de equipamento (apenas valor inicial, editável). */
export const DEFAULT_RANGE: Record<EquipmentKind, { min: number; max: number }> = {
  geladeira: { min: 0, max: 5 },
  freezer: { min: -25, max: -12 },
  camara_fria: { min: 0, max: 4 },
  balcao_refrigerado: { min: 0, max: 5 },
  estufa: { min: 60, max: 80 },
  outro: { min: 0, max: 5 },
};

export const EQUIPMENT_KIND_OPTIONS: { value: EquipmentKind; label: string; hint: string }[] = (Object.keys(EQUIPMENT_KIND_LABEL) as EquipmentKind[]).map((k) => ({
  value: k,
  label: EQUIPMENT_KIND_LABEL[k],
  hint: `${fmtTemp(DEFAULT_RANGE[k].min)} a ${fmtTemp(DEFAULT_RANGE[k].max)}`,
}));

/** Ações corretivas (sem a opção vazia — usada quando a temperatura está fora da faixa). */
export const CORRECTIVE_OPTIONS: { value: Exclude<CorrectiveAction, "">; label: string }[] = (Object.keys(CORRECTIVE_LABEL) as CorrectiveAction[])
  .filter((k): k is Exclude<CorrectiveAction, ""> => k !== "")
  .map((k) => ({ value: k, label: CORRECTIVE_LABEL[k] }));

export function fmtTemp(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} °C`;
}

export function inRange(temp: number, min: number, max: number): boolean {
  return temp >= Number(min) && temp <= Number(max);
}

/** Equipamentos da unidade com a última medição e o status calculado no banco. */
export function useEquipmentStatus(storeId: string | undefined, includeInactive = false) {
  return useQuery({
    queryKey: ["temperature_equipment", "status", storeId, includeInactive],
    enabled: Boolean(storeId),
    staleTime: 15_000,
    queryFn: async () => {
      let q = supabaseBrowser().from("v_temperature_equipment_status").select("*").eq("store_id", storeId!).order("position").order("name");
      if (!includeInactive) q = q.eq("active", true);
      return unwrap(await q) as EquipmentStatusRow[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */
export type ChecklistRow = Checklist & { created_at: string; updated_at: string; stores?: { id: UUID; name: string } | null; checklist_tasks?: { count: number }[] };
export type ExecutionRow = ChecklistExecution & { checklists?: Pick<Checklist, "id" | "name" | "kind" | "mandatory" | "description"> | null };

export const CHECKLIST_KIND_OPTIONS: { value: ChecklistKind; label: string }[] = (Object.keys(CHECKLIST_KIND_LABEL) as ChecklistKind[]).map((k) => ({ value: k, label: CHECKLIST_KIND_LABEL[k] }));
export const FREQUENCY_OPTIONS: { value: ChecklistFrequency; label: string; hint: string }[] = [
  { value: "diaria", label: FREQUENCY_LABEL.diaria, hint: "Todo dia marcado" },
  { value: "semanal", label: FREQUENCY_LABEL.semanal, hint: "Nos dias da semana marcados" },
  { value: "mensal", label: FREQUENCY_LABEL.mensal, hint: "Uma vez por mês" },
  { value: "por_turno", label: FREQUENCY_LABEL.por_turno, hint: "Manhã, tarde e noite" },
  { value: "sob_demanda", label: FREQUENCY_LABEL.sob_demanda, hint: "Só quando alguém executar" },
];
export const SHIFT_LABEL: Record<string, string> = { "": "Sem turno", "manhã": "Manhã", tarde: "Tarde", noite: "Noite" };
export const SHIFT_OPTIONS: { value: string; label: string }[] = Object.entries(SHIFT_LABEL).map(([value, label]) => ({ value, label }));

export function execProgress(e: Pick<ChecklistExecution, "done_items" | "total_items">): number {
  return e.total_items > 0 ? (e.done_items / e.total_items) * 100 : 0;
}

/** Execução considerada atrasada: status "atrasado" ou ainda aberta com data no passado. */
export function isExecutionLate(e: Pick<ChecklistExecution, "status" | "due_date">, today: string): boolean {
  return e.status === "atrasado" || ((e.status === "pendente" || e.status === "em_andamento") && e.due_date < today);
}

/** Modelos de checklist da empresa (ativos; opcionalmente só os de uma frequência). */
export function useChecklistModels(opts: { frequency?: ChecklistFrequency; includeInactive?: boolean; storeId?: string } = {}) {
  const { company } = useSession();
  return useQuery({
    queryKey: ["checklists", "models", company?.id, opts],
    enabled: Boolean(company?.id),
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabaseBrowser().from("checklists").select("*, stores(id, name), checklist_tasks(count)").eq("company_id", company!.id).order("position").order("name");
      if (!opts.includeInactive) q = q.eq("active", true);
      if (opts.frequency) q = q.eq("frequency", opts.frequency);
      if (opts.storeId) q = q.or(`store_id.is.null,store_id.eq.${opts.storeId}`);
      return unwrap(await q) as ChecklistRow[];
    },
  });
}

export function useChecklistTasks(checklistId: string | null | undefined) {
  return useQuery({
    queryKey: ["checklist_tasks", checklistId],
    enabled: Boolean(checklistId),
    queryFn: async () => unwrap(await supabaseBrowser().from("checklist_tasks").select("*").eq("checklist_id", checklistId!).order("position").order("created_at")) as ChecklistTask[],
  });
}

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */
export type TaskTab = "pendentes" | "em_andamento" | "atrasadas" | "concluidas" | "canceladas";
export const TASK_TABS: { value: TaskTab; label: string }[] = [
  { value: "pendentes", label: "Pendentes" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "atrasadas", label: "Atrasadas" },
  { value: "concluidas", label: "Concluídas" },
  { value: "canceladas", label: "Canceladas" },
];

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: Tone; bar: string; order: number }> = {
  urgente: { label: TASK_PRIORITY_LABEL.urgente, tone: "red", bar: "bg-rose-500", order: 0 },
  alta: { label: TASK_PRIORITY_LABEL.alta, tone: "amber", bar: "bg-amber-400", order: 1 },
  media: { label: TASK_PRIORITY_LABEL.media, tone: "blue", bar: "bg-blue-500", order: 2 },
  baixa: { label: TASK_PRIORITY_LABEL.baixa, tone: "slate", bar: "bg-slate-500", order: 3 },
};
export const TASK_PRIORITY_OPTIONS: { value: TaskPriority; label: string; tone: Tone }[] = (["baixa", "media", "alta", "urgente"] as TaskPriority[]).map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p], tone: PRIORITY_META[p].tone }));

export const SOURCE_LABEL: Record<string, string> = { manual: "Manual", alert: "Alerta", checklist: "Checklist", production: "Produção", receipt: "Recebimento", temperature: "Temperatura" };
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Manual";
  return SOURCE_LABEL[source] ?? source;
}

export function taskStatusLabel(s: TaskStatus): string {
  return TASK_STATUS_LABEL[s];
}

/** Tarefa vencida: prazo no passado e ainda não concluída/cancelada. */
export function isTaskOverdue(t: { status: TaskStatus; due_at: string | null }, now = Date.now()): boolean {
  if (t.status === "concluida" || t.status === "cancelada") return false;
  if (t.status === "atrasada") return true;
  return Boolean(t.due_at) && new Date(t.due_at!).getTime() < now;
}

/**
 * Visão mínima do construtor de consultas do Supabase usada pelos filtros
 * abaixo. Os métodos do PostgrestFilterBuilder alteram a própria consulta e
 * devolvem `this`, então basta chamar os filtros sobre a consulta original
 * (convertida com `as unknown as TaskQuery`) e depois aguardá-la.
 * Isso evita a instanciação de tipos "excessivamente profunda" do TS.
 */
export type TaskQuery = { eq: (c: string, v: string) => TaskQuery; or: (f: string) => TaskQuery };

/**
 * Filtro PostgREST de cada aba. Tarefas com prazo vencido contam como
 * "atrasadas" mesmo que o banco ainda não tenha reprocessado o status.
 */
export function applyTaskTab(q: TaskQuery, tab: TaskTab, nowIso: string): TaskQuery {
  switch (tab) {
    case "pendentes":
      return q.eq("status", "pendente").or(`due_at.is.null,due_at.gte.${nowIso}`);
    case "em_andamento":
      return q.eq("status", "em_andamento").or(`due_at.is.null,due_at.gte.${nowIso}`);
    case "atrasadas":
      return q.or(`status.eq.atrasada,and(status.in.(pendente,em_andamento),due_at.lt.${nowIso})`);
    case "concluidas":
      return q.eq("status", "concluida");
    case "canceladas":
      return q.eq("status", "cancelada");
  }
}

/** Filtros da tela de tarefas (responsável, prioridade, busca) sobre a mesma consulta. */
export function applyTaskFilters(q: TaskQuery, f: { assigned: string; priority: string; term: string }): TaskQuery {
  let x = q;
  if (f.assigned) x = x.eq("assigned_to", f.assigned);
  if (f.priority) x = x.eq("priority", f.priority);
  const term = f.term.trim();
  if (term) {
    const like = `%${term.replace(/[%_,()]/g, " ")}%`;
    x = x.or(`title.ilike.${like},description.ilike.${like}`);
  }
  return x;
}

/* ------------------------------------------------------------------ */
/* Datas para <input type="datetime-local"> e <input type="date">      */
/* ------------------------------------------------------------------ */
/** ISO → "yyyy-MM-ddTHH:mm" no fuso local (vazio se nulo). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** "yyyy-MM-ddTHH:mm" (fuso local) → ISO UTC (null se vazio/inválido). */
export function fromLocalInput(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Agora no formato do datetime-local. */
export function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString());
}
/** Início (00:00) e fim (23:59:59.999) de um dia local em ISO, para filtrar timestamptz. */
export function dayBoundsISO(dateISO: string): { from: string; to: string } {
  const from = new Date(`${dateISO}T00:00:00`);
  const to = new Date(`${dateISO}T23:59:59.999`);
  return { from: from.toISOString(), to: to.toISOString() };
}
