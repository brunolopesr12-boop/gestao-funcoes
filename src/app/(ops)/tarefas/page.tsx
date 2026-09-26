"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import type { Task, TaskPriority, TaskStatus } from "@/lib/ops/types";
import { TASK_PRIORITY_LABEL } from "@/lib/ops/types";
import { TASK_TABS, applyTaskFilters, applyTaskTab, type TaskQuery, type TaskTab } from "@/lib/ops/modules/rotinas";
import { Button, ConfirmSheet, EmptyState, ErrorBox, Field, InlineAlert, PageHeader, SearchInput, Select, Skeleton, Tabs, Toggle, useDebounced, usePagination, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { MemberSelect } from "@/components/ops/pickers";
import { TaskCard, type TaskActions } from "@/components/ops/rotinas/TaskCard";
import { TaskDrawer } from "@/components/ops/rotinas/TaskDrawer";

export default function TarefasPage() {
  const { store, can, user } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = can("tarefas.editar");
  const canWork = can("tarefas.executar");

  const [tab, setTab] = useState<TaskTab>("pendentes");
  const [assigned, setAssigned] = useState("");
  const [priority, setPriority] = useState<"" | TaskPriority>("");
  const [mine, setMine] = useState(false);
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const pg = usePagination(30);
  useEffect(() => pg.reset(), [tab, assigned, priority, mine, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // "agora" fixo por consulta (muda a cada minuto para as abas de prazo)
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const filters = useMemo(() => ({ assigned: mine ? user?.id ?? "" : assigned, priority, term: t }), [mine, user?.id, assigned, priority, t]);

  /* ---------------- contagens por aba (com os mesmos filtros) ---------------- */
  const counts = useQuery({
    queryKey: ["tasks", "counts", store?.id, filters, nowIso],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const sb = supabaseBrowser();
      const queries = TASK_TABS.map((tb) => {
        const q = sb.from("tasks").select("id", { count: "exact", head: true }).eq("store_id", store!.id);
        applyTaskTab(applyTaskFilters(q as unknown as TaskQuery, filters), tb.value, nowIso); // altera `q` no lugar
        return q;
      });
      const res = await Promise.all(queries);
      const out: Record<TaskTab, number> = { pendentes: 0, em_andamento: 0, atrasadas: 0, concluidas: 0, canceladas: 0 };
      TASK_TABS.forEach((tb, i) => {
        if (res[i].error) throw toOpsError(res[i].error);
        out[tb.value] = res[i].count ?? 0;
      });
      return out;
    },
  });

  /* ---------------- lista ---------------- */
  const list = useQuery({
    queryKey: ["tasks", "list", store?.id, tab, filters, pg.page, nowIso],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const closed = tab === "concluidas" || tab === "canceladas";
      const base = supabaseBrowser().from("tasks").select("*", { count: "exact" }).eq("store_id", store!.id);
      const q = closed
        ? base.order("completed_at", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false })
        : base.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      const ranged = q.range(pg.range.from, pg.range.to);
      applyTaskTab(applyTaskFilters(ranged as unknown as TaskQuery, filters), tab, nowIso); // altera `ranged` no lugar
      const res = await ranged;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as Task[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["tasks"]);

  /* ---------------- ações ---------------- */
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [toCancel, setToCancel] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(task: Task, status: TaskStatus, extra: Partial<Task> = {}, msg?: string) {
    setBusyId(task.id);
    try {
      const res = await supabaseBrowser().from("tasks").update({ status, ...extra }).eq("id", task.id);
      if (res.error) throw toOpsError(res.error);
      if (msg) notify(msg);
      invalidate("tasks", "alerts");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusyId(null);
    }
  }

  const actions: TaskActions = useMemo(
    () => ({
      canEdit,
      canWork: (task) => canEdit || (canWork && Boolean(user?.id) && task.assigned_to === user?.id),
      onEdit: (task) => { setEditing(task); setDrawer(true); },
      onStart: (task) => void setStatus(task, "em_andamento", {}, "Tarefa iniciada"),
      onComplete: (task) => void setStatus(task, "concluida", {}, "Tarefa concluída"),
      onCancel: (task) => setToCancel(task),
      onReopen: (task) => void setStatus(task, "pendente", { completed_at: null, started_at: null }, "Tarefa reaberta"),
      busyId,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canWork, user?.id, busyId],
  );

  const late = counts.data?.atrasadas ?? 0;
  const noFilters = !assigned && !priority && !mine && !t.trim();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Tarefas"
        subtitle={store ? `${store.name} · pendências da equipe` : undefined}
        icon="checkSquare"
        actions={canEdit ? <Button variant="primary" onClick={() => { setEditing(null); setDrawer(true); }}><Icon name="plus" size={16} /> Nova tarefa</Button> : undefined}
      />

      {late > 0 && (
        <InlineAlert tone="red" icon="alert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{late} tarefa(s) atrasada(s){noFilters ? "" : " (com os filtros atuais)"}</span>
            {tab !== "atrasadas" && <button type="button" onClick={() => setTab("atrasadas")} className="text-xs font-bold underline">ver atrasadas</button>}
          </div>
        </InlineAlert>
      )}

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <SearchInput value={term} onChange={setTerm} placeholder="Buscar por título ou descrição" />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <Field label="Responsável"><MemberSelect value={mine ? user?.id ?? "" : assigned} onChange={(v) => { setMine(false); setAssigned(v); }} placeholder="Todos" /></Field>
          <Field label="Prioridade">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as "" | TaskPriority)}>
              <option value="">Todas</option>
              {(["urgente", "alta", "media", "baixa"] as TaskPriority[]).map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
        </div>
        <div className="sm:w-48"><Toggle checked={mine} onChange={(v) => { setMine(v); if (v) setAssigned(""); }} label="Minhas tarefas" /></div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={TASK_TABS.map((tb) => ({ ...tb, count: counts.data?.[tb.value] }))} />

      {list.isLoading ? (
        <Skeleton rows={3} />
      ) : list.error ? (
        <ErrorBox error={toOpsError(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : (list.data?.rows ?? []).length === 0 ? (
        <EmptyState
          emoji={tab === "atrasadas" ? "🎉" : "✅"}
          title={tab === "atrasadas" ? "Nenhuma tarefa atrasada" : tab === "pendentes" ? "Nenhuma tarefa pendente" : "Nada por aqui"}
          description={noFilters ? (canEdit ? "Crie uma tarefa para a equipe com o botão Nova tarefa." : "Quando alguém atribuir uma tarefa a você, ela aparece aqui.") : "Nenhuma tarefa com os filtros escolhidos."}
          action={canEdit && noFilters && tab === "pendentes" ? <Button variant="primary" size="lg" onClick={() => { setEditing(null); setDrawer(true); }}><Icon name="plus" size={18} /> Nova tarefa</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {(list.data?.rows ?? []).map((task) => <TaskCard key={task.id} task={task} actions={actions} />)}
          </div>
          {(list.data?.total ?? 0) > pg.pageSize && (
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span className="tabular-nums">{list.data?.total} tarefas · página {pg.page + 1} de {Math.max(1, Math.ceil((list.data?.total ?? 0) / pg.pageSize))}</span>
              <div className="flex gap-1">
                <button type="button" disabled={pg.page <= 0} onClick={() => pg.setPage(pg.page - 1)} className="rounded-lg border border-[var(--line)] px-2 py-1 disabled:opacity-40"><Icon name="chevronLeft" size={16} /></button>
                <button type="button" disabled={(pg.page + 1) * pg.pageSize >= (list.data?.total ?? 0)} onClick={() => pg.setPage(pg.page + 1)} className="rounded-lg border border-[var(--line)] px-2 py-1 disabled:opacity-40"><Icon name="chevronRight" size={16} /></button>
              </div>
            </div>
          )}
        </>
      )}

      <TaskDrawer open={drawer} onClose={() => { setDrawer(false); setEditing(null); }} task={editing} />
      <ConfirmSheet
        open={Boolean(toCancel)}
        title="Cancelar tarefa?"
        message={`“${toCancel?.title ?? ""}” será marcada como cancelada. Você pode reabrir depois, se precisar.`}
        confirmLabel="Cancelar tarefa"
        onConfirm={() => { if (toCancel) void setStatus(toCancel, "cancelada", {}, "Tarefa cancelada"); }}
        onClose={() => setToCancel(null)}
      />
    </div>
  );
}
