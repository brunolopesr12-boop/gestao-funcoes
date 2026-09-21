"use client";

import { useEffect, useMemo, useState } from "react";
import { CHECKLIST_ICONS, isChecklistComplete } from "@/lib/kds/alerts";
import type { KdsCard } from "@/lib/kds/store";
import { useKds } from "@/lib/kds/store";
import { ActionButton } from "./OrderCard";

/**
 * Conferência antes do despacho.
 *
 * Não é um sistema: é uma lista para o funcionário bater o olho e confirmar.
 * Itens que não existem no pedido aparecem como "não se aplica" e já vêm
 * marcados — menos clique, mesma checagem.
 */
export function ConferenceSheet({
  card,
  open,
  onClose,
}: {
  card: KdsCard;
  open: boolean;
  onClose: () => void;
}) {
  const { act, busy } = useKds();
  const naoSeAplica = useMemo(
    () => card.checklist.filter((i) => !i.required).map((i) => i.key),
    [card.checklist],
  );
  const [marcados, setMarcados] = useState<string[]>(naoSeAplica);

  useEffect(() => {
    if (open) setMarcados(naoSeAplica);
  }, [open, naoSeAplica]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const completo = isChecklistComplete(card.checklist, marcados);
  const carregando = busy === card.row.id;

  const alternar = (key: string) =>
    setMarcados((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const confirmar = async (forcar: boolean) => {
    const ok = await act(card.row.id, "conferir", {
      conferencia: marcados,
      forcar,
    });
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fade-in absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="sheet-up relative flex max-h-[94dvh] w-full flex-col rounded-t-3xl border-2 border-[var(--line)] bg-[#0f172a] sm:max-w-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <h3 className="text-2xl font-black">
            Conferir pedido #{card.order.displayId}
          </h3>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-xl text-slate-300"
          >
            ✕
          </button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {card.checklist.map((item) => {
            const marcado = marcados.includes(item.key);
            const icone = CHECKLIST_ICONS[item.key].icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => alternar(item.key)}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition ${
                  marcado
                    ? "border-emerald-500 bg-emerald-600/20"
                    : item.required
                      ? "border-rose-500/70 bg-rose-600/10"
                      : "border-[var(--line)] bg-white/5"
                }`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-2xl ${
                    marcado ? "bg-emerald-500 text-slate-950" : "bg-white/10"
                  }`}
                >
                  {marcado ? "✓" : icone}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-2xl font-extrabold leading-tight">
                    {item.label}
                  </span>
                  <span className="block truncate text-base text-slate-400">
                    {item.required
                      ? item.detail || "Confira antes de despachar"
                      : item.detail || "não se aplica a este pedido"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="safe-bottom space-y-2 border-t border-[var(--line)] px-4 pt-4">
          <ActionButton
            tone="green"
            disabled={!completo || carregando}
            onClick={() => void confirmar(false)}
          >
            ✅ PEDIDO CONFERIDO
          </ActionButton>
          {!completo && (
            <button
              disabled={carregando}
              onClick={() => void confirmar(true)}
              className="w-full rounded-xl px-4 py-2 text-base font-bold text-amber-300 underline underline-offset-4 disabled:opacity-40"
            >
              Marcar como conferido mesmo assim
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
