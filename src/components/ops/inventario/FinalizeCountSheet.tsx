"use client";

import { useEffect, useState } from "react";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { finalizeCount, type CountRow, type FinalizeResult } from "@/lib/ops/modules/inventario";
import { Button, Field, InlineAlert, Sheet, TextArea, Toggle, useToast } from "@/components/ops/ui";
import { DiffValue } from "./shared";

/**
 * Confirmação antes de finalizar a contagem: explica que gera ajustes de
 * estoque; na contagem completa, permite zerar os itens não contados.
 * Depois mostra o resumo (ajustes gerados e valor).
 */
export function FinalizeCountSheet({
  open, onClose, count, uncounted, onFinalized,
}: { open: boolean; onClose: () => void; count: CountRow; uncounted: number; onFinalized: (r: FinalizeResult) => void }) {
  const notify = useToast();
  const invalidate = useInvalidate();
  const [zero, setZero] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FinalizeResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setZero(false);
    setNotes("");
    setResult(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      const r = await finalizeCount(count.id, count.kind === "completa" && zero, notes.trim());
      invalidate("inventory_counts", "inventory_items", "stock_items", "stock_lots", "stock_movements", "dashboard", "alerts");
      setResult(r);
      notify("Contagem finalizada");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Sheet
        open={open}
        onClose={() => { onFinalized(result); onClose(); }}
        title="Contagem finalizada"
        footer={<Button variant="primary" size="lg" full onClick={() => { onFinalized(result); onClose(); }}>Ver relatório</Button>}
      >
        <div className="mb-3 text-center text-4xl">✅</div>
        <p className="mb-4 text-center text-slate-300">O estoque foi ajustado conforme o que foi contado.</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="card p-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Ajustes gerados</p>
            <p className="text-2xl font-extrabold tabular-nums">{result.adjustments}</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Valor da diferença</p>
            <p className="text-2xl font-extrabold"><DiffValue diff={Number(result.difference_value)} money className="!text-2xl" /></p>

          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Finalizar contagem"
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Voltar</Button>
          <Button variant="success" size="lg" full disabled={busy} onClick={() => void submit()}>{busy ? "Finalizando…" : "Finalizar e ajustar estoque"}</Button>
        </div>
      }
    >
      <InlineAlert tone="amber">
        Ao finalizar, o sistema gera um <strong>ajuste de estoque</strong> para cada item com diferença: o saldo passa a ser o que foi contado.
        Isso fica registrado nas movimentações e não pode ser desfeito (uma correção exige nova contagem ou ajuste).
      </InlineAlert>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="card p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Itens</p>
          <p className="text-lg font-extrabold tabular-nums">{count.items_count}</p>
        </div>
        <div className="card p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Diferenças</p>
          <p className="text-lg font-extrabold tabular-nums">{count.differences}</p>
        </div>
        <div className="card p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Não contados</p>
          <p className={`text-lg font-extrabold tabular-nums ${uncounted > 0 ? "text-amber-300" : ""}`}>{uncounted}</p>
        </div>
      </div>
      {count.kind === "completa" ? (
        <Toggle
          checked={zero}
          onChange={setZero}
          label="Itens não contados viram zero"
          hint={uncounted > 0 ? `${uncounted} item(ns) carregado(s) e não contado(s) terão o saldo zerado. Desligado: eles ficam como estão.` : "Todos os itens foram contados."}
          disabled={uncounted === 0}
        />
      ) : (
        <p className="mb-4 text-sm text-slate-400">Contagem rápida: só os itens contados são ajustados. O restante do estoque não muda.</p>
      )}
      <Field label="Observação (opcional)">
        <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: conferido com o gerente" />
      </Field>
    </Sheet>
  );
}
