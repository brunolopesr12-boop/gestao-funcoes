"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { addDaysISO, todayISO } from "@/lib/ops/format";
import type { Product } from "@/lib/ops/types";
import { MANUAL_ORIGIN_OPTIONS, type ManualEntryOrigin } from "@/lib/ops/modules/estoque";
import { Button, Choice, Drawer, Field, NumberInput, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { LocationSelect, ProductPicker, SupplierSelect } from "@/components/ops/pickers";
import { UnitQtyInput } from "./UnitQtyInput";

/**
 * Entrada manual / estoque inicial: cria um lote e o movimento de entrada
 * (rpc ops_create_lot). Para mercadoria de fornecedor com nota, prefira Recebimento.
 */
export function ManualEntryDrawer({
  open, onClose, product: fixedProduct, onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** quando informado, o produto fica travado (tela do produto) */
  product?: Product | null;
  onDone?: (lotId: string) => void;
}) {
  const { store } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();

  const [product, setProduct] = useState<Product | null>(fixedProduct ?? null);
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [expires, setExpires] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [supplier, setSupplier] = useState("");
  const [origin, setOrigin] = useState<ManualEntryOrigin>("inicial");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProduct(fixedProduct ?? null);
    setLocation("");
    setQty(null);
    setUnit("");
    setLotCode("");
    setExpires("");
    setCost(null);
    setSupplier("");
    setOrigin("inicial");
    setNotes("");
  }, [open, fixedProduct]);

  // ao escolher o produto: sugere validade pelo prazo padrão, custo e fornecedor
  useEffect(() => {
    if (!product) return;
    setUnit("");
    setExpires(product.shelf_life_days ? addDaysISO(todayISO(), product.shelf_life_days) : "");
    setCost(product.cost > 0 ? product.cost : null);
    setSupplier(product.default_supplier_id ?? "");
  }, [product]);

  async function submit() {
    if (!store || !product) return;
    if (!location) return notify("Escolha o local de estoque.", "erro");
    if (!qty || qty <= 0) return notify("Informe a quantidade.", "erro");
    setBusy(true);
    try {
      const lotId = await rpc<string>("ops_create_lot", {
        p_store: store.id,
        p_product: product.id,
        p_location: location,
        p_quantity: qty,
        p_lot_code: lotCode.trim(),
        p_expires_at: expires || null,
        p_unit_cost: cost,
        p_origin: origin,
        p_notes: notes.trim(),
        p_unit: unit || null,
        p_supplier: supplier || null,
      });
      invalidate("stock_items", "stock_lots", "stock_movements", "dashboard", "alerts", "products");
      notify("Entrada registrada e lote criado");
      onDone?.(lotId);
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Entrada manual / estoque inicial"
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy || !product || !location || !qty} onClick={() => void submit()}>{busy ? "Registrando…" : "Registrar entrada"}</Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-400">Use para carga inicial, devoluções ou entradas sem nota. Mercadoria de fornecedor com nota fiscal deve entrar por <strong className="text-slate-200">Recebimento</strong>.</p>

      <span className="mb-1.5 block text-sm font-semibold text-slate-300">Produto</span>
      <ProductPicker value={product} onChange={setProduct} disabled={Boolean(fixedProduct)} autoFocus={!fixedProduct} />

      {product && (
        <>
          <Choice value={origin} onChange={setOrigin} columns={3} options={MANUAL_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} />

          <Field label="Local de estoque">
            <LocationSelect value={location} onChange={setLocation} />
          </Field>

          <UnitQtyInput product={product} quantity={qty} onQuantity={setQty} unitId={unit} onUnitId={setUnit} autoFocus />

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Código do lote (opcional)" hint="Em branco: o sistema gera um código.">
              <TextInput value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Ex.: L240915-001" />
            </Field>
            <Field label="Validade" hint={product.shelf_life_days ? `Sugerida pelo prazo padrão do produto (${product.shelf_life_days} dias).` : "Deixe em branco se não tem validade."}>
              <TextInput type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </Field>
            <Field label="Custo unitário (R$)" hint="Em branco: usa o custo cadastrado no produto.">
              <NumberInput value={cost} onChange={setCost} min={0} placeholder="0,00" suffix="R$" />
            </Field>
            <Field label="Fornecedor (opcional)">
              <SupplierSelect value={supplier} onChange={setSupplier} placeholder="Sem fornecedor" />
            </Field>
          </div>
          <Field label="Observação (opcional)">
            <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
    </Drawer>
  );
}
