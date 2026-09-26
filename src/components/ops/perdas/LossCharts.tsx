"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate, fmtDateShort, fmtMoney, fmtPct, fmtQty } from "@/lib/ops/format";
import type { LossReportCompared, LossReportRow } from "@/lib/ops/modules/perdas";
import { Badge } from "@/components/ops/ui";

/* Paleta validada (dataviz): uma série por gráfico, azul no fundo escuro. */
const SERIES = "#3987e5";
const GRID = "#24314f";
const INK = "#94a3b8";

export type Metric = "cost" | "quantity";

const fmtMetric = (m: Metric, v: number) => (m === "cost" ? fmtMoney(v) : fmtQty(v));
const fmtAxis = (m: Metric, v: number) => (m === "cost" ? fmtMoney(v).replace(/,00$/, "") : fmtQty(v));

function truncate(s: string, n = 18) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ChartTip({ active, payload, metric, isDay }: { active?: boolean; payload?: { payload: LossReportRow }[]; metric: Metric; isDay?: boolean }) {
  if (!active || !payload || payload.length === 0) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-slate-100">{isDay ? fmtDate(r.label) : r.label}</p>
      <p className="text-slate-300">Valor: <span className="font-semibold text-slate-100">{fmtMoney(r.cost)}</span></p>
      <p className="text-slate-300">Quantidade: <span className="font-semibold text-slate-100">{fmtQty(r.quantity)}</span></p>
      <p className="text-slate-300">Registros: <span className="font-semibold text-slate-100">{r.occurrences}</span></p>
      {metric === "quantity" && <p className="mt-1 text-[10px] text-slate-500">Quantidades somam unidades diferentes.</p>}
    </div>
  );
}

/** Barras horizontais (rótulos longos cabem no celular). */
export function LossBarChart({ rows, metric }: { rows: LossReportRow[]; metric: Metric }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-500">Sem perdas no período.</p>;
  const h = Math.max(120, rows.length * 34 + 30);
  return (
    <div className="w-full" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fill: INK, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtAxis(metric, v)} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fill: INK, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: string) => truncate(v)} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ChartTip metric={metric} />} />
          <Bar dataKey={metric} fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Linha por dia. */
export function LossLineChart({ rows, metric }: { rows: LossReportRow[]; metric: Metric }) {
  if (rows.every((r) => r.cost === 0 && r.quantity === 0)) return <p className="py-8 text-center text-sm text-slate-500">Sem perdas no período.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fill: INK, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: string) => fmtDateShort(v)} minTickGap={24} />
          <YAxis tick={{ fill: INK, fontSize: 11 }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => fmtAxis(metric, v)} />
          <Tooltip cursor={{ stroke: INK, strokeDasharray: "3 3" }} content={<ChartTip metric={metric} isDay />} />
          <Line type="monotone" dataKey={metric} stroke={SERIES} strokeWidth={2} dot={rows.length <= 45 ? { r: 3, fill: SERIES, strokeWidth: 0 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Variação em relação ao período anterior: subir perdas é ruim (vermelho). */
export function VariationBadge({ value }: { value: number | null }) {
  if (value === null) return <Badge tone="slate">novo</Badge>;
  if (Math.abs(value) < 0.05) return <Badge tone="slate">= igual</Badge>;
  return <Badge tone={value > 0 ? "red" : "green"}>{value > 0 ? "▲" : "▼"} {fmtPct(Math.abs(value), 0)}</Badge>;
}

/** Tabela com R$, quantidade, registros e comparação ao período anterior. */
export function ReportTable({ rows, isDay, labelHeader = "Item" }: { rows: LossReportCompared[]; isDay?: boolean; labelHeader?: string }) {
  if (rows.length === 0) return null;
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalPrev = rows.reduce((s, r) => s + r.prev_cost, 0);
  const totalOcc = rows.reduce((s, r) => s + r.occurrences, 0);
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)]">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2 font-bold">{labelHeader}</th>
            <th className="px-3 py-2 text-right font-bold">Valor</th>
            <th className="px-3 py-2 text-right font-bold">Qtd.</th>
            <th className="px-3 py-2 text-right font-bold">Registros</th>
            <th className="px-3 py-2 text-right font-bold">Período anterior</th>
            <th className="px-3 py-2 text-right font-bold">Variação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-3 py-2 font-semibold text-slate-100">{isDay ? fmtDate(r.label) : r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.cost)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmtQty(r.quantity)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.occurrences}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">{fmtMoney(r.prev_cost)}</td>
              <td className="px-3 py-2 text-right"><VariationBadge value={r.variation} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--line)] text-xs font-bold text-slate-300">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(totalCost)}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right tabular-nums">{totalOcc}</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-400">{fmtMoney(totalPrev)}</td>
            <td className="px-3 py-2 text-right"><VariationBadge value={totalPrev > 0 ? ((totalCost - totalPrev) / totalPrev) * 100 : totalCost > 0 ? null : 0} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
