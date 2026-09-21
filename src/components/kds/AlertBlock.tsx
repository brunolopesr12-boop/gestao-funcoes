"use client";

import type { KdsAlert } from "@/lib/kds/types";

const LEVEL_STYLE: Record<KdsAlert["level"], string> = {
  critico: "border-rose-500 bg-rose-600/25 text-rose-50",
  atencao: "border-amber-500 bg-amber-500/20 text-amber-50",
  ok: "border-emerald-500/60 bg-emerald-600/15 text-emerald-100",
  info: "border-slate-500/60 bg-slate-500/15 text-slate-100",
};

/**
 * Bloco de alerta da comanda. Os críticos piscam — a ideia é ser
 * impossível de ignorar de longe.
 */
export function AlertBlock({
  alert,
  size = "md",
}: {
  alert: KdsAlert;
  size?: "sm" | "md";
}) {
  const piscar = alert.level === "critico";
  const compacto = size === "sm";
  const title = compacto
    ? "text-base sm:text-lg"
    : "text-xl leading-tight sm:text-2xl";

  return (
    <div
      className={`rounded-xl border-2 px-3 py-2 ${LEVEL_STYLE[alert.level]} ${piscar ? "kds-blink" : ""}`}
    >
      <p className={`flex items-center gap-2 font-extrabold uppercase ${title}`}>
        <span aria-hidden className="text-2xl">
          {alert.icon}
        </span>
        <span>{alert.title}</span>
      </p>
      {alert.lines.length > 0 && !compacto && (
        <ul className="mt-1 space-y-0.5 pl-9">
          {alert.lines.map((l, i) => (
            <li key={i} className="text-base font-semibold leading-snug sm:text-lg">
              {l}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
