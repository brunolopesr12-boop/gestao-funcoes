"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { fmtMoney, fmtQty, parseDecimal, newId } from "@/lib/ops/format";

export { Button, Card, Field, TextInput, TextArea, Select, Sheet, ConfirmSheet, EmptyState, ProgressBar } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
type Toast = { id: string; text: string; kind: "ok" | "erro" | "info" };
const ToastCtx = createContext<{ notify: (text: string, kind?: Toast["kind"]) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = newId();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "erro" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ notify }}>
      {children}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pop-in pointer-events-auto max-w-md rounded-2xl border px-4 py-2.5 text-sm font-medium shadow-xl backdrop-blur ${
                t.kind === "erro"
                  ? "border-rose-500/40 bg-rose-950/95 text-rose-100"
                  : t.kind === "info"
                    ? "border-blue-500/40 bg-blue-950/95 text-blue-100"
                    : "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast precisa de <ToastProvider>");
  return c.notify;
}

/* ------------------------------------------------------------------ */
/* Cabeçalho de página                                                 */
/* ------------------------------------------------------------------ */
export function PageHeader({
  title, subtitle, backHref, actions, icon,
}: { title: string; subtitle?: React.ReactNode; backHref?: string; actions?: React.ReactNode; icon?: IconName }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {backHref && (
        <Link href={backHref} aria-label="Voltar" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-300 active:scale-95">
          <Icon name="arrowLeft" />
        </Link>
      )}
      {icon && (
        <span className="hidden h-10 w-10 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-[var(--accent)] sm:grid">
          <Icon name={icon} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-extrabold leading-tight sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Selos                                                               */
/* ------------------------------------------------------------------ */
export type Tone = "green" | "amber" | "red" | "blue" | "slate" | "violet" | "cyan";
const TONES: Record<Tone, string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  red: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  slate: "border-[var(--line)] bg-white/5 text-slate-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
};
export function Badge({ tone = "slate", children, className = "", dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]} ${className}`}>
      {dot && <span aria-hidden>{dot}</span>}
      {children}
    </span>
  );
}

export function toneFor(status: string): Tone {
  if (/conclu|finaliz|aprovado$|recebido|ativo|normal|ok|concluido/.test(status)) return "green";
  if (/andamento|pedido|solicitado|atencao|ressalva|3dias|7dias|hoje|lido|planejada|aberta/.test(status)) return "amber";
  if (/cancel|recusado|vencido|critico|baixo|atrasad|bloqueado|erro/.test(status)) return "red";
  if (/rascunho|esgotado|pendente/.test(status)) return "slate";
  return "blue";
}

/* ------------------------------------------------------------------ */
/* Valores                                                             */
/* ------------------------------------------------------------------ */
export function Money({ value, className = "" }: { value: unknown; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{fmtMoney(value)}</span>;
}
export function Qty({ value, unit, decimals, className = "" }: { value: unknown; unit?: string | null; decimals?: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{fmtQty(value, unit, decimals)}</span>;
}

/* ------------------------------------------------------------------ */
/* Campos especiais                                                    */
/* ------------------------------------------------------------------ */
/** Campo numérico que aceita vírgula (pt-BR) e devolve number. */
export function NumberInput({
  value, onChange, placeholder, min, step, autoFocus, disabled, suffix, className = "", inputMode = "decimal", big,
}: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; min?: number; step?: number;
  autoFocus?: boolean; disabled?: boolean; suffix?: string; className?: string; inputMode?: "decimal" | "numeric"; big?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value).replace(".", ","));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null || value === undefined ? "" : String(value).replace(".", ","));
    }
  }, [value]);
  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        inputMode={inputMode}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.-]/g, "");
          setText(t);
          const n = t.trim() === "" ? null : parseDecimal(t);
          last.current = n;
          onChange(n);
        }}
        onBlur={() => {
          if (min !== undefined && value !== null && value !== undefined && value < min) onChange(min);
        }}
        step={step}
        className={`field tabular-nums ${big ? "h-14 text-2xl font-bold" : ""} ${suffix ? "pr-14" : ""}`}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-400">{suffix}</span>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Buscar…", autoFocus, className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field !pl-10"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-white/10">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

/** Debounce simples para buscas. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white/5 px-3.5 py-3 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block text-sm font-semibold text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-600"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
      </button>
    </label>
  );
}

/** Botões de opção grandes (para telas de toque). */
export function Choice<T extends string>({ value, onChange, options, columns = 2 }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string; tone?: Tone; icon?: IconName }[]; columns?: 1 | 2 | 3 | 4 }) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns];
  return (
    <div className={`mb-4 grid gap-2 ${cols}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.98] ${
              active ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--line)] bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {o.icon && <Icon name={o.icon} size={18} />}
            <span className="min-w-0">
              <span className="block">{o.label}</span>
              {o.hint && <span className="block text-[11px] font-normal text-slate-500">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Abas                                                                */
/* ------------------------------------------------------------------ */
export function Tabs<T extends string>({ value, onChange, tabs, className = "" }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div className={`scrollbar-thin mb-4 flex gap-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-white/5 p-1 ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            t.value === value ? "bg-[var(--panel-2)] text-white shadow" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabela paginada                                                     */
/* ------------------------------------------------------------------ */
export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  hideOnMobile?: boolean;
};

export function DataTable<T extends { id?: string }>({
  columns, rows, loading, emptyTitle = "Nada por aqui", emptyDescription, onRowClick, rowHref, page, pageSize, total, onPage, mobileCard, keyFn,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean; emptyTitle?: string; emptyDescription?: string; onRowClick?: (row: T) => void; rowHref?: (row: T) => string;
  page?: number; pageSize?: number; total?: number | null; onPage?: (p: number) => void; mobileCard?: (row: T) => React.ReactNode; keyFn?: (row: T, i: number) => string;
}) {
  const pages = total !== null && total !== undefined && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const key = (r: T, i: number) => keyFn?.(r, i) ?? r.id ?? String(i);
  const clickable = Boolean(onRowClick || rowHref);

  const Row = ({ row, children, className }: { row: T; children: React.ReactNode; className: string }) => {
    if (rowHref) return <Link href={rowHref(row)} className={className}>{children}</Link>;
    return (
      <div role={onRowClick ? "button" : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} className={className}>
        {children}
      </div>
    );
  };

  return (
    <div className="card overflow-hidden">
      {loading && rows.length === 0 ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-white/5" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="font-semibold text-slate-200">{emptyTitle}</p>
          {emptyDescription && <p className="mt-1 text-sm text-slate-400">{emptyDescription}</p>}
        </div>
      ) : (
        <>
          {/* celular: cartões */}
          {mobileCard && (
            <div className="divide-y divide-[var(--line)] md:hidden">
              {rows.map((r, i) => (
                <Row key={key(r, i)} row={r} className={`block px-4 py-3 ${clickable ? "cursor-pointer active:bg-white/5" : ""}`}>
                  {mobileCard(r)}
                </Row>
              ))}
            </div>
          )}
          <div className={`overflow-x-auto ${mobileCard ? "hidden md:block" : ""}`}>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wider text-slate-500">
                  {columns.map((c) => (
                    <th key={c.key} className={`px-3 py-2.5 font-bold ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""} ${c.hideOnMobile ? "hidden lg:table-cell" : ""} ${c.className ?? ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {rows.map((r, i) => (
                  <tr
                    key={key(r, i)}
                    onClick={clickable ? () => (onRowClick ? onRowClick(r) : (window.location.href = rowHref!(r))) : undefined}
                    className={clickable ? "cursor-pointer transition hover:bg-white/5" : ""}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 align-middle ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""} ${c.hideOnMobile ? "hidden lg:table-cell" : ""} ${c.className ?? ""}`}>
                        {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {pages !== null && onPage && page !== undefined && (total ?? 0) > (pageSize ?? 0) && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-2 text-xs text-slate-400">
          <span className="tabular-nums">{total} registros · página {page + 1} de {pages}</span>
          <div className="flex gap-1">
            <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} className="rounded-lg border border-[var(--line)] px-2 py-1 disabled:opacity-40"><Icon name="chevronLeft" size={16} /></button>
            <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="rounded-lg border border-[var(--line)] px-2 py-1 disabled:opacity-40"><Icon name="chevronRight" size={16} /></button>
          </div>
        </div>
      )}
      {loading && rows.length > 0 && <div className="h-0.5 w-full animate-pulse bg-[var(--accent)]/60" />}
    </div>
  );
}

/** Paginação controlada por hook. */
export function usePagination(pageSize = 50) {
  const [page, setPage] = useState(0);
  const range = useMemo(() => ({ from: page * pageSize, to: page * pageSize + pageSize - 1 }), [page, pageSize]);
  return { page, setPage, pageSize, range, reset: () => setPage(0) };
}

/* ------------------------------------------------------------------ */
/* Cartões de indicadores                                              */
/* ------------------------------------------------------------------ */
export function KpiCard({ label, value, hint, tone = "slate", icon, href, onClick }: { label: string; value: React.ReactNode; hint?: string; tone?: Tone; icon?: IconName; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
        {icon && <Icon name={icon} size={18} className="text-slate-500" />}
      </div>
      <div className={`mt-1 text-2xl font-extrabold tabular-nums leading-none ${{ green: "text-emerald-300", amber: "text-amber-300", red: "text-rose-300", blue: "text-blue-300", slate: "text-slate-100", violet: "text-violet-300", cyan: "text-cyan-300" }[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </>
  );
  const cls = `card block p-3.5 text-left ${href || onClick ? "card-hover" : ""}`;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} w-full`}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

/* ------------------------------------------------------------------ */
/* Atalho grande (celular)                                             */
/* ------------------------------------------------------------------ */
export function ActionTile({ href, label, description, icon, tone }: { href: string; label: string; description?: string; icon: IconName; tone: string }) {
  return (
    <Link href={href} className="card card-hover flex items-center gap-3 p-3.5">
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${tone}`}>
        <Icon name={icon} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-extrabold leading-tight">{label}</span>
        {description && <span className="block truncate text-xs text-slate-400">{description}</span>}
      </span>
      <Icon name="chevronRight" className="text-slate-600" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Painel lateral (desktop) / folha (celular)                          */
/* ------------------------------------------------------------------ */
export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end">
      <div className="fade-in absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`sheet-up relative flex max-h-[94dvh] w-full flex-col rounded-t-3xl border border-[var(--line)] bg-[var(--panel)] sm:max-h-none sm:rounded-none sm:border-l ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-[var(--line)] px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diversos                                                            */
/* ------------------------------------------------------------------ */
export function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/5" />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="card border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
      <p className="font-semibold">Não foi possível carregar</p>
      <p className="mt-1 text-rose-200/80">{error}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-semibold">Tentar de novo</button>
      )}
    </div>
  );
}

