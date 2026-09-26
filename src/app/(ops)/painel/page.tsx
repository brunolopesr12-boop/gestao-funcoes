"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/ops/format";
import { CHART, KPI_SECTIONS, fmtKpi, presetRange, rangeLabel, useDashboard, type Range } from "@/lib/ops/modules/gestao";
import { Button, EmptyState, ErrorBox, KpiCard, PageHeader, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { PeriodPicker } from "@/components/ops/gestao/PeriodPicker";
import { ChartCard, ExpiringList, HBars, LossesByDay, ReplenishmentList, StockDonut, VBars } from "@/components/ops/gestao/DashboardCharts";

/** Painel gerencial da unidade: indicadores, gráficos e listas de ação. */
export default function PainelPage() {
  const { store, stores, can, companies } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [range, setRange] = useState<Range>(() => presetRange(30));
  const [storeId, setStoreId] = useState<string | undefined>(store?.id);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => setStoreId(store?.id), [store?.id]);
  const allowed = useMemo(() => stores.filter((s) => can("painel.ver", s.id)), [stores, can]);
  const current = allowed.find((s) => s.id === storeId) ?? (store && can("painel.ver", store.id) ? store : null);
  const sid = current?.id;

  const dash = useDashboard(sid, range, Boolean(sid));
  useRealtimeInvalidate(["alerts", "losses", "productions", "receipts", "tasks", "checklist_executions"], [["dashboard"]]);

  async function refreshAlerts() {
    if (!sid) return;
    setRefreshing(true);
    try {
      const r = await rpc<{ touched?: number }>("ops_refresh_alerts", { p_store: sid });
      notify(`Alertas atualizados${r?.touched !== undefined ? ` (${r.touched} verificado(s))` : ""}`);
      invalidate("alerts", "dashboard");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setRefreshing(false);
    }
  }

  if (!store) return <ErrorBox error="Escolha uma unidade para ver o painel." />;
  if (!current) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Painel gerencial" icon="dashboard" />
        <EmptyState emoji="🔒" title="Sem permissão" description="Seu perfil não tem a permissão painel.ver nesta unidade." />
      </div>
    );
  }

  const d = dash.data;
  const cards = d?.cards ?? {};
  const s = d?.series;
  const loading = dash.isLoading;
  const companyName = (cid: string) => companies.find((c) => c.id === cid)?.name;
  const money = (r: Record<string, unknown>) => [{ k: "Custo", v: fmtMoney(r.cost) }, { k: "Quantidade", v: fmtQty(r.quantity, r.unit as string | undefined) }, { k: "Movimentos", v: String(r.movements ?? 0) }];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Painel gerencial"
        icon="dashboard"
        subtitle={
          <span>
            {current.name} · {rangeLabel(range)}
            {d?.generated_at && <> · gerado {fmtDateTime(d.generated_at)}</>}
          </span>
        }
        actions={
          <>
            {allowed.length > 1 && (
              <select value={current.id} onChange={(e) => setStoreId(e.target.value)} className="field !w-auto !py-2" aria-label="Unidade">
                {allowed.map((st) => <option key={st.id} value={st.id}>{allowed.some((x) => x.company_id !== st.company_id) ? `${companyName(st.company_id) ?? ""} · ` : ""}{st.name}</option>)}
              </select>
            )}
            <Button variant="soft" disabled={refreshing || !can("alertas.ver", current.id)} onClick={() => void refreshAlerts()}><Icon name="refresh" size={16} /> Atualizar alertas</Button>
            <Button variant="ghost" disabled={dash.isFetching} onClick={() => void dash.refetch()} aria-label="Recarregar painel"><Icon name="refresh" size={16} className={dash.isFetching ? "animate-spin" : ""} /></Button>
          </>
        }
      />

      <section className="card mb-4 p-3">
        <PeriodPicker value={range} onChange={setRange} />
      </section>

      {dash.error ? (
        <ErrorBox error={toOpsError(dash.error as Error).message} onRetry={() => void dash.refetch()} />
      ) : (
        <>
          {/* indicadores */}
          {KPI_SECTIONS.map((sec) => (
            <section key={sec.title} className="mb-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{sec.title}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {sec.items.map((k) =>
                  loading ? (
                    <div key={k.key} className="h-[86px] animate-pulse rounded-2xl bg-white/5" />
                  ) : (
                    <KpiCard key={k.key} label={k.label} value={fmtKpi(k, cards)} tone={k.tone(cards)} icon={k.icon} href={k.href} hint={k.hint?.(cards)} />
                  ),
                )}
              </div>
            </section>
          ))}

          {/* gráficos */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Perdas por dia" subtitle="R$ perdidos a cada dia do período" loading={loading} empty={!s || s.losses_by_day.length === 0} emptyText="Nenhuma perda registrada no período." action={<Link href="/relatorios/perdas" className="text-xs font-semibold text-[var(--accent)]">relatório</Link>}>
              {s && <LossesByDay rows={s.losses_by_day} />}
            </ChartCard>
            <ChartCard title="Perdas por motivo" subtitle="Onde o dinheiro está indo embora" loading={loading} empty={!s || s.losses_by_reason.length === 0} emptyText="Nenhuma perda registrada no período." action={<Link href="/perdas" className="text-xs font-semibold text-[var(--accent)]">ver perdas</Link>}>
              {s && <HBars rows={s.losses_by_reason} color={CHART.orange} lines={(r) => [{ k: "Valor", v: fmtMoney(r.cost) }, { k: "Quantidade", v: fmtQty(r.quantity) }, { k: "Registros", v: String(r.occurrences ?? 0) }]} />}
            </ChartCard>
            <ChartCard title="Consumo por categoria" subtitle="Custo do que saiu do estoque para uso e produção" loading={loading} empty={!s || s.consumption_by_category.length === 0} emptyText="Nenhum consumo no período." action={<Link href="/relatorios/consumo" className="text-xs font-semibold text-[var(--accent)]">relatório</Link>}>
              {s && <VBars rows={s.consumption_by_category} color={CHART.blue} xKey="label" valueKey="cost" lines={money} />}
            </ChartCard>
            <ChartCard title="Produção por dia" subtitle="Produções concluídas" loading={loading} empty={!s || s.production_by_day.length === 0} emptyText="Nenhuma produção concluída no período." action={<Link href="/relatorios/producao" className="text-xs font-semibold text-[var(--accent)]">relatório</Link>}>
              {s && <VBars rows={s.production_by_day} color={CHART.aqua} xKey="day" valueKey="productions" isDay yFormat="qty" lines={(r) => [{ k: "Produções", v: String(r.productions ?? 0) }, { k: "Quantidade", v: fmtQty(r.quantity) }, { k: "Custo", v: fmtMoney(r.cost) }]} />}
            </ChartCard>
            <ChartCard title="Estoque por categoria" subtitle="Valor atual em estoque" loading={loading} empty={!s || s.stock_by_category.length === 0} emptyText="Nenhum saldo em estoque." action={<Link href="/relatorios/custos" className="text-xs font-semibold text-[var(--accent)]">relatório</Link>}>
              {s && <StockDonut rows={s.stock_by_category} />}
            </ChartCard>
            <ChartCard title="Produtos mais consumidos" subtitle="Os 10 maiores em custo no período" loading={loading} empty={!s || s.top_consumed.length === 0} emptyText="Nenhum consumo no período.">
              {s && <HBars rows={s.top_consumed} color={CHART.blue} lines={money} />}
            </ChartCard>
            <ChartCard title="Próximos do vencimento" subtitle="Vencidos e vencendo em até 7 dias — use primeiro (FEFO)" loading={loading} empty={!s || s.expiring_products.length === 0} emptyText="Nenhum lote vencido ou vencendo nos próximos 7 dias." action={<Link href="/validades" className="text-xs font-semibold text-[var(--accent)]">ver todos</Link>}>
              {s && <ExpiringList rows={s.expiring_products} />}
            </ChartCard>
            <ChartCard title="Reposição sugerida" subtitle="Produtos abaixo do mínimo ou no ponto de reposição" loading={loading} empty={!s || s.replenishment.length === 0} emptyText="Nenhum produto precisa de reposição." action={<Link href="/reposicao" className="text-xs font-semibold text-[var(--accent)]">ver reposição</Link>}>
              {s && <ReplenishmentList rows={s.replenishment} />}
            </ChartCard>
          </div>

          {d && (
            <p className="mt-4 text-center text-xs text-slate-600">
              Gerado em {fmtDateTime(d.generated_at)} · {current.name} · {rangeLabel(range)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
