"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtTime, todayISO } from "@/lib/ops/format";
import type { ChecklistExecutionStatus } from "@/lib/ops/types";
import { CHECKLIST_KIND_LABEL, EXEC_STATUS_LABEL } from "@/lib/ops/types";
import { SHIFT_OPTIONS, useChecklistModels, type ChecklistRow, type ExecutionRow } from "@/lib/ops/modules/rotinas";
import { Badge, Button, Choice, EmptyState, ErrorBox, Field, InlineAlert, PageHeader, Select, Sheet, Skeleton, Tabs, TextInput, usePagination, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { RotinasSubnav } from "@/components/ops/rotinas/Subnav";
import { ExecutionCard } from "@/components/ops/rotinas/ExecutionCard";

type Tab = "hoje" | "atrasados" | "historico" | "sob_demanda";
const EXEC_SELECT = "*, checklists(id, name, kind, mandatory, description)";
const GROUPS: { status: ChecklistExecutionStatus[]; title: string }[] = [
  { status: ["atrasado"], title: "Atrasados" },
  { status: ["em_andamento"], title: "Em andamento" },
  { status: ["pendente"], title: "Pendentes" },
  { status: ["concluido"], title: "Concluídos" },
  { status: ["cancelado"], title: "Cancelados" },
];

/** gerações já feitas nesta sessão (uma por unidade/dia) */
const generated = new Set<string>();

export default function ChecklistsPage() {
  const { store, can } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const today = todayISO();
  const canExecute = can("checklists.executar");
  const [tab, setTab] = useState<Tab>("hoje");

  /* gera as execuções previstas de hoje (silencioso, uma vez por unidade/dia) */
  useEffect(() => {
    if (!store?.id || !can("checklists.ver")) return;
    const key = `${store.id}:${today}`;
    if (generated.has(key)) return;
    generated.add(key);
    rpc<number>("ops_generate_checklists", { p_store: store.id, p_date: today })
      .then((n) => { if (n > 0) void qc.invalidateQueries({ queryKey: ["checklist_executions"] }); })
      .catch(() => generated.delete(key));
  }, [store?.id, today, can, qc]);

  /* ---------------- hoje ---------------- */
  const hoje = useQuery({
    queryKey: ["checklist_executions", "hoje", store?.id, today],
    enabled: Boolean(store?.id),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("checklist_executions").select(EXEC_SELECT).eq("store_id", store!.id).eq("due_date", today).order("due_time", { ascending: true, nullsFirst: false }).order("created_at")) as ExecutionRow[],
  });

  /* ---------------- atrasados ---------------- */
  const pgLate = usePagination(50);
  const atrasados = useQuery({
    queryKey: ["checklist_executions", "atrasados", store?.id, today, pgLate.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await supabaseBrowser()
        .from("checklist_executions")
        .select(EXEC_SELECT, { count: "exact" })
        .eq("store_id", store!.id)
        .or(`status.eq.atrasado,and(status.in.(pendente,em_andamento),due_date.lt.${today})`)
        .order("due_date", { ascending: true })
        .order("due_time", { ascending: true, nullsFirst: false })
        .range(pgLate.range.from, pgLate.range.to);
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as unknown as ExecutionRow[], total: res.count ?? 0 };
    },
  });

  /* ---------------- histórico ---------------- */
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(today);
  const [hStatus, setHStatus] = useState<"" | ChecklistExecutionStatus>("");
  const pgHist = usePagination(50);
  useEffect(() => pgHist.reset(), [from, to, hStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const historico = useQuery({
    queryKey: ["checklist_executions", "historico", store?.id, from, to, hStatus, pgHist.page],
    enabled: Boolean(store?.id) && tab === "historico" && from <= to,
    queryFn: async () => {
      let q = supabaseBrowser().from("checklist_executions").select(EXEC_SELECT, { count: "exact" }).eq("store_id", store!.id).gte("due_date", from).lte("due_date", to)
        .order("due_date", { ascending: false }).order("finished_at", { ascending: false, nullsFirst: false }).range(pgHist.range.from, pgHist.range.to);
      if (hStatus) q = q.eq("status", hStatus);
      const res = await q;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as unknown as ExecutionRow[], total: res.count ?? 0 };
    },
  });

  /* ---------------- sob demanda ---------------- */
  const sobDemanda = useChecklistModels({ frequency: "sob_demanda", storeId: store?.id });
  const [starting, setStarting] = useState<ChecklistRow | null>(null);
  const [shift, setShift] = useState("");
  const [busy, setBusy] = useState(false);
  async function startNow() {
    if (!starting || !store) return;
    setBusy(true);
    try {
      const id = await rpc<string>("ops_checklist_start", { p_checklist: starting.id, p_store: store.id, p_date: today, p_shift: shift });
      invalidate("checklist_executions", "checklist_execution_items");
      setStarting(null);
      router.push(`/checklists/executar/${id}`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  useRealtimeInvalidate(["checklist_executions", "checklist_execution_items"]);

  const hojeRows = hoje.data ?? [];
  const doneToday = hojeRows.filter((e) => e.status === "concluido").length;
  const grouped = useMemo(() => GROUPS.map((g) => ({ ...g, rows: hojeRows.filter((e) => g.status.includes(e.status)) })).filter((g) => g.rows.length > 0), [hojeRows]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Checklists"
        subtitle={store ? `${store.name} · rotinas de abertura, fechamento, limpeza e segurança` : undefined}
        icon="list"
        actions={can("checklists.editar") ? <Link href="/checklists/modelos" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 text-[15px] font-medium"><Icon name="edit" size={16} /> Modelos</Link> : undefined}
      />
      <RotinasSubnav area="checklists" />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "hoje", label: "Hoje", count: hoje.data ? hojeRows.length : undefined },
          { value: "atrasados", label: "Atrasados", count: atrasados.data?.total },
          { value: "historico", label: "Histórico" },
          { value: "sob_demanda", label: "Sob demanda", count: sobDemanda.data?.length },
        ]}
      />

      {tab === "hoje" && (
        hoje.isLoading ? <Skeleton rows={3} /> : hoje.error ? <ErrorBox error={toOpsError(hoje.error as Error).message} onRetry={() => void hoje.refetch()} /> : hojeRows.length === 0 ? (
          <EmptyState
            emoji="📋"
            title="Nenhum checklist previsto para hoje"
            description="As execuções são geradas automaticamente a partir dos modelos ativos (frequência e dias da semana). Verifique os modelos ou execute um checklist sob demanda."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {(sobDemanda.data ?? []).length > 0 && <Button variant="primary" onClick={() => setTab("sob_demanda")}>Executar sob demanda</Button>}
                {can("checklists.editar") && <Link href="/checklists/modelos" className="rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 font-semibold">Ver modelos</Link>}
              </div>
            }
          />
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/5 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Progresso do dia</p>
                <p className="text-xs text-slate-400">{doneToday} de {hojeRows.length} checklist(s) concluído(s)</p>
              </div>
              <span className="text-2xl font-extrabold tabular-nums">{hojeRows.length > 0 ? Math.round((doneToday / hojeRows.length) * 100) : 0}%</span>
            </div>
            {grouped.map((g) => (
              <section key={g.title} className="mb-5">
                <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {g.title} <Badge tone={g.status[0] === "atrasado" ? "red" : g.status[0] === "concluido" ? "green" : "slate"}>{g.rows.length}</Badge>
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.rows.map((e) => <ExecutionCard key={e.id} row={e} today={today} canExecute={canExecute} />)}
                </div>
              </section>
            ))}
          </>
        )
      )}

      {tab === "atrasados" && (
        atrasados.isLoading ? <Skeleton rows={3} /> : atrasados.error ? <ErrorBox error={toOpsError(atrasados.error as Error).message} onRetry={() => void atrasados.refetch()} /> : (atrasados.data?.rows ?? []).length === 0 ? (
          <EmptyState emoji="🎉" title="Nenhum checklist atrasado" description="Todos os checklists de dias anteriores foram concluídos." />
        ) : (
          <>
            <InlineAlert tone="red" icon="alert">Checklists de dias anteriores ainda não concluídos. Conclua ou peça ao gerente para revisar.</InlineAlert>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(atrasados.data?.rows ?? []).map((e) => <ExecutionCard key={e.id} row={e} today={today} showDate canExecute={canExecute} />)}
            </div>
            <Pager page={pgLate.page} pageSize={pgLate.pageSize} total={atrasados.data?.total ?? 0} onPage={pgLate.setPage} />
          </>
        )
      )}

      {tab === "historico" && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="De"><TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Até"><TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Situação">
              <Select value={hStatus} onChange={(e) => setHStatus(e.target.value as "" | ChecklistExecutionStatus)}>
                <option value="">Todas</option>
                {(Object.keys(EXEC_STATUS_LABEL) as ChecklistExecutionStatus[]).map((s) => <option key={s} value={s}>{EXEC_STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
          </div>
          {from > to && <InlineAlert tone="amber">A data inicial não pode ser depois da final.</InlineAlert>}
          {historico.isLoading ? <Skeleton rows={3} /> : historico.error ? <ErrorBox error={toOpsError(historico.error as Error).message} onRetry={() => void historico.refetch()} /> : (historico.data?.rows ?? []).length === 0 ? (
            <EmptyState emoji="🗂️" title="Nada no período" description="Ajuste as datas ou a situação para ver outras execuções." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(historico.data?.rows ?? []).map((e) => <ExecutionCard key={e.id} row={e} today={today} showDate canExecute={canExecute} />)}
              </div>
              <Pager page={pgHist.page} pageSize={pgHist.pageSize} total={historico.data?.total ?? 0} onPage={pgHist.setPage} />
            </>
          )}
        </>
      )}

      {tab === "sob_demanda" && (
        sobDemanda.isLoading ? <Skeleton rows={3} /> : sobDemanda.error ? <ErrorBox error={toOpsError(sobDemanda.error as Error).message} onRetry={() => void sobDemanda.refetch()} /> : (sobDemanda.data ?? []).length === 0 ? (
          <EmptyState emoji="🧾" title="Nenhum checklist sob demanda" description="Modelos com frequência “Sob demanda” aparecem aqui para serem executados a qualquer momento (ex.: limpeza pesada, recebimento especial)." action={can("checklists.editar") ? <Link href="/checklists/modelos/novo" className="rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-white">Criar modelo</Link> : undefined} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(sobDemanda.data ?? []).map((c) => (
              <div key={c.id} className="card p-3.5">
                <p className="text-base font-extrabold leading-tight">{c.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {CHECKLIST_KIND_LABEL[c.kind]} · {c.checklist_tasks?.[0]?.count ?? 0} tarefa(s){c.mandatory ? " · obrigatório" : ""}{c.scheduled_time ? ` · ${fmtTime(c.scheduled_time)}` : ""}
                </p>
                {c.description && <p className="mt-1 line-clamp-2 text-sm text-slate-400">{c.description}</p>}
                {canExecute ? (
                  <Button variant="primary" size="lg" full className="mt-3" onClick={() => { setShift(""); setStarting(c); }}><Icon name="checkSquare" size={18} /> Executar agora</Button>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">Sem permissão para executar.</p>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <Sheet
        open={Boolean(starting)}
        onClose={() => setStarting(null)}
        title="Executar agora"
        footer={
          <div className="flex gap-2">
            <Button variant="soft" size="lg" onClick={() => setStarting(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full disabled={busy} onClick={() => void startNow()}>{busy ? "Abrindo…" : "Começar"}</Button>
          </div>
        }
      >
        <p className="mb-3 text-base font-bold">{starting?.name}</p>
        <p className="mb-2 text-sm font-semibold text-slate-300">Turno (opcional)</p>
        <Choice value={shift} onChange={setShift} options={SHIFT_OPTIONS} columns={4} />
        <p className="text-xs text-slate-500">Se já existir uma execução deste checklist hoje no mesmo turno, ela será reaberta em vez de criar outra.</p>
      </Sheet>
    </div>
  );
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
      <span className="tabular-nums">{total} registros · página {page + 1} de {pages}</span>
      <div className="flex gap-1">
        <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} className="rounded-lg border border-[var(--line)] px-2 py-1 disabled:opacity-40"><Icon name="chevronLeft" size={16} /></button>
        <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="rounded-lg border border-[var(--line)] px-2 py-1 disabled:opacity-40"><Icon name="chevronRight" size={16} /></button>
      </div>
    </div>
  );
}
