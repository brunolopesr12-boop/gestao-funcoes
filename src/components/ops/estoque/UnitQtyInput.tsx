"use client";

import { useEffect } from "react";
import { fmtQty } from "@/lib/ops/format";
import type { Product } from "@/lib/ops/types";
import { useProductUnitOptions } from "@/lib/ops/modules/estoque";
import { NumberInput } from "@/components/ops/ui";

/**
 * Quantidade + unidade de medida de um produto.
 * Oferece só as unidades que o banco sabe converter (ops_convert_qty) e mostra
 * a equivalência na unidade de estoque quando o funcionário escolhe outra.
 */
export function UnitQtyInput({
  product, quantity, onQuantity, unitId, onUnitId, label = "Quantidade", autoFocus, hint, max,
}: {
  product: Pick<Product, "id" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor"> | null | undefined;
  quantity: number | null;
  onQuantity: (v: number | null) => void;
  unitId: string;
  onUnitId: (id: string) => void;
  label?: string;
  autoFocus?: boolean;
  hint?: string;
  /** saldo disponível na unidade de estoque (mostra aviso ao passar) */
  max?: number | null;
}) {
  const { options, stockUnit } = useProductUnitOptions(product);

  // unidade padrão = unidade de estoque
  useEffect(() => {
    if (!unitId && stockUnit) onUnitId(stockUnit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockUnit?.id]);

  const chosen = options.find((o) => o.id === unitId) ?? (stockUnit ? { id: stockUnit.id, code: stockUnit.code, label: stockUnit.code, factor: 1 } : null);
  const inStock = quantity !== null && chosen?.factor ? quantity * chosen.factor : quantity;
  const over = max !== null && max !== undefined && inStock !== null && inStock > max + 1e-9;

  return (
    <div className="mb-4">
      <span className="mb-1.5 block text-sm font-semibold text-slate-300">{label}</span>
      <div className="flex gap-2">
        <NumberInput big value={quantity} onChange={onQuantity} placeholder="0" min={0} autoFocus={autoFocus} className="min-w-0 flex-1" suffix={options.length <= 1 ? chosen?.code : undefined} />
        {options.length > 1 && (
          <select value={unitId} onChange={(e) => onUnitId(e.target.value)} className="field h-14 w-32 shrink-0 font-semibold" aria-label="Unidade de medida">
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.code}</option>
            ))}
          </select>
        )}
      </div>
      {chosen && chosen.factor !== 1 && chosen.factor !== null && quantity !== null && stockUnit && (
        <p className="mt-1 text-xs text-slate-400">= {fmtQty(inStock, stockUnit.code)} na unidade de estoque</p>
      )}
      {over && stockUnit && <p className="mt-1 text-xs font-semibold text-amber-300">Atenção: o saldo disponível é {fmtQty(max, stockUnit.code)}.</p>}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
