"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { callOfflineable } from "@/lib/ops/offline";
import { toOpsError } from "@/lib/ops/errors";
import { useProductLots } from "@/lib/ops/hooks";
import { fmtDate, fmtQty } from "@/lib/ops/format";
import type { Product, StockBalance } from "@/lib/ops/types";
import { CONSUME_REASONS } from "@/lib/ops/modules/estoque";
import type { ConsumeResult } from "@/lib/ops/modules/estoque-types";
import { Button, Drawer, Field, InlineAlert, Select, TextArea, useToast } from "@/components/ops/ui";
import { LocationSelect, LotPicker } from "@/components/ops/pickers";
import { UnitQtyInput } from "./UnitQtyInput";

/**
 * Baixa de estoque (consumo). Funciona offline: entra na fila e é enviada depois.
 * - Lote automático (FEFO) ou lote específico.
 * - Avisa quando o lote escolhido não é o que deveria sair primeiro.
 */
export function ConsumeDrawer({
  open, onClose, product, initialLotId, onDone,
}: {
  open: boolean;
  onClose: () => void;
  product: Pick<Product, "id" | "name" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor"> | null;
  /** abre já com este lote selecionado (ex.: veio do QR Code) */
  initialLotId?: string | null;
  onDone?: () => void;
}) {
  const { store } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const lots = useProductLots(product?.id, undefined, false);

  const [row, setRow] = useState<StockBalance | null>(null);
  const [auto, setAuto] = useState(true);
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("consumo");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // reinicia ao abrir
  useEffect(() => {
    if (!open) return;
    setRow(null);
    setAuto(!initialLotId);
    setLocation("");
    setQty(null);
    setUnit("");
    setReason("consumo");
    setNotes("");
    setWarning(null);
    setNotice(null);
  }, [open, initialLotId, product?.id]);

  // pré-seleciona o lote vindo do QR
  useEffect(() => {
    if (!open || !initialLotId || !lots.data) return;
    const found = lots.data.find((l) => l.lot_id === initialLotId);
    if (found) {
      setRow(found);
      setAuto(false);
      setNotice(null);
    } else {
      // lote lido está vencido, bloqueado ou sem saldo: cai para o automático e avisa
      setRow(null);
      setAuto(true);
      setNotice("O lote lido não está disponível para consumo (vencido, bloqueado ou sem saldo). Escolha outro lote ou use o automático.");
    }
  }, [open, initialLotId, lots.data]);

  const fefoFirst = lots.data?.[0] ?? null;
  const availableForRow = useMemo(() => {
    if (!lots.data) return null;
    if (row) return lots.data.filter((l) => l.lot_id === row.lot_id && (!location || l.location_id === location)).reduce((s, l) => s + Number(l.quantity), 0);
    return lots.data.filter((l) => !location || l.location_id === location).reduce((s, l) => s + Number(l.quantity), 0);
  }, [lots.data, row, location]);

  const preWarn = !auto && row && fefoFirst && fefoFirst.lot_id !== row.lot_id;

  async function submit() {
    if (!store || !product) return;
    if (!qty || qty <= 0) return notify("Informe a quantidade.", "erro");
    setBusy(true);
    try {
      const r = await callOfflineable<ConsumeResult>(
        "ops_consume",
        {
          p_store: store.id,
          p_product: product.id,
          p_quantity: qty,
          p_lot: auto ? null : (row?.lot_id ?? null),
          p_location: location || null,
          p_reason: reason,
          p_notes: notes.trim(),
          p_unit: unit || null,
        },
        `Consumo · ${product.name} · ${fmtQty(qty)}`,
      );
      invalidate("stock_items", "stock_lots", "stock_movements", "dashboard", "alerts");
      if (r.queued) {
        notify("Sem conexão: o consumo ficou na fila e será enviado quando a internet voltar.", "info");
        onDone?.();
        onClose();
        return;
      }
      if (r.data?.duplicated) {
        notify("Este consumo já tinha sido registrado.", "info");
        onClose();
        return;
      }
      if (r.data?.fefo_warning) {
        const f = lots.data?.find((l) => l.lot_id === r.data.fefo_lot_id);
        setWarning(`Consumo registrado, mas o lote ${f?.lot_code ?? "mais antigo"}${f?.expires_at ? ` (vence ${fmtDate(f.expires_at)})` : ""} deveria ter saído primeiro. Da próxima vez, use o lote que vence antes.`);
        onDone?.();
        return;
      }
      notify("Consumo registrado");
      onDone?.();
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
      title="Consumir do estoque"
      footer={
        warning ? (
          <Button variant="primary" size="lg" full onClick={onClose}>Entendi</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full disabled={busy || !product || !qty} onClick={() => void submit()}>{busy ? "Registrando…" : "Registrar consumo"}</Button>
          </div>
        )
      }
    >
      {!product ? (
        <p className="text-sm text-slate-400">Escolha um produto primeiro.</p>
      ) : warning ? (
        <InlineAlert tone="amber">{warning}</InlineAlert>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-400">
            Produto: <span className="font-semibold text-slate-100">{product.name}</span>
          </p>
          {notice && <InlineAlert tone="amber">{notice}</InlineAlert>}

          <LotPicker
            productId={product.id}
            value={auto ? null : (row?.id ?? null)}
            allowNone
            onChange={(l) => {
              if (!l) {
                setAuto(true);
                setRow(null);
              } else {
                setAuto(false);
                setRow(l);
                setLocation(l.location_id);
              }
            }}
          />
          {preWarn && (
            <InlineAlert tone="amber">
              O lote <strong>{fefoFirst!.lot_code}</strong> vence antes ({fmtDate(fefoFirst!.expires_at)}) e deveria sair primeiro. Se continuar, o sistema registra o aviso.
            </InlineAlert>
          )}

          <Field label="Local (opcional)" hint="Deixe em branco para o sistema escolher onde há saldo.">
            <LocationSelect value={location} onChange={setLocation} allowEmpty placeholder="Qualquer local" />
          </Field>

          <UnitQtyInput product={product} quantity={qty} onQuantity={setQty} unitId={unit} onUnitId={setUnit} autoFocus max={availableForRow} hint={availableForRow !== null ? `Disponível: ${fmtQty(availableForRow, lots.data?.[0]?.unit)}` : undefined} />

          <Field label="Motivo">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {CONSUME_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Observação (opcional)">
            <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: usado no almoço de sábado" />
          </Field>
        </>
      )}
    </Drawer>
  );
}
