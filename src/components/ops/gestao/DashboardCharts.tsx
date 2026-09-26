"use client";

import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate, fmtDateShort, fmtMoney, fmtQty, LEVEL_META } from "@/lib/ops/format";
import { CATEGORICAL, CHART } from "@/lib/ops/modules/gestao";
import type { DashboardData } from "@/lib/ops/types";
import { Icon } from "@/components/ops/Icon";

type Series = DashboardData["series"];

/* ------------------------------------------------------------------ */
/* Moldura de gráfico com carregando / vazio                            */
/* ------------------------------------------------------------------ */
export function ChartCard({
  title, subtitle, loading, empty, emptyText = "Sem dados no período.", action, children, className = "",
}: { title: string; subtitle?: string; loading?: boolean; empty?: boolean; emptyText?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card flex flex-col p-4 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {loading ? (
        <div className="h-56 animate-pulse rounded-xl bg-white/5" />
      ) : empty ? (
        <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
          <Icon name="chart" className="text-slate-600" />
          <p className="text-sm text-slate-500">{emptyText}</p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const truncate = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const axisMoney = (v: number) => fmtMoney(v).replace(/,00$/, "");

function Tip({ active, payload, label, lines, format }: { active?: boolean; payload?: { payload: Record<string, unknown> }[]; label?: string; lines: (r: Record<string, unknown>) => { k: string; v: string }[]; format?: (label: string) => string }) {
  if (!active || !payload || payload.length === 0) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-slate-100">{(format ?? ((x: string) => x))(String(label ?? r.label ?? ""))}</p>
      {lines(r).map((l) => (
        <p key={l.k} className="text-slate-300">{l.k}: <span className="font-semibold text-slate-100">{l.v}</span></p>
      ))}
    </div>
  );
}

const AXIS = { fill: CHART.ink, fontSize: 11 };

/* ------------------------------------------------------------------ */
/* Perdas por dia (área)                                               */
/* ------------------------------------------------------------------ */
export function LossesByDay({ rows }: { rows: Series["losses_by_day"] }) {
  const data = rows.map((r) => ({ ...r, label: r.day }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="lossFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.orange} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART.orange} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: string) => fmtDateShort(v)} minTickGap={24} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={axisMoney} />
          <Tooltip cursor={{ stroke: CHART.ink, strokeDasharray: "3 3" }} content={<Tip format={fmtDate} lines={(r) => [{ k: "Valor", v: fmtMoney(r.value) }, { k: "Quantidade", v: fmtQty(r.quantity) }]} />} />
          <Area type="monotone" dataKey="value" stroke={CHART.orange} strokeWidth={2} fill="url(#lossFill)" dot={data.length <= 45 ? { r: 3, fill: CHART.orange, strokeWidth: 0 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barras horizontais (perdas por motivo, mais consumidos)             */
/* ------------------------------------------------------------------ */
export function HBars({ rows, color, valueKey = "cost", lines }: { rows: Record<string, unknown>[]; color: string; valueKey?: string; lines: (r: Record<string, unknown>) => { k: string; v: string }[] }) {
  const h = Math.max(120, rows.length * 32 + 24);
  return (
    <div className="w-full" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={axisMoney} />
          <YAxis type="category" dataKey="label" width={118} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: string) => truncate(v)} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip lines={lines} />} />
          <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barras verticais (consumo por categoria, produção por dia)          */
/* ------------------------------------------------------------------ */
export function VBars({ rows, color, xKey, valueKey, isDay, yFormat = "money", lines }: {
  rows: Record<string, unknown>[]; color: string; xKey: string; valueKey: string; isDay?: boolean; yFormat?: "money" | "qty"; lines: (r: Record<string, unknown>) => { k: string; v: string }[];
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap={rows.length > 20 ? 2 : 8}>
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: string) => (isDay ? fmtDateShort(v) : truncate(v, 12))} minTickGap={isDay ? 24 : 8} interval={isDay ? "preserveStartEnd" : 0} angle={!isDay && rows.length > 5 ? -20 : 0} height={!isDay && rows.length > 5 ? 44 : 30} textAnchor={!isDay && rows.length > 5 ? "end" : "middle"} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => (yFormat === "money" ? axisMoney(v) : fmtQty(v))} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip lines={lines} format={isDay ? fmtDate : undefined} />} />
          <Bar dataKey={valueKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rosca: estoque por categoria (8 fatias + "Outras")                  */
/* ------------------------------------------------------------------ */
export function StockDonut({ rows }: { rows: Series["stock_by_category"] }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  const data = rest.length > 0
    ? [...top, { label: "Outras", id: null, products: rest.reduce((s, r) => s + r.products, 0), value: rest.reduce((s, r) => s + r.value, 0) }]
    : top;
  const total = data.reduce((s, r) => s + r.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-52 w-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="var(--panel)" strokeWidth={2} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />)}
            </Pie>
            <Tooltip content={<Tip lines={(r) => [{ k: "Valor", v: fmtMoney(r.value) }, { k: "Produtos", v: String(r.products) }, { k: "Participação", v: `${total > 0 ? ((Number(r.value) / total) * 100).toFixed(1) : "0"}%` }]} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
        {data.map((r, i) => (
          <li key={`${r.label}-${i}`} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
            <span className="min-w-0 flex-1 truncate text-slate-300">{r.label}</span>
            <span className="tabular-nums text-slate-500">{total > 0 ? `${((r.value / total) * 100).toFixed(0)}%` : "—"}</span>
            <span className="w-24 text-right tabular-nums font-semibold text-slate-100">{fmtMoney(r.value)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-[var(--line)] pt-1.5 text-xs font-bold text-slate-400">
          <span>Total</span><span className="tabular-nums">{fmtMoney(total)}</span>
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Listas: próximos do vencimento e reposição sugerida                 */
/* ------------------------------------------------------------------ */
export function ExpiringList({ rows }: { rows: Series["expiring_products"] }) {
  return (
    <ul className="divide-y divide-[var(--line)]">
      {rows.map((e) => (
        <li key={e.lot_id} className="flex items-center gap-3 py-2 text-sm">
          <Link href={`/lote/${e.lot_id}`} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate font-semibold">{e.product_name}</span>
            <span className="block text-xs text-slate-500">Lote {e.lot_code} · {fmtQty(e.quantity, e.unit)} · {e.locations}</span>
          </Link>
          <span className="text-right">
            <span className="block text-xs text-slate-400">{fmtDate(e.expires_at)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.days_to_expire < 0 ? "bg-rose-500/20 text-rose-300" : e.days_to_expire <= 1 ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>
              {e.days_to_expire < 0 ? `vencido há ${Math.abs(e.days_to_expire)} d` : e.days_to_expire === 0 ? "vence hoje" : `${e.days_to_expire} d`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReplenishmentList({ rows }: { rows: Series["replenishment"] }) {
  return (
    <ul className="divide-y divide-[var(--line)]">
      {rows.map((r) => {
        const meta = LEVEL_META[r.level];
        return (
          <li key={r.product_id} className="flex items-center gap-3 py-2 text-sm">
            <span aria-hidden>{meta.dot}</span>
            <Link href={`/estoque/produto/${r.product_id}`} className="min-w-0 flex-1 hover:underline">
              <span className="block truncate font-semibold">{r.product_name}</span>
              <span className="block text-xs text-slate-500">Saldo {fmtQty(r.quantity, r.unit)} · mínimo {fmtQty(r.min_stock, r.unit)}</span>
            </Link>
            <span className="text-right">
              <span className="block text-xs text-slate-400">comprar</span>
              <span className="block font-bold tabular-nums">{fmtQty(r.suggested_purchase, r.unit)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
