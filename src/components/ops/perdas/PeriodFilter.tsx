"use client";

import { todayISO } from "@/lib/ops/format";

type Range = { from: string; to: string };

function monthStart(offsetMonths = 0): { from: string; to: string } {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offsetMonths + 1, 0);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: iso(first), to: iso(last) };
}

const PRESETS: { label: string; range: () => Range }[] = [
  { label: "7 dias", range: () => ({ from: todayISO(-6), to: todayISO() }) },
  { label: "30 dias", range: () => ({ from: todayISO(-29), to: todayISO() }) },
  { label: "90 dias", range: () => ({ from: todayISO(-89), to: todayISO() }) },
  { label: "Este mês", range: () => monthStart(0) },
  { label: "Mês passado", range: () => monthStart(-1) },
];

/** Período (de/até) com atalhos grandes. */
export function PeriodFilter({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <input type="date" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} className="field min-w-0 flex-1" aria-label="De" />
        <span className="text-sm text-slate-500">até</span>
        <input type="date" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} className="field min-w-0 flex-1" aria-label="Até" />
      </div>
      <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
        {PRESETS.map((p) => {
          const r = p.range();
          const active = r.from === value.from && r.to === value.to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(r)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition ${active ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--line)] bg-white/5 text-slate-300 hover:bg-white/10"}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
