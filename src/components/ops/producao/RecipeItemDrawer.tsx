"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useInvalidate } from "@/lib/ops/query";
import { fmtPct, fmtQty } from "@/lib/ops/format";
import type { Product } from "@/lib/ops/types";
import { useIngredientUnitOptions, type RecipeItemRow } from "@/lib/ops/modules/producao";
import { ProductPicker } from "@/components/ops/pickers";
import { Button, Drawer, Field, NumberInput, TextArea, useToast } from "@/components/ops/ui";
import { FieldBlock } from "./shared";

/** Converte o produto parcial da ficha no formato que o ProductPicker exibe. */
function asPickerProduct(p: RecipeItemRow["products"]): Product | null {
  if (!p) return null;
  return p as unknown as Product;
}

/**
 * Adicionar/editar um ingrediente da ficha (recipe_items).
 * Peso bruto na unidade escolhida; peso líquido opcional (mesma unidade).
 */
export function RecipeItemDrawer({
  open, onClose, recipeId, item, nextPosition, onSaved,
}: { open: boolean; onClose: () => void; recipeId: string; item: RecipeItemRow | null; nextPosition: number; onSaved: () => void }) {
  const notify = useToast();
  const invalidate = useInvalidate();
  const [product, setProduct] = useState<Product | null>(null);
  const [gross, setGross] = useState<number | null>(null);
  const [net, setNet] = useState<number | null>(null);
  const [unitId, setUnitId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { options, stockUnit } = useIngredientUnitOptions(product);

  // carrega o item ao abrir
  useEffect(() => {
    if (!open) return;
    setProduct(asPickerProduct(item?.products ?? null));
    setGross(item ? Number(item.gross_quantity) : null);
    setNet(item && item.net_quantity !== null && item.net_quantity !== undefined ? Number(item.net_quantity) : null);
    setUnitId(item?.unit_id ?? item?.products?.stock_unit_id ?? "");
    setNotes(item?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  // unidade padrão = unidade de estoque do ingrediente
  useEffect(() => {
    if (!product) return;
    if (!unitId || !options.some((o) => o.id === unitId)) {
      if (stockUnit) setUnitId(stockUnit.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, stockUnit?.id, options.length]);

  const chosen = options.find((o) => o.id === unitId);
  const unitCode = chosen?.code ?? stockUnit?.code ?? "";
  const lossPct = gross && gross > 0 && net !== null && net !== undefined ? ((gross - net) / gross) * 100 : null;
  const factor = net && net > 0 && gross ? gross / net : null;
  const inStock = gross !== null && chosen ? gross * chosen.factor : null;

  async function save() {
    if (!product) return notify("Escolha o ingrediente.", "erro");
    if (!gross || gross <= 0) return notify("Informe o peso bruto.", "erro");
    if (net !== null && net !== undefined && net <= 0) return notify("O peso líquido precisa ser maior que zero (ou deixe em branco).", "erro");
    if (net !== null && net !== undefined && gross && net > gross + 1e-9) return notify("O peso líquido não pode ser maior que o bruto.", "erro");
    setBusy(true);
    try {
      const payload = {
        recipe_id: recipeId,
        ingredient_product_id: product.id,
        gross_quantity: gross,
        unit_id: unitId || product.stock_unit_id || null,
        net_quantity: net ?? null,
        notes: notes.trim(),
      };
      const sb = supabaseBrowser();
      if (item) {
        const res = await sb.from("recipe_items").update(payload).eq("id", item.id);
        if (res.error) throw toOpsError(res.error);
        notify("Ingrediente atualizado");
      } else {
        const res = await sb.from("recipe_items").insert({ ...payload, position: nextPosition });
        if (res.error) throw toOpsError(res.error);
        notify("Ingrediente adicionado");
      }
      invalidate("recipe_items", "recipe_cost", "production_plan");
      onSaved();
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={item ? "Editar ingrediente" : "Adicionar ingrediente"}
      footer={
        <div className="flex gap-3 pb-3">
          <Button variant="soft" size="lg" full onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy || !product}>{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      }
    >
      <FieldBlock label="Ingrediente" required>
        <ProductPicker value={product} onChange={(p) => { setProduct(p); setUnitId(""); }} autoFocus={!item} disabled={Boolean(item)} placeholder="Buscar produto (nome ou código)" />
      </FieldBlock>

      {product && (
        <>
          <FieldBlock label="Peso bruto" required hint="Quantidade como você compra/pesa antes de limpar. Aceita vírgula.">
            <div className="flex gap-2">
              <NumberInput big value={gross} onChange={setGross} placeholder="0" min={0} className="min-w-0 flex-1" suffix={options.length <= 1 ? unitCode : undefined} />
              {options.length > 1 && (
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="field h-14 w-32 shrink-0 font-semibold" aria-label="Unidade de medida">
                  {options.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
                </select>
              )}
            </div>
            {chosen && chosen.factor !== 1 && inStock !== null && stockUnit && (
              <p className="mt-1 text-xs text-slate-400">= {fmtQty(inStock, stockUnit.code)} na unidade de estoque</p>
            )}
          </FieldBlock>

          <FieldBlock label="Peso líquido (opcional)" hint={`Quanto sobra depois de limpar/descascar, em ${unitCode || "mesma unidade"}. Deixe em branco se não houver perda.`}>
            <NumberInput value={net} onChange={setNet} placeholder="Sem perda" min={0} suffix={unitCode} />
          </FieldBlock>

          {lossPct !== null && factor !== null && (
            <div className="mb-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Perda</p>
                <p className={`text-lg font-extrabold tabular-nums ${lossPct > 30 ? "text-amber-300" : "text-slate-100"}`}>{fmtPct(lossPct)}</p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Fator de correção</p>
                <p className="text-lg font-extrabold tabular-nums text-slate-100">{fmtQty(factor, null, 2)}</p>
              </div>
            </div>
          )}

          <Field label="Observação" hint="Ex.: cortado em cubos, sem pele…">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </>
      )}
    </Drawer>
  );
}
