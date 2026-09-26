"use client";

import { useMemo, useState } from "react";
import { fmtQty } from "@/lib/ops/format";
import type { Unit } from "@/lib/ops/types";
import { conversionOptions, type ProductForm } from "@/lib/ops/modules/cadastros";
import { Button, Field, IconButton, InlineAlert, NumberInput, Select, useToast } from "@/components/ops/ui";
import { UnitSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";

/** Conversão adicional (linha de product_units ou pendente, antes de salvar o produto). */
export type ExtraConversion = { id: string; unit_id: string; factor: number };

/**
 * Seção "Unidades" do produto: unidade de estoque, unidade de compra + fator,
 * conversões adicionais e conversor rápido.
 */
export function ProductUnitsSection({
  form, set, units, extras, onAddExtra, onRemoveExtra, canEdit, hasHistory,
}: {
  form: ProductForm; set: (patch: Partial<ProductForm>) => void; units: Unit[]; extras: ExtraConversion[];
  onAddExtra: (unitId: string, factor: number) => Promise<void>; onRemoveExtra: (id: string) => Promise<void>; canEdit: boolean;
  /** produto já tem lotes/movimentos: trocar a unidade de estoque muda o significado dos saldos */
  hasHistory?: boolean;
}) {
  const notify = useToast();
  const active = useMemo(() => units.filter((u) => u.active || u.id === form.stock_unit_id || u.id === form.purchase_unit_id), [units, form.stock_unit_id, form.purchase_unit_id]);
  const stock = units.find((u) => u.id === form.stock_unit_id);
  const purchase = units.find((u) => u.id === form.purchase_unit_id);
  const [newUnit, setNewUnit] = useState("");
  const [newFactor, setNewFactor] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // conversor rápido
  const options = useMemo(() => conversionOptions(units, form.stock_unit_id, form.purchase_unit_id, form.purchase_factor, extras), [units, form.stock_unit_id, form.purchase_unit_id, form.purchase_factor, extras]);
  const [convQty, setConvQty] = useState<number | null>(1);
  const [convUnit, setConvUnit] = useState("");
  const chosen = options.find((o) => o.id === convUnit) ?? options.find((o) => o.source === "compra") ?? options[0];
  const converted = chosen && convQty !== null ? convQty * chosen.factor : null;

  async function add() {
    if (!newUnit) return notify("Escolha a unidade da conversão.", "erro");
    if (!newFactor || newFactor <= 0) return notify("Informe o fator (quantas unidades de estoque cabem em 1).", "erro");
    if (newUnit === form.stock_unit_id) return notify("A unidade de estoque já é a base: escolha outra unidade.", "erro");
    if (extras.some((e) => e.unit_id === newUnit)) return notify("Essa unidade já tem conversão cadastrada.", "erro");
    setAdding(true);
    try {
      await onAddExtra(newUnit, newFactor);
      setNewUnit("");
      setNewFactor(null);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Unidade de estoque</h2>
        <p className="mb-3 text-sm text-slate-400">Como o produto é contado no estoque, nas fichas técnicas e nos relatórios (ex.: kg, L, un).</p>
        <Field label="Unidade de estoque">
          <UnitSelect value={form.stock_unit_id} onChange={(v) => set({ stock_unit_id: v })} units={active} placeholder="Escolha a unidade…" allowEmpty={false} />
        </Field>
        {hasHistory && <InlineAlert tone="amber">Este produto já tem movimentações. Trocar a unidade de estoque não converte os saldos antigos: use só para corrigir um cadastro errado.</InlineAlert>}
        {!canEdit && <p className="text-xs text-slate-500">Você não tem permissão para editar produtos.</p>}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Unidade de compra</h2>
        <p className="mb-3 text-sm text-slate-400">Como o fornecedor vende (caixa, fardo, pacote…). Informe quantas unidades de estoque vêm em 1 unidade de compra.</p>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Unidade de compra" hint="Deixe em branco se compra na mesma unidade do estoque.">
            <UnitSelect value={form.purchase_unit_id} onChange={(v) => set({ purchase_unit_id: v, purchase_factor: v ? (form.purchase_factor ?? 1) : 1 })} units={active} placeholder="Mesma do estoque" allowEmpty />
          </Field>
          {form.purchase_unit_id && (
            <Field label={`1 ${purchase?.code ?? "unidade de compra"} = quantos ${stock?.code ?? "?"}?`} hint={`Ex.: 1 caixa = 10 kg → digite 10. Ao receber, o sistema converte ${purchase?.code ?? "a unidade de compra"} para ${stock?.code ?? "a unidade de estoque"} sozinho.`}>
              <NumberInput big value={form.purchase_factor} onChange={(v) => set({ purchase_factor: v })} min={0} suffix={stock?.code} placeholder="1" />
            </Field>
          )}
        </div>
        {form.purchase_unit_id && stock && purchase && (form.purchase_factor ?? 0) > 0 && (
          <p className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm">
            <span className="font-semibold">1 {purchase.code}</span> ({purchase.name}) = <span className="font-semibold">{fmtQty(form.purchase_factor, stock.code)}</span>
          </p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Conversões adicionais</h2>
        <p className="mb-3 text-sm text-slate-400">Outras formas de contar este produto (ex.: 1 pacote = 0,5 kg; 1 bandeja = 30 un). Podem ser usadas no recebimento, na produção e na contagem.</p>
        {extras.length === 0 ? (
          <p className="mb-3 rounded-xl border border-dashed border-[var(--line)] px-3 py-3 text-center text-sm text-slate-500">Nenhuma conversão adicional.</p>
        ) : (
          <ul className="mb-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
            {extras.map((e) => {
              const u = units.find((x) => x.id === e.unit_id);
              return (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">
                    <span className="font-semibold">1 {u?.code ?? "?"}</span> <span className="text-slate-500">({u?.name ?? "unidade"})</span> = <span className="font-semibold">{fmtQty(e.factor, stock?.code)}</span>
                  </span>
                  {canEdit && <IconButton icon="trash" label="Remover conversão" tone="danger" size={36} onClick={() => void onRemoveExtra(e.id)} />}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Unidade">
              <UnitSelect value={newUnit} onChange={setNewUnit} units={active.filter((u) => u.id !== form.stock_unit_id)} placeholder="Escolha…" />
            </Field>
            <Field label={`1 unidade = quantos ${stock?.code ?? "?"}?`}>
              <NumberInput value={newFactor} onChange={setNewFactor} min={0} suffix={stock?.code} placeholder="0" />
            </Field>
            <Button variant="soft" size="lg" className="mb-4" disabled={adding || !form.stock_unit_id} onClick={() => void add()}>
              <Icon name="plus" size={18} /> Adicionar
            </Button>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Conversor rápido</h2>
        <p className="mb-3 text-sm text-slate-400">Digite uma quantidade e veja quanto dá na unidade de estoque.</p>
        {options.length === 0 ? (
          <p className="text-sm text-slate-500">Escolha a unidade de estoque para usar o conversor.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <NumberInput big value={convQty} onChange={setConvQty} min={0} className="w-36" placeholder="0" />
            <Select value={chosen?.id ?? ""} onChange={(e) => setConvUnit(e.target.value)} className="!h-14 !w-auto min-w-[120px] font-semibold" aria-label="Unidade de origem">
              {options.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}
            </Select>
            <span className="text-xl font-bold text-slate-400">=</span>
            <span className="text-2xl font-extrabold tabular-nums">{converted !== null && stock ? fmtQty(converted, stock.code) : "—"}</span>
          </div>
        )}
        {chosen && chosen.source === "natureza" && <p className="mt-2 text-xs text-slate-500">Conversão automática entre unidades da mesma natureza ({chosen.code} → {stock?.code}).</p>}
      </section>
    </div>
  );
}
