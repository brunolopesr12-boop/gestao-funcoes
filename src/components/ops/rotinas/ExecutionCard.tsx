"use client";

import Link from "next/link";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/ops/format";
import { CHECKLIST_KIND_LABEL, EXEC_STATUS_LABEL } from "@/lib/ops/types";
import { SHIFT_LABEL, execProgress, isExecutionLate, type ExecutionRow } from "@/lib/ops/modules/rotinas";
import { Badge, ProgressBar, toneFor } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/** Cartão de uma execução de checklist (hoje, atrasados, histórico). */
export function ExecutionCard({ row, today, showDate, canExecute }: { row: ExecutionRow; today: string; showDate?: boolean; canExecute: boolean }) {
  const late = isExecutionLate(row, today);
  const done = row.status === "concluido";
  const closed = done || row.status === "cancelado";
  const pct = execProgress(row);
  const href = `/checklists/executar/${row.id}`;
  return (
    <div className={`card p-3.5 ${late && !closed ? "border-rose-500/40" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={href} className="min-w-0 flex-1">
          <p className="truncate text-base font-extrabold leading-tight">{row.checklists?.name ?? "Checklist"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            {row.checklists?.kind && <span>{CHECKLIST_KIND_LABEL[row.checklists.kind]}</span>}
            {showDate && <span>· {fmtDate(row.due_date)}</span>}
            {row.due_time && <span>· previsto {fmtTime(row.due_time)}</span>}
            {row.shift && <span>· {SHIFT_LABEL[row.shift] ?? row.shift}</span>}
            {row.checklists?.mandatory && <span className="text-amber-300">· obrigatório</span>}
          </p>
        </Link>
        <Badge tone={late && !closed ? "red" : toneFor(row.status)}>{late && !closed ? "Atrasado" : EXEC_STATUS_LABEL[row.status]}</Badge>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <ProgressBar value={pct} className="flex-1" tone={done ? "green" : undefined} />
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-300">{row.done_items}/{row.total_items}</span>
      </div>
      {done && (
        <p className="mt-1.5 text-xs text-slate-400">
          Concluído {fmtDateTime(row.finished_at)}{row.finished_by_name ? ` por ${row.finished_by_name}` : ""}
        </p>
      )}
      <div className="mt-2.5">
        <Link
          href={href}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold active:scale-[0.98] ${
            closed || !canExecute ? "border border-[var(--line)] bg-white/5 text-slate-200" : "bg-[var(--accent)] text-white"
          }`}
        >
          <Icon name={closed ? "eye" : "checkSquare"} size={18} />
          {closed ? "Ver" : canExecute ? (row.status === "em_andamento" ? "Continuar" : "Executar") : "Ver itens"}
        </Link>
      </div>
    </div>
  );
}
