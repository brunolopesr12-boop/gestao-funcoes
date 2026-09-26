"use client";

import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtMoney, fmtPct, todayISO } from "@/lib/ops/format";
import { REPORT_GROUPS, compareByIndex, compareRows, daysBetween, fillDays, lossReportOptions, previousPeriod, variationPct, type LossReportRow } from "@/lib/ops/modules/perdas";
import { EmptyState, ErrorBox, KpiCard, PageHeader, SectionCard, Skeleton, Tabs } from "@/components/ops/ui";
import { PeriodFilter } from "@/components/ops/perdas/PeriodFilter";
import { LossBarChart, LossLineChart, ReportTable, VariationBadge, type Metric } from "@/components/ops/perdas/LossCharts";

/** Painel de perdas: gráficos por motivo, produto, funcionário, dia e categoria, com comparação ao período anterior. */
export default function PainelPerdasPage() {
  const { store, can } = useSession();
  const [range, setRange] = useState({ from: todayISO(-29), to: todayISO() });
  const [metric, setMetric] = useState<Metric>("cost");
  const prev = previousPeriod(range.from, range.to);
  const enabled = can("relatorios.ver");

  const cur = useQueries({ queries: REPORT_GROUPS.map((g) => lossReportOptions(store?.id, range.from, range.to, g.value, enabled)) });
  const before = useQueries({ queries: REPORT_GROUPS.map((g) => lossReportOptions(store?.id, prev.from, prev.to, g.value, enabled)) });

  const byReason = cur[0]?.data ?? [];
  const byReasonPrev = before[0]?.data ?? [];
  const total = byReason.reduce((s, r) => s + r.cost, 0);
  const totalPrev = byReasonPrev.reduce((s, r) => s + r.cost, 0);
  const records = byReason.reduce((s, r) => s + r.occurrences, 0);
  const recordsPrev = byReasonPrev.reduce((s, r) => s + r.occurrences, 0);
  const days = daysBetween(range.from, range.to);
  const top = byReason[0] ?? null;
  const firstError = cur.find((q) => q.error)?.error ?? before.find((q) => q.error)?.error ?? null;
  const loadingAny = cur.some((q) => q.isLoading);

  if (!enabled) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Painel de perdas" backHref="/perdas" icon="chart" />
        <EmptyState emoji="🔒" title="Este painel exige a permissão “Relatórios: ver”" description="Peça ao gerente. Você ainda pode consultar a lista de perdas." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Painel de perdas" subtitle={store ? `${store.name} · ${fmtDate(range.from)} a ${fmtDate(range.to)} (${days} dias)` : undefined} backHref="/perdas" icon="chart" />

      <div className="card mb-4 p-3">
        <PeriodFilter value={range} onChange={setRange} />
      </div>

      {firstError && <ErrorBox error={toOpsError(firstError as Error).message} onRetry={() => { cur.forEach((q) => void q.refetch()); before.forEach((q) => void q.refetch()); }} />}

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Total perdido" value={loadingAny ? "…" : fmtMoney(total)} tone={total > 0 ? "red" : "green"} icon="chart" hint={`anterior (${fmtDate(prev.from)} a ${fmtDate(prev.to)}): ${fmtMoney(totalPrev)}`} />
        <KpiCard
          label="Variação"
          value={loadingAny ? "…" : <VariationBadge value={variationPct(total, totalPrev)} />}
          tone="slate"
          icon="percent"
          hint={variationPct(total, totalPrev) === null ? "sem base de comparação" : `${fmtPct(Math.abs(variationPct(total, totalPrev) ?? 0), 0)} em relação ao período anterior`}
        />
        <KpiCard label="Registros" value={loadingAny ? "…" : records} tone="blue" icon="list" hint={`anterior: ${recordsPrev} · média ${fmtMoney(days > 0 ? total / days : 0)}/dia`} />
        <KpiCard label="Maior motivo" value={loadingAny ? "…" : top ? <span className="text-lg">{top.label}</span> : "—"} tone="amber" icon="alert" hint={top ? `${fmtMoney(top.cost)} · ${top.occurrences} registro(s)` : "nenhuma perda no período"} />
      </div>

      <Tabs value={metric} onChange={setMetric} tabs={[{ value: "cost", label: "Em R$" }, { value: "quantity", label: "Em quantidade" }]} />

      <div className="space-y-4">
        {REPORT_GROUPS.map((g, i) => {
          const q = cur[i];
          const p = before[i];
          const rowsRaw: LossReportRow[] = q?.data ?? [];
          const isDay = g.value === "dia";
          const sorted = isDay ? fillDays(rowsRaw, range.from, range.to) : [...rowsRaw].sort((a, b) => b[metric] - a[metric]);
          const chartRows = g.limit ? sorted.slice(0, g.limit) : sorted;
          const compared = isDay
            ? compareByIndex(sorted, fillDays(p?.data ?? [], prev.from, prev.to)).filter((r) => r.occurrences > 0 || r.prev_occurrences > 0)
            : compareRows(chartRows, p?.data ?? []);
          return (
            <SectionCard key={g.value} title={g.title} action={<span className="text-xs text-slate-500">{g.subtitle}</span>}>
              {q?.isLoading ? (
                <Skeleton rows={2} />
              ) : q?.error ? (
                <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
              ) : (
                <>
                  {g.kind === "line" ? <LossLineChart rows={chartRows} metric={metric} /> : <LossBarChart rows={chartRows} metric={metric} />}
                  {isDay && <p className="mt-2 text-[11px] text-slate-500">A comparação por dia usa o mesmo dia relativo do período anterior (1º dia com 1º dia, e assim por diante).</p>}
                  {g.limit && rowsRaw.length > g.limit && <p className="mt-2 text-[11px] text-slate-500">Mostrando os {g.limit} maiores de {rowsRaw.length}.</p>}
                  <ReportTable rows={compared} isDay={isDay} labelHeader={g.value === "dia" ? "Dia" : g.value === "usuario" ? "Funcionário" : g.value === "produto" ? "Produto" : g.value === "categoria" ? "Categoria" : "Motivo"} />
                </>
              )}
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
