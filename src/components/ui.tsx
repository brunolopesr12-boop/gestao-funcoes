"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { STATUS_META, type Fitness, type ProcessStatus } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Botão                                                               */
/* ------------------------------------------------------------------ */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "soft" | "success";
  size?: "sm" | "md" | "lg";
  full?: boolean;
};

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/60 shadow-lg shadow-blue-900/30",
  success:
    "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/60",
  soft: "bg-white/5 hover:bg-white/10 text-slate-100 border border-[var(--line)]",
  ghost: "bg-transparent hover:bg-white/5 text-slate-300 border border-transparent",
  danger: "bg-rose-600/90 hover:bg-rose-500 text-white border border-rose-500/60",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "text-sm px-3 py-1.5 rounded-lg",
  md: "text-[15px] px-4 py-2.5 rounded-xl",
  lg: "text-base px-5 py-3.5 rounded-2xl font-semibold",
};

export function Button({
  variant = "soft",
  size = "md",
  full,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Cartão                                                              */
/* ------------------------------------------------------------------ */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function LinkCard({
  href,
  className = "",
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`card card-hover block p-4 ${className}`}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Barra de progresso                                                  */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  value,
  tone = "auto",
  showLabel = false,
  className = "",
}: {
  value: number;
  tone?: "auto" | "green" | "amber" | "red" | "blue";
  showLabel?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const resolved =
    tone === "auto" ? (v >= 100 ? "green" : v > 0 ? "amber" : "red") : tone;
  const bar = {
    green: "bg-emerald-500",
    amber: "bg-amber-400",
    red: "bg-rose-500",
    blue: "bg-blue-500",
  }[resolved];
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${bar} transition-[width] duration-300`}
          style={{ width: `${v}%` }}
        />
      </div>
      {showLabel && (
        <span className="w-11 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-300">
          {v}%
        </span>
      )}
    </div>
  );
}

/** Barra em blocos, estilo ████████░░ */
export function BlockBar({ value, blocks = 10 }: { value: number; blocks?: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * blocks);
  return (
    <span className="font-mono text-lg tracking-tight text-emerald-400">
      {"█".repeat(filled)}
      <span className="text-slate-600">{"░".repeat(blocks - filled)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Selo de status                                                      */
/* ------------------------------------------------------------------ */

export function StatusPill({
  status,
  className = "",
  compact = false,
}: {
  status: ProcessStatus | Fitness;
  className?: string;
  compact?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.className} ${className}`}
    >
      <span aria-hidden>{meta.dot}</span>
      {!compact && meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Títulos e vazios                                                    */
/* ------------------------------------------------------------------ */

export function SectionTitle({
  children,
  action,
  hint,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {children}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  emoji = "📭",
  title,
  description,
  action,
}: {
  emoji?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-5 py-9 text-center">
      <div className="text-4xl">{emoji}</div>
      <div>
        <p className="font-semibold text-slate-200">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Indicador numérico                                                  */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  tone = "slate",
  emoji,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "green" | "amber" | "red" | "blue" | "slate";
  emoji?: string;
  onClick?: () => void;
}) {
  const tones = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    slate: "border-[var(--line)] bg-white/5 text-slate-300",
  }[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-3 text-left ${tones} ${onClick ? "active:scale-[0.98] transition" : ""}`}
    >
      <span className="text-2xl font-extrabold tabular-nums leading-none">
        {emoji && <span className="mr-1 text-lg">{emoji}</span>}
        {value}
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide opacity-80">
        {label}
      </span>
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Modal / bottom sheet                                                */
/* ------------------------------------------------------------------ */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="fade-in absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-[var(--line)] bg-[var(--panel)] sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="safe-bottom border-t border-[var(--line)] px-5 pt-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campos de formulário                                                */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`field ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field ${props.className ?? ""}`} />;
}

/* ------------------------------------------------------------------ */
/* Seletor de emoji simples                                            */
/* ------------------------------------------------------------------ */

export function EmojiPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
      {options.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onChange(e)}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-xl transition ${
            value === e
              ? "border-blue-500 bg-blue-500/20"
              : "border-[var(--line)] bg-white/5 hover:bg-white/10"
          }`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmação                                                         */
/* ------------------------------------------------------------------ */

export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = "Excluir",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="mb-5 text-slate-300">{message}</p>
      <div className="flex gap-3">
        <Button variant="soft" full onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          full
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Lista editável inline (competências, checklist)                     */
/* ------------------------------------------------------------------ */

export function InlineList({
  items,
  placeholder,
  emptyText,
  bullet = "•",
  onAdd,
  onRename,
  onDelete,
}: {
  items: { id: string; label: string }[];
  placeholder: string;
  emptyText: string;
  bullet?: string;
  onAdd: (text: string) => void;
  onRename: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div>
      {items.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">{emptyText}</p>
      )}
      <ul className="mb-3 space-y-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/[0.03] px-3 py-2"
          >
            {editing === it.id ? (
              <>
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onRename(it.id, editText);
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="field flex-1 !py-1.5"
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onRename(it.id, editText);
                    setEditing(null);
                  }}
                >
                  OK
                </Button>
              </>
            ) : (
              <>
                <span className="text-slate-500">{bullet}</span>
                <span className="flex-1 text-[15px] text-slate-200">{it.label}</span>
                <button
                  onClick={() => {
                    setEditing(it.id);
                    setEditText(it.label);
                  }}
                  className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10"
                  aria-label="Editar"
                >
                  ✏️
                </button>
                <button
                  onClick={() => onDelete(it.id)}
                  className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10"
                  aria-label="Excluir"
                >
                  🗑️
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          className="field flex-1"
        />
        <Button variant="primary" onClick={add} disabled={!draft.trim()}>
          Adicionar
        </Button>
      </div>
    </div>
  );
}
