"use client";

import { useState } from "react";
import { brl } from "@/lib/kds/money";
import type { KdsCard } from "@/lib/kds/store";
import { useKds } from "@/lib/kds/store";
import { STAGE_META } from "@/lib/kds/types";
import { AlertBlock } from "./AlertBlock";
import { ConferenceSheet } from "./ConferenceSheet";
import { Timer } from "./Timer";

const hora = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function fmtHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : hora.format(d);
}

const TIPO_LABEL: Record<string, string> = {
  DELIVERY: "Entrega",
  TAKEOUT: "Retirada",
  INDOOR: "Consumo no local",
};

export function OrderCard({ card, now }: { card: KdsCard; now: number }) {
  const { act, busy, settings } = useKds();
  const [conferindo, setConferindo] = useState(false);
  const { order, alerts, row } = card;
  const carregando = busy === row.id;
  const stage = order.stage;
  const meta = STAGE_META[stage];

  const temAlertaCritico = card.blocking.length > 0;
  const encerrado = stage === "despachado" || stage === "cancelado";
  // Pedido que já saiu não precisa mais dos alertas de produção ocupando a
  // tela — fica só o essencial para consulta.
  const alertasVisiveis = encerrado
    ? alerts.filter((a) => a.kind === "cancelado")
    : alerts;

  return (
    <article
      className={`kds-comanda flex flex-col gap-3 p-3 sm:p-4 ${
        stage === "novo" ? "kds-new" : ""
      } ${stage === "cancelado" ? "opacity-70 grayscale" : ""}`}
      style={stage !== "novo" ? { borderColor: `${meta.accent}66` } : undefined}
    >
      {/* ---------------- cabeçalho ---------------- */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="rounded-xl px-3 py-1.5 text-3xl font-black leading-none tabular-nums text-white sm:text-4xl"
          style={{ background: meta.accent }}
        >
          #{order.displayId}
        </span>
        <Timer
          placedAt={order.placedAt}
          lateMinutes={settings.lateMinutes}
          now={now}
          paused={stage === "despachado" || stage === "cancelado"}
        />
        <span className="text-lg font-bold text-slate-300 tabular-nums">
          {fmtHora(order.placedAt)}
        </span>
        <span className="ml-auto rounded-lg bg-white/10 px-2.5 py-1 text-sm font-bold uppercase tracking-wide text-slate-300">
          {TIPO_LABEL[order.orderType] ?? order.orderType}
        </span>
        {order.source === "teste" && (
          <span className="rounded-lg bg-fuchsia-600 px-2.5 py-1 text-sm font-black uppercase text-white">
            🧪 Teste
          </span>
        )}
      </header>

      <p className="text-2xl font-extrabold leading-tight text-white sm:text-3xl">
        {order.customerName || "Cliente"}
      </p>

      {/* ---------------- alertas ---------------- */}
      {alertasVisiveis.length > 0 && (
        <div className="space-y-2">
          {alertasVisiveis.map((a) => (
            <AlertBlock
              key={a.kind}
              alert={a}
              size={a.level === "info" ? "sm" : "md"}
            />
          ))}
        </div>
      )}

      {/* ---------------- itens ---------------- */}
      <ul className="space-y-2">
        {order.items.map((it) => (
          <li key={it.id} className="border-b border-white/10 pb-2 last:border-0">
            <p
              className={`flex items-start gap-2 text-2xl font-extrabold leading-tight sm:text-[28px] ${
                it.isDrink ? "text-cyan-200" : "text-white"
              }`}
            >
              <span className="min-w-[2.5rem] rounded-lg bg-white/15 px-2 text-center tabular-nums">
                {it.quantity}×
              </span>
              <span>
                {it.isDrink && <span aria-hidden>🥤 </span>}
                {it.name}
              </span>
            </p>
            {it.options.length > 0 && (
              <ul className="mt-1 pl-14">
                {it.options.map((o, i) => (
                  <li key={i} className="text-xl font-bold text-amber-300">
                    + {o.quantity}× {o.name}
                  </li>
                ))}
              </ul>
            )}
            {it.observations && (
              <p className="mt-1 pl-14 text-xl font-bold text-rose-300">
                ⚠️ {it.observations}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/* ---------------- entrega ---------------- */}
      {order.orderType === "DELIVERY" && order.delivery.address && (
        <p className="text-lg font-semibold leading-snug text-slate-300">
          📍 {order.delivery.address}
          {order.delivery.number ? `, ${order.delivery.number}` : ""}
          {order.delivery.neighborhood ? ` — ${order.delivery.neighborhood}` : ""}
        </p>
      )}

      {/* ---------------- pagamento ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white/5 px-3 py-2">
        <span className="text-2xl font-black text-white">{brl(order.total)}</span>
        <span className="text-lg font-bold text-slate-300">
          {order.payment.methods.map((m) => m.label).join(" + ") || "Pagamento não informado"}
        </span>
        {order.deliveryFee > 0 && (
          <span className="text-base text-slate-400">
            taxa {brl(order.deliveryFee)}
          </span>
        )}
      </div>

      {card.conferido && (
        <p className="rounded-xl bg-emerald-600/20 px-3 py-2 text-xl font-black text-emerald-200">
          ✅ PEDIDO CONFERIDO
          {row.checked_by ? ` · ${row.checked_by}` : ""}
          {row.forced ? " (forçado)" : ""}
        </p>
      )}

      {row.sync_error && (
        <p className="rounded-xl bg-amber-600/20 px-3 py-2 text-base font-bold text-amber-200">
          ⚠️ {row.sync_error}
        </p>
      )}

      {/* ---------------- ações ---------------- */}
      <footer className="mt-auto flex flex-wrap gap-2 pt-1">
        {stage === "novo" && (
          <>
            <ActionButton
              tone="blue"
              disabled={carregando}
              onClick={() => void act(row.id, "aceitar")}
            >
              ▶ ACEITAR
            </ActionButton>
            <ActionButton
              tone="slate"
              disabled={carregando}
              onClick={() => void act(row.id, "pronto")}
            >
              PRONTO
            </ActionButton>
          </>
        )}

        {stage === "producao" && (
          <ActionButton
            tone="violet"
            disabled={carregando}
            onClick={() => void act(row.id, "pronto")}
          >
            ✔ PEDIDO PRONTO
          </ActionButton>
        )}

        {stage === "pronto" && (
          <>
            <ActionButton
              tone={card.conferido ? "slate" : "amber"}
              disabled={carregando}
              onClick={() => setConferindo(true)}
            >
              🧾 CONFERIR PEDIDO
            </ActionButton>
            <ActionButton
              tone="green"
              disabled={carregando || (temAlertaCritico && !card.conferido)}
              onClick={() => void act(row.id, "despachar")}
            >
              🚀 DESPACHAR
            </ActionButton>
            <ActionButton
              tone="ghost"
              disabled={carregando}
              onClick={() => void act(row.id, "produzir")}
            >
              ↩ voltar
            </ActionButton>
          </>
        )}

        {(stage === "despachado" || stage === "cancelado") && (
          <ActionButton
            tone="ghost"
            disabled={carregando}
            onClick={() => void act(row.id, "ocultar")}
          >
            ✕ tirar da tela
          </ActionButton>
        )}
      </footer>

      {temAlertaCritico && stage === "pronto" && !card.conferido && (
        <p className="text-center text-base font-bold text-amber-300">
          Confira o pedido antes de despachar.
        </p>
      )}

      <ConferenceSheet
        card={card}
        open={conferindo}
        onClose={() => setConferindo(false)}
      />
    </article>
  );
}

const TONES = {
  blue: "bg-blue-600 hover:bg-blue-500 text-white",
  green: "bg-emerald-600 hover:bg-emerald-500 text-white",
  amber: "bg-amber-500 hover:bg-amber-400 text-slate-950",
  violet: "bg-violet-600 hover:bg-violet-500 text-white",
  slate: "bg-white/10 hover:bg-white/20 text-slate-100",
  ghost: "bg-transparent hover:bg-white/10 text-slate-400",
} as const;

export function ActionButton({
  tone,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone: keyof typeof TONES }) {
  return (
    <button
      {...rest}
      className={`flex-1 rounded-xl px-4 py-3 text-lg font-black uppercase tracking-wide transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none sm:text-xl ${TONES[tone]}`}
    >
      {children}
    </button>
  );
}
