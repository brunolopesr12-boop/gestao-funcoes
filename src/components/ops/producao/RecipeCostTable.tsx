"use client";

import { fmtMoney, fmtPct, fmtQty } from "@/lib/ops/format";
import type { RecipeCost } from "@/lib/ops/types";
import { KpiCard } from "@/components/ops/ui";

/**
 * Custo e rendimento da ficha, calculados pelo banco (ops_recipe_cost).
 * Tabela por ingrediente + totais.
 */
export function RecipeCostTable({ cost }: { cost: RecipeCost }) {
  const unit = cost.yield_unit || "un";
  const items = cost.items ?? [];
  return (
    <div>
      <p className="mb-3 text-xs text-slate-400">
        <strong className="text-slate-300">Fator de correção</strong> = peso bruto ÷ peso líquido: quanto você precisa comprar para cada 1 unidade aproveitada
        (ex.: 1,25 significa 25% de perda na limpeza). O custo usa o custo atual de cada produto.
      </p>

      {/* celular: cartões */}
      <ul className="divide-y divide-[var(--line)] md:hidden">
        {items.map((it) => (
          <li key={it.id} className="py-2.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 font-semibold">{it.name}</p>
              <p className="shrink-0 font-bold tabular-nums">{fmtMoney(it.total_cost)}</p>
            </div>
            <p className="text-xs text-slate-400 tabular-nums">
              Bruto {fmtQty(it.gross_quantity, it.unit)}
              {it.net_quantity !== null && it.net_quantity !== undefined ? ` · líquido ${fmtQty(it.net_quantity, it.unit)} · perda ${fmtPct(it.loss_pct)} · fator ${fmtQty(it.correction_factor, null, 2)}` : ""}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              = {fmtQty(it.quantity_stock, it.stock_unit)} × {fmtMoney(it.unit_cost)}/{it.stock_unit}
            </p>
          </li>
        ))}
      </ul>

      {/* desktop: tabela */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-2 py-2 font-bold">Ingrediente</th>
              <th className="px-2 py-2 text-right font-bold">Bruto</th>
              <th className="px-2 py-2 text-right font-bold">Líquido</th>
              <th className="px-2 py-2 text-right font-bold">Perda</th>
              <th className="px-2 py-2 text-right font-bold">Fator corr.</th>
              <th className="px-2 py-2 text-right font-bold">Qtd. estoque</th>
              <th className="px-2 py-2 text-right font-bold">Custo unit.</th>
              <th className="px-2 py-2 text-right font-bold">Custo total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {items.map((it) => (
              <tr key={it.id}>
                <td className="px-2 py-2 font-semibold">{it.name}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtQty(it.gross_quantity, it.unit)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{it.net_quantity !== null && it.net_quantity !== undefined ? fmtQty(it.net_quantity, it.unit) : <span className="text-slate-500">—</span>}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtPct(it.loss_pct)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtQty(it.correction_factor, null, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtQty(it.quantity_stock, it.stock_unit)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(it.unit_cost)}/{it.stock_unit}</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{fmtMoney(it.total_cost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--line)] font-bold">
              <td className="px-2 py-2" colSpan={7}>Custo total da ficha</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(cost.total_cost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Custo total" value={fmtMoney(cost.total_cost)} hint={`rendimento ${fmtQty(cost.yield_quantity, unit)}`} tone="slate" />
        <KpiCard label={`Custo por ${unit}`} value={cost.cost_per_unit !== null && cost.cost_per_unit !== undefined ? fmtMoney(cost.cost_per_unit) : "—"} tone="blue" />
        <KpiCard
          label="Custo por porção"
          value={cost.cost_per_portion !== null && cost.cost_per_portion !== undefined ? fmtMoney(cost.cost_per_portion) : "—"}
          hint={cost.portions ? `${fmtQty(cost.portions)} porções de ${fmtQty(cost.portion_quantity, unit)}` : "informe o tamanho da porção"}
          tone="violet"
        />
        <KpiCard
          label="Fator de rendimento"
          value={cost.yield_factor !== null && cost.yield_factor !== undefined ? fmtQty(cost.yield_factor, null, 2) : "—"}
          hint={cost.loss_pct !== null && cost.loss_pct !== undefined ? `perda no preparo ${fmtPct(cost.loss_pct)}` : "unidades de tipos diferentes"}
          tone={cost.loss_pct !== null && cost.loss_pct !== undefined && cost.loss_pct > 30 ? "amber" : "green"}
        />
        <KpiCard label="Total bruto" value={cost.gross_total !== null && cost.gross_total !== undefined ? fmtQty(cost.gross_total, unit) : "—"} hint="soma dos pesos brutos" tone="slate" />
        <KpiCard label="Total líquido" value={cost.net_total !== null && cost.net_total !== undefined ? fmtQty(cost.net_total, unit) : "—"} hint="soma dos pesos líquidos" tone="slate" />
        <KpiCard label="Rendimento" value={fmtQty(cost.yield_quantity, unit)} hint="quanto a ficha rende" tone="slate" />
        <KpiCard label="Perda no preparo" value={cost.loss_pct !== null && cost.loss_pct !== undefined ? fmtPct(cost.loss_pct) : "—"} hint="1 − rendimento ÷ total bruto" tone="slate" />
      </div>
      {(cost.gross_total === null || cost.gross_total === undefined) && (
        <p className="mt-2 text-xs text-slate-500">Total bruto, líquido e fator de rendimento só são calculados quando todos os ingredientes usam unidades do mesmo tipo do rendimento (ex.: tudo em massa).</p>
      )}
    </div>
  );
}
