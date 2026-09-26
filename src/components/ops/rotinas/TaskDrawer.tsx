"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import type { Task, TaskPriority } from "@/lib/ops/types";
import { TASK_PRIORITY_OPTIONS, fromLocalInput, toLocalInput } from "@/lib/ops/modules/rotinas";
import { Button, Choice, Drawer, Field, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { MemberSelect } from "@/components/ops/pickers";

type Form = { title: string; description: string; assigned_to: string; priority: TaskPriority; due_at: string; notes: string };
const empty: Form = { title: "", description: "", assigned_to: "", priority: "media", due_at: "", notes: "" };

/** Criar/editar uma tarefa (gravação direta em `tasks`; o trigger cuida de nomes e datas). */
export function TaskDrawer({ open, onClose, task, onSaved }: { open: boolean; onClose: () => void; task: Task | null; onSaved?: (id: string) => void }) {
  const { store } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(task ? { title: task.title, description: task.description, assigned_to: task.assigned_to ?? "", priority: task.priority, due_at: toLocalInput(task.due_at), notes: task.notes } : empty);
  }, [open, task]);

  const valid = f.title.trim().length > 0;

  async function save() {
    if (!store || !valid) return;
    setBusy(true);
    try {
      const payload = {
        title: f.title.trim(), description: f.description.trim(), assigned_to: f.assigned_to || null, priority: f.priority, due_at: fromLocalInput(f.due_at), notes: f.notes.trim(),
      };
      const sb = supabaseBrowser();
      let id = task?.id ?? "";
      if (task) {
        const res = await sb.from("tasks").update(payload).eq("id", task.id);
        if (res.error) throw toOpsError(res.error);
      } else {
        const res = await sb.from("tasks").insert({ ...payload, store_id: store.id, source_type: "manual" }).select("id").single();
        if (res.error) throw toOpsError(res.error);
        id = (res.data as { id: string }).id;
      }
      notify(task ? "Tarefa atualizada" : "Tarefa criada");
      invalidate("tasks", "alerts");
      onSaved?.(id);
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={task ? "Editar tarefa" : "Nova tarefa"}
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy || !valid} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      }
    >
      <Field label="Título">
        <TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus placeholder="Ex.: Limpar a câmara fria" />
      </Field>
      <Field label="Descrição" hint="Opcional. O que precisa ser feito.">
        <TextArea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Field label="Responsável" hint="Quem vai executar. Deixe em branco para qualquer pessoa da equipe.">
        <MemberSelect value={f.assigned_to} onChange={(v) => setF({ ...f, assigned_to: v })} placeholder="Sem responsável" />
      </Field>
      <p className="mb-1.5 text-sm font-semibold text-slate-300">Prioridade</p>
      <Choice value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={TASK_PRIORITY_OPTIONS} columns={4} />
      <Field label="Prazo" hint="Opcional. Depois do prazo a tarefa aparece como atrasada.">
        <TextInput type="datetime-local" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} />
      </Field>
      <Field label="Observações" hint="Opcional.">
        <TextArea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Drawer>
  );
}
