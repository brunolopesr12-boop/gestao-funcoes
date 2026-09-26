"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { callOfflineable } from "@/lib/ops/offline";
import { toOpsError } from "@/lib/ops/errors";
import { fmtQty } from "@/lib/ops/format";
import type { Product } from "@/lib/ops/types";
import {
  DIFF_REASONS, fetchProductByCode, fetchScannedLot, useLocationBalances, useProductUnitOptions, useUnitCode,
  type CountItemProduct, type CountItemRow, type CountRow,
} from "@/lib/ops/modules/inventario";
import { Button, Choice, Field, InlineAlert, Sheet, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { LocationSelect, ProductPicker } from "@/components/ops/pickers";
import { parseLotQr } from "@/components/ops/QrCode";
import { Icon } from "@/components/ops/Icon";
import { ScanSheet } from "./ScanSheet";
import { QtyUnitInput } from "./QtyUnitInput";
import { CountLotPicker, CountPreview } from "./shared";

/** Dados iniciais (vindos do QR, da URL ou de um item já listado). */
export type CountItemInitial = { product?: Product | null; lotId?: string | null; locationId?: string | null };

/**
 * Folha para contar (ou corrigir) um item da contagem.
 * - produto por busca/leitura de código; local; lote (opcional quando o local
 *   tem um só lote — o banco resolve); quantidade + unidade; motivo; observação.
 * - grava com ops_count_set_item (funciona offline: entra na fila).
 */
export function CountItemSheet({
  open, onClose, count, item, initial, onSaved,
}: { open: boolean; onClose: () => void; count: CountRow; item?: CountItemRow | null; initial?: CountItemInitial | null; onSaved?: () => void }) {
  const { store, company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const unitCode = useUnitCode();

  const [product, setProduct] = useState<Product | null>(null);
  const [fixed, setFixed] = useState<CountItemProduct | null>(null);
  const [location, setLocation] = useState("");
  const [lot, setLot] = useState<string | null>(null);
  const [lotTouched, setLotTouched] = useState(false);
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  const editing = Boolean(item);
  const active: CountItemProduct | null = fixed ?? product;

  // reinicia ao abrir
  useEffect(() => {
    if (!open) return;
    if (item) {
      setFixed(item.products);
      setProduct(null);
      setLocation(item.location_id);
      setLot(item.lot_id);
      setLotTouched(true);
      setQty(item.counted_quantity === null ? null : Number(item.counted_quantity));
      const known = DIFF_REASONS.some((r) => r.value === item.reason);
      setReason(item.reason ? (known ? item.reason : "outro") : "");
      setReasonText(item.reason && !known ? item.reason : "");
      setNotes(item.notes ?? "");
    } else {
      setFixed(null);
      setProduct(initial?.product ?? null);
      setLocation(initial?.locationId ?? count.location_id ?? "");
      setLot(initial?.lotId ?? null);
      setLotTouched(Boolean(initial?.lotId));
      setQty(null);
      setReason("");
      setReasonText("");
      setNotes("");
    }
    setUnit("");
    setBusy(false);
  }, [open, item, initial, count.location_id]);

  const balances = useLocationBalances(store?.id, active?.id, location || null);
  const { options } = useProductUnitOptions(active);
  const factor = options.find((o) => o.id === unit)?.factor ?? 1;

  // um só lote no local: usa direto (mesma regra do banco)
  useEffect(() => {
    if (!open || editing || lotTouched || !balances.data) return;
    if (balances.data.length === 1) setLot(balances.data[0].lot_id);
    else setLot(null);
  }, [open, editing, lotTouched, balances.data]);

  const stockUnit = active ? unitCode(active.stock_unit_id) : "";
  const theoretical = useMemo(() => {
    if (editing && item) return Number(item.theoretical_quantity);
    if (!balances.data) return null;
    if (lot) return balances.data.filter((b) => b.lot_id === lot).reduce((s, b) => s + Number(b.quantity), 0);
    return balances.data.reduce((s, b) => s + Number(b.quantity), 0);
  }, [editing, item, balances.data, lot]);
  const countedInStock = qty === null ? null : qty * factor;
  const hasDiff = theoretical !== null && countedInStock !== null && Math.abs(countedInStock - theoretical) > 1e-9;

  async function handleScan(text: string) {
    setScanOpen(false);
    if (!company) return;
    setScanBusy(true);
    try {
      const lotId = parseLotQr(text);
      if (lotId) {
        const s = await fetchScannedLot(lotId);
        if (!s) return notify("Lote não encontrado.", "erro");
        if (s.lot.store_id !== store?.id) return notify("Este lote é de outra unidade.", "erro");
        setProduct(s.product);
        setLot(s.lot.id);
        setLotTouched(true);
        if (!count.location_id) {
          const here = s.balances.find((b) => b.location_id === location) ?? s.balances[0];
          if (here) setLocation(here.location_id);
        }
        return;
      }
      const ps = await fetchProductByCode(company.id, text);
      if (ps.length === 0) return notify(`Código "${text}" não encontrado.`, "erro");
      if (ps.length > 1) return notify("Mais de um produto com esse código. Escolha pela busca.", "info");
      setProduct(ps[0]);
      setLot(null);
      setLotTouched(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setScanBusy(false);
    }
  }

  async function submit() {
    if (!store || !active) return notify("Escolha o produto.", "erro");
    if (!location) return notify("Escolha o local.", "erro");
    if (qty === null || qty < 0) return notify("Informe a quantidade contada (pode ser zero).", "erro");
    const finalReason = reason === "outro" ? reasonText.trim() || "outro" : reason;
    setBusy(true);
    try {
      const r = await callOfflineable<string>(
        "ops_count_set_item",
        {
          p_count: count.id,
          p_product: active.id,
          p_location: location,
          p_counted: qty,
          p_lot: lot,
          p_reason: finalReason,
          p_notes: notes.trim(),
          p_unit: unit || null,
        },
        `Contagem ${count.number} · ${active.name} · ${fmtQty(qty)}`,
      );
      invalidate("inventory_items", "inventory_counts");
      if (r.queued) notify("Sem conexão: a contagem ficou na fila e será enviada quando a internet voltar.", "info");
      else notify(editing ? "Contagem corrigida" : "Item contado");
      onSaved?.();
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={editing ? "Corrigir contagem" : "Contar item"}
        footer={
          <div className="flex gap-2">
            <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full disabled={busy || !active || !location || qty === null} onClick={() => void submit()}>
              {busy ? "Gravando…" : editing ? "Salvar correção" : "Confirmar contagem"}
            </Button>
          </div>
        }
      >
        {fixed ? (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-white/5 text-lg">📦</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{fixed.name}</p>
              <p className="text-xs text-slate-400">{fixed.internal_code && <span className="mr-2 font-mono">{fixed.internal_code}</span>}{item?.stock_lots?.lot_code ? `lote ${item.stock_lots.lot_code}` : "todos os lotes"} · {item?.stock_locations?.name}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-1.5 text-sm font-semibold text-slate-300">Produto</p>
            <ProductPicker value={product} onChange={(p) => { setProduct(p); setLot(null); setLotTouched(false); }} autoFocus={!product} onScan={() => setScanOpen(true)} />
            {scanBusy && <p className="-mt-2 mb-3 text-xs text-slate-400">Procurando o código…</p>}
          </>
        )}

        {active && (
          <>
            {!editing && (
              <Field label="Local" hint={count.location_id ? "Local da contagem." : "Onde o produto está."}>
                <LocationSelect value={location} onChange={(v) => { setLocation(v); setLot(null); setLotTouched(false); }} placeholder="Escolha o local" />
              </Field>
            )}
            {!editing && location && (
              <CountLotPicker balances={balances.data ?? []} loading={balances.isLoading} value={lot} onChange={(l) => { setLot(l); setLotTouched(true); }} />
            )}
            {balances.error && !editing && <InlineAlert tone="amber">Não foi possível carregar o saldo do sistema ({toOpsError(balances.error as Error).message}). Você ainda pode registrar a contagem.</InlineAlert>}

            <QtyUnitInput product={active} quantity={qty} onQuantity={setQty} unitId={unit} onUnitId={setUnit} label="Quantidade contada" autoFocus={Boolean(fixed || product)} />
            <CountPreview theoretical={theoretical} counted={countedInStock} unit={stockUnit} />

            {(hasDiff || reason) && (
              <>
                <p className="mb-1.5 text-sm font-semibold text-slate-300">Motivo da diferença</p>
                <Choice value={reason} onChange={setReason} columns={2} options={DIFF_REASONS.map((r) => ({ value: r.value, label: r.label }))} />
                {reason === "outro" && (
                  <Field label="Descreva o motivo">
                    <TextInput value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Ex.: embalagem trocada" />
                  </Field>
                )}
              </>
            )}
            <Field label="Observação (opcional)">
              <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: caixa aberta no fundo da prateleira" />
            </Field>
          </>
        )}
        {!active && (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Icon name="scan" size={16} /> Busque pelo nome ou leia o código de barras / QR da etiqueta.</p>
        )}
      </Sheet>
      <ScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onResult={(t) => void handleScan(t)} />
    </>
  );
}
