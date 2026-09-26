"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/ops/format";
import { ITEM_RESULT_LABEL, type ReceiptItemResult } from "@/lib/ops/types";
import type { ReportMode, ReportRow } from "@/lib/ops/modules/reports";
import { Badge, Button, Drawer, ErrorBox, Skeleton, toneFor } from "@/components/ops/ui";

type Kind = NonNullable<ReportMode["detail"]>;
type Item = Record<string, unknown> & { id: string; products?: { name?: string; internal_code?: string } | null; units?: { code?: string } | null; stock_lots?: { lot_code?: string; expires_at?: string | null } | null; stock_locations?: { name?: string } | null };

const META: Record<Kind, { title: string; href: (id: string) => string; table: string; fk: string; select: string; order: string }> = {
  inventory_count: { title: "Itens da contagem", href: (id) => `/inventario/${id}`, table: "inventory_items", fk: "count_id", select: "*, products(id, name, internal_code), stock_lots(id, lot_code, expires_at), stock_locations(id, name)", order: "created_at" },
  purchase_order: { title: "Itens do pedido", href: (id) => `/compras/${id}`, table: "purchase_order_items", fk: "purchase_order_id", select: "*, products(id, name, internal_code), units(code)", order: "position" },
  receipt: { title: "Itens do recebimento", href: (id) => `/recebimento/${id}`, table: "receipt_items", fk: "receipt_id", select: "*, products(id, name, internal_code), units(code)", order: "position" },
};

const MAX_ITEMS = 500;

/** Painel lateral com os itens de um inventário, pedido de compra ou recebimento. */
export function ReportDetailDrawer({ kind, row, onClose }: { kind: Kind | null; row: ReportRow | null; onClose: () => void }) {
  const id = (row?.id as string | undefined) ?? null;
  const meta = kind ? META[kind] : null;
  const q = useQuery({
    queryKey: [meta?.table ?? "detail", id],
    enabled: Boolean(meta && id),
    queryFn: async () => unwrap(await supabaseBrowser().from(meta!.table).select(meta!.select).eq(meta!.fk, id!).order(meta!.order).limit(MAX_ITEMS)) as unknown as Item[],
  });
  const open = Boolean(kind && row);
  const title = meta ? `${meta.title} ${row?.number ? `· ${row.number}` : ""}` : "";
  const items = q.data ?? [];

  return (
    <Drawer open={open} onClose={onClose} title={title} wide footer={meta && id ? (
      <Link href={meta.href(id)} className="block">
        <Button variant="primary" full size="lg">Abrir registro completo</Button>
      </Link>
    ) : undefined}>
      {q.isLoading ? (
        <Skeleton rows={4} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Nenhum item.</p>
      ) : (
        <>
          {items.length >= MAX_ITEMS && <p className="mb-2 text-xs text-amber-300">Mostrando os primeiros {MAX_ITEMS} itens. Abra o registro completo para ver todos.</p>}
          <ul className="divide-y divide-[var(--line)]">
            {items.map((it) => (
              <li key={it.id} className="py-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{it.products?.name ?? "—"}</p>
                    <p className="text-xs text-slate-500">
                      {it.products?.internal_code && <span className="mr-2 font-mono">{it.products.internal_code}</span>}
                      {kind === "inventory_count" && <>{it.stock_locations?.name ?? "—"}{it.stock_lots?.lot_code ? ` · lote ${it.stock_lots.lot_code}` : ""}{it.stock_lots?.expires_at ? ` · val. ${fmtDate(it.stock_lots.expires_at)}` : ""}</>}
                      {kind === "receipt" && <>{it.lot_code ? `lote ${String(it.lot_code)}` : ""}{it.expires_at ? ` · val. ${fmtDate(String(it.expires_at))}` : ""}</>}
                      {kind === "purchase_order" && it.notes ? String(it.notes) : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    {kind === "inventory_count" && (
                      <>
                        <p className="text-xs text-slate-400">teórico {fmtQty(it.theoretical_quantity)} · contado {it.counted_quantity === null ? "—" : fmtQty(it.counted_quantity)}</p>
                        <p className={`font-bold ${Number(it.difference ?? 0) < 0 ? "text-rose-300" : Number(it.difference ?? 0) > 0 ? "text-emerald-300" : "text-slate-300"}`}>
                          {it.difference === null || it.difference === undefined ? "sem contagem" : `${Number(it.difference) > 0 ? "+" : ""}${fmtQty(it.difference)}`}
                        </p>
                      </>
                    )}
                    {kind === "purchase_order" && (
                      <>
                        <p className="font-bold">{fmtQty(it.quantity, it.units?.code)}</p>
                        <p className="text-xs text-slate-400">{fmtMoney(it.estimated_price)} · {fmtMoney(it.total)}{Number(it.received_quantity ?? 0) > 0 ? ` · recebido ${fmtQty(it.received_quantity)}` : ""}</p>
                      </>
                    )}
                    {kind === "receipt" && (
                      <>
                        <p className="font-bold">{fmtQty(it.quantity, it.units?.code)} <span className="text-xs font-normal text-slate-400">{fmtMoney(it.total_price)}</span></p>
                        <Badge tone={toneFor(String(it.result ?? ""))}>{ITEM_RESULT_LABEL[(it.result as ReceiptItemResult) ?? "aprovado"] ?? String(it.result ?? "")}</Badge>
                      </>
                    )}
                  </div>
                </div>
                {kind === "inventory_count" && it.reason ? <p className="mt-1 text-xs text-slate-500">Motivo: {String(it.reason)}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}
