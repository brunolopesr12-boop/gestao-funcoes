"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, todayISO } from "@/lib/ops/format";
import type { Product, StockLot } from "@/lib/ops/types";
import { LOT_EVENT_META, previewLotEventExpiry, type LotEvent } from "@/lib/ops/modules/estoque";
import type { LotEventResult } from "@/lib/ops/modules/estoque-types";
import { Button, ConfirmSheet, Field, Sheet, TextArea, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/**
 * Abrir / Congelar / Descongelar / Bloquear / Desbloquear um lote (rpc ops_lot_event).
 * Cada ação pede confirmação e mostra a nova validade prevista.
 */
export function LotEventButtons({
  lot, product, onDone, size = "lg",
}: {
  lot: Pick<StockLot, "id" | "lot_code" | "status" | "expires_at" | "original_expires_at" | "opened_at" | "frozen_at" | "thawed_at">;
  product: Pick<Product, "shelf_life_open_days" | "shelf_life_frozen_days" | "shelf_life_thawed_days"> | null | undefined;
  onDone?: (r: LotEventResult) => void;
  size?: "md" | "lg";
}) {
  const { can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [pending, setPending] = useState<LotEvent | null>(null);
  const [blockNotes, setBlockNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const blocked = lot.status === "bloqueado";
  const events = useMemo(() => {
    const list: LotEvent[] = [];
    if (!blocked) {
      if (!lot.opened_at) list.push("abertura");
      if (!lot.frozen_at || lot.thawed_at) list.push("congelamento");
      if (lot.frozen_at && !lot.thawed_at) list.push("descongelamento");
      list.push("bloqueio");
    } else {
      list.push("desbloqueio");
    }
    return list.filter((e) => can(LOT_EVENT_META[e].perm));
  }, [blocked, lot.opened_at, lot.frozen_at, lot.thawed_at, can]);

  const preview = pending ? previewLotEventExpiry(pending, lot, product, todayISO()) : null;

  async function run(event: LotEvent, notes = "") {
    setBusy(true);
    try {
      const r = await rpc<LotEventResult>("ops_lot_event", { p_lot: lot.id, p_event: event, p_notes: notes });
      invalidate("stock_items", "stock_lots", "stock_movements", "alerts", "dashboard");
      const meta = LOT_EVENT_META[event];
      if (event === "bloqueio") notify(`Lote ${lot.lot_code} bloqueado`);
      else if (event === "desbloqueio") notify(`Lote ${lot.lot_code} liberado`);
      else notify(`Lote ${lot.lot_code}: ${meta.label.toLowerCase()} registrado. Validade: ${fmtDate(r.expires_at)}`);
      onDone?.(r);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
      setPending(null);
      setBlockNotes("");
    }
  }

  if (events.length === 0) return null;

  const icon = (e: LotEvent) => (e === "congelamento" ? "snow" : e === "descongelamento" ? "thermometer" : e === "bloqueio" ? "lock" : e === "desbloqueio" ? "check" : "package");

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {events.map((e) => {
          const m = LOT_EVENT_META[e];
          return (
            <Button key={e} variant={m.tone} size={size} disabled={busy} onClick={() => setPending(e)} className="!justify-start">
              <Icon name={icon(e)} size={18} />
              {m.label}
            </Button>
          );
        })}
      </div>

      {/* confirmação simples (abrir/congelar/descongelar/desbloquear) */}
      <ConfirmSheet
        open={pending !== null && pending !== "bloqueio"}
        onClose={() => setPending(null)}
        title={pending ? `${LOT_EVENT_META[pending].label} o lote ${lot.lot_code}?` : ""}
        confirmLabel={pending ? LOT_EVENT_META[pending].label : "Confirmar"}
        message={
          pending && preview
            ? `${LOT_EVENT_META[pending].help} ${
                pending === "desbloqueio"
                  ? ""
                  : preview.noRule
                    ? "Este produto não tem prazo cadastrado para esta situação, então a validade continua " + fmtDate(lot.expires_at) + "."
                    : preview.changed
                      ? `Validade atual: ${fmtDate(lot.expires_at)} → nova validade prevista: ${fmtDate(preview.expires_at)}.`
                      : `A validade continua ${fmtDate(lot.expires_at)}.`
              }`
            : ""
        }
        onConfirm={() => pending && void run(pending)}
      />

      {/* bloqueio pede o motivo */}
      <Sheet open={pending === "bloqueio"} onClose={() => setPending(null)} title={`Bloquear o lote ${lot.lot_code}?`}>
        <p className="mb-4 text-sm text-slate-300">{LOT_EVENT_META.bloqueio.help}</p>
        <Field label="Motivo do bloqueio">
          <TextArea rows={3} value={blockNotes} onChange={(e) => setBlockNotes(e.target.value)} placeholder="Ex.: embalagem estufada, aguardando análise" autoFocus />
        </Field>
        <div className="flex gap-3">
          <Button variant="soft" size="lg" full onClick={() => setPending(null)} disabled={busy}>Cancelar</Button>
          <Button variant="danger" size="lg" full disabled={busy || !blockNotes.trim()} onClick={() => void run("bloqueio", blockNotes.trim())}>{busy ? "Bloqueando…" : "Bloquear"}</Button>
        </div>
      </Sheet>
    </>
  );
}
