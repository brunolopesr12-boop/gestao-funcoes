"use client";

import { useEffect, useState } from "react";
import type { ChecklistTask } from "@/lib/ops/types";
import { Button, Field, Sheet, TextArea, TextInput, Toggle } from "@/components/ops/ui";

export type TaskForm = { text: string; description: string; critical: boolean; requires_photo: boolean; active: boolean };

/** Edição de uma tarefa (item) de um modelo de checklist. */
export function ChecklistTaskSheet({ open, onClose, task, onSave, busy }: { open: boolean; onClose: () => void; task: ChecklistTask | null; onSave: (f: TaskForm) => void; busy: boolean }) {
  const [f, setF] = useState<TaskForm>({ text: "", description: "", critical: false, requires_photo: false, active: true });
  useEffect(() => {
    if (!open) return;
    setF(task ? { text: task.text, description: task.description, critical: task.critical, requires_photo: task.requires_photo, active: task.active } : { text: "", description: "", critical: false, requires_photo: false, active: true });
  }, [open, task]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={task ? "Editar tarefa" : "Nova tarefa"}
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy || !f.text.trim()} onClick={() => onSave({ ...f, text: f.text.trim(), description: f.description.trim() })}>{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      }
    >
      <Field label="Tarefa" hint="Frase curta e direta, como o funcionário vai ler no celular.">
        <TextInput value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} autoFocus placeholder="Ex.: Conferir temperatura das geladeiras" />
      </Field>
      <Field label="Descrição / como fazer" hint="Opcional.">
        <TextArea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Toggle checked={f.critical} onChange={(v) => setF({ ...f, critical: v })} label="Tarefa crítica" hint="Exige observação ou foto ao marcar." />
      <Toggle checked={f.requires_photo} onChange={(v) => setF({ ...f, requires_photo: v })} label="Exige foto" hint="Só pode ser marcada com uma foto." />
      <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Ativa" hint="Inativas não entram nas próximas execuções." />
    </Sheet>
  );
}
