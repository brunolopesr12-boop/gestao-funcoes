"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDateTime } from "@/lib/ops/format";
import { fmtTemp } from "@/lib/ops/modules/rotinas";

export type ChartPoint = { id: string; measured_at: string; temperature: number; in_range: boolean; measured_by_name?: string };

/*
 * Cores validadas (dataviz · superfície escura #121a30):
 *   série  #0284c7 · fora da faixa #e11d48 · linhas de referência #d97706
 */
const SERIES = "#0284c7";
const OUT = "#e11d48";
const REF = "#d97706";

const dayShort = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const timeShort = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

type Datum = { t: number; temperature: number; in_range: boolean; id: string; who: string };

function Dot(props: { cx?: number; cy?: number; payload?: Datum }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const out = !payload.in_range;
  return <circle cx={cx} cy={cy} r={out ? 5 : 3.5} fill={out ? OUT : SERIES} stroke="#121a30" strokeWidth={2} />;
}

function TipContent({ active, payload }: { active?: boolean; payload?: { payload: Datum }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs shadow-xl">
      <p className="font-bold tabular-nums text-slate-100">{fmtTemp(d.temperature)}</p>
      <p className="text-slate-400">{fmtDateTime(new Date(d.t).toISOString())}</p>
      {d.who && <p className="text-slate-400">{d.who}</p>}
      <p className={d.in_range ? "text-emerald-300" : "text-rose-300"}>{d.in_range ? "Dentro da faixa" : "Fora da faixa"}</p>
    </div>
  );
}

/**
 * Linha de temperatura dos últimos dias de UM equipamento, com a faixa
 * aceitável (mín./máx.) como linhas de referência. Pontos fora da faixa
 * ficam destacados em vermelho e maiores (não só pela cor).
 */
export function TemperatureChart({ points, min, max, days = 7 }: { points: ChartPoint[]; min: number; max: number; days?: number }) {
  const data = useMemo<Datum[]>(
    () =>
      points
        .map((p) => ({ t: new Date(p.measured_at).getTime(), temperature: Number(p.temperature), in_range: p.in_range, id: p.id, who: p.measured_by_name ?? "" }))
        .filter((d) => Number.isFinite(d.t))
        .sort((a, b) => a.t - b.t),
    [points],
  );
  // "agora" fixo por conjunto de pontos: evita recalcular eixo/ticks a cada render
  const now = useMemo(() => Date.now(), [points]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = now - days * 86_400_000;
  const domain = useMemo<[number, number]>(() => {
    const values = data.map((d) => d.temperature).concat([Number(min), Number(max)]);
    const lo = Math.min(...values), hi = Math.max(...values);
    const pad = Math.max(1, (hi - lo) * 0.15);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [data, min, max]);
  const ticks = useMemo(() => {
    const out: number[] = [];
    const d = new Date(start);
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i <= days + 1; i++) {
      const t = d.getTime() + i * 86_400_000;
      if (t >= start && t <= now) out.push(t);
    }
    return out;
  }, [start, now, days]);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sem medições nos últimos {days} dias para este equipamento.</p>;
  }

  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[start, now]}
            ticks={ticks}
            tickFormatter={(v: number) => dayShort.format(new Date(v))}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
            tickLine={false}
          />
          <YAxis
            domain={domain}
            tickFormatter={(v: number) => `${v}°`}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<TipContent />} cursor={{ stroke: "rgba(255,255,255,0.2)", strokeDasharray: "3 3" }} />
          <ReferenceLine y={Number(max)} stroke={REF} strokeDasharray="4 4" label={{ value: `máx. ${max}°`, position: "insideTopRight", fill: "#fbbf24", fontSize: 11 }} />
          <ReferenceLine y={Number(min)} stroke={REF} strokeDasharray="4 4" label={{ value: `mín. ${min}°`, position: "insideBottomRight", fill: "#fbbf24", fontSize: 11 }} />
          <Line type="monotone" dataKey="temperature" stroke={SERIES} strokeWidth={2} dot={<Dot />} activeDot={{ r: 6, stroke: "#121a30", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px] text-slate-500">
        Passe o dedo/mouse sobre a linha para ver cada medição · pontos vermelhos maiores = fora da faixa · {timeShort.format(new Date(now))} agora
      </p>
    </div>
  );
}
