"use client";

import { detectPreset, presetRange, type PeriodPreset, type Range } from "@/lib/ops/modules/gestao";
import { Tabs } from "@/components/ops/ui";

/** Período com atalhos 7/30/90 dias e intervalo personalizado (de/até). */
export function PeriodPicker({ value, onChange, className = "" }: { value: Range; onChange: (r: Range) => void; className?: string }) {
  const preset = detectPreset(value);
  const set = (p: PeriodPreset) => {
    if (p === "custom") return;
    onChange(presetRange(Number(p)));
  };
  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center ${className}`}>
      <Tabs<PeriodPreset>
        value={preset}
        onChange={set}
        className="!mb-0"
        tabs={[
          { value: "7", label: "7 dias" },
          { value: "30", label: "30 dias" },
          { value: "90", label: "90 dias" },
          { value: "custom", label: "Personalizado" },
        ]}
      />
      <div className="flex items-center gap-2">
        <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="field min-w-0 flex-1 !py-2" aria-label="De" />
        <span className="text-sm text-slate-500">até</span>
        <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="field min-w-0 flex-1 !py-2" aria-label="Até" />
      </div>
    </div>
  );
}
