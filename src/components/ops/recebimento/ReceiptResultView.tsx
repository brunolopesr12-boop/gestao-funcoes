"use client";

import Link from "next/link";
import { fmtQty } from "@/lib/ops/format";
import type { ReceiptDetail, ReceiptItemRow, ReceiveResult } from "@/lib/ops/modules/recebimento";
import { RECEIPT_RESULT_LABEL, REJECTION_LABEL } from "@/lib/ops/types";
import { Icon } from "@/components/ops/Icon";
import { Badge, Button, SectionCard, toneFor } from "@/components/ops/ui";

/** Tela mostrada logo após finalizar o recebimento. */
export function ReceiptResultView({ receipt, result, items, onViewReceipt }: { receipt: ReceiptDetail; result: ReceiveResult; items: ReceiptItemRow[]; onViewReceipt: () => void }) {
  const byItem = new Map(items.map((i) => [i.id, i]));
  const rejected = items.filter((i) => i.result === "recusado");
  const lotIds = result.lots.map((l) => l.lot_id);
  const printHref = `/etiquetas/imprimir?lots=${encodeURIComponent(lotIds.join(","))}&kind=recebimento`;
  const tone = toneFor(result.result === "aprovado" ? "aprovado" : result.result === "recusado" ? "recusado" : "ressalva");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card mb-4 p-5 text-center">
        <div className="mb-2 text-5xl">{result.result === "recusado" ? "⛔" : result.result === "aprovado_ressalva" ? "⚠️" : "✅"}</div>
        <h1 className="text-xl font-extrabold">Recebimento {receipt.number} finalizado</h1>
        <div className="mt-2"><Badge tone={tone} className="!text-sm">{RECEIPT_RESULT_LABEL[result.result]}</Badge></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2 py-2">
            <p className="text-2xl font-extrabold tabular-nums text-emerald-300">{result.approved}</p>
            <p className="text-[11px] font-semibold uppercase text-emerald-200/80">aprovados</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-2">
            <p className="text-2xl font-extrabold tabular-nums text-amber-300">{result.with_issues}</p>
            <p className="text-[11px] font-semibold uppercase text-amber-200/80">com ressalva</p>
          </div>
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2 py-2">
            <p className="text-2xl font-extrabold tabular-nums text-rose-300">{result.rejected}</p>
            <p className="text-[11px] font-semibold uppercase text-rose-200/80">recusados</p>
          </div>
        </div>
      </div>

      {result.lots.length > 0 && (
        <SectionCard title={`Lotes criados (${result.lots.length})`} className="mb-4">
          <ul className="divide-y divide-[var(--line)]">
            {result.lots.map((l) => {
              const it = byItem.get(l.item_id);
              return (
                <li key={l.lot_id}>
                  <Link href={`/lote/${l.lot_id}`} className="flex items-center gap-3 py-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300"><Icon name="package" size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{it?.products?.name ?? "Produto"}</span>
                      <span className="block text-xs text-slate-400">Lote <span className="font-mono">{l.lot_code}</span> · {fmtQty(l.quantity, it?.products?.units?.code)} · {it?.stock_locations?.name ?? ""}</span>
                    </span>
                    <Icon name="chevronRight" className="text-slate-600" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link href={printHref} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3.5 text-base font-semibold text-white">
            <Icon name="printer" /> Imprimir etiquetas dos lotes
          </Link>
        </SectionCard>
      )}

      {rejected.length > 0 && (
        <SectionCard title={`Itens recusados (${rejected.length})`} className="mb-4">
          <ul className="divide-y divide-[var(--line)]">
            {rejected.map((i) => (
              <li key={i.id} className="py-2.5">
                <p className="font-semibold">{i.products?.name ?? "Produto"} <span className="text-slate-400">· {fmtQty(i.quantity, i.units?.code)}</span></p>
                <p className="text-sm text-rose-300">Motivo: {REJECTION_LABEL[i.rejection_reason] ?? i.rejection_reason}</p>
                {i.notes && <p className="text-xs text-slate-400">{i.notes}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Os itens recusados não entraram no estoque. Um alerta foi registrado para acompanhamento com o fornecedor.</p>
        </SectionCard>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/recebimento/novo" className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/5 px-5 py-3.5 text-base font-semibold text-slate-100">
          <Icon name="plus" /> Novo recebimento
        </Link>
        <Button variant="soft" size="lg" full onClick={onViewReceipt}>Ver este recebimento</Button>
        <Link href="/recebimento" className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-base font-semibold text-slate-300">
          Voltar à lista
        </Link>
      </div>
    </div>
  );
}
