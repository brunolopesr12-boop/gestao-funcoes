"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { callOfflineable } from "@/lib/ops/offline";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtDateTime, fmtTime, todayISO } from "@/lib/ops/format";
import type { ChecklistExecutionItem } from "@/lib/ops/types";
import { CHECKLIST_KIND_LABEL, EXEC_STATUS_LABEL } from "@/lib/ops/types";
import { SHIFT_LABEL, execProgress, isExecutionLate, type ExecutionRow } from "@/lib/ops/modules/rotinas";
import { Badge, Button, ConfirmSheet, ErrorBox, Field, InlineAlert, PageHeader, ProgressBar, Skeleton, TextArea, toneFor, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { ChecklistItemSheet } from "@/components/ops/rotinas/ChecklistItemSheet";

type ExecWithModel = ExecutionRow & { checklists?: (NonNullable<ExecutionRow["checklists"]> & { requires_evidence?: boolean }) | null };
type ItemSetRpc = { ok: boolean; done_items: number; total_items: number };
type LocalOverride = { done: boolean; notes: string; photo_url: string; queued: boolean };

export default function ExecutarChecklistPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { can, displayName } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const today = todayISO();

  const exec = useQuery({
    queryKey: ["checklist_executions", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("checklist_executions").select("*, checklists(id, name, kind, mandatory, description, requires_evidence)").eq("id", id).single()) as ExecWithModel,
  });
  const items = useQuery({
    queryKey: ["checklist_execution_items", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("checklist_execution_items").select("*").eq("execution_id", id).order("position").order("created_at")) as ChecklistExecutionItem[],
  });
  useRealtimeInvalidate(["checklist_executions", "checklist_execution_items"]);

  const e = exec.data ?? null;
  const closed = e ? e.status === "concluido" || e.status === "cancelado" : false;
  const canExecute = can("checklists.executar") && !closed;
  const requireEvidence = Boolean(e?.checklists?.requires_evidence);

  /* itens marcados sem internet: aplica localmente até o servidor confirmar */
  const [overrides, setOverrides] = useState<Record<string, LocalOverride>>({});
  const list = useMemo(
    () => (items.data ?? []).map((it) => {
      const o = overrides[it.id];
      return o ? { ...it, done: o.done, notes: o.notes || it.notes, photo_url: o.photo_url || it.photo_url, done_by_name: o.done ? displayName : "", done_at: o.done ? new Date().toISOString() : null, queued: o.queued } : { ...it, queued: false };
    }),
    [items.data, overrides, displayName],
  );
  useEffect(() => {
    // servidor confirmou: descarta os overrides que já batem com o banco
    if (!items.data) return;
    setOverrides((prev) => {
      const confirmed = items.data.filter((it) => prev[it.id] && prev[it.id].done === it.done);
      if (confirmed.length === 0) return prev;
      const next = { ...prev };
      for (const it of confirmed) delete next[it.id];
      return next;
    });
  }, [items.data]);

  const doneCount = list.filter((i) => i.done).length;
  const total = list.length;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;

  const [sheetItem, setSheetItem] = useState<ChecklistExecutionItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // só sincroniza a observação geral quando o texto salvo no banco muda (marcar itens
  // altera done_items e refaz a consulta — não pode apagar o que o usuário está digitando)
  const serverNotes = e?.notes;
  useEffect(() => { if (serverNotes !== undefined) setNotes(serverNotes ?? ""); }, [serverNotes]);

  async function setItem(item: ChecklistExecutionItem, done: boolean, itemNotes = "", photo = "") {
    setBusyId(item.id);
    try {
      const r = await callOfflineable<ItemSetRpc>("ops_checklist_item_set", { p_item: item.id, p_done: done, p_notes: itemNotes, p_photo_url: photo }, `Checklist: ${done ? "marcar" : "desmarcar"} “${item.text}”`);
      if (r.queued) {
        setOverrides((o) => ({ ...o, [item.id]: { done, notes: itemNotes, photo_url: photo, queued: true } }));
        notify("Sem conexão: a marcação ficou na fila e será enviada quando a internet voltar.", "info");
      } else {
        setOverrides((o) => { const n = { ...o }; delete n[item.id]; return n; });
      }
      invalidate("checklist_execution_items", "checklist_executions");
      setSheetItem(null);
    } catch (err) {
      notify(toOpsError(err as Error).message, "erro");
    } finally {
      setBusyId(null);
    }
  }

  function tap(item: ChecklistExecutionItem) {
    if (!canExecute || busyId) return;
    if (item.done) return void setItem(item, false);
    if (item.critical || item.requires_photo || requireEvidence) return setSheetItem(item);
    void setItem(item, true);
  }

  async function finish() {
    if (!e) return;
    setFinishing(true);
    try {
      const r = await rpc<{ ok: boolean; pending: number }>("ops_checklist_finish", { p_execution: e.id, p_notes: notes.trim() });
      notify(r.pending > 0 ? `Checklist finalizado com ${r.pending} item(ns) pendente(s)` : "Checklist concluído!");
      invalidate("checklist_executions", "checklist_execution_items", "alerts", "dashboard");
    } catch (err) {
      notify(toOpsError(err as Error).message, "erro");
    } finally {
      setFinishing(false);
    }
  }

  if (exec.isLoading || items.isLoading) return <div className="mx-auto max-w-2xl"><PageHeader title="Checklist" backHref="/checklists" /><Skeleton rows={4} /></div>;
  if (exec.error || !e) return <div className="mx-auto max-w-2xl"><PageHeader title="Checklist" backHref="/checklists" /><ErrorBox error={exec.error ? toOpsError(exec.error as Error).message : "Execução não encontrada."} onRetry={() => void exec.refetch()} /></div>;
  if (items.error) return <div className="mx-auto max-w-2xl"><PageHeader title="Checklist" backHref="/checklists" /><ErrorBox error={toOpsError(items.error as Error).message} onRetry={() => void items.refetch()} /></div>;

  const late = isExecutionLate(e, today);
  const pending = total - doneCount;
  const mandatory = Boolean(e.checklists?.mandatory);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={e.checklists?.name ?? "Checklist"}
        backHref="/checklists"
        icon="list"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {e.checklists?.kind && <span>{CHECKLIST_KIND_LABEL[e.checklists.kind]}</span>}
            <span>· {fmtDate(e.due_date)}</span>
            {e.due_time && <span>· previsto {fmtTime(e.due_time)}</span>}
            {e.shift && <span>· {SHIFT_LABEL[e.shift] ?? e.shift}</span>}
            <Badge tone={late && !closed ? "red" : toneFor(e.status)}>{late && !closed ? "Atrasado" : EXEC_STATUS_LABEL[e.status]}</Badge>
            {mandatory && <Badge tone="amber">obrigatório</Badge>}
          </span>
        }
      />

      <div className="card mb-4 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold">Progresso</span>
          <span className="tabular-nums text-slate-300">{doneCount} de {total}</span>
        </div>
        <ProgressBar value={pct} tone={closed ? "green" : undefined} showLabel />
        {e.checklists?.description && <p className="mt-2 text-xs text-slate-400">{e.checklists.description}</p>}
        {closed && (
          <p className="mt-2 text-sm text-slate-300">
            {e.status === "concluido" ? `Concluído ${fmtDateTime(e.finished_at)}${e.finished_by_name ? ` por ${e.finished_by_name}` : ""}.` : "Esta execução foi cancelada."} Somente leitura.
          </p>
        )}
      </div>

      {!closed && !can("checklists.executar") && <InlineAlert tone="blue" icon="info">Você pode ver os itens, mas não tem permissão para marcar (“checklists.executar”).</InlineAlert>}
      {requireEvidence && canExecute && <InlineAlert tone="amber" icon="camera">Este checklist exige evidência: cada item pede observação ou foto ao marcar.</InlineAlert>}

      {total === 0 ? (
        <InlineAlert tone="amber">Este checklist não tem tarefas. Peça ao gerente para cadastrar as tarefas no modelo.</InlineAlert>
      ) : (
        <ul className="mb-4 space-y-2">
          {list.map((it) => (
            <li key={it.id} className={`card flex items-start gap-3 p-3 ${it.done ? "border-emerald-500/30" : it.critical ? "border-amber-500/30" : ""}`}>
              <button
                type="button"
                onClick={() => tap(it)}
                disabled={!canExecute || busyId === it.id}
                aria-pressed={it.done}
                aria-label={it.done ? "Desmarcar" : "Marcar como feito"}
                className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-2 text-3xl transition active:scale-95 disabled:opacity-60 ${
                  it.done ? "border-emerald-500 bg-emerald-500/20 text-emerald-300" : "border-[var(--line)] bg-white/5 text-slate-500"
                }`}
              >
                {busyId === it.id ? <Icon name="refresh" className="animate-spin" /> : it.done ? "☑" : "☐"}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] font-semibold leading-snug ${it.done ? "text-slate-300" : ""}`}>{it.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {it.critical && <Badge tone="amber">crítica</Badge>}
                  {it.requires_photo && <Badge tone="violet" dot="📷">exige foto</Badge>}
                  {it.queued && <Badge tone="amber">na fila (offline)</Badge>}
                </div>
                {it.done && (
                  <p className="mt-1 text-xs text-slate-400">
                    Feito {it.done_at ? fmtDateTime(it.done_at) : ""}{it.done_by_name ? ` por ${it.done_by_name}` : ""}
                  </p>
                )}
                {it.notes && <p className="mt-1 text-xs text-slate-400">Obs.: {it.notes}</p>}
                {it.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={it.photo_url} target="_blank" rel="noreferrer" className="mt-1.5 block w-fit"><img src={it.photo_url} alt="Foto do item" className="h-16 w-16 rounded-lg border border-[var(--line)] object-cover" /></a>
                )}
              </div>
              {canExecute && (
                <button type="button" onClick={() => setSheetItem(it)} disabled={busyId === it.id} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-300" aria-label="Observação ou foto" title="Observação ou foto">
                  <Icon name="camera" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {closed ? (
        e.notes && <div className="card p-4 text-sm"><p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Observação geral</p><p className="text-slate-200">{e.notes}</p></div>
      ) : (
        canExecute && (
          <div className="card p-4">
            <Field label="Observação geral" hint="Opcional. Fica registrada na execução.">
              <TextArea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Ex.: faltou papel toalha; freezer 2 com ruído" />
            </Field>
            {pending > 0 && mandatory && <InlineAlert tone="amber">Checklist obrigatório: ainda há {pending} item(ns) pendente(s). Conclua todos para finalizar.</InlineAlert>}
            {pending > 0 && !mandatory && <InlineAlert tone="blue" icon="info">Há {pending} item(ns) pendente(s). Este checklist não é obrigatório, então pode ser finalizado assim mesmo.</InlineAlert>}
            <Button variant="success" size="lg" full disabled={finishing || total === 0} onClick={() => setConfirmFinish(true)}>
              <Icon name="check" size={18} /> {finishing ? "Finalizando…" : "Finalizar checklist"}
            </Button>
          </div>
        )
      )}

      <ChecklistItemSheet
        item={sheetItem}
        open={Boolean(sheetItem)}
        onClose={() => setSheetItem(null)}
        busy={Boolean(busyId)}
        requireEvidence={requireEvidence}
        onConfirm={(n, p, markDone) => { if (sheetItem) void setItem(sheetItem, markDone ? true : sheetItem.done, n, p); }}
      />
      <ConfirmSheet
        open={confirmFinish}
        title="Finalizar checklist?"
        message={pending > 0 ? `Ainda há ${pending} item(ns) sem marcar. ${mandatory ? "Como o checklist é obrigatório, o sistema vai recusar." : "Eles ficarão registrados como não feitos."}` : "Todos os itens foram marcados. Depois de finalizar não é possível alterar."}
        confirmLabel="Finalizar"
        onConfirm={() => void finish()}
        onClose={() => setConfirmFinish(false)}
      />
    </div>
  );
}
