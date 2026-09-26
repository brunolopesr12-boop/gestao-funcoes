"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { COUNT_KIND_OPTIONS, openCount, type CountKind } from "@/lib/ops/modules/inventario";
import { Button, Choice, Field, Sheet, TextArea, useToast } from "@/components/ops/ui";
import { CategorySelect, LocationSelect } from "@/components/ops/pickers";

/** Abre uma nova contagem (rápida ou completa) na unidade atual. */
export function NewCountSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { store } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [kind, setKind] = useState<CountKind>("rapida");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind("rapida");
    setLocation("");
    setCategory("");
    setNotes("");
  }, [open]);

  async function submit() {
    if (!store) return;
    setBusy(true);
    try {
      const id = await openCount({ storeId: store.id, kind, locationId: location || null, categoryId: category || null, notes: notes.trim() });
      invalidate("inventory_counts", "inventory_items");
      notify("Contagem aberta");
      onCreated(id);
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nova contagem"
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy || !store} onClick={() => void submit()}>{busy ? "Abrindo…" : "Abrir contagem"}</Button>
        </div>
      }
    >
      <p className="mb-1.5 text-sm font-semibold text-slate-300">Tipo de contagem</p>
      <Choice value={kind} onChange={setKind} columns={1} options={COUNT_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint, icon: o.value === "completa" ? "clipboard" : "sparkles" }))} />
      <Field label="Local" hint="Deixe em branco para contar a unidade inteira.">
        <LocationSelect value={location} onChange={setLocation} allowEmpty placeholder="Toda a unidade" />
      </Field>
      <Field label="Categoria (opcional)" hint="Só os produtos desta categoria entram na contagem.">
        <CategorySelect value={category} onChange={setCategory} />
      </Field>
      <Field label="Observação (opcional)">
        <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: contagem de fim de mês" />
      </Field>
    </Sheet>
  );
}
