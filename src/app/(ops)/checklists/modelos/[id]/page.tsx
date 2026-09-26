"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { todayISO } from "@/lib/ops/format";
import type { Checklist, ChecklistFrequency, ChecklistKind, ChecklistTask } from "@/lib/ops/types";
import { WEEKDAYS } from "@/lib/ops/types";
import { CHECKLIST_KIND_OPTIONS, FREQUENCY_OPTIONS, useChecklistTasks } from "@/lib/ops/modules/rotinas";
import { Badge, Button, Choice, ConfirmSheet, ErrorBox, Field, IconButton, InlineAlert, NumberInput, PageHeader, SectionCard, Select, Skeleton, TextArea, TextInput, Toggle, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { MemberSelect } from "@/components/ops/pickers";
import { ChecklistTaskSheet, type TaskForm } from "@/components/ops/rotinas/ChecklistTaskSheet";

type Form = {
  name: string; kind: ChecklistKind; description: string; frequency: ChecklistFrequency; scheduled_time: string; weekdays: number[]; month_day: number | null;
  store_id: string; assigned_to: string; mandatory: boolean; requires_evidence: boolean; active: boolean; position: number | null;
};
const EMPTY: Form = { name: "", kind: "abertura", description: "", frequency: "diaria", scheduled_time: "", weekdays: [0, 1, 2, 3, 4, 5, 6], month_day: 1, store_id: "", assigned_to: "", mandatory: true, requires_evidence: false, active: true, position: 0 };

export default function ModeloPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const isNew = id === "novo";
  const router = useRouter();
  const { company, store, stores, canCompany, can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("checklists.editar");
  const companyStores = stores.filter((s) => s.company_id === company?.id);

  const model = useQuery({
    queryKey: ["checklists", id],
    enabled: Boolean(id) && !isNew,
    queryFn: async () => unwrap(await supabaseBrowser().from("checklists").select("*").eq("id", id).single()) as Checklist,
  });
  const tasks = useChecklistTasks(isNew ? null : id);
  useRealtimeInvalidate(["checklists", "checklist_tasks"]);

  const [f, setF] = useState<Form>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isNew) {
      setF({ ...EMPTY, store_id: "" });
      return;
    }
    const m = model.data;
    if (!m) return;
    // o modelo mudou no banco (realtime/refetch): não sobrescreve o que o usuário está editando
    if (dirtyRef.current) return;
    setF({
      name: m.name, kind: m.kind, description: m.description, frequency: m.frequency, scheduled_time: m.scheduled_time ? m.scheduled_time.slice(0, 5) : "", weekdays: m.weekdays ?? [],
      month_day: m.month_day ?? 1, store_id: m.store_id ?? "", assigned_to: m.assigned_to ?? "", mandatory: m.mandatory, requires_evidence: m.requires_evidence, active: m.active, position: m.position,
    });
    setDirty(false);
  }, [isNew, model.data]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setF((s) => ({ ...s, [k]: v }));
    dirtyRef.current = true;
    setDirty(true);
  }
  function toggleDay(d: number) {
    set("weekdays", f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d].sort());
  }

  const usesWeekdays = f.frequency === "diaria" || f.frequency === "semanal" || f.frequency === "por_turno";
  const valid = f.name.trim().length > 0 && (!usesWeekdays || f.weekdays.length > 0) && (f.frequency !== "mensal" || ((f.month_day ?? 0) >= 1 && (f.month_day ?? 0) <= 31));

  async function save() {
    if (!company || !valid) return;
    setBusy(true);
    try {
      const payload = {
        company_id: company.id, name: f.name.trim(), kind: f.kind, description: f.description.trim(), frequency: f.frequency, scheduled_time: f.scheduled_time || null,
        weekdays: usesWeekdays ? f.weekdays : [0, 1, 2, 3, 4, 5, 6], month_day: f.frequency === "mensal" ? Math.round(f.month_day ?? 1) : null,
        store_id: f.store_id || null, assigned_to: f.assigned_to || null, mandatory: f.mandatory, requires_evidence: f.requires_evidence, active: f.active, position: Math.round(f.position ?? 0),
      };
      const sb = supabaseBrowser();
      if (isNew) {
        const res = await sb.from("checklists").insert(payload).select("id").single();
        if (res.error) throw toOpsError(res.error);
        notify("Modelo criado. Agora cadastre as tarefas.");
        dirtyRef.current = false;
        setDirty(false);
        invalidate("checklists");
        router.replace(`/checklists/modelos/${(res.data as { id: string }).id}`);
      } else {
        const res = await sb.from("checklists").update(payload).eq("id", id);
        if (res.error) throw toOpsError(res.error);
        notify("Modelo salvo");
        dirtyRef.current = false;
        setDirty(false);
        invalidate("checklists");
      }
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- tarefas ---------------- */
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ChecklistTask | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<ChecklistTask | null>(null);
  const [quick, setQuick] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const list = tasks.data ?? [];

  async function saveTask(tf: TaskForm) {
    setTaskBusy(true);
    try {
      const sb = supabaseBrowser();
      const res = editingTask
        ? await sb.from("checklist_tasks").update(tf).eq("id", editingTask.id)
        : await sb.from("checklist_tasks").insert({ ...tf, checklist_id: id, position: list.length });
      if (res.error) throw toOpsError(res.error);
      notify(editingTask ? "Tarefa atualizada" : "Tarefa adicionada");
      invalidate("checklist_tasks", "checklists");
      setTaskOpen(false);
      setEditingTask(null);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setTaskBusy(false);
    }
  }
  async function quickAdd() {
    const text = quick.trim();
    if (!text) return;
    await saveTask({ text, description: "", critical: false, requires_photo: false, active: true });
    setQuick("");
  }
  async function moveTask(t: ChecklistTask, dir: -1 | 1) {
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    setTaskBusy(true);
    try {
      const order = list.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      const sb = supabaseBrowser();
      const results = await Promise.all(order.map((tid, pos) => sb.from("checklist_tasks").update({ position: pos }).eq("id", tid)));
      const err = results.find((r) => r.error)?.error;
      if (err) throw toOpsError(err);
      invalidate("checklist_tasks");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setTaskBusy(false);
    }
  }
  async function deleteTask() {
    if (!taskToDelete) return;
    setTaskBusy(true);
    try {
      const res = await supabaseBrowser().from("checklist_tasks").delete().eq("id", taskToDelete.id);
      if (res.error) throw toOpsError(res.error);
      notify("Tarefa excluída");
      invalidate("checklist_tasks", "checklists");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setTaskBusy(false);
      setTaskToDelete(null);
    }
  }

  const [generating, setGenerating] = useState(false);
  async function generateToday() {
    if (!store) return;
    setGenerating(true);
    try {
      const n = await rpc<number>("ops_generate_checklists", { p_store: store.id, p_date: todayISO() });
      notify(n > 0 ? `${n} execução(ões) gerada(s) para hoje em ${store.name}` : "Nada novo: as execuções de hoje já existiam (ou este modelo não está previsto para hoje).", n > 0 ? "ok" : "info");
      invalidate("checklist_executions", "checklist_execution_items");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setGenerating(false);
    }
  }

  if (!isNew && model.isLoading) return <div className="mx-auto max-w-3xl"><PageHeader title="Modelo de checklist" backHref="/checklists/modelos" /><Skeleton rows={4} /></div>;
  if (!isNew && (model.error || !model.data)) return <div className="mx-auto max-w-3xl"><PageHeader title="Modelo de checklist" backHref="/checklists/modelos" /><ErrorBox error={model.error ? toOpsError(model.error as Error).message : "Modelo não encontrado."} onRetry={() => void model.refetch()} /></div>;
  if (isNew && !canEdit) return <div className="mx-auto max-w-3xl"><PageHeader title="Novo modelo" backHref="/checklists/modelos" /><InlineAlert tone="red">Você não tem permissão para criar modelos (“checklists.editar”).</InlineAlert></div>;

  const ro = !canEdit;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={isNew ? "Novo modelo de checklist" : model.data?.name ?? "Modelo"}
        subtitle={isNew ? "Defina a rotina; depois cadastre as tarefas" : `${list.length} tarefa(s)${model.data?.active ? "" : " · inativo"}`}
        backHref="/checklists/modelos"
        icon="list"
        actions={!isNew && can("checklists.ver") && store ? <Button variant="soft" disabled={generating} onClick={() => void generateToday()}><Icon name="refresh" size={16} /> {generating ? "Gerando…" : "Gerar execuções de hoje"}</Button> : undefined}
      />
      {ro && <InlineAlert tone="blue" icon="info">Somente leitura: você não tem permissão para alterar modelos.</InlineAlert>}

      <SectionCard title="Dados do modelo" className="mb-4">
        <fieldset disabled={ro || busy} className="contents">
          <Field label="Nome"><TextInput value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Abertura da cozinha" autoFocus={isNew} /></Field>
          <p className="mb-1.5 text-sm font-semibold text-slate-300">Tipo</p>
          <Choice value={f.kind} onChange={(v) => set("kind", v)} options={CHECKLIST_KIND_OPTIONS} columns={3} />
          <Field label="Descrição" hint="Opcional. Orientação geral para quem executa."><TextArea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <p className="mb-1.5 text-sm font-semibold text-slate-300">Frequência</p>
          <Choice value={f.frequency} onChange={(v) => set("frequency", v)} options={FREQUENCY_OPTIONS} columns={2} />
          {usesWeekdays && (
            <div className="mb-4">
              <p className="mb-1.5 text-sm font-semibold text-slate-300">Dias da semana</p>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((d, i) => {
                  const on = f.weekdays.includes(i);
                  return (
                    <button key={d} type="button" onClick={() => toggleDay(i)} aria-pressed={on} className={`min-h-11 rounded-xl border text-sm font-bold transition ${on ? "border-[var(--accent)] bg-[var(--accent)]/20 text-white" : "border-[var(--line)] bg-white/5 text-slate-400"}`}>
                      {d}
                    </button>
                  );
                })}
              </div>
              {f.weekdays.length === 0 && <p className="mt-1 text-xs text-rose-300">Marque pelo menos um dia.</p>}
              {f.frequency === "por_turno" && <p className="mt-1 text-xs text-slate-500">Por turno: gera três execuções por dia (manhã, tarde e noite).</p>}
            </div>
          )}
          {f.frequency === "mensal" && (
            <Field label="Dia do mês" hint="De 1 a 31. Em meses mais curtos, use até 28 para não pular.">
              <NumberInput value={f.month_day} onChange={(v) => set("month_day", v)} inputMode="numeric" min={1} className="max-w-[10rem]" />
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Horário previsto" hint="Opcional. Após 2h do horário sem concluir, vira atrasado.">
              <TextInput type="time" value={f.scheduled_time} onChange={(e) => set("scheduled_time", e.target.value)} />
            </Field>
            <Field label="Unidade" hint="Uma unidade específica ou todas da empresa.">
              <Select value={f.store_id} onChange={(e) => set("store_id", e.target.value)}>
                <option value="">Todas as unidades</option>
                {companyStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Responsável padrão" hint="Opcional. Quem costuma executar esta rotina.">
            <MemberSelect value={f.assigned_to} onChange={(v) => set("assigned_to", v)} placeholder="Qualquer pessoa da equipe" />
          </Field>
          <Toggle checked={f.mandatory} onChange={(v) => set("mandatory", v)} label="Obrigatório" hint="Só pode ser finalizado com todas as tarefas marcadas." disabled={ro} />
          <Toggle checked={f.requires_evidence} onChange={(v) => set("requires_evidence", v)} label="Exige evidência" hint="Cada tarefa pede observação ou foto ao marcar." disabled={ro} />
          <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Ativo" hint="Inativos não geram execuções, mas o histórico é mantido." disabled={ro} />
          <Field label="Ordem" hint="Ordem de exibição entre os modelos.">
            <NumberInput value={f.position} onChange={(v) => set("position", v)} inputMode="numeric" min={0} className="max-w-[10rem]" />
          </Field>
        </fieldset>
        {canEdit && (
          <Button variant="primary" size="lg" full disabled={busy || !valid || (!isNew && !dirty)} onClick={() => void save()}>
            {busy ? "Salvando…" : isNew ? "Criar modelo" : "Salvar alterações"}
          </Button>
        )}
      </SectionCard>

      {isNew ? (
        <InlineAlert tone="blue" icon="info">Salve o modelo para cadastrar as tarefas.</InlineAlert>
      ) : (
        <SectionCard title={`Tarefas (${list.length})`} className="mb-4" action={canEdit ? <Button size="sm" variant="soft" onClick={() => { setEditingTask(null); setTaskOpen(true); }}><Icon name="plus" size={14} /> Detalhada</Button> : undefined}>
          {tasks.isLoading ? (
            <Skeleton rows={2} />
          ) : tasks.error ? (
            <ErrorBox error={toOpsError(tasks.error as Error).message} onRetry={() => void tasks.refetch()} />
          ) : list.length === 0 ? (
            <p className="mb-3 text-sm text-slate-400">Nenhuma tarefa ainda. Digite abaixo e pressione Adicionar.</p>
          ) : (
            <ul className="mb-3 space-y-1.5">
              {list.map((t, i) => (
                <li key={t.id} className={`flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/[0.03] px-3 py-2 ${t.active ? "" : "opacity-60"}`}>
                  <span className="w-6 shrink-0 text-center text-xs tabular-nums text-slate-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{t.text}</p>
                    {t.description && <p className="text-xs text-slate-400">{t.description}</p>}
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {t.critical && <Badge tone="amber">crítica</Badge>}
                      {t.requires_photo && <Badge tone="violet" dot="📷">exige foto</Badge>}
                      {!t.active && <Badge tone="slate">inativa</Badge>}
                    </div>
                  </div>
                  {canEdit && (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="[&>*]:rotate-180"><IconButton icon="chevronDown" label="Mover para cima" size={32} disabled={taskBusy || i === 0} onClick={() => void moveTask(t, -1)} /></span>
                      <IconButton icon="chevronDown" label="Mover para baixo" size={32} disabled={taskBusy || i === list.length - 1} onClick={() => void moveTask(t, 1)} />
                      <IconButton icon="edit" label="Editar" size={32} disabled={taskBusy} onClick={() => { setEditingTask(t); setTaskOpen(true); }} />
                      <IconButton icon="trash" label="Excluir" tone="danger" size={32} disabled={taskBusy} onClick={() => setTaskToDelete(t)} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="flex gap-2">
              <TextInput value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void quickAdd(); }} placeholder="Nova tarefa (ex.: Ligar exaustor)" className="flex-1" disabled={taskBusy} />
              <Button variant="primary" disabled={taskBusy || !quick.trim()} onClick={() => void quickAdd()}>Adicionar</Button>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Alterações nas tarefas valem para as próximas execuções; as já geradas não mudam. Para parar de usar o modelo, desative-o (o histórico é mantido).</p>
        </SectionCard>
      )}

      <ChecklistTaskSheet open={taskOpen} onClose={() => { setTaskOpen(false); setEditingTask(null); }} task={editingTask} onSave={(tf) => void saveTask(tf)} busy={taskBusy} />
      <ConfirmSheet
        open={Boolean(taskToDelete)}
        title="Excluir tarefa?"
        message={`“${taskToDelete?.text ?? ""}” sai do modelo. As execuções já geradas não são alteradas.`}
        confirmLabel="Excluir"
        onConfirm={() => void deleteTask()}
        onClose={() => setTaskToDelete(null)}
      />
    </div>
  );
}
