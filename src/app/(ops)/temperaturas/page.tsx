"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { downloadBlob, fmtDateTime, toCSV, todayISO } from "@/lib/ops/format";
import type { Alert, TemperatureLog } from "@/lib/ops/types";
import { CORRECTIVE_LABEL, EQUIPMENT_KIND_LABEL } from "@/lib/ops/types";
import { EQUIPMENT_STATUS_META, dayBoundsISO, fmtTemp, useEquipmentStatus, type EquipmentStatus } from "@/lib/ops/modules/rotinas";
import { Badge, Button, DataTable, EmptyState, ErrorBox, Field, InlineAlert, KpiCard, PageHeader, SectionCard, Select, Skeleton, TextInput, usePagination, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { RotinasSubnav } from "@/components/ops/rotinas/Subnav";
import { EquipmentCard } from "@/components/ops/rotinas/EquipmentCard";
import { TemperatureChart, type ChartPoint } from "@/components/ops/rotinas/TemperatureChart";

type LogRow = TemperatureLog;

const STATUS_ORDER: EquipmentStatus[] = ["fora", "vencida", "sem_medicao", "ok"];

export default function TemperaturasPage() {
  const { store, can } = useSession();
  const notify = useToast();
  const canRegister = can("temperaturas.registrar");
  const canAlerts = can("alertas.ver");

  /* ---------------- equipamentos + status ---------------- */
  const eq = useEquipmentStatus(store?.id);
  const counts = useMemo(() => {
    const c: Record<EquipmentStatus, number> = { ok: 0, fora: 0, vencida: 0, sem_medicao: 0 };
    for (const r of eq.data ?? []) c[r.status] += 1;
    return c;
  }, [eq.data]);

  /* ---------------- alertas abertos ---------------- */
  const alerts = useQuery({
    queryKey: ["alerts", "temperatura", store?.id],
    enabled: Boolean(store?.id) && canAlerts,
    queryFn: async () =>
      unwrap(
        await supabaseBrowser().from("alerts").select("id, title, message, severity, status, created_at").eq("store_id", store!.id).eq("kind", "temperatura").neq("status", "resolvido").order("created_at", { ascending: false }).limit(20),
      ) as Pick<Alert, "id" | "title" | "message" | "severity" | "status" | "created_at">[],
  });

  /* ---------------- filtros do histórico ---------------- */
  const [eqFilter, setEqFilter] = useState("");
  const [from, setFrom] = useState(todayISO(-6));
  const [to, setTo] = useState(todayISO());
  const [onlyOut, setOnlyOut] = useState(false);
  const pg = usePagination(50);
  useEffect(() => pg.reset(), [eqFilter, from, to, onlyOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const bounds = useMemo(() => ({ from: dayBoundsISO(from).from, to: dayBoundsISO(to).to }), [from, to]);

  function buildLogsQuery(select: string, count?: "exact") {
    let q = supabaseBrowser().from("temperature_logs").select(select, count ? { count } : undefined).eq("store_id", store!.id).gte("measured_at", bounds.from).lte("measured_at", bounds.to).order("measured_at", { ascending: false });
    if (eqFilter) q = q.eq("equipment_id", eqFilter);
    if (onlyOut) q = q.eq("in_range", false);
    return q;
  }

  const logs = useQuery({
    queryKey: ["temperature_logs", "list", store?.id, eqFilter, from, to, onlyOut, pg.page],
    enabled: Boolean(store?.id) && from <= to,
    queryFn: async () => {
      const res = await buildLogsQuery("*, temperature_equipment(id, name, kind)", "exact").range(pg.range.from, pg.range.to);
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as unknown as LogRow[], total: res.count ?? 0 };
    },
  });

  /* ---------------- gráfico (7 dias, 1 equipamento) ---------------- */
  const [chartEq, setChartEq] = useState<string>("");
  const chartId = eqFilter || chartEq || eq.data?.[0]?.id || "";
  const chartRow = (eq.data ?? []).find((r) => r.id === chartId) ?? null;
  const chart = useQuery({
    queryKey: ["temperature_logs", "chart", chartId],
    enabled: Boolean(chartId),
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      return unwrap(
        await supabaseBrowser().from("temperature_logs").select("id, measured_at, temperature, in_range, measured_by_name").eq("equipment_id", chartId).gte("measured_at", since).order("measured_at").limit(2000),
      ) as ChartPoint[];
    },
  });

  useRealtimeInvalidate(["temperature_logs", "temperature_equipment", "alerts"]);

  /* ---------------- exportação ---------------- */
  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    if (!store) return;
    setExporting(true);
    try {
      const res = await buildLogsQuery("*, temperature_equipment(id, name, kind)").limit(5000);
      if (res.error) throw toOpsError(res.error);
      const rows = ((res.data ?? []) as unknown as LogRow[]).map((r) => ({
        measured_at: fmtDateTime(r.measured_at), equipment: r.temperature_equipment?.name ?? "", kind: r.temperature_equipment?.kind ? EQUIPMENT_KIND_LABEL[r.temperature_equipment.kind] : "",
        temperature: Number(r.temperature), min: r.min_temp === null ? "" : Number(r.min_temp), max: r.max_temp === null ? "" : Number(r.max_temp),
        in_range: r.in_range ? "Dentro" : "Fora", action: CORRECTIVE_LABEL[r.corrective_action] ?? r.corrective_action, by: r.measured_by_name, notes: r.notes,
      }));
      const csv = toCSV(rows, [
        { key: "measured_at", label: "Data/hora" }, { key: "equipment", label: "Equipamento" }, { key: "kind", label: "Tipo" }, { key: "temperature", label: "Temperatura (°C)" },
        { key: "min", label: "Mín." }, { key: "max", label: "Máx." }, { key: "in_range", label: "Faixa" }, { key: "action", label: "Ação corretiva" }, { key: "by", label: "Responsável" }, { key: "notes", label: "Observação" },
      ]);
      downloadBlob(`temperaturas_${store.code || store.name}_${from}_${to}.csv`, csv, "text/csv;charset=utf-8");
      notify(`${rows.length} registro(s) exportado(s)`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<LogRow>[] = [
    { key: "measured_at", label: "Data/hora", render: (r) => <span className="tabular-nums">{fmtDateTime(r.measured_at)}</span> },
    { key: "equipment", label: "Equipamento", render: (r) => <span className="font-semibold">{r.temperature_equipment?.name ?? "—"}</span> },
    { key: "temperature", label: "Temperatura", align: "right", render: (r) => <span className={`font-bold tabular-nums ${r.in_range ? "text-emerald-300" : "text-rose-300"}`}>{fmtTemp(r.temperature)}</span> },
    { key: "range", label: "Faixa", hideOnMobile: true, render: (r) => <span className="text-xs tabular-nums text-slate-400">{fmtTemp(r.min_temp)} a {fmtTemp(r.max_temp)}</span> },
    { key: "in_range", label: "Situação", render: (r) => <Badge tone={r.in_range ? "green" : "red"}>{r.in_range ? "Dentro" : "Fora"}</Badge> },
    { key: "corrective_action", label: "Ação corretiva", render: (r) => (r.corrective_action ? CORRECTIVE_LABEL[r.corrective_action] : <span className="text-slate-500">—</span>) },
    { key: "measured_by_name", label: "Responsável", hideOnMobile: true },
    { key: "notes", label: "Observação", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.notes || "—"}</span> },
  ];

  const sortedEq = useMemo(() => [...(eq.data ?? [])].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.position - b.position), [eq.data]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Temperaturas"
        subtitle={store ? `${store.name} · controle de geladeiras, freezers e câmaras` : undefined}
        icon="thermometer"
        actions={
          <>
            <Button variant="soft" onClick={() => void exportCsv()} disabled={exporting || !store}><Icon name="download" size={16} /> {exporting ? "Exportando…" : "CSV"}</Button>
            <Link href="/temperaturas/equipamentos" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 text-[15px] font-medium"><Icon name="settings" size={16} /> Equipamentos</Link>
            {canRegister && (
              <Link href="/temperaturas/registrar" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[15px] font-semibold text-white"><Icon name="plus" size={16} /> Registrar</Link>
            )}
          </>
        }
      />
      <RotinasSubnav area="temperaturas" />

      {/* alertas abertos */}
      {canAlerts && alerts.data && alerts.data.length > 0 && (
        <InlineAlert tone="red" icon="alert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{alerts.data.length} alerta(s) de temperatura em aberto</span>
            <Link href="/alertas" className="text-xs font-bold underline">ver alertas</Link>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-rose-100/80">
            {alerts.data.slice(0, 5).map((a) => (
              <li key={a.id}>{a.title} · {fmtDateTime(a.created_at)}</li>
            ))}
          </ul>
        </InlineAlert>
      )}

      {/* equipamentos */}
      {eq.isLoading ? (
        <Skeleton rows={3} />
      ) : eq.error ? (
        <ErrorBox error={toOpsError(eq.error as Error).message} onRetry={() => void eq.refetch()} />
      ) : (eq.data ?? []).length === 0 ? (
        <EmptyState
          emoji="🌡️"
          title="Nenhum equipamento cadastrado"
          description="Cadastre as geladeiras, freezers e câmaras desta unidade para começar a registrar temperaturas."
          action={can("temperaturas.editar") ? <Link href="/temperaturas/equipamentos" className="rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-white">Cadastrar equipamentos</Link> : undefined}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STATUS_ORDER.map((s) => (
              <KpiCard key={s} label={EQUIPMENT_STATUS_META[s].label} value={counts[s]} tone={counts[s] > 0 ? EQUIPMENT_STATUS_META[s].tone : "slate"} hint={EQUIPMENT_STATUS_META[s].hint} />
            ))}
          </div>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedEq.map((r) => (
              <EquipmentCard key={r.id} row={r} canRegister={canRegister} onSelectChart={() => { setChartEq(r.id); setEqFilter(""); }} chartActive={r.id === chartId} />
            ))}
          </div>
        </>
      )}

      {/* gráfico */}
      {(eq.data ?? []).length > 0 && (
        <SectionCard
          className="mb-4"
          title={`Últimos 7 dias${chartRow ? ` · ${chartRow.name}` : ""}`}
          action={
            <select value={chartId} onChange={(e) => { setChartEq(e.target.value); if (eqFilter) setEqFilter(e.target.value); }} className="field !w-auto !py-1.5 text-xs" aria-label="Equipamento do gráfico">
              {(eq.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          }
        >
          {chart.isLoading ? (
            <Skeleton rows={2} />
          ) : chart.error ? (
            <ErrorBox error={toOpsError(chart.error as Error).message} onRetry={() => void chart.refetch()} />
          ) : chartRow ? (
            <TemperatureChart points={chart.data ?? []} min={Number(chartRow.min_temp)} max={Number(chartRow.max_temp)} />
          ) : null}
        </SectionCard>
      )}

      {/* histórico */}
      <SectionCard title="Histórico de medições" className="mb-4">
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Equipamento">
            <Select value={eqFilter} onChange={(e) => setEqFilter(e.target.value)}>
              <option value="">Todos</option>
              {(eq.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Situação">
            <Select value={onlyOut ? "fora" : ""} onChange={(e) => setOnlyOut(e.target.value === "fora")}>
              <option value="">Todas</option>
              <option value="fora">Só fora da faixa</option>
            </Select>
          </Field>
          <Field label="De"><TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {from > to && <InlineAlert tone="amber">A data inicial não pode ser depois da final.</InlineAlert>}
        {logs.error ? (
          <ErrorBox error={toOpsError(logs.error as Error).message} onRetry={() => void logs.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={logs.data?.rows ?? []}
            loading={logs.isLoading}
            total={logs.data?.total}
            page={pg.page}
            pageSize={pg.pageSize}
            onPage={pg.setPage}
            emptyTitle="Nenhuma medição no período"
            emptyDescription={canRegister ? "Use o botão Registrar para lançar a temperatura de um equipamento." : "Ajuste o período ou o equipamento."}
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.temperature_equipment?.name ?? "—"}</p>
                  <p className="text-xs text-slate-400">{fmtDateTime(r.measured_at)} · {r.measured_by_name || "—"}</p>
                  {(r.corrective_action || r.notes) && (
                    <p className="mt-0.5 text-xs text-slate-400">{r.corrective_action ? CORRECTIVE_LABEL[r.corrective_action] : ""}{r.corrective_action && r.notes ? " · " : ""}{r.notes}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className={`text-lg font-extrabold tabular-nums ${r.in_range ? "text-emerald-300" : "text-rose-300"}`}>{fmtTemp(r.temperature)}</p>
                  <Badge tone={r.in_range ? "green" : "red"}>{r.in_range ? "Dentro" : "Fora"}</Badge>
                </div>
              </div>
            )}
          />
        )}
      </SectionCard>
    </div>
  );
}
