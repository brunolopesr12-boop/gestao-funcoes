"use client";

import { useEffect, useState } from "react";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/ops/format";
import type { ProductionPlan, StockBalance } from "@/lib/ops/types";
import { effectiveQuantity, effectiveShortages, estimatedCost, type ChosenLot, type PlanItem, type PlanOverride, type PlanOverrides } from "@/lib/ops/modules/producao";
import { LotPicker } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { Badge, Button, InlineAlert, NumberInput, Sheet } from "@/components/ops/ui";

/* ------------------------------------------------------------------ */
/* Ajuste de um ingrediente: quantidade a consumir e lote              */
/* ------------------------------------------------------------------ */
function AdjustSheet({ open, onClose, item, value, storeId, onApply }: { open: boolean; onClose: () => void; item: PlanItem; value: PlanOverride | undefined; storeId: string; onApply: (v: PlanOverride) => void }) {
  const [qty, setQty] = useState<number | null>(effectiveQuantity(item, value));
  const [lot, setLot] = useState<ChosenLot | null>(value?.lot ?? null);

  useEffect(() => {
    if (!open) return;
    setQty(effectiveQuantity(item, value));
    setLot(value?.lot ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = qty ?? 0;
  const over = lot ? q > Number(lot.available) + 1e-6 : q > Number(item.available) + 1e-6;

  function pick(b: StockBalance | null) {
    if (!b) return setLot(null);
    setLot({ balanceId: b.id, lot_id: b.lot_id, location_id: b.location_id, lot_code: b.lot_code, location_name: b.location_name, available: Number(b.quantity), expires_at: b.expires_at });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item.name}
      footer={
        <div className="flex gap-3 pb-3">
          <Button variant="soft" size="lg" full onClick={onClose}>Voltar</Button>
          <Button variant="primary" size="lg" full onClick={() => { onApply({ quantity: qty ?? 0, lot }); onClose(); }}>Aplicar</Button>
        </div>
      }
    >
      <p className="mb-1.5 text-sm font-semibold text-slate-300">Quantidade a consumir</p>
      <NumberInput big value={qty} onChange={setQty} min={0} suffix={item.stock_unit} placeholder="0" />
      <p className="mt-1 mb-4 text-xs text-slate-500">
        A ficha pede {fmtQty(item.needed, item.stock_unit)}. Informe 0 para não consumir este ingrediente.
      </p>
      {over && <InlineAlert tone="red">Falta estoque: {lot ? `o lote ${lot.lot_code} tem ${fmtQty(lot.available, item.stock_unit)}` : `disponível ${fmtQty(item.available, item.stock_unit)}`}.</InlineAlert>}
      <LotPicker productId={item.product_id} storeId={storeId} value={lot?.balanceId ?? null} onChange={pick} allowNone />
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Tabela do plano                                                     */
/* ------------------------------------------------------------------ */
export function ProductionPlanTable({
  plan, overrides, onChange, editable, storeId,
}: { plan: ProductionPlan; overrides: PlanOverrides; onChange: (o: PlanOverrides) => void; editable: boolean; storeId: string }) {
  const [adjusting, setAdjusting] = useState<PlanItem | null>(null);
  const shortages = effectiveShortages(plan, overrides);
  const cost = estimatedCost(plan, overrides);
  const planned = Number(plan.planned);

  if (plan.items.length === 0) {
    return <InlineAlert tone="amber">Esta ficha não tem ingredientes cadastrados. A produção criará o lote sem baixar estoque e sem custo.</InlineAlert>;
  }

  return (
    <div>
      {shortages.length > 0 ? (
        <InlineAlert tone="red">
          <strong>Falta estoque</strong> para {shortages.length === 1 ? "1 ingrediente" : `${shortages.length} ingredientes`}: {shortages.map((s) => `${s.name} (${fmtQty(s.missing, s.unit)})`).join(", ")}.
          {editable ? " Ajuste a quantidade, troque o lote ou registre a entrada antes de produzir." : ""}
        </InlineAlert>
      ) : (
        <InlineAlert tone="green" icon="check">Estoque suficiente para todos os ingredientes.</InlineAlert>
      )}

      <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
        {plan.items.map((it) => {
          const ov = overrides[it.product_id];
          const qty = effectiveQuantity(it, ov);
          const changed = ov && ov.quantity !== undefined && ov.quantity !== null && Math.abs(Number(ov.quantity) - Number(it.needed)) > 1e-9;
          const available = ov?.lot ? Number(ov.lot.available) : Number(it.available);
          const missing = Math.max(0, qty - available);
          return (
            <li key={it.product_id} className="px-3 py-3 sm:px-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span className="truncate">{it.name}</span>
                    {qty <= 0 && <Badge tone="slate">não consumir</Badge>}
                    {missing > 1e-6 && <Badge tone="red">falta {fmtQty(missing, it.stock_unit)}</Badge>}
                    {ov?.lot && <Badge tone="violet">lote escolhido</Badge>}
                  </p>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-xs sm:max-w-md">
                    <div>
                      <p className="text-slate-500">Necessário</p>
                      <p className={`font-bold tabular-nums ${changed ? "text-amber-300" : "text-slate-100"}`}>{fmtQty(qty, it.stock_unit)}</p>
                      {changed && <p className="text-[11px] text-slate-500">ficha: {fmtQty(it.needed, it.stock_unit)}</p>}
                    </div>
                    <div>
                      <p className="text-slate-500">Disponível</p>
                      <p className="font-bold tabular-nums text-slate-100">{fmtQty(available, it.stock_unit)}</p>
                      {ov?.lot && <p className="text-[11px] text-slate-500">no lote</p>}
                    </div>
                    <div>
                      <p className="text-slate-500">Custo est.</p>
                      <p className="font-bold tabular-nums text-slate-100">{fmtMoney(qty * Number(it.unit_cost ?? 0))}</p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ov?.lot ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200">
                        <span className="font-mono font-semibold">{ov.lot.lot_code}</span> · {ov.lot.location_name} · vence {fmtDate(ov.lot.expires_at)}
                      </span>
                    ) : it.lots.length === 0 ? (
                      <span className="text-[11px] text-slate-500">Sem lote com saldo</span>
                    ) : (
                      it.lots.map((l) => (
                        <span key={`${l.lot_id}-${l.location_id}`} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white/5 px-2 py-0.5 text-[11px] text-slate-300" title="Sugerido pelo FEFO (vence primeiro, sai primeiro)">
                          <Icon name="sparkles" size={12} className="text-[var(--accent)]" />
                          <span className="font-mono font-semibold">{l.lot_code}</span> · {fmtQty(l.quantity, it.stock_unit)} · vence {fmtDate(l.expires_at)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                {editable && (
                  <Button size="sm" variant="soft" onClick={() => setAdjusting(it)} className="shrink-0">
                    <Icon name="edit" size={14} /> Ajustar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-400">Custo estimado dos ingredientes</span>
        <span className="font-bold tabular-nums">
          {fmtMoney(cost)}
          {planned > 0 && <span className="font-normal text-slate-400"> · {fmtMoney(cost / planned)}/{plan.unit}</span>}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">Os lotes listados são a sugestão FEFO (vence primeiro, sai primeiro); toque em Ajustar para trocar o lote ou a quantidade. O custo final usa o custo de cada lote consumido.</p>

      {adjusting && (
        <AdjustSheet
          open
          onClose={() => setAdjusting(null)}
          item={adjusting}
          value={overrides[adjusting.product_id]}
          storeId={storeId}
          onApply={(v) => onChange({ ...overrides, [adjusting.product_id]: v })}
        />
      )}
    </div>
  );
}