export function Row({ label, children, className = "" }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-2 text-sm ${className}`}>
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-semibold text-slate-100">{children}</span>
    </div>
  );
}

export function SectionCard({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function IconButton({ icon, label, onClick, href, tone = "soft", size = 40, disabled }: { icon: IconName; label: string; onClick?: () => void; href?: string; tone?: "soft" | "primary" | "danger"; size?: number; disabled?: boolean }) {
  const cls = `grid place-items-center rounded-xl border transition active:scale-95 disabled:opacity-40 ${
    tone === "primary" ? "border-[var(--accent)]/60 bg-[var(--accent)] text-white" : tone === "danger" ? "border-rose-500/40 bg-rose-500/15 text-rose-200" : "border-[var(--line)] bg-white/5 text-slate-300 hover:bg-white/10"
  }`;
  const style = { width: size, height: size };
  if (href) return <Link href={href} aria-label={label} title={label} className={cls} style={style}><Icon name={icon} size={18} /></Link>;
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cls} style={style}><Icon name={icon} size={18} /></button>;
}

export function LevelDot({ level }: { level: "normal" | "atencao" | "baixo" | "critico" }) {
  const map = { normal: "🟢", atencao: "🟡", baixo: "🔴", critico: "🚨" } as const;
  return <span aria-label={level}>{map[level]}</span>;
}

export function InlineAlert({ tone = "amber", children, icon = "alert" }: { tone?: Tone; children: React.ReactNode; icon?: IconName }) {
  return (
    <div className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${TONES[tone]}`}>
      <Icon name={icon} size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
