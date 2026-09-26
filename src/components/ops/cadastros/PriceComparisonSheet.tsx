"use client";

import Link from "next/link";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtMoney } from "@/lib/ops/format";
import { usePriceComparison } from "@/lib/ops/modules/cadastros";
import { Badge, EmptyState, ErrorBox, Sheet, Skeleton } from "@/components/ops/ui";

/**
 * Comparação de preços entre os fornecedores de um produto
 * (rpc ops_supplier_price_comparison). Ordenada do mais barato ao mais caro.
 */
export function PriceComparisonSheet({ open, onClose, productId, productName, unit }: { open: boolean; onClose: () => void; productId: string | null; productName?: string; unit?: string | null }) {
  const q = usePriceComparison(productId, open);
  const rows = q.data ?? [];
  const cheapest = rows.length > 0 ? Math.min(...rows.filter((r) => Number(r.last_price) > 0).map((r) => Number(r.last_price))) : null;
  return (
    <Sheet open={open} onClose={onClose} title="Comparar preços">
      {productName && <p className="mb-3 text-sm text-slate-400">{productName}{unit ? ` · preço por ${unit}` : ""}</p>}
      {q.isLoading ? (
        <Skeleton rows={3} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🏷️" title="Nenhum fornecedor vinculado" description="Adicione fornecedores na aba “Fornecedores” do produto. Os preços são preenchidos automaticamente a cada recebimento." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const price = Number(r.last_price);
            const best = cheapest !== null && price > 0 && Math.abs(price - cheapest) < 1e-9;
            return (
              <div key={r.supplier_id} className={`rounded-xl border p-3 ${best ? "border-emerald-500/40 bg-emerald-500/10" : "border-[var(--line)] bg-white/5"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/fornecedores/${r.supplier_id}`} className="block truncate font-bold hover:underline">{r.supplier_name}</Link>
                    <p className="text-xs text-slate-500">
                      {r.supplier_code && <span className="mr-2 font-mono">cód. {r.supplier_code}</span>}
                      {r.purchases > 0 ? `${r.purchases} ${r.purchases === 1 ? "compra" : "compras"}` : "sem compras registradas"}
                      {r.last_purchase_at && ` · última em ${fmtDate(r.last_purchase_at)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-extrabold tabular-nums">{price > 0 ? fmtMoney(price) : "—"}</p>
                    <div className="flex justify-end gap-1">
                      {best && <Badge tone="green">mais barato</Badge>}
                      {r.preferred && <Badge tone="blue">preferido</Badge>}
                    </div>
                  </div>
                </div>
                {(r.avg_price_180d !== null || r.min_price !== null) && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-black/20 py-1"><span className="block text-slate-500">média 180 d</span><span className="font-semibold tabular-nums">{r.avg_price_180d !== null ? fmtMoney(r.avg_price_180d) : "—"}</span></div>
                    <div className="rounded-lg bg-black/20 py-1"><span className="block text-slate-500">menor</span><span className="font-semibold tabular-nums">{r.min_price !== null ? fmtMoney(r.min_price) : "—"}</span></div>
                    <div className="rounded-lg bg-black/20 py-1"><span className="block text-slate-500">maior</span><span className="font-semibold tabular-nums">{r.max_price !== null ? fmtMoney(r.max_price) : "—"}</span></div>
                  </div>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-xs text-slate-500">Os preços são por unidade de estoque e vêm dos recebimentos finalizados.</p>
        </div>
      )}
    </Sheet>
  );
}
