"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useInvalidate } from "@/lib/ops/query";
import { useSession } from "@/lib/ops/session";
import { useUnits } from "@/lib/ops/hooks";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/ops/format";
import {
  compatibleUnits, defaultUnitId, findProductByBarcode, unitFactor, useProductUnits, useSupplierProduct,
  type PoItemProduct, type PurchaseOrderDetail, type PurchaseOrderItemRow,
} from "@/lib/ops/modules/recebimento";
import type { Product } from "@/lib/ops/types";
import { ProductPicker, UnitSelect } from "@/components/ops/pickers";
import { Button, Drawer, Field, InlineAlert, NumberInput, TextArea, useToast } from "@/components/ops/ui";
import { FieldBlock, ScanSheet } from "./shared";

type Props = {
  open: boolean;
  onClose: () => void;
  po: PurchaseOrderDetail;
  item: PurchaseOrderItemRow | null;
  nextPosition: number;
  onSaved: (keepOpen: boolean) => void;
};

/** Adicionar/editar item do pedido de compra. */
export function PoItemDrawer({ open, onClose, po, item, nextPosition, onSaved }: Props) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const editing = Boolean(item);

  const [product, setProduct] = useState<PoItemProduct | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [autoPrice, setAutoPrice] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = useUnits();
  const productUnits = useProductUnits(product?.id);
  const supplierProduct = useSupplierProduct(po.supplier_id, product?.id);

  const reset = useCallback(() => {
    if (item) {
      setProduct(item.products ?? null);
      setQuantity(Number(item.quantity));
      setUnitId(item.unit_id ?? item.products?.stock_unit_id ?? "");
      setPrice(Number(item.estimated_price) || null);
      setNotes(item.notes ?? "");
      setAutoPrice(false);
    } else {
      setProduct(null);
      setQuantity(null);
      setUnitId("");
      setPrice(null);
      setNotes("");
      setAutoPrice(true);
    }
    setError(null);
    setScanOpen(false);
  }, [item]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const unitOptions = useMemo(() => (product ? compatibleUnits(product, units.data ?? [], productUnits.data ?? []) : []), [product, units.data, productUnits.data]);
  const factor = unitFactor(unitOptions, unitId) ?? 1;
  const stockUnit = product?.units?.code ?? "";
  const unitCode = unitOptions.find((o) => o.unit.id === unitId)?.unit.code ?? stockUnit;
  const total = (quantity ?? 0) * (price ?? 0);

  // referência de preço: último do fornecedor (por unidade de estoque) ou último pago
  const refPrice = useMemo(() => {
    if (!product) return null;
    if (supplierProduct.data && Number(supplierProduct.data.last_price) > 0) {
      return { label: `Último preço de ${po.suppliers?.name ?? "fornecedor"}`, perStock: Number(supplierProduct.data.last_price), at: supplierProduct.data.last_purchase_at };
    }
    if (Number(product.last_purchase_price) > 0) return { label: "Último preço pago", perStock: Number(product.last_purchase_price), at: null };
    if (Number(product.cost) > 0) return { label: "Custo atual", perStock: Number(product.cost), at: null };
    return null;
  }, [product, supplierProduct.data, po.suppliers?.name]);

  function pickProduct(p: Product | null) {
    setProduct(p);
    setError(null);
    if (!p) return;
    setUnitId(defaultUnitId(p, compatibleUnits(p, units.data ?? [], [])));
    setAutoPrice(true);
  }

  useEffect(() => {
    if (!open || !autoPrice || !product || !unitId) return;
    if (po.supplier_id && supplierProduct.isLoading) return;
    if (refPrice) setPrice(Number((refPrice.perStock * factor).toFixed(4)));
  }, [open, autoPrice, product, unitId, factor, refPrice, supplierProduct.isLoading, po.supplier_id]);

  async function onScan(text: string) {
    setScanOpen(false);
    if (!company) return;
    try {
      const p = await findProductByBarcode(company.id, text);
      if (!p) notify(`Nenhum produto com o código ${text}.`, "erro");
      else pickProduct(p);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  async function save(keepOpen: boolean) {
    if (!product) return setError("Escolha o produto.");
    if (!quantity || quantity <= 0) return setError("Informe a quantidade.");
    if (!unitId) return setError("Escolha a unidade.");
    setBusy(true);
    setError(null);
    try {
      const payload = { purchase_order_id: po.id, product_id: product.id, quantity, unit_id: unitId, estimated_price: price ?? 0, notes: notes.trim() };
      const sb = supabaseBrowser();
      const res = item ? await sb.from("purchase_order_items").update(payload).eq("id", item.id) : await sb.from("purchase_order_items").insert({ ...payload, position: nextPosition });
      if (res.error) throw toOpsError(res.error);
      invalidate("purchase_order_items", "purchase_orders");
      notify(item ? "Item atualizado" : "Item adicionado");
      if (keepOpen) reset();
      onSaved(keepOpen);
    } catch (e) {
      setError(toOpsError(e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <div className="flex flex-col gap-2 pb-2 sm:flex-row">
      {!editing && <Button variant="soft" size="lg" full disabled={busy} onClick={() => void save(true)}>Salvar e adicionar outro</Button>}
      <Button variant="primary" size="lg" full disabled={busy} onClick={() => void save(false)}>{busy ? "Salvando…" : editing ? "Salvar alterações" : "Salvar item"}</Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title={editing ? "Editar item" : "Adicionar item ao pedido"} footer={footer}>
      {error && <InlineAlert tone="red">{error}</InlineAlert>}
      <FieldBlock label="Produto" required>
        {editing && product ? (
          <ProductPicker value={product as unknown as Product} onChange={() => undefined} disabled />
        ) : (
          <ProductPicker value={product as unknown as Product | null} onChange={pickProduct} onScan={() => setScanOpen(true)} autoFocus={!product} />
        )}
      </FieldBlock>

      {product && (
        <>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Quantidade">
              <NumberInput big value={quantity} onChange={setQuantity} placeholder="0" min={0} suffix={unitCode} autoFocus={!editing} />
            </Field>
            <Field label="Unidade" hint={factor !== 1 && stockUnit ? `1 ${unitCode} = ${fmtQty(factor, stockUnit)}` : undefined}>
              <UnitSelect value={unitId} onChange={setUnitId} units={unitOptions.map((o) => o.unit)} placeholder="Unidade" />
            </Field>
          </div>
          {quantity !== null && quantity > 0 && factor !== 1 && stockUnit && (
            <p className="-mt-2 mb-4 text-sm text-slate-300">Equivale a <strong className="tabular-nums">{fmtQty(quantity * factor, stockUnit)}</strong></p>
          )}

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label={`Preço estimado por ${unitCode || "unidade"}`}>
              <NumberInput value={price} onChange={(v) => { setPrice(v); setAutoPrice(false); }} placeholder="0,00" min={0} suffix="R$" />
            </Field>
            <div className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2.5">
              <p className="text-xs text-slate-400">Total estimado</p>
              <p className="text-xl font-extrabold tabular-nums">{fmtMoney(total)}</p>
              {refPrice ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{refPrice.label}: {fmtMoney(refPrice.perStock)}/{stockUnit}{refPrice.at ? ` (${fmtDate(refPrice.at)})` : ""}</span>
                  <button type="button" className="font-semibold text-[var(--accent)] underline" onClick={() => { setPrice(Number((refPrice.perStock * factor).toFixed(4))); setAutoPrice(false); }}>usar</button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Sem preço de referência para este produto.</p>
              )}
            </div>
          </div>

          <Field label="Observação (opcional)">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ex.: marca preferida, tamanho da embalagem" />
          </Field>
        </>
      )}
      <ScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onResult={(t) => void onScan(t)} />
    </Drawer>
  );
}
