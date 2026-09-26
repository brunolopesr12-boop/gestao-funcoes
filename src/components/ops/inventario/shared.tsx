"use client";

import { fmtDate, fmtMoney, fmtQty, EXPIRY_META } from "@/lib/ops/format";
import { COUNT_STATUS_LABEL, type InventoryCountStatus, type StockBalance } from "@/lib/ops/types";
import { COUNT_KIND_LABEL, DIFF_TEXT, diffTone, signed, type CountKind } from "@/lib/ops/modules/inventario";
import { Badge, toneFor } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/** Diferença com sinal e cor (sobra verde, falta vermelha). `money` formata em R$. */
export function DiffValue({ diff, unit, money, className = "" }: { diff: number | null | undefined; unit?: string | null; money?: boolean; className?: string }) {
  const tone = diffTone(diff);
  const fmt = (v: number) => (money ? fmtMoney(v) : fmtQty(v, unit));
  return <span className={`font-bold tabular-nums ${DIFF_TEXT[tone]} ${className}`}>{diff === null || diff === undefined ? "—" : signed(Number(diff), fmt)}</span>;
}

export function CountKindBadge({ kind }: { kind: CountKind }) {
  return <Badge tone={kind === "completa" ? "violet" : "cyan"}>{COUNT_KIND_LABEL[kind]}</Badge>;
}

export function CountStatusBadge({ status }: { status: InventoryCountStatus }) {
  return <Badge tone={toneFor(status)}>{COUNT_STATUS_LABEL[status]}</Badge>;
}

/**
 * Lotes do produto no local, com o saldo do sistema em cada um.
 * `value === null` = contar o total do local (o banco distribui a diferença
 * entre os lotes ao finalizar). Quando há um só lote, ele é usado direto.
 */
export function CountLotPicker({
  balances, loading, value, onChange, disabled,
}: { balances: StockBalance[]; loading: boolean; value: string | null; onChange: (lotId: string | null) => void; disabled?: boolean }) {
  if (loading) return <p className="mb-4 text-sm text-slate-400">Carregando lotes…</p>;
  if (balances.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        O sistema não tem saldo deste produto neste local. Se você encontrou o produto aqui, conte mesmo assim: a contagem vai registrar a sobra.
      </div>
    );
  }
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-sm font-semibold text-slate-300">Lote</p>
      <div className="space-y-1.5">
        {balances.length > 1 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-60 ${value === null ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--line)] bg-white/5"}`}
          >
            <Icon name="layers" size={16} className="text-[var(--accent)]" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Todos os lotes juntos</span>
              <span className="block text-xs text-slate-400">Conte o total do produto neste local ({fmtQty(balances.reduce((s, b) => s + Number(b.quantity), 0), balances[0]?.unit)} no sistema)</span>
            </span>
          </button>
        )}
        {balances.map((l) => {
          const active = value === l.lot_id;
          const meta = EXPIRY_META[l.expiry_status];
          return (
            <button
              key={l.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(l.lot_id)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-60 ${active ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--line)] bg-white/5"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono font-semibold">{l.lot_code}</span>
                <span className="block text-xs text-slate-400">validade {fmtDate(l.expires_at)}{l.lot_status === "bloqueado" ? " · bloqueado" : ""}</span>
              </span>
              <span className="text-right">
                <span className="block font-bold tabular-nums">{fmtQty(l.quantity, l.unit)}</span>
                <span className={`rounded-full px-1.5 text-[10px] font-semibold ${meta.className}`}>{meta.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Resumo "sistema × contado × diferença" usado antes de confirmar. */
export function CountPreview({ theoretical, counted, unit }: { theoretical: number | null; counted: number | null; unit?: string | null }) {
  const diff = theoretical !== null && counted !== null ? counted - theoretical : null;
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-[var(--line)] bg-white/5 p-3 text-center">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Sistema</p>
        <p className="text-base font-bold tabular-nums text-slate-200">{theoretical === null ? "?" : fmtQty(theoretical, unit)}</p>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Contado</p>
        <p className="text-base font-bold tabular-nums text-white">{counted === null ? "—" : fmtQty(counted, unit)}</p>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Diferença</p>
        <p className="text-base"><DiffValue diff={diff} unit={unit} /></p>
      </div>
    </div>
  );
}
