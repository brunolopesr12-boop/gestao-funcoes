"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { useLossReasons } from "@/lib/ops/hooks";
import { downloadBlob, fmtDateTime, fmtMoney, fmtPct, fmtQty, toCSV } from "@/lib/ops/format";
import type { Loss } from "@/lib/ops/types";
import { defaultFilters, fetchAllLosses, useLossKpis, useLosses, variationPct, type LossFilters } from "@/lib/ops/modules/perdas";
import { Badge, Button, DataTable, ErrorBox, InlineAlert, KpiCard, PageHeader, SearchInput, Select, TextInput, useDebounced, usePagination, useToast, type Column } from "@/components/ops/ui";
import { ProductPicker } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { PeriodFilter } from "@/components/ops/perdas/PeriodFilter";

const PAGE = 50;

/** Perdas registradas na unidade: filtros, indicadores do período, lista paginada e CSV. */
export default function PerdasPage() {
  const { store, can } = useSession();
  const notify = useToast();
  const reasons = useLossReasons();
  const [f, setF] = useState<LossFilters>(defaultFilters);
  const term = useDebounced(f.term.trim(), 300);
  const user = useDebounced(f.user.trim(), 300);
  const eff: LossFilters = { ...f, term, user };
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [f.from, f.to, f.reason, f.product, term, user, setPage]);

  const canSeeAll = can("perdas.ver");
  const canPanel = canSeeAll || can("relatorios.ver");
  const q = useLosses(store?.id, eff, pg.range);
  const kpis = useLossKpis(store?.id, eff, canSeeAll);
  useRealtimeInvalidate(["losses"]);

  const rows = q.data?.rows ?? [];
  const k = kpis.data;
  const variation = k ? variationPct(Number(k.total_cost), Number(k.prev_total_cost)) : null;

  async function exportCsv() {
    if (!store) return;
    try {
      const all = await fetchAllLosses(store.id, eff);
      if (all.length === 0) return notify("Nada para exportar com esses filtros.", "info");
      const csv = toCSV(
        all.map((r) => ({
          created_at: fmtDateTime(r.created_at),
          internal_code: r.internal_code,
          product_name: r.product_name,
          category_name: r.category_name ?? "",
          lot_code: r.lot_code ?? "",
          location_name: r.location_name ?? "",
          quantity: Number(r.quantity),
          unit: r.unit,
          unit_cost: Number(r.unit_cost),
          total_cost: Number(r.total_cost),
          reason_name: r.reason_name,
          created_by_name: r.created_by_name,
          notes: r.notes,
          photo_url: r.photo_url,
        })),
        [
          { key: "created_at", label: "Data" },
          { key: "internal_code", label: "Código" },
          { key: "product_name", label: "Produto" },
          { key: "category_name", label: "Categoria" },
          { key: "lot_code", label: "Lote" },
          { key: "location_name", label: "Local" },
          { key: "quantity", label: "Quantidade" },
          { key: "unit", label: "Unidade" },
          { key: "unit_cost", label: "Custo unitário" },
          { key: "total_cost", label: "Custo total" },
          { key: "reason_name", label: "Motivo" },
          { key: "created_by_name", label: "Funcionário" },
          { key: "notes", label: "Observação" },
          { key: "photo_url", label: "Foto" },
        ],
      );
      downloadBlob(`perdas-${store.code || "unidade"}-${eff.from}-a-${eff.to}.csv`, csv, "text/csv;charset=utf-8");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  const columns: Column<Loss>[] = [
    { key: "created_at", label: "Data", render: (r) => <span className="tabular-nums text-slate-300">{fmtDateTime(r.created_at)}</span> },
    {
      key: "product_name",
      label: "Produto",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{r.product_name}</p>
          <p className="text-xs text-slate-500">{r.internal_code && <span className="mr-2 font-mono">{r.internal_code}</span>}{r.category_name ?? ""}</p>
        </div>
      ),
    },
    { key: "lot_code", label: "Lote", render: (r) => r.lot_id ? <Link href={`/lote/${r.lot_id}`} className="font-mono text-slate-200 hover:underline" onClick={(e) => e.stopPropagation()}>{r.lot_code}</Link> : <span className="text-slate-500">—</span> },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</span> },
    { key: "total_cost", label: "Custo", align: "right", render: (r) => <span className="tabular-nums font-semibold text-rose-200">{fmtMoney(r.total_cost)}</span> },
    { key: "reason_name", label: "Motivo", render: (r) => <Badge tone="red">{r.reason_name}</Badge> },
    { key: "created_by_name", label: "Funcionário", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.created_by_name || "—"}</span> },
    {
      key: "photo_url",
      label: "Foto",
      align: "center",
      render: (r) => r.photo_url ? (
        <a href={r.photo_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Abrir foto em nova aba">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.photo_url} alt="" className="inline-block h-10 w-10 rounded-lg border border-[var(--line)] object-cover" />
        </a>
      ) : <span className="text-slate-600">—</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Perdas"
        subtitle={store ? `Descartes e quebras · ${store.name}` : "Descartes e quebras"}
        icon="trash"
        actions={
          <>
            {can("perdas.registrar") && (
              <Link href="/perdas/nova" className="inline-flex items-center gap-2 rounded-xl border border-rose-500/60 bg-rose-600/90 px-4 py-2.5 text-[15px] font-medium text-white hover:bg-rose-500">
                <Icon name="plus" size={18} /> Registrar perda
              </Link>
            )}
            {canPanel && (
              <Link href="/perdas/painel" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 text-[15px] font-medium text-slate-100 hover:bg-white/10">
                <Icon name="chart" size={18} /> Painel de perdas
              </Link>
            )}
            <Button variant="soft" onClick={() => void exportCsv()} disabled={rows.length === 0}>
              <Icon name="download" size={18} /> <span className="hidden sm:inline">Exportar</span> CSV
            </Button>
          </>
        }
      />

      {!canSeeAll && <InlineAlert tone="slate" icon="info">Você vê apenas as perdas que você mesmo registrou. Para ver todas, peça a permissão “Perdas: ver”.</InlineAlert>}

      {canSeeAll && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KpiCard
            label="Total perdido"
            value={k ? fmtMoney(k.total_cost) : kpis.isLoading ? "…" : "—"}
            tone={k && Number(k.total_cost) > 0 ? "red" : "green"}
            icon="chart"
            hint={k ? (variation === null ? `período anterior: ${fmtMoney(k.prev_total_cost)}` : `${variation > 0 ? "▲" : variation < 0 ? "▼" : "="} ${fmtPct(Math.abs(variation), 0)} vs. ${k.days} dias anteriores (${fmtMoney(k.prev_total_cost)})`) : undefined}
          />
          <KpiCard label="Registros" value={k ? k.count : kpis.isLoading ? "…" : "—"} tone="blue" icon="list" hint={k ? `${fmtQty(k.total_quantity)} em quantidade somada` : undefined} />
          <KpiCard label="Maior motivo" value={k ? (k.top_reason ? <span className="text-lg">{k.top_reason.name}</span> : "—") : kpis.isLoading ? "…" : "—"} tone="amber" icon="alert" hint={k?.top_reason ? `${fmtMoney(k.top_reason.cost)} em ${k.top_reason.count} registro(s)` : "nenhuma perda no período"} />
        </div>
      )}
      {kpis.error && <ErrorBox error={toOpsError(kpis.error as Error).message} onRetry={() => void kpis.refetch()} />}

      <div className="card mb-4 p-3">
        <PeriodFilter value={{ from: f.from, to: f.to }} onChange={(r) => setF({ ...f, ...r })} />
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Motivo">
            <option value="">Todos os motivos</option>
            {(reasons.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <TextInput value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder="Funcionário (nome)" aria-label="Funcionário" />
          <SearchInput value={f.term} onChange={(v) => setF({ ...f, term: v })} placeholder="Produto, lote, motivo ou observação" />
        </div>
        <div className="mt-3 [&>div]:mb-0">
          <ProductPicker value={f.product} onChange={(p) => setF({ ...f, product: p })} placeholder="Filtrar por produto (opcional)" />
        </div>
      </div>

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          emptyTitle="Nenhuma perda no período"
          emptyDescription={can("perdas.registrar") ? "Isso é bom! Quando algo for descartado, registre em “Registrar perda” para o custo aparecer aqui." : "Nenhum registro com esses filtros."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              {r.photo_url ? (
                <a href={r.photo_url} target="_blank" rel="noopener noreferrer" aria-label="Abrir foto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.photo_url} alt="" className="h-12 w-12 rounded-lg border border-[var(--line)] object-cover" />
                </a>
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-white/5 text-slate-500"><Icon name="trash" size={18} /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.product_name}</p>
                <p className="text-xs text-slate-500">{r.reason_name} · {r.lot_code ? `lote ${r.lot_code} · ` : ""}{r.created_by_name || "—"}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</p>
                <p className="text-xs font-semibold text-rose-200">{fmtMoney(r.total_cost)}</p>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
