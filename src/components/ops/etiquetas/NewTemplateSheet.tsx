"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { toOpsError } from "@/lib/ops/errors";
import { useInvalidate } from "@/lib/ops/query";
import { LABEL_KIND_LABEL, type LabelKind, type LabelLayout, type LabelTemplate } from "@/lib/ops/types";
import { LABEL_KINDS, blankLayout, factoryLayout, normalizeLayout } from "@/lib/ops/modules/labels";
import { Button, Field, NumberInput, Select, Sheet, TextInput, useToast } from "@/components/ops/ui";

type Base = "fabrica" | "branco" | "copia";

/** Cria um modelo novo (de fábrica, em branco 60×40 ou cópia de um existente). */
export function NewTemplateSheet({ open, onClose, templates, onCreated }: { open: boolean; onClose: () => void; templates: LabelTemplate[]; onCreated: (id: string) => void }) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LabelKind>("producao");
  const [base, setBase] = useState<Base>("fabrica");
  const [copyId, setCopyId] = useState("");
  const [w, setW] = useState<number | null>(60);
  const [h, setH] = useState<number | null>(40);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!company) return;
    const n = name.trim();
    if (!n) return notify("Dê um nome ao modelo.", "erro");
    let layout: LabelLayout;
    let width = w ?? 60, height = h ?? 40;
    if (base === "copia") {
      const src = templates.find((t) => t.id === copyId);
      if (!src) return notify("Escolha o modelo a copiar.", "erro");
      layout = normalizeLayout(src.layout);
      width = Number(src.width_mm);
      height = Number(src.height_mm);
    } else if (base === "fabrica") {
      const f = factoryLayout(kind);
      layout = f.layout;
      width = f.width_mm;
      height = f.height_mm;
    } else {
      layout = blankLayout();
    }
    if (width < 20 || height < 10 || width > 300 || height > 300) return notify("Tamanho inválido (mínimo 20×10 mm, máximo 300×300 mm).", "erro");
    setBusy(true);
    try {
      const hasDefault = templates.some((t) => t.kind === kind && t.is_default);
      const { data, error } = await supabaseBrowser()
        .from("label_templates")
        .insert({ company_id: company.id, name: n, kind, width_mm: width, height_mm: height, layout, is_default: !hasDefault, active: true, position: templates.length })
        .select("id")
        .single();
      if (error) throw toOpsError(error);
      notify("Modelo criado");
      invalidate("label_templates");
      onCreated((data as { id: string }).id);
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Novo modelo de etiqueta">
      <Field label="Nome">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Produção 60×40 com logo" autoFocus />
      </Field>
      <Field label="Tipo de etiqueta">
        <Select value={kind} onChange={(e) => setKind(e.target.value as LabelKind)}>
          {LABEL_KINDS.map((k) => <option key={k} value={k}>{LABEL_KIND_LABEL[k]}</option>)}
        </Select>
      </Field>
      <Field label="Começar a partir de">
        <Select value={base} onChange={(e) => setBase(e.target.value as Base)}>
          <option value="fabrica">Modelo de fábrica deste tipo</option>
          <option value="branco">Em branco (60×40 mm)</option>
          {templates.length > 0 && <option value="copia">Cópia de um modelo existente</option>}
        </Select>
      </Field>
      {base === "copia" && (
        <Field label="Modelo a copiar">
          <Select value={copyId} onChange={(e) => setCopyId(e.target.value)}>
            <option value="">Selecione…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {LABEL_KIND_LABEL[t.kind]} · {Number(t.width_mm)}×{Number(t.height_mm)}</option>)}
          </Select>
        </Field>
      )}
      {base === "branco" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Largura (mm)"><NumberInput value={w} onChange={setW} min={20} suffix="mm" /></Field>
          <Field label="Altura (mm)"><NumberInput value={h} onChange={setH} min={10} suffix="mm" /></Field>
        </div>
      )}
      <div className="flex gap-3">
        <Button variant="soft" size="lg" full onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant="primary" size="lg" full onClick={() => void create()} disabled={busy}>{busy ? "Criando…" : "Criar e editar"}</Button>
      </div>
    </Sheet>
  );
}
