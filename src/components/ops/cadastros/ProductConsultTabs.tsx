"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { EXPIRY_META, fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/ops/format";
import { LOT_STATUS_LABEL, MOVEMENT_LABEL, type Movement, type StockBalance } from "@/lib/ops/types";
import { Badge, DataTable, EmptyState, ErrorBox, InlineAlert, Skeleton, toneFor, usePagination, type Column } from "@/components/ops/ui";
import { PriceHistoryTable } from "./PriceHistoryTable";

/** Aba "Saldo": lotes com saldo na unidade atual (v_stock_balances). */
export function ProductStockTab({ productId, unit }: { productId: string; unit?: string | null }) {
  const { store } = useSession();
  const q = useQuery({
    queryKey: ["stock_items", "cadastro", store?.id, productId],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await supabaseBrowser().from("v_stock_balances").select("*").eq("store_id", store!.id).eq("product_id", productId)
        .order("expires_at", { ascending: true, nullsFirst: false }).order("received_at", { ascending: true });
      if (res.error) throw toOpsError(res.error);
      return (res.data ?? []) as StockBalance[];
    },
  });
  useRealtimeInvalidate(["stock_items"]);
  if (!store) return <InlineAlert tone="amber">Escolha uma unidade para ver os saldos.</InlineAlert>;
  if (q.isLoading) return <Skeleton rows={3} />;
  if (q.error) return <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.quantity), 0);
  const value = rows.reduce((s, r) => s + Number(r.total_value), 0);
  if (rows.length === 0) {
    return <EmptyState emoji="📭" title={`Sem saldo em ${store.name}`} description="Este produto não tem lotes com quantidade nesta unidade. Registre um recebimento ou uma entrada manual no Estoque." action={<Link href={`/estoque/produto/${productId}`} className="text-sm font-semibold text-[var(--accent)]">Abrir no estoque</Link>} />;
  }
  const columns: Column<StockBalance>[] = [
    { key: "lot_code", label: "Lote", render: (r) => <Link href={`/lote/${r.lot_id}`} className="font-mono font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>{r.lot_code}</Link> },
    { key: "location_name", label: "Local", render: (r) => <span className="text-slate-300">{r.location_name}</span> },
    { key: "expires_at", label: "Validade", render: (r) => <span className="flex items-center gap-2"><span className="tabular-nums">{fmtDate(r.expires_at)}</span><Badge className={EXPIRY_META[r.expiry_status].className}>{EXPIRY_META[r.expiry_status].label}</Badge></span> },
    { key: "lot_status", label: "Situação", hideOnMobile: true, render: (r) => <Badge tone={toneFor(r.lot_status)}>{LOT_STATUS_LABEL[r.lot_status]}</Badge> },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</span> },
    { key: "unit_cost", label: "Custo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.unit_cost)}</span> },
    { key: "total_value", label: "Valor", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.total_value)}</span> },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-400">Saldo em <span className="font-semibold text-slate-200">{store.name}</span>: <span className="font-bold text-slate-100">{fmtQty(total, unit)}</span> em {rows.length} {rows.length === 1 ? "registro" : "registros"} · {fmtMoney(value)}</p>
        <Link href={`/estoque/produto/${productId}`} className="text-xs font-semibold text-[var(--accent)]">Abrir no estoque (consumir, ajustar…)</Link>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(r) => `/lote/${r.lot_id}`}
        mobileCard={(r) => (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono font-semibold">{r.lot_code}</p>
              <p className="text-xs text-slate-500">{r.location_name} · validade {fmtDate(r.expires_at)}</p>
              <Badge className={`mt-1 ${EXPIRY_META[r.expiry_status].className}`}>{EXPIRY_META[r.expiry_status].label}</Badge>
            </div>
            <div className="text-right">
              <p className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</p>
              <p className="text-xs text-slate-400">{fmtMoney(r.total_value)}</p>
            </div>
          </div>
        )}
      />
    </div>
  );
}

/** Aba "Preços": histórico de preços de compra do produto. */
export function ProductPricesTab({ productId }: { productId: string }) {
  return <PriceHistoryTable productId={productId} />;
}

/** Aba "Movimentações": últimas movimentações do produto na unidade atual (v_movements). */
export function ProductMovementsTab({ productId }: { productId: string }) {
  const { store } = useSession();
  const pg = usePagination(30);
  const q = useQuery({
    queryKey: ["stock_movements", "cadastro", store?.id, productId, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await supabaseBrowser().from("v_movements").select("*", { count: "exact" }).eq("store_id", store!.id).eq("product_id", productId)
        .order("created_at", { ascending: false }).range(pg.range.from, pg.range.to);
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as Movement[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["stock_movements"]);
  if (!store) return <InlineAlert tone="amber">Escolha uma unidade para ver as movimentações.</InlineAlert>;
  if (q.error) return <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const sign = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-rose-300" : "text-slate-300");
  const columns: Column<Movement>[] = [
    { key: "created_at", label: "Data", render: (r) => <span className="tabular-nums text-slate-300">{fmtDateTime(r.created_at)}</span> },
    { key: "movement_type", label: "Tipo", render: (r) => <Badge tone={r.quantity > 0 ? "green" : r.movement_type === "perda" ? "red" : "slate"}>{MOVEMENT_LABEL[r.movement_type]}</Badge> },
    { key: "lot_code", label: "Lote", render: (r) => <Link href={`/lote/${r.lot_id}`} className="font-mono hover:underline" onClick={(e) => e.stopPropagation()}>{r.lot_code}</Link> },
    { key: "location_name", label: "Local", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.location_name}</span> },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className={`font-bold tabular-nums ${sign(Number(r.quantity))}`}>{Number(r.quantity) > 0 ? "+" : ""}{fmtQty(r.quantity, r.unit)}</span> },
    { key: "balance_after", label: "Saldo após", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtQty(r.balance_after, r.unit)}</span> },
    { key: "total_cost", label: "Valor", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.total_cost)}</span> },
    { key: "created_by_name", label: "Por", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.created_by_name || "—"}{r.reason ? ` · ${r.reason}` : ""}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.rows ?? []}
      loading={q.isLoading || q.isFetching}
      total={q.data?.total}
      page={pg.page}
      pageSize={pg.pageSize}
      onPage={pg.setPage}
      emptyTitle={`Sem movimentações em ${store.name}`}
      emptyDescription="Entradas, consumos, perdas e ajustes deste produto aparecerão aqui."
      mobileCard={(r) => (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{MOVEMENT_LABEL[r.movement_type]} <span className="ml-1 font-mono text-xs text-slate-500">{r.lot_code}</span></p>
            <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)} · {r.location_name}{r.created_by_name ? ` · ${r.created_by_name}` : ""}</p>
          </div>
          <div className="text-right">
            <p className={`font-bold tabular-nums ${sign(Number(r.quantity))}`}>{Number(r.quantity) > 0 ? "+" : ""}{fmtQty(r.quantity, r.unit)}</p>
            <p className="text-xs text-slate-400">saldo {fmtQty(r.balance_after, r.unit)}</p>
          </div>
        </div>
      )}
    />
  );
}
