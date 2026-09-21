"use client";

import { elapsedSeconds, fmtElapsed } from "@/lib/kds/alerts";

/** Cronômetro desde a entrada do pedido. Pisca quando passa do limite. */
export function Timer({
  placedAt,
  lateMinutes,
  now,
  paused = false,
}: {
  placedAt: string;
  lateMinutes: number;
  now: number;
  paused?: boolean;
}) {
  const secs = elapsedSeconds(placedAt, now);
  const late = !paused && secs >= Math.max(1, lateMinutes) * 60;
  const quase = !paused && !late && secs >= Math.max(1, lateMinutes) * 60 * 0.75;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-2xl font-black tabular-nums leading-none sm:text-3xl ${
        late
          ? "kds-late"
          : quase
            ? "bg-amber-500/25 text-amber-200"
            : "bg-white/10 text-slate-200"
      }`}
      title={late ? "Pedido atrasado" : "Tempo desde a entrada"}
    >
      {fmtElapsed(secs)}
    </span>
  );
}
