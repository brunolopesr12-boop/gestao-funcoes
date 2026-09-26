"use client";

import Link from "next/link";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/ops/format";
import { usePriceHistory, type PriceHistoryRow } from "@/lib/ops/modules/cadastros";
import { DataTable, ErrorBox, usePagination, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/**
 * Histórico de preços (supplier_price_history) de um produto ou de um fornecedor.
 * Somente leitura: as linhas são gravadas pelo recebimento (ops_receive).
 */
export function PriceHistoryTable({ productId, supplierId }: { productId?: string | null; supplierId?: string | null }) {
  const pg = usePagination(30);
  const q = usePriceHistory({ productId, supplierId }, pg.range);
  const rows = q.data?.rows ?? [];

  const columns: Column<PriceHistoryRow>[] = [
    { key: "recorded_at", label: "Data", render: (r) => <span className="tabular-nums text-slate-300">{fmtDateTime(r.recorded_at)}</span> },
    ...(productId
      ? [{ key: "supplier", label: "Fornecedor", render: (r: PriceHistoryRow) => r.suppliers ? <Link href={`/fornecedores/${r.suppliers.id}`} className="font-semibold hover:underline">{r.suppliers.name}</Link> : <span className="text-slate-500">sem fornecedor</span> }]
      : [{ key: "product", label: "Produto", render: (r: PriceHistoryRow) => r.products ? <Link href={`/produtos/${r.products.id}`} className="font-semibold hover:underline">{r.products.name}</Link> : "—" }]),
    { key: "stores", label: "Unidade", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.stores?.name ?? "—"}</span> },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className="tabular-nums">{fmtQty(r.quantity, r.units?.code)}</span> },
    { key: "price", label: "Preço", align: "right", render: (r) => <span className="font-bold tabular-nums">{fmtMoney(r.price)}</span> },
    {
      key: "receipt_id", label: "Recebimento", align: "center",
      render: (r) => r.receipt_id ? <Link href={`/recebimento/${r.receipt_id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]" onClick={(e) => e.stopPropagation()}><Icon name="truck" size={14} /> abrir</Link> : <span className="text-slate-600">—</span>,
    },
  ];

  if (q.error) return <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />;
  return (
    <DataTable
      columns={columns}
      rows={rows}
      loading={q.isLoading || q.isFetching}
      total={q.data?.total}
      page={pg.page}
      pageSize={pg.pageSize}
      onPage={pg.setPage}
      emptyTitle="Nenhuma compra registrada ainda"
      emptyDescription="O histórico é preenchido automaticamente quando um recebimento é finalizado."
      mobileCard={(r) => (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{productId ? (r.suppliers?.name ?? "Sem fornecedor") : (r.products?.name ?? "—")}</p>
            <p className="text-xs text-slate-500">{fmtDateTime(r.recorded_at)}{r.stores?.name ? ` · ${r.stores.name}` : ""}</p>
            {r.receipt_id && <Link href={`/recebimento/${r.receipt_id}`} className="text-xs font-semibold text-[var(--accent)]">ver recebimento</Link>}
          </div>
          <div className="text-right">
            <p className="font-bold tabular-nums">{fmtMoney(r.price)}</p>
            <p className="text-xs text-slate-400">{fmtQty(r.quantity, r.units?.code)}</p>
          </div>
        </div>
      )}
    />
  );
}
