"use client";

import { useEffect, useState } from "react";
import { fmtDate, fmtPct, fmtQty, todayISO } from "@/lib/ops/format";
import { yieldPct, yieldTone, type FinishValues } from "@/lib/ops/modules/producao";
import { LocationSelect } from "@/components/ops/pickers";
import { Button, Field, InlineAlert, NumberInput, TextArea, TextInput } from "@/components/ops/ui";
import { ConfirmActionSheet, FieldBlock } from "./shared";

/**
 * Formulário de conclusão da produção (usado em "Produzir agora" e em "Concluir").
 * Quantidade produzida, local de destino, lote, validade e observações.
 */
export function FinishProductionForm({
  planned, unit, productName, suggestedExpiresAt, shelfLifeDays, initialLocationId, storeId, busy, blockedReason, submitLabel = "Concluir produção", onSubmit,
}: {
  planned: number;
  unit: string;
  productName: string;
  suggestedExpiresAt: string | null | undefined;
  shelfLifeDays: number | null | undefined;
  initialLocationId?: string | null;
  storeId: string;
  busy: boolean;
  /** quando informado, o botão fica desativado e o motivo aparece */
  blockedReason?: string | null;
  submitLabel?: string;
  onSubmit: (v: FinishValues) => void | Promise<void>;
}) {
  const [produced, setProduced] = useState<number | null>(planned);
  const [locationId, setLocationId] = useState(initialLocationId ?? "");
  const [lotCode, setLotCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(suggestedExpiresAt ?? "");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => { setProduced(planned); }, [planned]);
  useEffect(() => { if (suggestedExpiresAt && !expiresAt) setExpiresAt(suggestedExpiresAt); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [suggestedExpiresAt]);
  useEffect(() => { if (initialLocationId && !locationId) setLocationId(initialLocationId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initialLocationId]);

  const pct = yieldPct(produced, planned);
  const partial = produced !== null && produced < planned - 1e-9;
  const overProduced = produced !== null && produced > planned * 1.5;
  const pastDate = Boolean(expiresAt) && expiresAt < todayISO();
  const canSubmit = !busy && !blockedReason && produced !== null && produced > 0;

  function submit() {
    if (!canSubmit) return;
    setConfirm(false);
    void onSubmit({ produced: produced!, locationId, lotCode: lotCode.trim(), expiresAt, notes: notes.trim() });
  }

  return (
    <div>
      <FieldBlock label="Quantidade produzida" required hint={`Planejado: ${fmtQty(planned, unit)}. Pode ser parcial.`}>
        <NumberInput big value={produced} onChange={setProduced} min={0} suffix={unit} placeholder="0" />
        {pct !== null && (
          <p className={`mt-1 text-xs font-semibold ${{ green: "text-emerald-300", amber: "text-amber-300", red: "text-rose-300", slate: "text-slate-400" }[yieldTone(pct)]}`}>
            Rendimento {fmtPct(pct)} do planejado{partial ? " (produção parcial)" : ""}{overProduced ? " — confira se a quantidade está certa" : ""}
          </p>
        )}
      </FieldBlock>

      <Field label="Local de destino" hint="Onde o lote produzido será guardado. Vazio = local padrão do produto/unidade.">
        <LocationSelect value={locationId} onChange={setLocationId} storeId={storeId} allowEmpty placeholder="Local padrão" />
      </Field>

      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Código do lote" hint="Vazio = gerado automaticamente">
          <TextInput value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Automático" className="font-mono" />
        </Field>
        <Field label="Validade" hint={shelfLifeDays ? `Sugestão: ${shelfLifeDays} dias após hoje` : "Sem validade padrão cadastrada"}>
          <TextInput type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
      </div>
      {pastDate && <InlineAlert tone="red">A validade informada já passou. Confira a data.</InlineAlert>}

      <Field label="Observações">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ex.: usamos a segunda panela; sobrou massa" />
      </Field>

      {blockedReason && <InlineAlert tone="red">{blockedReason}</InlineAlert>}

      <Button variant="success" size="lg" full disabled={!canSubmit} onClick={() => setConfirm(true)}>
        {busy ? "Registrando…" : submitLabel}
      </Button>

      <ConfirmActionSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirmar produção"
        variant="success"
        confirmLabel="Confirmar"
        busy={busy}
        onConfirm={submit}
        message={
          <div className="space-y-1 text-sm">
            <p><strong>{productName}</strong>: {fmtQty(produced ?? 0, unit)} produzido{pct !== null ? ` (${fmtPct(pct)} do planejado)` : ""}.</p>
            <p>Os ingredientes serão baixados do estoque e um novo lote será criado{expiresAt ? ` com validade ${fmtDate(expiresAt)}` : " sem validade"}.</p>
            <p className="text-slate-400">Esta ação não pode ser desfeita; correções viram novos movimentos.</p>
          </div>
        }
      />
    </div>
  );
}
