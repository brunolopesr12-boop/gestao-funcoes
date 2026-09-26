"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { downloadBlob, fmtDate, fmtDateTime, fmtMoney, fmtQty, toCSV, todayISO } from "@/lib/ops/format";
import {
  ITEM_FILTER_OPTIONS, cancelCount, countScopeLabel, fetchAllCountItems, useCount, useCountItems, useUnitCode,
  type CountItemRow, type ItemFilter,
} from "@/lib/ops/modules/inventario";
import { Badge, Button, ConfirmSheet, DataTable, ErrorBox, InlineAlert, KpiCard, PageHeader, SearchInput, Select, Skeleton, useDebounced, usePagination, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { CountItemSheet } from "@/components/ops/inventario/CountItemSheet";
import { FinalizeCountSheet } from "@/components/ops/inventario/FinalizeCountSheet";
import { CountKindBadge, CountStatusBadge, DiffValue } from "@/components/ops/inventario/shared";

const PAGE = 50;

/** Detalhe da contagem: itens (sistema × contado × diferença), contar/corrigir, finalizar, cancelar e relatório. */
export default function ContagemPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const unitCode = useUnitCode();

  const [filter, setFilter] = useState<ItemFilter>("todos");
  const [term, setTerm] = useState("");
  const t = useDebounced(term.trim(), 300);
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [filter, t, setPage]);

  const [itemOpen, setItemOpen] = useState(false);
  const [editing, setEditing] = useState<CountItemRow | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const count = useCount(id);
  const items = useCountItems(id, { filter, term: t, from: pg.range.from, to: pg.range.to });
  const uncounted = useCountItems(id, { filter: "nao_contados", term: "", from: 0, to: 0 });
  useRealtimeInvalidate(["inventory_counts", "inventory_items"]);

  const c = count.data;
  const open = c?.status === "aberta";
  const canCount = can("inventario.contar");
  const canFinalize = can("inventario.finalizar");
  const uncountedTotal = uncounted.data?.total ?? 0;

  async function doCancel() {
    if (!c) return;
    setBusy(true);
    try {
      await cancelCount(c.id, "");
      invalidate("inventory_counts", "inventory_items");
      notify("Contagem cancelada");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(onlyDiff: boolean) {
    if (!c) return;
    try {
      const all = await fetchAllCountItems(c.id, onlyDiff);
      const csv = toCSV(
        all.map((r) => ({
          internal_code: r.products?.internal_code ?? "",
          product: r.products?.name ?? "",
          lot: r.stock_lots?.lot_code ?? "todos",
          expires_at: r.stock_lots?.expires_at ? fmtDate(r.stock_lots.expires_at) : "",
          location: r.stock_locations?.name ?? "",
          unit: unitCode(r.products?.stock_unit_id),
          theoretical: Number(r.theoretical_quantity),
          counted: r.counted_quantity === null ? "" : Number(r.counted_quantity),
          difference: r.difference === null ? "" : Number(r.difference),
          unit_cost: Number(r.unit_cost),
          difference_value: r.difference === null ? "" : Number(r.difference) * Number(r.unit_cost),
          reason: r.reason,
          notes: r.notes,
          counted_by: r.counted_by_name,
          counted_at: r.counted_at ? fmtDateTime(r.counted_at) : "",
        })),
        [
          { key: "internal_code", label: "Código" },
          { key: "product", label: "Produto" },
          { key: "lot", label: "Lote" },
          { key: "expires_at", label: "Validade" },
          { key: "location", label: "Local" },
          { key: "unit", label: "Unidade" },
          { key: "theoretical", label: "Sistema" },
          { key: "counted", label: "Contado" },
          { key: "difference", label: "Diferença" },
          { key: "unit_cost", label: "Custo unitário" },
          { key: "difference_value", label: "Valor da diferença" },
          { key: "reason", label: "Motivo" },
          { key: "notes", label: "Observação" },
          { key: "counted_by", label: "Contado por" },
          { key: "counted_at", label: "Contado em" },
        ],
      );
      downloadBlob(`contagem-${c.number}-${onlyDiff ? "diferencas" : "itens"}-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  const columns: Column<CountItemRow>[] = useMemo(
    () => [
      {
        key: "product",
        label: "Produto",
        render: (r) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-100">{r.products?.name ?? "—"}</p>
            <p className="text-xs text-slate-500">{r.products?.internal_code && <span className="mr-2 font-mono">{r.products.internal_code}</span>}{r.stock_locations?.name}</p>
          </div>
        ),
      },
      {
        key: "lot",
        label: "Lote",
        render: (r) => r.stock_lots ? (
          <span>
            <span className="font-mono text-slate-200">{r.stock_lots.lot_code}</span>
            <span className="block text-[11px] text-slate-500">val. {fmtDate(r.stock_lots.expires_at)}</span>
          </span>
        ) : <span className="text-xs text-slate-500">todos os lotes</span>,
      },
      { key: "theoretical_quantity", label: "Sistema", align: "right", render: (r) => <span className="tabular-nums text-slate-300">{fmtQty(r.theoretical_quantity, unitCode(r.products?.stock_unit_id))}</span> },
      {
        key: "counted_quantity",
        label: "Contado",
        align: "right",
        render: (r) => r.counted_quantity === null ? <Badge tone="amber">não contado</Badge> : <span className="font-bold tabular-nums">{fmtQty(r.counted_quantity, unitCode(r.products?.stock_unit_id))}</span>,
      },
      { key: "difference", label: "Diferença", align: "right", render: (r) => <DiffValue diff={r.difference === null ? null : Number(r.difference)} unit={unitCode(r.products?.stock_unit_id)} /> },
      { key: "difference_value", label: "Valor", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{r.difference === null ? "—" : fmtMoney(Number(r.difference) * Number(r.unit_cost))}</span> },
      { key: "reason", label: "Motivo", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.reason || "—"}</span> },
      { key: "counted_by_name", label: "Contado por", hideOnMobile: true, render: (r) => <span className="text-xs text-slate-400">{r.counted_by_name ? `${r.counted_by_name} · ${fmtDateTime(r.counted_at)}` : "—"}</span> },
    ],
    [unitCode],
  );

  if (count.isLoading) return <div className="mx-auto max-w-5xl"><Skeleton rows={4} /></div>;
  if (count.error || !c) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Contagem" backHref="/inventario" />
        <ErrorBox error={count.error ? toOpsError(count.error as Error).message : "Contagem não encontrada."} onRetry={() => void count.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Contagem ${c.number}`}
        backHref="/inventario"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <CountStatusBadge status={c.status} />
            <CountKindBadge kind={c.kind} />
            <span>{countScopeLabel(c)}</span>
            <span>· {c.started_by_name || "—"} · {fmtDateTime(c.created_at)}</span>
          </span>
        }
        actions={
          open ? (
            <>
              {canCount && (
                <Button variant="primary" size="lg" onClick={() => { setEditing(null); setItemOpen(true); }}>
                  <Icon name="plus" size={18} /> Contar item
                </Button>
              )}
              {canFinalize && (
                <Button variant="success" size="lg" onClick={() => setFinalizeOpen(true)} disabled={c.items_count === 0 && c.kind === "rapida"}>
                  <Icon name="check" size={18} /> Finalizar
                </Button>
              )}
              {canCount && <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy} className="!text-rose-300">Cancelar contagem</Button>}
            </>
          ) : (
            <>
              <Button variant="soft" onClick={() => void exportCsv(true)}><Icon name="download" size={18} /> CSV das diferenças</Button>
              <Button variant="ghost" onClick={() => void exportCsv(false)}>CSV completo</Button>
            </>
          )
        }
      />

      {c.notes && <InlineAlert tone="slate" icon="info">{c.notes}</InlineAlert>}
      {open && !canCount && <InlineAlert tone="amber">Você pode ver esta contagem, mas não tem permissão para contar itens.</InlineAlert>}
      {open && canCount && !canFinalize && <InlineAlert tone="slate" icon="info">Quando terminar de contar, peça a um gerente para finalizar: só ele pode gerar os ajustes de estoque.</InlineAlert>}
      {c.status === "finalizada" && (
        <InlineAlert tone="green" icon="check">
          Finalizada em {fmtDateTime(c.finished_at)}. Os ajustes já foram aplicados no estoque — este relatório é somente leitura.
        </InlineAlert>
      )}
      {c.status === "cancelada" && <InlineAlert tone="red">Contagem cancelada: nenhum ajuste foi feito no estoque.</InlineAlert>}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Itens" value={c.items_count} tone="blue" icon="list" />
        <KpiCard label="Não contados" value={uncountedTotal} tone={uncountedTotal > 0 && open ? "amber" : "slate"} icon="clock" onClick={() => setFilter(filter === "nao_contados" ? "todos" : "nao_contados")} />
        <KpiCard label="Diferenças" value={c.differences} tone={c.differences > 0 ? "amber" : "green"} icon="alert" onClick={() => setFilter(filter === "com_diferenca" ? "todos" : "com_diferenca")} />
        <KpiCard label="Valor da diferença" value={<DiffValue diff={Number(c.difference_value)} money className="!text-2xl" />} hint={c.differences > 0 ? "sobra positiva, falta negativa" : undefined} icon="chart" />
      </div>

      <div className="card mb-4 grid grid-cols-1 gap-2 p-3 sm:grid-cols-[2fr_1fr]">
        <SearchInput value={term} onChange={setTerm} placeholder="Buscar produto por nome ou código" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as ItemFilter)}>
          {ITEM_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {items.error ? (
        <ErrorBox error={toOpsError(items.error as Error).message} onRetry={() => void items.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={items.data?.rows ?? []}
          loading={items.isLoading}
          total={items.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          onRowClick={open && canCount ? (r) => { setEditing(r); setItemOpen(true); } : undefined}
          emptyTitle={filter !== "todos" || t ? "Nenhum item com esse filtro" : c.kind === "completa" ? "Nenhum item com saldo neste local" : "Nenhum item contado ainda"}
          emptyDescription={
            filter !== "todos" || t
              ? "Tente outro filtro ou outra busca."
              : c.kind === "completa"
                ? "A contagem completa carrega só produtos com saldo. Você pode contar itens encontrados usando “Contar item”."
                : open ? "Toque em “Contar item” e leia o código ou busque o produto. Cada item conta o que você encontrou na prateleira." : "Esta contagem foi encerrada sem itens."
          }
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.products?.name ?? "—"}</p>
                <p className="text-xs text-slate-500">
                  {r.stock_lots ? `lote ${r.stock_lots.lot_code}` : "todos os lotes"} · {r.stock_locations?.name}
                  {r.reason ? ` · ${r.reason}` : ""}
                </p>
                <p className="text-xs text-slate-400">
                  Sistema {fmtQty(r.theoretical_quantity, unitCode(r.products?.stock_unit_id))}
                  {r.counted_quantity !== null && <> · Contado <span className="font-semibold text-slate-200">{fmtQty(r.counted_quantity, unitCode(r.products?.stock_unit_id))}</span></>}
                </p>
              </div>
              <div className="text-right">
                {r.counted_quantity === null ? <Badge tone="amber">não contado</Badge> : <DiffValue diff={Number(r.difference)} unit={unitCode(r.products?.stock_unit_id)} />}
                {r.difference !== null && <p className="text-[11px] text-slate-500">{fmtMoney(Number(r.difference) * Number(r.unit_cost))}</p>}
              </div>
              {open && canCount && <Icon name="edit" size={16} className="text-slate-600" />}
            </div>
          )}
        />
      )}

      {!open && (
        <p className="mt-3 text-center text-xs text-slate-500">
          <Link href="/estoque/movimentacoes" className="font-semibold text-[var(--accent)]">Ver movimentações de inventário</Link>
        </p>
      )}

      {open && (
        <>
          <CountItemSheet open={itemOpen} onClose={() => setItemOpen(false)} count={c} item={editing} onSaved={() => setEditing(null)} />
          <FinalizeCountSheet open={finalizeOpen} onClose={() => setFinalizeOpen(false)} count={c} uncounted={uncountedTotal} onFinalized={() => void count.refetch()} />
          <ConfirmSheet
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title="Cancelar contagem?"
            message={`A contagem ${c.number} será cancelada. Nada do que foi contado vai alterar o estoque. Esta ação não pode ser desfeita.`}
            confirmLabel="Cancelar contagem"
            onConfirm={() => void doCancel()}
          />
        </>
      )}
    </div>
  );
}
