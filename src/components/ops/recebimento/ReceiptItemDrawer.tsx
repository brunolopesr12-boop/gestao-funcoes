"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useInvalidate } from "@/lib/ops/query";
import { useSession } from "@/lib/ops/session";
import { useLocations, useUnits } from "@/lib/ops/hooks";
import { addDaysISO, fmtDate, fmtMoney, fmtQty, todayISO } from "@/lib/ops/format";
import {
  compatibleUnits, defaultUnitId, findProductByBarcode, temperatureIssue, toLocalDateISO, unitFactor, useProductStoreSettings, useProductUnits, useSupplierProduct,
  type ReceiptDetail, type ReceiptItemProduct, type ReceiptItemRow,
} from "@/lib/ops/modules/recebimento";
import { ITEM_RESULT_LABEL, PACKAGE_LABEL, REJECTION_LABEL, STORAGE_TYPE_LABEL, type PackageCondition, type Product, type ReceiptItemResult, type RejectionReason } from "@/lib/ops/types";
import { ProductPicker, UnitSelect, LocationSelect } from "@/components/ops/pickers";
import { Button, Choice, Drawer, Field, InlineAlert, NumberInput, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { FieldBlock, ScanSheet } from "./shared";

const RESULT_OPTIONS: { value: ReceiptItemResult; label: string; hint: string }[] = [
  { value: "aprovado", label: ITEM_RESULT_LABEL.aprovado, hint: "Entra no estoque" },
  { value: "ressalva", label: ITEM_RESULT_LABEL.ressalva, hint: "Entra, mas com observação" },
  { value: "recusado", label: ITEM_RESULT_LABEL.recusado, hint: "Não entra no estoque" },
];
const PACKAGE_OPTIONS = (Object.keys(PACKAGE_LABEL) as PackageCondition[]).map((v) => ({ value: v, label: PACKAGE_LABEL[v] }));
const REJECTION_OPTIONS = (Object.keys(REJECTION_LABEL) as RejectionReason[]).filter((v) => v !== "").map((v) => ({ value: v, label: REJECTION_LABEL[v] }));

type Props = {
  open: boolean;
  onClose: () => void;
  receipt: ReceiptDetail;
  /** item em edição (null = novo) */
  item: ReceiptItemRow | null;
  nextPosition: number;
  onSaved: (keepOpen: boolean) => void;
};

/**
 * Conferência de um item do recebimento (adicionar/editar).
 * Pensado para o celular: campos grandes, um passo por vez, validação clara.
 */
export function ReceiptItemDrawer({ open, onClose, receipt, item, nextPosition, onSaved }: Props) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const editing = Boolean(item);

  const [product, setProduct] = useState<ReceiptItemProduct | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [unitId, setUnitId] = useState("");
  const [weight, setWeight] = useState<number | null>(null);
  const [lotCode, setLotCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [unitPrice, setUnitPrice] = useState<number | null>(null);
  const [temperature, setTemperature] = useState<number | null>(null);
  const [packageCondition, setPackageCondition] = useState<PackageCondition>("ok");
  const [result, setResult] = useState<ReceiptItemResult>("aprovado");
  const [rejectionReason, setRejectionReason] = useState<RejectionReason>("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [autoLocation, setAutoLocation] = useState(true);
  const [autoPrice, setAutoPrice] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = useUnits();
  const locations = useLocations(receipt.store_id);
  const productUnits = useProductUnits(product?.id);
  const storeSettings = useProductStoreSettings(product?.id, receipt.store_id);
  const supplierProduct = useSupplierProduct(receipt.supplier_id, product?.id);

  const receivedDate = useMemo(() => toLocalDateISO(receipt.received_at) || todayISO(), [receipt.received_at]);

  const reset = useCallback(() => {
    if (item) {
      setProduct(item.products ?? null);
      setQuantity(Number(item.quantity));
      setUnitId(item.unit_id ?? item.products?.stock_unit_id ?? "");
      setWeight(item.weight === null ? null : Number(item.weight));
      setLotCode(item.lot_code ?? "");
      setExpiresAt(item.expires_at ?? "");
      setUnitPrice(Number(item.unit_price) || null);
      setTemperature(item.temperature === null ? null : Number(item.temperature));
      setPackageCondition(item.package_condition ?? "ok");
      setResult(item.result ?? "aprovado");
      setRejectionReason(item.rejection_reason ?? "");
      setLocationId(item.location_id ?? "");
      setNotes(item.notes ?? "");
      setAutoLocation(false);
      setAutoPrice(false);
    } else {
      setProduct(null);
      setQuantity(null);
      setUnitId("");
      setWeight(null);
      setLotCode("");
      setExpiresAt("");
      setUnitPrice(null);
      setTemperature(null);
      setPackageCondition("ok");
      setResult("aprovado");
      setRejectionReason("");
      setLocationId("");
      setNotes("");
      setAutoLocation(true);
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
  const qtyStock = (quantity ?? 0) * factor;
  const total = (quantity ?? 0) * (unitPrice ?? 0);
  const pricePerStock = factor > 0 ? (unitPrice ?? 0) / factor : 0;
  const temp = temperatureIssue(product, temperature);
  const needsNotes = result !== "aprovado";

  /** ao escolher um produto novo: unidade, validade sugerida */
  function pickProduct(p: Product | null) {
    setProduct(p);
    setError(null);
    if (!p) return;
    const opts = compatibleUnits(p, units.data ?? [], []);
    setUnitId(defaultUnitId(p, opts));
    setExpiresAt(p.shelf_life_days ? addDaysISO(receivedDate, p.shelf_life_days) : "");
    setAutoLocation(true);
    setAutoPrice(true);
  }

  // local padrão: configuração do produto na unidade, senão o primeiro local
  useEffect(() => {
    if (!open || !autoLocation || !product) return;
    if (storeSettings.isLoading) return;
    const def = storeSettings.data?.default_location_id;
    // sem local padrão configurado: sugere o local cujo armazenamento combina com o produto
    // (refrigerado → geladeira/câmara, congelado → freezer, ambiente → estoque seco)
    const byStorage = locations.data?.find((l) => l.storage_type === product.storage_type)?.id;
    const first = locations.data?.[0]?.id;
    const next = def && locations.data?.some((l) => l.id === def) ? def : (byStorage ?? first);
    if (next) setLocationId(next);
  }, [open, autoLocation, product, storeSettings.data, storeSettings.isLoading, locations.data]);

  // preço sugerido: último preço do fornecedor (por unidade de estoque) × fator da unidade escolhida
  useEffect(() => {
    if (!open || !autoPrice || !product || !unitId) return;
    if (receipt.supplier_id && supplierProduct.isLoading) return;
    const base = supplierProduct.data?.last_price ? Number(supplierProduct.data.last_price) : Number(product.last_purchase_price) || 0;
    if (base > 0) setUnitPrice(Number((base * factor).toFixed(4)));
  }, [open, autoPrice, product, unitId, factor, supplierProduct.data, supplierProduct.isLoading, receipt.supplier_id]);

  async function onScan(text: string) {
    setScanOpen(false);
    if (!company) return;
    try {
      const p = await findProductByBarcode(company.id, text);
      if (!p) notify(`Nenhum produto com o código ${text}. Cadastre o código de barras no produto.`, "erro");
      else pickProduct(p);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  function validate(): string | null {
    if (!product) return "Escolha o produto.";
    if (!quantity || quantity <= 0) return "Informe a quantidade recebida.";
    if (!unitId) return "Escolha a unidade.";
    if (result !== "recusado" && !locationId) return "Escolha o local onde o produto será guardado.";
    if (result === "recusado" && !rejectionReason) return "Informe o motivo da recusa.";
    if (needsNotes && !notes.trim()) return result === "recusado" ? "Descreva o problema na observação (obrigatório na recusa)." : "Descreva a ressalva na observação (obrigatório).";
    return null;
  }

  async function save(keepOpen: boolean) {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        receipt_id: receipt.id,
        product_id: product!.id,
        quantity,
        unit_id: unitId,
        weight,
        lot_code: lotCode.trim(),
        expires_at: expiresAt || null,
        unit_price: unitPrice ?? 0,
        temperature,
        package_condition: packageCondition,
        result,
        rejection_reason: result === "recusado" ? rejectionReason : "",
        location_id: locationId || null,
        notes: notes.trim(),
      };
      const sb = supabaseBrowser();
      const res = item
        ? await sb.from("receipt_items").update(payload).eq("id", item.id)
        : await sb.from("receipt_items").insert({ ...payload, position: nextPosition });
      if (res.error) throw toOpsError(res.error);
      invalidate("receipt_items", "receipts");
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
      {!editing && (
        <Button variant="soft" size="lg" full disabled={busy} onClick={() => void save(true)}>
          Salvar e adicionar outro
        </Button>
      )}
      <Button variant="primary" size="lg" full disabled={busy} onClick={() => void save(false)}>
        {busy ? "Salvando…" : editing ? "Salvar alterações" : "Salvar item"}
      </Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title={editing ? "Editar item" : "Adicionar item"} footer={footer}>
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
          {product.storage_type !== "ambiente" && (
            <InlineAlert tone="cyan" icon="snow">
              Produto <strong>{STORAGE_TYPE_LABEL[product.storage_type].toLowerCase()}</strong>{temp.rangeLabel ? ` — faixa de armazenagem: ${temp.rangeLabel}` : ""}. Confira a temperatura na chegada.
            </InlineAlert>
          )}

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Quantidade recebida">
              <NumberInput big value={quantity} onChange={setQuantity} placeholder="0" min={0} suffix={unitCode} autoFocus={!editing} />
            </Field>
            <Field label="Unidade" hint={factor !== 1 && stockUnit ? `1 ${unitCode} = ${fmtQty(factor, stockUnit)}` : undefined}>
              <UnitSelect value={unitId} onChange={(v) => { setUnitId(v); }} units={unitOptions.map((o) => o.unit)} placeholder="Unidade" />
            </Field>
          </div>
          {quantity !== null && quantity > 0 && factor !== 1 && stockUnit && (
            <p className="-mt-2 mb-4 text-sm text-slate-300">
              Entra no estoque: <strong className="tabular-nums">{fmtQty(qtyStock, stockUnit)}</strong>
            </p>
          )}

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Peso conferido na balança (opcional)">
              <NumberInput value={weight} onChange={setWeight} placeholder="0,000" min={0} suffix="kg" />
            </Field>
            <Field label="Temperatura na chegada (opcional)">
              <NumberInput value={temperature} onChange={setTemperature} placeholder="—" suffix="°C" />
            </Field>
          </div>
          {temp.outOfRange && (
            <InlineAlert tone="red">
              <strong>Temperatura fora da faixa</strong> ({temp.rangeLabel}). Avalie receber com ressalva ou recusar o item.
            </InlineAlert>
          )}

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Lote (vazio = automático)">
              <TextInput value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Nº do lote na embalagem" />
            </Field>
            <Field label="Validade" hint={product.shelf_life_days ? `Sugerida: ${product.shelf_life_days} dias após o recebimento` : "Sem prazo padrão cadastrado"}>
              <TextInput type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label={`Preço por ${unitCode || "unidade"}`}>
              <NumberInput value={unitPrice} onChange={(v) => { setUnitPrice(v); setAutoPrice(false); }} placeholder="0,00" min={0} suffix="R$" />
            </Field>
            <div className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2.5">
              <p className="text-xs text-slate-400">Total do item</p>
              <p className="text-xl font-extrabold tabular-nums">{fmtMoney(total)}</p>
              {factor !== 1 && stockUnit && unitPrice ? <p className="text-xs text-slate-500">≈ {fmtMoney(pricePerStock)} por {stockUnit}</p> : null}
              {supplierProduct.data?.last_price ? (
                <p className="mt-1 text-xs text-slate-500">
                  Último preço deste fornecedor: {fmtMoney(supplierProduct.data.last_price)}/{stockUnit}
                  {supplierProduct.data.last_purchase_at ? ` (${fmtDate(supplierProduct.data.last_purchase_at)})` : ""}
                </p>
              ) : null}
            </div>
          </div>

          <FieldBlock label="Condição da embalagem">
            <Choice value={packageCondition} onChange={setPackageCondition} options={PACKAGE_OPTIONS} columns={3} />
          </FieldBlock>

          <FieldBlock label="Resultado da conferência">
            <Choice value={result} onChange={(v) => { setResult(v); if (v !== "recusado") setRejectionReason(""); }} options={RESULT_OPTIONS} columns={3} />
          </FieldBlock>

          {result === "recusado" && (
            <FieldBlock label="Motivo da recusa" required>
              <Choice value={rejectionReason} onChange={setRejectionReason} options={REJECTION_OPTIONS} columns={2} />
            </FieldBlock>
          )}

          {result !== "recusado" && (
            <Field label="Guardar em" hint="Local de estoque onde o lote vai entrar">
              <LocationSelect value={locationId} onChange={(v) => { setLocationId(v); setAutoLocation(false); }} storeId={receipt.store_id} />
            </Field>
          )}

          <Field label={needsNotes ? "Observação (obrigatória)" : "Observação"}>
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={result === "recusado" ? "Descreva o problema encontrado" : result === "ressalva" ? "Descreva a ressalva" : "Opcional"} />
          </Field>
        </>
      )}

      <ScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onResult={(t) => void onScan(t)} />
    </Drawer>
  );
}
