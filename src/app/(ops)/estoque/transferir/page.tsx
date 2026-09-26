"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { useLocations, useProduct, useProductLots, useUnits } from "@/lib/ops/hooks";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/ops/format";
import type { Product, StockBalance } from "@/lib/ops/types";
import { useLot, useOtherStores, useRecentTransfers } from "@/lib/ops/modules/estoque";
import type { TransferRow } from "@/lib/ops/modules/estoque-types";
import { Badge, Button, ConfirmSheet, EmptyState, ErrorBox, Field, InlineAlert, PageHeader, SectionCard, Select, Skeleton, Tabs, TextArea, useToast } from "@/components/ops/ui";
import { LocationSelect, LotPicker, ProductPicker } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { UnitQtyInput } from "@/components/ops/estoque/UnitQtyInput";
import { EstoqueSubnav } from "@/components/ops/estoque/Subnav";

type Mode = "interna" | "unidades";

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <TransferirPage />
    </Suspense>
  );
}

/** Transferência entre locais da unidade ou entre unidades da empresa. */
function TransferirPage() {
  const { store, can } = useSession();
  const sp = useSearchParams();
  const productParam = sp.get("product");
  const lotParam = sp.get("lot");
  const notify = useToast();
  const invalidate = useInvalidate();

  const [mode, setMode] = useState<Mode>("interna");
  const [product, setProduct] = useState<Product | null>(null);
  const [row, setRow] = useState<StockBalance | null>(null);
  const [toLocation, setToLocation] = useState("");
  const [toStore, setToStore] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  // pré-carga vinda da URL (?product= / ?lot=)
  const lotRow = useLot(lotParam);
  const preload = useProduct(productParam ?? lotRow.data?.product_id ?? null);
  useEffect(() => {
    if (preload.data && !product) setProduct(preload.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preload.data]);

  const lots = useProductLots(product?.id, undefined, false);
  useEffect(() => {
    if (!lotParam || row || !lots.data) return;
    const found = lots.data.find((l) => l.lot_id === lotParam);
    if (found) setRow(found);
  }, [lotParam, lots.data, row]);

  const locations = useLocations();
  const units = useUnits();
  const unitCode = (unit && units.data?.find((x) => x.id === unit)?.code) || row?.unit || "";
  const otherStores = useOtherStores();
  const recent = useRecentTransfers(store?.id);
  useRealtimeInvalidate(["stock_items"], [["transfers"], ["stock_lots"], ["stock_movements"]]);

  const destLocations = useMemo(() => (locations.data ?? []).filter((l) => l.id !== row?.location_id), [locations.data, row?.location_id]);
  const toStoreName = otherStores.find((s) => s.id === toStore)?.name;

  const ready = Boolean(product && row && qty && qty > 0 && (mode === "interna" ? toLocation && toLocation !== row?.location_id : toStore && toLocation));

  function resetItem() {
    setRow(null);
    setQty(null);
    setToLocation("");
    setNotes("");
  }

  async function submit() {
    if (!store || !product || !row || !qty) return;
    setBusy(true);
    try {
      if (mode === "interna") {
        await rpc<string>("ops_transfer_internal", {
          p_store: store.id, p_product: product.id, p_lot: row.lot_id, p_from_location: row.location_id, p_to_location: toLocation,
          p_quantity: qty, p_notes: notes.trim(), p_unit: unit || null,
        });
        notify(`Transferido ${fmtQty(qty, unitCode)} de ${product.name} para ${destLocations.find((l) => l.id === toLocation)?.name ?? "o destino"}`);
      } else {
        await rpc<string>("ops_transfer_between_stores", {
          p_from_store: store.id, p_to_store: toStore, p_product: product.id, p_lot: row.lot_id, p_from_location: row.location_id, p_to_location: toLocation,
          p_quantity: qty, p_notes: notes.trim(), p_unit: unit || null,
        });
        notify(`Transferido ${fmtQty(qty, unitCode)} de ${product.name} para ${toStoreName ?? "a outra unidade"}`);
      }
      invalidate("stock_items", "stock_lots", "stock_movements", "transfers", "dashboard", "alerts");
      resetItem();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  if (!can("estoque.movimentar")) {
    return (
      <div>
        <PageHeader title="Transferir" icon="swap" backHref="/estoque" />
        <EmptyState emoji="🔒" title="Você não tem permissão para transferir estoque" description="Peça ao gerente a permissão “estoque.movimentar”." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Transferir estoque" subtitle={store ? `Saindo de ${store.name}` : undefined} icon="swap" backHref="/estoque" />
      <EstoqueSubnav />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard>
          <Tabs
            value={mode}
            onChange={(m) => { setMode(m); setToLocation(""); setToStore(""); }}
            tabs={[
              { value: "interna", label: "Entre locais" },
              { value: "unidades", label: "Entre unidades" },
            ]}
          />
          {mode === "unidades" && otherStores.length === 0 && (
            <InlineAlert tone="amber">Você só tem acesso a esta unidade. Para transferir para outra, peça acesso à unidade de destino.</InlineAlert>
          )}

          <span className="mb-1.5 block text-sm font-semibold text-slate-300">1. Produto</span>
          <ProductPicker value={product} onChange={(p) => { setProduct(p); resetItem(); }} autoFocus={!productParam && !lotParam} />

          {product && (
            <>
              <p className="mb-1.5 text-sm font-semibold text-slate-300">2. Lote e local de origem</p>
              <LotPicker productId={product.id} value={row?.id ?? null} onChange={(l) => { setRow(l); setToLocation(""); }} />
              {row && (
                <div className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2.5 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-slate-400">Origem</span><span className="font-semibold">{row.location_name}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-400">Disponível</span><span className="font-bold tabular-nums">{fmtQty(row.quantity, row.unit)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-400">Validade</span><span>{fmtDate(row.expires_at)}</span></div>
                </div>
              )}
            </>
          )}

          {row && (
            <>
              <p className="mb-1.5 text-sm font-semibold text-slate-300">3. Destino</p>
              {mode === "interna" ? (
                <Field label="Local de destino">
                  <Select value={toLocation} onChange={(e) => setToLocation(e.target.value)}>
                    <option value="">Selecione…</option>
                    {destLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                </Field>
              ) : (
                <>
                  <Field label="Unidade de destino">
                    <Select value={toStore} onChange={(e) => { setToStore(e.target.value); setToLocation(""); }}>
                      <option value="">Selecione…</option>
                      {otherStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                  {toStore && (
                    <Field label={`Local de destino em ${toStoreName ?? "destino"}`}>
                      <LocationSelect value={toLocation} onChange={setToLocation} storeId={toStore} />
                    </Field>
                  )}
                </>
              )}

              <p className="mb-1.5 text-sm font-semibold text-slate-300">4. Quantidade</p>
              <UnitQtyInput product={product} quantity={qty} onQuantity={setQty} unitId={unit} onUnitId={setUnit} max={Number(row.quantity)} hint={`Disponível na origem: ${fmtQty(row.quantity, row.unit)}`} />
              <div className="-mt-2 mb-4">
                <button type="button" className="text-xs font-semibold text-[var(--accent)]" onClick={() => { setQty(Number(row.quantity)); setUnit(""); }}>Transferir tudo ({fmtQty(row.quantity, row.unit)})</button>
              </div>

              <Field label="Observação (opcional)">
                <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              <Button variant="primary" size="lg" full disabled={!ready || busy} onClick={() => setConfirm(true)}>
                <Icon name="swap" size={18} /> {busy ? "Transferindo…" : "Transferir"}
              </Button>
            </>
          )}
        </SectionCard>

        <SectionCard title="Transferências recentes">
          {recent.error ? (
            <ErrorBox error={toOpsError(recent.error as Error).message} onRetry={() => void recent.refetch()} />
          ) : recent.isLoading ? (
            <Skeleton rows={3} />
          ) : (recent.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nenhuma transferência registrada ainda nesta unidade.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {(recent.data ?? []).map((t) => <TransferItem key={t.id} t={t} storeId={store!.id} />)}
            </ul>
          )}
        </SectionCard>
      </div>

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirmar transferência"
        confirmLabel="Transferir"
        message={
          product && row && qty
            ? mode === "interna"
              ? `Transferir ${fmtQty(qty, unitCode)} de ${product.name} (lote ${row.lot_code}) de ${row.location_name} para ${destLocations.find((l) => l.id === toLocation)?.name ?? "o destino"}?`
              : `Transferir ${fmtQty(qty, unitCode)} de ${product.name} (lote ${row.lot_code}) de ${store?.name} para ${toStoreName}? O lote será espelhado na unidade de destino com a mesma validade e custo.`
            : ""
        }
        onConfirm={() => void submit()}
      />
    </div>
  );
}

function TransferItem({ t, storeId }: { t: TransferRow; storeId: string }) {
  const internal = t.from_store_id === t.to_store_id;
  const outgoing = !internal && t.from_store_id === storeId;
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${internal ? "bg-blue-500/15 text-blue-300" : outgoing ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
          <Icon name="swap" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {internal
              ? `${t.from_location?.name ?? "?"} → ${t.to_location?.name ?? "?"}`
              : outgoing
                ? `Enviada para ${t.to_store?.name ?? "outra unidade"} (${t.to_location?.name ?? "?"})`
                : `Recebida de ${t.from_store?.name ?? "outra unidade"} → ${t.to_location?.name ?? "?"}`}
            <Badge tone={internal ? "blue" : outgoing ? "amber" : "green"} className="ml-2">{internal ? "interna" : outgoing ? "saída" : "entrada"}</Badge>
          </p>
          <p className="text-xs text-slate-500">{fmtDateTime(t.created_at)} · {t.created_by_name || "—"}{t.notes ? ` · ${t.notes}` : ""}</p>
          <ul className="mt-1 space-y-0.5">
            {t.transfer_items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/estoque/produto/${it.product_id}`} className="min-w-0 truncate text-slate-200 hover:underline">
                  {it.products?.name ?? "Produto"} {it.from_lot?.lot_code && <span className="font-mono text-xs text-slate-500">· {it.from_lot.lot_code}</span>}
                </Link>
                <span className="shrink-0 font-semibold tabular-nums">{fmtQty(it.quantity, it.products?.units?.code)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}
