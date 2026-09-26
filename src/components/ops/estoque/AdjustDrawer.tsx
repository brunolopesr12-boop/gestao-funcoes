"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { useProductLots } from "@/lib/ops/hooks";
import { fmtQty } from "@/lib/ops/format";
import type { Product, StockBalance } from "@/lib/ops/types";
import { ADJUST_REASONS } from "@/lib/ops/modules/estoque";
import { Button, ConfirmSheet, Drawer, Field, InlineAlert, NumberInput, Select, TextArea, useToast } from "@/components/ops/ui";
import { LotPicker } from "@/components/ops/pickers";

/**
 * Ajuste manual de saldo: define o NOVO saldo de um lote em um local.
 * O banco gera um movimento "ajuste" com a diferença (rpc ops_adjust).
 */
export function AdjustDrawer({
  open, onClose, product, initialLotId, onDone,
}: {
  open: boolean;
  onClose: () => void;
  product: Pick<Product, "id" | "name"> | null;
  initialLotId?: string | null;
  onDone?: () => void;
}) {
  const { store } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const lots = useProductLots(product?.id, undefined, true);

  const [row, setRow] = useState<StockBalance | null>(null);
  const [newQty, setNewQty] = useState<number | null>(null);
  const [reason, setReason] = useState("contagem");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const preselected = useRef(false);

  useEffect(() => {
    if (!open) return;
    preselected.current = false;
    setRow(null);
    setNewQty(null);
    setReason("contagem");
    setNotes("");
    setConfirm(false);
  }, [open, product?.id]);

  useEffect(() => {
    if (!open || !initialLotId || !lots.data || preselected.current) return;
    preselected.current = true;
    const found = lots.data.find((l) => l.lot_id === initialLotId);
    if (found) setRow(found);
  }, [open, initialLotId, lots.data]);

  const delta = row && newQty !== null ? newQty - Number(row.quantity) : null;

  async function submit() {
    if (!store || !product || !row || newQty === null) return;
    setBusy(true);
    try {
      const id = await rpc<string | null>("ops_adjust", {
        p_store: store.id,
        p_product: product.id,
        p_lot: row.lot_id,
        p_location: row.location_id,
        p_new_quantity: newQty,
        p_reason: reason,
        p_notes: notes.trim(),
      });
      invalidate("stock_items", "stock_lots", "stock_movements", "dashboard", "alerts");
      notify(id ? "Saldo ajustado" : "O saldo já estava com esse valor — nada foi alterado.", id ? "ok" : "info");
      onDone?.();
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Ajustar saldo"
        footer={
          <div className="flex gap-2">
            <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full disabled={busy || !row || newQty === null || newQty < 0 || delta === 0} onClick={() => setConfirm(true)}>
              {busy ? "Ajustando…" : "Ajustar saldo"}
            </Button>
          </div>
        }
      >
        {!product ? (
          <p className="text-sm text-slate-400">Escolha um produto primeiro.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-400">
              Produto: <span className="font-semibold text-slate-100">{product.name}</span>
            </p>
            <InlineAlert tone="blue" icon="info">
              O ajuste corrige o saldo do lote em um local. Para baixa normal use <strong>Consumir</strong>; para descarte use <strong>Registrar perda</strong>.
            </InlineAlert>

            <LotPicker productId={product.id} value={row?.id ?? null} includeExpired onChange={(l) => setRow(l)} />

            {row && (
              <div className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Local</span>
                  <span className="font-semibold">{row.location_name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Saldo atual no sistema</span>
                  <span className="font-bold tabular-nums">{fmtQty(row.quantity, row.unit)}</span>
                </div>
              </div>
            )}

            <Field label={`Novo saldo${row ? ` (${row.unit})` : ""}`} hint="Informe a quantidade real contada neste local.">
              <NumberInput big value={newQty} onChange={setNewQty} min={0} placeholder="0" suffix={row?.unit} autoFocus={Boolean(row)} disabled={!row} />
            </Field>
            {delta !== null && delta !== 0 && row && (
              <p className={`-mt-2 mb-4 text-sm font-semibold ${delta > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                Diferença: {delta > 0 ? "+" : ""}{fmtQty(delta, row.unit)}
              </p>
            )}

            <Field label="Motivo">
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                {ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label="Observação (opcional)">
              <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explique o que aconteceu" />
            </Field>
          </>
        )}
      </Drawer>

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirmar ajuste"
        message={row && newQty !== null ? `O saldo do lote ${row.lot_code} em ${row.location_name} vai de ${fmtQty(row.quantity, row.unit)} para ${fmtQty(newQty, row.unit)} (${delta! > 0 ? "+" : ""}${fmtQty(delta, row.unit)}). Isso fica registrado na auditoria.` : ""}
        confirmLabel="Ajustar"
        onConfirm={() => void submit()}
      />
    </>
  );
}
