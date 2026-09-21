"use client";

import type { KdsCard } from "@/lib/kds/store";
import { STAGE_META, type KdsStage } from "@/lib/kds/types";
import { OrderCard } from "./OrderCard";

/** Uma fila do KDS. Sempre visível, mesmo vazia, para a equipe se orientar. */
export function Column({
  stage,
  cards,
  now,
}: {
  stage: KdsStage;
  cards: KdsCard[];
  now: number;
}) {
  const meta = STAGE_META[stage];
  return (
    <section className="kds-col rounded-2xl bg-white/[0.03]">
      <header
        className="flex items-center gap-2 rounded-t-2xl px-3 py-2"
        style={{ background: `${meta.accent}26`, borderBottom: `3px solid ${meta.accent}` }}
      >
        <span className="text-2xl" aria-hidden>
          {meta.emoji}
        </span>
        <h2 className="flex-1 text-lg font-black uppercase tracking-wide sm:text-xl">
          {meta.label}
        </h2>
        <span
          className="rounded-lg px-2.5 py-0.5 text-xl font-black tabular-nums text-white"
          style={{ background: meta.accent }}
        >
          {cards.length}
        </span>
      </header>

      <div className="kds-col-body space-y-3 p-2">
        {cards.length === 0 ? (
          <p className="py-8 text-center text-base font-semibold text-slate-600">
            nenhum pedido
          </p>
        ) : (
          cards.map((card) => <OrderCard key={card.row.id} card={card} now={now} />)
        )}
      </div>
    </section>
  );
}
