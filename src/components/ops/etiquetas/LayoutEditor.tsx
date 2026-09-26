"use client";

import { useEffect, useRef } from "react";
import { LABEL_KIND_LABEL, type LabelField, type LabelKind, type LabelLayout, type LabelTemplate } from "@/lib/ops/types";
import { FIELD_CATALOG, LABEL_KINDS, type LabelFieldKey } from "@/lib/ops/modules/labels";
import { Icon } from "@/components/ops/Icon";
import { Field, IconButton, NumberInput, Select, SectionCard, TextInput, Toggle } from "@/components/ops/ui";

type Layout = Required<Pick<LabelLayout, "fields">> & { qr: NonNullable<LabelLayout["qr"]>; barcode: NonNullable<LabelLayout["barcode"]>; logo: NonNullable<LabelLayout["logo"]> };

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Setas para mover 1 mm (esquerda, direita, cima, baixo). */
function Arrows({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <IconButton icon="chevronLeft" label="Mover 1 mm para a esquerda" size={36} onClick={() => onMove(-1, 0)} />
      <IconButton icon="chevronRight" label="Mover 1 mm para a direita" size={36} onClick={() => onMove(1, 0)} />
      <button type="button" aria-label="Mover 1 mm para cima" title="Mover 1 mm para cima" onClick={() => onMove(0, -1)} className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-300 active:scale-95">
        <Icon name="chevronDown" size={18} className="rotate-180" />
      </button>
      <IconButton icon="chevronDown" label="Mover 1 mm para baixo" size={36} onClick={() => onMove(0, 1)} />
    </div>
  );
}

function Num({ label, value, onChange, suffix, min }: { label: string; value: number; onChange: (v: number) => void; suffix: string; min?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <NumberInput value={value} onChange={(v) => onChange(round1(Math.max(min ?? 0, v ?? 0)))} suffix={suffix} min={min ?? 0} />
    </label>
  );
}

