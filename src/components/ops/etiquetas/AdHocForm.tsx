"use client";

import { STORAGE_TYPE_LABEL, type LabelKind, type StorageType } from "@/lib/ops/types";
import { KIND_DATE_FIELD, type AdHocLabelInput } from "@/lib/ops/modules/labels";
import { Field, NumberInput, Select, TextInput } from "@/components/ops/ui";
import { LocationSelect } from "@/components/ops/pickers";
import { useLocations } from "@/lib/ops/hooks";

const DATE_FIELDS: { key: keyof AdHocLabelInput; label: string }[] = [
  { key: "produced_at", label: "Data de produção" },
  { key: "opened_at", label: "Data de abertura" },
  { key: "frozen_at", label: "Data de congelamento" },
  { key: "thawed_at", label: "Data de descongelamento" },
  { key: "received_at", label: "Data de recebimento" },
];

/** Campos manuais da etiqueta avulsa (sem lote no sistema). */
export function AdHocForm({ value, onChange, kind }: { value: AdHocLabelInput; onChange: (v: AdHocLabelInput) => void; kind: LabelKind }) {
  const set = <K extends keyof AdHocLabelInput>(k: K, v: AdHocLabelInput[K]) => onChange({ ...value, [k]: v });
  const locations = useLocations();
  const mainDate = KIND_DATE_FIELD[kind];
  const ordered = [...DATE_FIELDS].sort((a, b) => (a.key === mainDate ? -1 : b.key === mainDate ? 1 : 0));
  const locationId = (locations.data ?? []).find((l) => l.name === value.location)?.id ?? "";

  return (
    <div>
      <Field label="Produto *">
        <TextInput value={value.product_name} onChange={(e) => set("product_name", e.target.value)} placeholder="Ex.: Molho de tomate" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantidade">
          <NumberInput big value={value.quantity} onChange={(v) => set("quantity", v)} placeholder="0" min={0} />
        </Field>
        <Field label="Unidade" hint="kg, g, L, un…">
          <TextInput value={value.unit} onChange={(e) => set("unit", e.target.value)} placeholder="kg" className="h-14 text-xl font-bold" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Validade *">
          <TextInput type="date" value={value.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
        </Field>
        {ordered.slice(0, 1).map((d) => (
          <Field key={d.key} label={d.label}>
            <TextInput type="date" value={String(value[d.key] ?? "")} onChange={(e) => set(d.key, e.target.value as never)} />
          </Field>
        ))}
      </div>
      <details className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-slate-300">Outras datas e informações</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {ordered.slice(1).map((d) => (
            <Field key={d.key} label={d.label}>
              <TextInput type="date" value={String(value[d.key] ?? "")} onChange={(e) => set(d.key, e.target.value as never)} />
            </Field>
          ))}
          <Field label="Lote (texto)">
            <TextInput value={value.lot_code} onChange={(e) => set("lot_code", e.target.value)} placeholder="Ex.: L260926-001" />
          </Field>
          <Field label="Código interno">
            <TextInput value={value.internal_code} onChange={(e) => set("internal_code", e.target.value)} />
          </Field>
          <Field label="Armazenamento">
            <Select value={value.storage} onChange={(e) => set("storage", e.target.value as StorageType | "")}>
              <option value="">—</option>
              {(Object.keys(STORAGE_TYPE_LABEL) as StorageType[]).map((k) => <option key={k} value={k}>{STORAGE_TYPE_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Fornecedor">
            <TextInput value={value.supplier} onChange={(e) => set("supplier", e.target.value)} />
          </Field>
        </div>
      </details>
      <Field label="Responsável">
        <TextInput value={value.responsible} onChange={(e) => set("responsible", e.target.value)} placeholder="Quem está etiquetando" />
      </Field>
      <Field label="Local" hint="Escolha um local da unidade ou digite outro abaixo.">
        <LocationSelect value={locationId} onChange={(id) => set("location", (locations.data ?? []).find((l) => l.id === id)?.name ?? "")} allowEmpty placeholder="Local de estoque (opcional)" />
      </Field>
      <Field label="Local (texto livre)">
        <TextInput value={value.location} onChange={(e) => set("location", e.target.value)} placeholder="Ex.: Geladeira 2" />
      </Field>
    </div>
  );
}
