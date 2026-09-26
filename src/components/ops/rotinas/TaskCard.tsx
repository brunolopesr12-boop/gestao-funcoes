"use client";

import { fmtDateTime, fmtRelative } from "@/lib/ops/format";
import { TASK_STATUS_LABEL, type Task } from "@/lib/ops/types";
import { PRIORITY_META, isTaskOverdue, sourceLabel } from "@/lib/ops/modules/rotinas";
import { Badge, Button, toneFor } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

export type TaskActions = {
  canEdit: boolean;
  canWork: (t: Task) => boolean;
  onEdit: (t: Task) => void;
  onStart: (t: Task) => void;
  onComplete: (t: Task) => void;
  onCancel: (t: Task) => void;
  onReopen: (t: Task) => void;
  busyId: string | null;
};

/** Cartão de tarefa com prioridade (cor), prazo, responsável, origem e ações rápidas. */
export function TaskCard({ task, actions, compact }: { task: Task; actions: TaskActions; compact?: boolean }) {
  const pm = PRIORITY_META[task.priority];
  const overdue = isTaskOverdue(task);
  const open = task.status !== "concluida" && task.status !== "cancelada";
  const busy = actions.busyId === task.id;
  const work = actions.canWork(task);
  return (
    <div className={`card relative overflow-hidden p-3.5 pl-4 ${overdue ? "border-rose-500/40" : ""}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${pm.bar}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-base font-extrabold leading-tight ${task.status === "concluida" ? "text-slate-400 line-through" : ""}`}>{task.title}</p>
          {!compact && task.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-400">{task.description}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={pm.tone}>{pm.label}</Badge>
          <Badge tone={overdue ? "red" : toneFor(task.status)}>{overdue ? "Atrasada" : TASK_STATUS_LABEL[task.status]}</Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className={`inline-flex items-center gap-1 ${overdue ? "font-bold text-rose-300" : ""}`}>
          <Icon name="clock" size={14} />
          {task.due_at ? `prazo ${fmtDateTime(task.due_at)}` : "sem prazo"}
        </span>
        <span className="inline-flex items-center gap-1"><Icon name="users" size={14} />{task.assigned_name || "sem responsável"}</span>
        <span className="inline-flex items-center gap-1"><Icon name="layers" size={14} />{sourceLabel(task.source_type)}</span>
        {task.status === "concluida" && task.completed_at && <span>concluída {fmtRelative(task.completed_at)}</span>}
        {task.created_by_name && <span>criada por {task.created_by_name}</span>}
      </div>
      {task.notes && !compact && <p className="mt-1.5 text-xs text-slate-500">Obs.: {task.notes}</p>}
      {(work || actions.canEdit) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {open && work && task.status !== "em_andamento" && (
            <Button size="md" variant="primary" disabled={busy} onClick={() => actions.onStart(task)}><Icon name="chevronRight" size={16} /> Iniciar</Button>
          )}
          {open && work && (
            <Button size="md" variant="success" disabled={busy} onClick={() => actions.onComplete(task)}><Icon name="check" size={16} /> Concluir</Button>
          )}
          {!open && work && (
            <Button size="md" variant="soft" disabled={busy} onClick={() => actions.onReopen(task)}><Icon name="refresh" size={16} /> Reabrir</Button>
          )}
          {actions.canEdit && (
            <Button size="md" variant="soft" disabled={busy} onClick={() => actions.onEdit(task)}><Icon name="edit" size={16} /> Editar</Button>
          )}
          {open && actions.canEdit && (
            <Button size="md" variant="ghost" className="!text-rose-300" disabled={busy} onClick={() => actions.onCancel(task)}><Icon name="x" size={16} /> Cancelar</Button>
          )}
        </div>
      )}
    </div>
  );
}