function AlignPicker({ value, onChange }: { value: LabelField["align"]; onChange: (v: NonNullable<LabelField["align"]>) => void }) {
  const opts: { v: NonNullable<LabelField["align"]>; l: string }[] = [{ v: "left", l: "Esq." }, { v: "center", l: "Centro" }, { v: "right", l: "Dir." }];
  return (
    <div className="inline-flex rounded-xl border border-[var(--line)] bg-white/5 p-0.5">
      {opts.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${(value ?? "left") === o.v ? "bg-[var(--panel-2)] text-white shadow" : "text-slate-400"}`}>{o.l}</button>
      ))}
    </div>
  );
}

/** Um campo de texto do layout (aberto quando selecionado). */
function FieldRow({ catalog, field, selected, onToggle, onSelect, onChange }: {
  catalog: (typeof FIELD_CATALOG)[number]; field: LabelField | null; selected: boolean; onToggle: (on: boolean) => void; onSelect: () => void; onChange: (f: LabelField) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && ref.current) ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const on = Boolean(field);
  return (
    <div ref={ref} className={`rounded-xl border ${selected ? "border-[var(--accent)]/60 bg-[var(--accent)]/5" : "border-[var(--line)] bg-white/[0.03]"}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${on ? "Remover" : "Incluir"} ${catalog.label}`}
          onClick={() => onToggle(!on)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-600"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${on ? "left-6" : "left-1"}`} />
        </button>
        <button type="button" onClick={on ? onSelect : () => onToggle(true)} className="min-w-0 flex-1 text-left">
          <span className={`block text-sm font-semibold ${on ? "text-slate-100" : "text-slate-500"}`}>{catalog.label}</span>
          {field && <span className="block text-[11px] text-slate-500">x {field.x} · y {field.y} · {field.w}×{field.h} mm · {field.font} pt{field.bold ? " · negrito" : ""}</span>}
        </button>
        {on && <Icon name="chevronDown" size={16} className={`text-slate-500 transition ${selected ? "rotate-180" : ""}`} />}
      </div>
      {field && selected && (
        <div className="border-t border-[var(--line)] px-3 py-3">
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rótulo antes do valor (opcional)</span>
            <TextInput value={field.label ?? ""} onChange={(e) => onChange({ ...field, label: e.target.value })} placeholder={catalog.defaultLabel || "sem rótulo"} />
          </label>
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            <Num label="X" value={field.x} onChange={(v) => onChange({ ...field, x: v })} suffix="mm" />
            <Num label="Y" value={field.y} onChange={(v) => onChange({ ...field, y: v })} suffix="mm" />
            <Num label="Largura" value={field.w} onChange={(v) => onChange({ ...field, w: v })} suffix="mm" min={1} />
            <Num label="Altura" value={field.h} onChange={(v) => onChange({ ...field, h: v })} suffix="mm" min={1} />
            <Num label="Fonte" value={field.font} onChange={(v) => onChange({ ...field, font: v })} suffix="pt" min={3} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => onChange({ ...field, bold: !field.bold })} className={`rounded-xl border px-3 py-1.5 text-sm font-extrabold ${field.bold ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--line)] bg-white/5 text-slate-400"}`}>
              N
            </button>
            <AlignPicker value={field.align} onChange={(a) => onChange({ ...field, align: a })} />
            <Arrows onMove={(dx, dy) => onChange({ ...field, x: round1(Math.max(0, field.x + dx)), y: round1(Math.max(0, field.y + dy)) })} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Formulário do editor visual: dados do modelo, campos de texto, QR, código de barras e logo.
 * Trabalha sobre uma cópia local do modelo (o pai decide quando salvar).
 */
export function LayoutEditor({ template, onChange, selected, onSelect, logoUrl }: {
  template: LabelTemplate; onChange: (t: LabelTemplate) => void; selected: string | null; onSelect: (k: string | null) => void; logoUrl: string;
}) {
  const layout = template.layout as Layout;
  const setLayout = (patch: Partial<Layout>) => onChange({ ...template, layout: { ...layout, ...patch } });
  const fieldOf = (key: LabelFieldKey) => layout.fields.find((f) => f.key === key) ?? null;
  const setField = (key: LabelFieldKey, f: LabelField) => setLayout({ fields: layout.fields.map((x) => (x.key === key ? f : x)) });
  const toggleField = (cat: (typeof FIELD_CATALOG)[number], on: boolean) => {
    if (!on) {
      setLayout({ fields: layout.fields.filter((f) => f.key !== cat.key) });
      if (selected === cat.key) onSelect(null);
      return;
    }
    if (fieldOf(cat.key)) return;
    // posição sugerida: abaixo do último campo
    const last = layout.fields[layout.fields.length - 1];
    const y = last ? round1(Math.min(Number(template.height_mm) - 4, last.y + last.h + 1)) : 2;
    const nf: LabelField = { key: cat.key, label: cat.defaultLabel || undefined, x: 2, y, w: Math.max(10, round1(Number(template.width_mm) - 4)), h: 4, font: 7, bold: false, align: "left" };
    setLayout({ fields: [...layout.fields, nf] });
    onSelect(cat.key);
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Modelo">
        <Field label="Nome">
          <TextInput value={template.name} onChange={(e) => onChange({ ...template, name: e.target.value })} />
        </Field>
        <Field label="Tipo de etiqueta" hint="Cada tipo pode ter um modelo padrão, usado automaticamente na impressão.">
          <Select value={template.kind} onChange={(e) => onChange({ ...template, kind: e.target.value as LabelKind })}>
            {LABEL_KINDS.map((k) => <option key={k} value={k}>{LABEL_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Largura"><NumberInput value={Number(template.width_mm)} onChange={(v) => onChange({ ...template, width_mm: round1(Math.max(20, v ?? 20)) })} suffix="mm" min={20} /></Field>
          <Field label="Altura"><NumberInput value={Number(template.height_mm)} onChange={(v) => onChange({ ...template, height_mm: round1(Math.max(10, v ?? 10)) })} suffix="mm" min={10} /></Field>
        </div>
        <Toggle checked={template.is_default} onChange={(v) => onChange({ ...template, is_default: v })} label="Padrão do tipo" hint="Ao salvar como padrão, os outros modelos deste tipo deixam de ser padrão." />
        <Toggle checked={template.active} onChange={(v) => onChange({ ...template, active: v })} label="Ativo" hint="Modelos inativos não aparecem na impressão." />
      </SectionCard>

      <SectionCard title="Campos de texto" action={<span className="text-[11px] text-slate-500">{layout.fields.length} no layout</span>}>
        <p className="mb-3 text-xs text-slate-500">Ligue os campos que devem sair na etiqueta e toque no nome para ajustar posição (mm), tamanho e fonte. Você também pode tocar no campo na pré-visualização.</p>
        <div className="space-y-2">
          {FIELD_CATALOG.map((cat) => (
            <FieldRow
              key={cat.key}
              catalog={cat}
              field={fieldOf(cat.key)}
              selected={selected === cat.key}
              onToggle={(on) => toggleField(cat, on)}
              onSelect={() => onSelect(selected === cat.key ? null : cat.key)}
              onChange={(f) => setField(cat.key, f)}
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="QR Code">
        <Toggle checked={layout.qr.enabled !== false} onChange={(v) => setLayout({ qr: { ...layout.qr, enabled: v } })} label="Imprimir QR Code" hint="Abre a ficha do lote ao ser lido pelo celular. Etiquetas avulsas (sem lote) não têm QR." />
        {layout.qr.enabled !== false && (
          <div className={`rounded-xl border p-3 ${selected === "qr" ? "border-[var(--accent)]/60" : "border-[var(--line)]"}`} onClick={() => onSelect("qr")}>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <Num label="X" value={layout.qr.x} onChange={(v) => setLayout({ qr: { ...layout.qr, x: v } })} suffix="mm" />
              <Num label="Y" value={layout.qr.y} onChange={(v) => setLayout({ qr: { ...layout.qr, y: v } })} suffix="mm" />
              <Num label="Tamanho" value={layout.qr.size} onChange={(v) => setLayout({ qr: { ...layout.qr, size: v } })} suffix="mm" min={5} />
            </div>
            <Arrows onMove={(dx, dy) => setLayout({ qr: { ...layout.qr, x: round1(Math.max(0, layout.qr.x + dx)), y: round1(Math.max(0, layout.qr.y + dy)) } })} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Código de barras">
        <Toggle checked={layout.barcode.enabled} onChange={(v) => setLayout({ barcode: { ...layout.barcode, enabled: v } })} label="Imprimir código de barras" hint="Code 128 com o código do lote (ou código interno na etiqueta avulsa). Textos com acentos/símbolos saem como texto." />
        {layout.barcode.enabled && (
          <div className={`rounded-xl border p-3 ${selected === "barcode" ? "border-[var(--accent)]/60" : "border-[var(--line)]"}`} onClick={() => onSelect("barcode")}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Num label="X" value={layout.barcode.x} onChange={(v) => setLayout({ barcode: { ...layout.barcode, x: v } })} suffix="mm" />
              <Num label="Y" value={layout.barcode.y} onChange={(v) => setLayout({ barcode: { ...layout.barcode, y: v } })} suffix="mm" />
              <Num label="Largura" value={layout.barcode.w} onChange={(v) => setLayout({ barcode: { ...layout.barcode, w: v } })} suffix="mm" min={10} />
              <Num label="Altura" value={layout.barcode.h} onChange={(v) => setLayout({ barcode: { ...layout.barcode, h: v } })} suffix="mm" min={3} />
            </div>
            <Arrows onMove={(dx, dy) => setLayout({ barcode: { ...layout.barcode, x: round1(Math.max(0, layout.barcode.x + dx)), y: round1(Math.max(0, layout.barcode.y + dy)) } })} />
            <p className="mt-2 text-[11px] text-slate-500">No navegador o código é desenhado (Code 128 B/C). No ZPL a própria impressora Zebra gera o código (^BC).</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Logo da empresa">
        <Toggle checked={layout.logo.enabled} onChange={(v) => setLayout({ logo: { ...layout.logo, enabled: v } })} label="Imprimir logo" hint="A imagem vem da configuração da empresa (chave empresa.logo_url). Não sai no ZPL." />
        {layout.logo.enabled && (
          <div className={`rounded-xl border p-3 ${selected === "logo" ? "border-[var(--accent)]/60" : "border-[var(--line)]"}`} onClick={() => onSelect("logo")}>
            {logoUrl ? (
              <div className="mb-3 flex items-center gap-3 text-xs text-slate-400">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" />
                <span>Logo configurado em Configurações da empresa.</span>
              </div>
            ) : (
              <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Nenhum logo configurado. Peça ao gerente para definir o logo em Configurações (empresa.logo_url); até lá o espaço fica em branco.</p>
            )}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Num label="X" value={layout.logo.x} onChange={(v) => setLayout({ logo: { ...layout.logo, x: v } })} suffix="mm" />
              <Num label="Y" value={layout.logo.y} onChange={(v) => setLayout({ logo: { ...layout.logo, y: v } })} suffix="mm" />
              <Num label="Largura" value={layout.logo.w} onChange={(v) => setLayout({ logo: { ...layout.logo, w: v } })} suffix="mm" min={3} />
              <Num label="Altura" value={layout.logo.h} onChange={(v) => setLayout({ logo: { ...layout.logo, h: v } })} suffix="mm" min={3} />
            </div>
            <Arrows onMove={(dx, dy) => setLayout({ logo: { ...layout.logo, x: round1(Math.max(0, layout.logo.x + dx)), y: round1(Math.max(0, layout.logo.y + dy)) } })} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
