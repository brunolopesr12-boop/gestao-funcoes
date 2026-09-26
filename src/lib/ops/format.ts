import type { ExpiryStatus, StockLevel } from "./types";

const nf = (min: number, max: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateShort = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Número a partir de texto pt-BR ou en: "1.234,5" → 1234.5 ; "2,5" → 2.5 ; "2.5" → 2.5 */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  // com vírgula: pontos são separadores de milhar; sem vírgula: ponto é decimal
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function parseDecimal(s: string): number {
  return num(s);
}

export function fmtQty(v: unknown, unit?: string | null, decimals?: number): string {
  const n = num(v);
  const d = decimals ?? (Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 3);
  const s = nf(0, Math.max(d, 0)).format(n);
  return unit ? `${s} ${unit}` : s;
}

export function fmtMoney(v: unknown): string {
  return money.format(num(v));
}

export function fmtPct(v: unknown, decimals = 1): string {
  return `${nf(0, decimals).format(num(v))}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateOnly.format(d);
}
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateShort.format(d);
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (/^\d{2}:\d{2}/.test(iso)) return iso.slice(0, 5);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : timeOnly.format(d);
}
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  return fmtDate(iso);
}

/** yyyy-mm-dd de hoje (fuso local) */
export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "sem validade";
  if (days < 0) return `vencido há ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}`;
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}

export const LEVEL_META: Record<StockLevel, { label: string; dot: string; className: string; short: string }> = {
  normal:  { label: "Nível adequado",     dot: "🟢", short: "OK",       className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  atencao: { label: "Próximo do mínimo",  dot: "🟡", short: "Atenção",  className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  baixo:   { label: "Abaixo do mínimo",   dot: "🔴", short: "Baixo",    className: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  critico: { label: "Crítico",            dot: "🚨", short: "Crítico",  className: "border-rose-600/50 bg-rose-600/20 text-rose-200" },
};

export const EXPIRY_META: Record<ExpiryStatus, { label: string; className: string; tone: "green" | "amber" | "red" | "slate" }> = {
  sem_validade: { label: "Sem validade",   tone: "slate", className: "border-[var(--line)] bg-white/5 text-slate-300" },
  vencido:      { label: "Vencido",        tone: "red",   className: "border-rose-600/50 bg-rose-600/20 text-rose-200" },
  hoje:         { label: "Vence hoje",     tone: "red",   className: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  "3dias":      { label: "Vence em 3 dias", tone: "amber", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  "7dias":      { label: "Vence em 7 dias", tone: "amber", className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200" },
  ok:           { label: "No prazo",       tone: "green", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Converte linhas para CSV (separador ; para Excel em pt-BR). */
export function toCSV(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(";");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(";"));
  return "﻿" + [head, ...body].join("\n");
}

export function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
