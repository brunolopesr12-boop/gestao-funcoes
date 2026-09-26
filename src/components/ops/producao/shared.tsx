"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDateTime, fmtPct } from "@/lib/ops/format";
import { PRODUCTION_STATUS_LABEL, type ProductionStatus } from "@/lib/ops/types";
import { splitSteps, yieldTone, type ProductionRow } from "@/lib/ops/modules/producao";
import { Icon, type IconName } from "@/components/ops/Icon";
import { Badge, Button, Sheet, TextArea, toneFor } from "@/components/ops/ui";

/** Link com aparência de botão. */
export function LinkButton({
  href, children, variant = "primary", size = "md", full, className = "", icon,
}: { href: string; children: React.ReactNode; variant?: "primary" | "soft" | "ghost" | "success"; size?: "md" | "lg"; full?: boolean; className?: string; icon?: IconName }) {
  const v = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/60 shadow-lg shadow-blue-900/30",
    success: "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/60",
    soft: "bg-white/5 hover:bg-white/10 text-slate-100 border border-[var(--line)]",
    ghost: "bg-transparent hover:bg-white/5 text-slate-300 border border-transparent",
  }[variant];
  const s = size === "lg" ? "text-base px-5 py-3.5 rounded-2xl font-semibold" : "text-[15px] px-4 py-2.5 rounded-xl";
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] ${v} ${s} ${full ? "w-full" : ""} ${className}`}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  );
}

/** Confirmação com botão principal (não destrutivo), para concluir/avançar etapas. */
export function ConfirmActionSheet({
  open, onClose, title, message, confirmLabel = "Confirmar", onConfirm, variant = "primary", busy, children,
}: { open: boolean; onClose: () => void; title: string; message: React.ReactNode; confirmLabel?: string; onConfirm: () => void | Promise<void>; variant?: "primary" | "success" | "danger"; busy?: boolean; children?: React.ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="mb-5 text-slate-300">{message}</div>
      {children}
      <div className="flex gap-3">
        <Button variant="soft" size="lg" full onClick={onClose} disabled={busy}>Voltar</Button>
        <Button variant={variant} size="lg" full disabled={busy} onClick={() => void onConfirm()}>{busy ? "Aguarde…" : confirmLabel}</Button>
      </div>
    </Sheet>
  );
}

/** Folha para informar um motivo (cancelamento). */
export function ReasonSheet({
  open, onClose, title, message, confirmLabel = "Confirmar", onConfirm, required = true, busy,
}: { open: boolean; onClose: () => void; title: string; message: string; confirmLabel?: string; onConfirm: (reason: string) => void | Promise<void>; required?: boolean; busy?: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="mb-3 text-sm text-slate-300">{message}</p>
      <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Motivo" className="mb-4" />
      <div className="flex gap-3">
        <Button variant="soft" size="lg" full onClick={onClose} disabled={busy}>Voltar</Button>
        <Button
          variant="danger"
          size="lg"
          full
          disabled={busy || (required && !reason.trim())}
          onClick={() => {
            void onConfirm(reason.trim());
            setReason("");
          }}
        >
          {busy ? "Aguarde…" : confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}

export function ProductionStatusBadge({ status }: { status: ProductionStatus }) {
  const tone = status === "planejada" ? "blue" : toneFor(status);
  return <Badge tone={tone}>{PRODUCTION_STATUS_LABEL[status]}</Badge>;
}

/** Rendimento real em % (2 casas, como o banco grava em actual_yield_pct), colorido (≥95% verde, ≥80% amarelo, abaixo vermelho). */
export function YieldBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-slate-500">—</span>;
  return <Badge tone={yieldTone(pct)}>{fmtPct(pct, 2)}</Badge>;
}

/** Indicador de etapas do fluxo guiado. */
export function StepBar({ step, steps, onStep }: { step: number; steps: string[]; onStep?: (i: number) => void }) {
  return (
    <ol className="mb-4 flex items-center gap-1 sm:gap-2">
      {steps.map((label, i) => {
        const state = i < step ? "done" : i === step ? "current" : "todo";
        const clickable = onStep && i < step;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStep(i)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2 py-2 text-left sm:px-3 ${
                state === "current" ? "border-[var(--accent)] bg-[var(--accent)]/15" : state === "done" ? "border-emerald-500/40 bg-emerald-500/10" : "border-[var(--line)] bg-white/5 opacity-60"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${state === "done" ? "bg-emerald-500 text-white" : state === "current" ? "bg-[var(--accent)] text-white" : "bg-white/10 text-slate-300"}`}>
                {state === "done" ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className="hidden truncate text-xs font-semibold text-slate-200 sm:block">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Linha do tempo da produção (criada → iniciada → concluída / cancelada). */
export function ProductionTimeline({ p }: { p: ProductionRow }) {
  const steps: { label: string; at: string | null; who?: string; tone: "done" | "current" | "todo" | "cancel" }[] = [];
  steps.push({ label: "Criada", at: p.created_at, who: p.created_by_name || undefined, tone: "done" });
  if (p.status === "cancelada") {
    if (p.started_at) steps.push({ label: "Iniciada", at: p.started_at, who: p.produced_by_name || undefined, tone: "done" });
    steps.push({ label: "Cancelada", at: p.updated_at ?? null, tone: "cancel" });
  } else {
    steps.push({ label: "Iniciada", at: p.started_at, who: p.produced_by_name || undefined, tone: p.started_at ? "done" : p.status === "planejada" ? "current" : "todo" });
    steps.push({ label: "Concluída", at: p.finished_at, who: p.produced_by_name || undefined, tone: p.finished_at ? "done" : p.status === "em_andamento" ? "current" : "todo" });
  }
  return (
    <ol className="relative ml-2 border-l border-[var(--line)] pl-4">
      {steps.map((s) => {
        const cls = s.tone === "cancel" ? "bg-rose-500" : s.tone === "done" ? "bg-emerald-500" : s.tone === "current" ? "bg-amber-400" : "bg-slate-600";
        return (
          <li key={s.label} className="mb-3 last:mb-0">
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${cls}`} />
            <p className={`text-sm font-semibold ${s.tone === "todo" ? "text-slate-500" : "text-slate-100"}`}>{s.label}</p>
            <p className="text-xs text-slate-500">
              {s.at ? fmtDateTime(s.at) : s.tone === "current" ? "próxima etapa" : "—"}
              {s.who && s.at ? ` · ${s.who}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Modo de preparo numerado (um passo por linha). */
export function StepsList({ instructions, emptyText = "Esta ficha não tem modo de preparo cadastrado." }: { instructions: string | null | undefined; emptyText?: string }) {
  const steps = splitSteps(instructions);
  if (steps.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm text-slate-200">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-slate-300">{i + 1}</span>
          <span className="min-w-0 flex-1 leading-6">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Bloco de campo sem <label> (para grupos de botões ou seletores compostos). */
export function FieldBlock({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-sm font-semibold text-slate-300">
        {label} {required && <span className="text-rose-400">*</span>}
      </p>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
