"use client";

import { useEffect, useState } from "react";
import type { ChecklistExecutionItem } from "@/lib/ops/types";
import { Button, Field, InlineAlert, Sheet, TextArea } from "@/components/ops/ui";
import { PhotoUpload } from "@/components/ops/PhotoUpload";

/**
 * Folha para marcar um item que exige evidência (tarefa crítica ou com foto)
 * ou para anexar observação/foto a qualquer item.
 */
export function ChecklistItemSheet({
  item, open, onClose, onConfirm, busy, requireEvidence,
}: {
  item: ChecklistExecutionItem | null; open: boolean; onClose: () => void; onConfirm: (notes: string, photo: string, markDone: boolean) => void; busy: boolean;
  /** modelo exige evidência em todos os itens */
  requireEvidence: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState("");
  useEffect(() => {
    if (open && item) {
      setNotes(item.notes ?? "");
      setPhoto(item.photo_url ?? "");
    }
  }, [open, item]);
  if (!item) return null;

  const needsPhoto = item.requires_photo;
  const needsAny = item.critical || requireEvidence;
  const hasPhoto = photo.trim() !== "";
  const hasNotes = notes.trim() !== "";
  const ok = (!needsPhoto || hasPhoto) && (!needsAny || hasPhoto || hasNotes);
  const willMark = !item.done;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={willMark ? "Marcar como feito" : "Observação e foto"}
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant={willMark ? "success" : "primary"} size="lg" full disabled={busy || !ok} onClick={() => onConfirm(notes.trim(), photo, willMark)}>
            {busy ? "Salvando…" : willMark ? "Marcar como feito" : "Salvar"}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-base font-bold">{item.text}</p>
      {needsPhoto && <InlineAlert tone="amber" icon="camera">Esta tarefa exige foto como evidência.</InlineAlert>}
      {!needsPhoto && needsAny && <InlineAlert tone="amber" icon="alert">Tarefa crítica: informe uma observação ou tire uma foto.</InlineAlert>}
      <PhotoUpload value={photo} onChange={setPhoto} folder="checklists" label="Foto" required={needsPhoto} hint="Tire a foto pelo celular ou escolha da galeria." />
      <Field label="Observação" hint={needsAny && !needsPhoto ? "Obrigatória se não houver foto." : "Opcional."}>
        <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="O que foi verificado, problemas encontrados…" />
      </Field>
    </Sheet>
  );
}
