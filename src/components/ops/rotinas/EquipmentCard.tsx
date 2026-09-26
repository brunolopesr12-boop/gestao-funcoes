"use client";

import Link from "next/link";
import { fmtRelative, fmtDateTime } from "@/lib/ops/format";
import { CORRECTIVE_LABEL, EQUIPMENT_KIND_LABEL } from "@/lib/ops/types";
import { EQUIPMENT_STATUS_META, fmtTemp, type EquipmentStatusRow } from "@/lib/ops/modules/rotinas";
import { Badge } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

const TEMP_COLOR = { ok: "text-emerald-300", fora: "text-rose-300", vencida: "text-amber-300", sem_medicao: "text-slate-500" } as const;

/** Cartão de um equipamento com a última medição e o status (verde/vermelho/âmbar/cinza). */
export function EquipmentCard({ row, canRegister, onSelectChart, chartActive }: { row: EquipmentStatusRow; canRegister: boolean; onSelectChart?: () => void; chartActive?: boolean }) {
  const meta = EQUIPMENT_STATUS_META[row.status];
  return (
    <div className={`card flex flex-col gap-2 border p-3.5 ${meta.border} ${chartActive ? "ring-2 ring-[var(--accent)]/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold leading-tight">{row.name}</p>
          <p className="truncate text-xs text-slate-400">
            {EQUIPMENT_KIND_LABEL[row.kind]}
            {row.location_text ? ` · ${row.location_text}` : ""}
          </p>
        </div>
        <Badge tone={meta.tone} dot={meta.dot}>{meta.label}</Badge>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={`text-3xl font-extrabold tabular-nums leading-none ${TEMP_COLOR[row.status]}`}>{row.last_temperature === null ? "—" : fmtTemp(row.last_temperature)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {row.last_measured_at ? (
              <span title={fmtDateTime(row.last_measured_at)}>
                {fmtRelative(row.last_measured_at)}
                {row.last_measured_by_name ? ` · ${row.last_measured_by_name}` : ""}
              </span>
            ) : (
              "nenhuma medição ainda"
            )}
          </p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p>faixa</p>
          <p className="font-semibold tabular-nums text-slate-200">{fmtTemp(row.min_temp)} a {fmtTemp(row.max_temp)}</p>
          <p>a cada {row.check_interval_min} min</p>
        </div>
      </div>

      {row.status === "fora" && row.stale && <p className="text-xs text-amber-300">Além de fora da faixa, a medição está atrasada.</p>}
      {row.status === "fora" && row.last_corrective_action && (
        <p className="text-xs text-slate-400">Ação: {CORRECTIVE_LABEL[row.last_corrective_action]}{row.last_notes ? ` · ${row.last_notes}` : ""}</p>
      )}

      <div className="mt-1 flex gap-2">
        {canRegister && (
          <Link
            href={`/temperaturas/registrar?equipment=${row.id}`}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white active:scale-[0.98]"
          >
            <Icon name="thermometer" size={18} /> Registrar
          </Link>
        )}
        {onSelectChart && (
          <button
            type="button"
            onClick={onSelectChart}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-semibold ${chartActive ? "border-[var(--accent)] text-white" : "border-[var(--line)] bg-white/5 text-slate-300"}`}
            aria-label="Ver gráfico"
            title="Ver gráfico"
          >
            <Icon name="chart" size={18} />
            <span className="hidden sm:inline">Gráfico</span>
          </button>
        )}
      </div>
    </div>
  );
}
