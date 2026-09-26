"use client";

import { fmtQty } from "@/lib/ops/format";
import type { Store } from "@/lib/ops/types";
import type { ProductForm } from "@/lib/ops/modules/cadastros";
import { NumberInput, Toggle } from "@/components/ops/ui";
import { LocationSelect } from "@/components/ops/pickers";

/** Ajustes por unidade (loja) — product_store_settings. */
export type StoreDraft = { min_stock: number | null; max_stock: number | null; reorder_point: number | null; ideal_stock: number | null; default_location_id: string; active: boolean };
export const emptyStoreDraft = (): StoreDraft => ({ min_stock: null, max_stock: null, reorder_point: null, ideal_stock: null, default_location_id: "", active: true });

/**
 * Seção "Estoque" do produto: níveis padrão (empresa) e overrides por unidade.
 */
export function ProductStoreSettingsSection({
  form, set, stores, drafts, setDraft, canEditCompany, canEditStore, unit,
}: {
  form: ProductForm; set: (patch: Partial<ProductForm>) => void; stores: Store[]; drafts: Record<string, StoreDraft>;
  setDraft: (storeId: string, patch: Partial<StoreDraft>) => void; canEditCompany: boolean; canEditStore: (storeId: string) => boolean; unit?: string | null;
}) {
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Níveis padrão (todas as unidades)</h2>
        <p className="mb-3 text-sm text-slate-400">Usados nos alertas de estoque baixo e na sugestão de compra. Deixe 0 para não controlar.</p>
        <div className="grid grid-cols-2 gap-x-3 lg:grid-cols-4">
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Mínimo</span>
            <NumberInput value={form.min_stock} onChange={(v) => set({ min_stock: v })} min={0} suffix={unit ?? undefined} placeholder="0" disabled={!canEditCompany} />
            <span className="mt-1 block text-xs text-slate-500">Abaixo disso: alerta 🔴</span>
          </label>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Ponto de reposição</span>
            <NumberInput value={form.reorder_point} onChange={(v) => set({ reorder_point: v })} min={0} suffix={unit ?? undefined} placeholder="0" disabled={!canEditCompany} />
            <span className="mt-1 block text-xs text-slate-500">Hora de comprar 🟡</span>
          </label>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Máximo</span>
            <NumberInput value={form.max_stock} onChange={(v) => set({ max_stock: v })} min={0} suffix={unit ?? undefined} placeholder="0" disabled={!canEditCompany} />
            <span className="mt-1 block text-xs text-slate-500">Compra sugerida = máximo − atual</span>
          </label>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Quantidade ideal</span>
            <NumberInput value={form.ideal_stock} onChange={(v) => set({ ideal_stock: v })} min={0} suffix={unit ?? undefined} placeholder="0" disabled={!canEditCompany} />
            <span className="mt-1 block text-xs text-slate-500">Usada se não houver máximo</span>
          </label>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Ajustes por unidade</h2>
        <p className="mb-3 text-sm text-slate-400">Cada loja pode ter níveis e local padrão diferentes. Campo em branco = usa o padrão acima. Os ajustes são gravados junto com o botão “Salvar”.</p>
        {stores.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma unidade acessível.</p>
        ) : (
          <div className="space-y-3">
            {stores.map((s) => {
              const d = drafts[s.id] ?? emptyStoreDraft();
              const editable = canEditStore(s.id);
              const hasOverride = d.min_stock !== null || d.max_stock !== null || d.reorder_point !== null || d.ideal_stock !== null || Boolean(d.default_location_id) || !d.active;
              return (
                <div key={s.id} className={`rounded-xl border p-3 ${hasOverride ? "border-[var(--accent)]/40 bg-[var(--accent)]/5" : "border-[var(--line)] bg-white/5"}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">{s.name} {s.code && <span className="ml-1 text-xs font-normal text-slate-500">{s.code}</span>}</p>
                    {!editable && <span className="text-xs text-slate-500">somente leitura</span>}
                    {hasOverride && editable && (
                      <button type="button" className="text-xs font-semibold text-[var(--accent)]" onClick={() => setDraft(s.id, emptyStoreDraft())}>Usar o padrão</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-400">Mínimo</span>
                      <NumberInput value={d.min_stock} onChange={(v) => setDraft(s.id, { min_stock: v })} min={0} placeholder={fmtQty(form.min_stock ?? 0)} disabled={!editable} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-400">Reposição</span>
                      <NumberInput value={d.reorder_point} onChange={(v) => setDraft(s.id, { reorder_point: v })} min={0} placeholder={fmtQty(form.reorder_point ?? 0)} disabled={!editable} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-400">Máximo</span>
                      <NumberInput value={d.max_stock} onChange={(v) => setDraft(s.id, { max_stock: v })} min={0} placeholder={fmtQty(form.max_stock ?? 0)} disabled={!editable} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-400">Ideal</span>
                      <NumberInput value={d.ideal_stock} onChange={(v) => setDraft(s.id, { ideal_stock: v })} min={0} placeholder={fmtQty(form.ideal_stock ?? 0)} disabled={!editable} />
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-400">Local padrão nesta unidade</span>
                      {editable ? (
                        <LocationSelect value={d.default_location_id} onChange={(v) => setDraft(s.id, { default_location_id: v })} storeId={s.id} placeholder="Sem local padrão" allowEmpty />
                      ) : (
                        <span className="field block">{d.default_location_id ? "definido" : "—"}</span>
                      )}
                    </label>
                    <div className="-mb-3">
                      <Toggle checked={d.active} onChange={(v) => setDraft(s.id, { active: v })} label="Produto ativo nesta unidade" hint="Desligado: some do estoque e da reposição desta loja." disabled={!editable} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
