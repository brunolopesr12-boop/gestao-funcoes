"use client";

import Link from "next/link";
import { useState } from "react";
import { downloadBlob, todayISO } from "@/lib/ops/format";
import { Icon, type IconName } from "@/components/ops/Icon";
import { Button, InlineAlert, useToast } from "@/components/ops/ui";

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

/** Botão grande do hub (celular e desktop). */
export function BigTile({ href, label, description, icon, tone }: { href: string; label: string; description: string; icon: IconName; tone: string }) {
  return (
    <Link href={href} className="card card-hover flex min-h-20 items-center gap-3 p-4">
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white ${tone}`}>
        <Icon name={icon} size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold leading-tight">{label}</span>
        <span className="block text-xs text-slate-400">{description}</span>
      </span>
      <Icon name="chevronRight" className="text-slate-600" />
    </Link>
  );
}

/** Texto curto sobre impressão térmica e ZPL. */
export function PrintHelp({ compact }: { compact?: boolean }) {
  return (
    <InlineAlert tone="blue" icon="printer">
      <strong>Como imprime:</strong> a impressão usa a impressora configurada neste aparelho (a etiqueta abre na janela de impressão do navegador, uma por página, no tamanho exato em mm).
      {!compact && <> Para impressoras <strong>Zebra ou compatíveis</strong>, use <strong>Baixar ZPL</strong> / <strong>Copiar ZPL</strong> e envie o arquivo à impressora (203 dpi). O logo só sai na impressão pelo navegador.</>}
    </InlineAlert>
  );
}

/** Botões Baixar ZPL e Copiar ZPL. `zpl` é gerado sob demanda (pode ser pesado). */
export function ZplButtons({ getZpl, disabled, filename }: { getZpl: () => string; disabled?: boolean; filename?: string }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const name = filename ?? `etiquetas-${todayISO()}.zpl`;
  async function copy() {
    setBusy(true);
    try {
      const text = getZpl();
      if (!navigator.clipboard?.writeText) throw new Error("Este navegador não permite copiar. Use Baixar ZPL.");
      await navigator.clipboard.writeText(text);
      notify("ZPL copiado");
    } catch (e) {
      notify((e as Error).message || "Não foi possível copiar.", "erro");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="soft" size="lg" disabled={disabled || busy} onClick={() => { try { downloadBlob(name, getZpl(), "text/plain;charset=utf-8"); } catch (e) { notify((e as Error).message, "erro"); } }}>
        <Icon name="download" size={18} /> Baixar ZPL
      </Button>
      <Button variant="soft" size="lg" disabled={disabled || busy} onClick={() => void copy()}>
        <Icon name="file" size={18} /> Copiar ZPL
      </Button>
    </div>
  );
}

/** Seletor de zoom da pré-visualização. */
export function ZoomPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--line)] bg-white/5 p-0.5">
      {[1, 2, 3].map((z) => (
        <button key={z} type="button" onClick={() => onChange(z)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${value === z ? "bg-[var(--panel-2)] text-white shadow" : "text-slate-400"}`}>
          {z}×
        </button>
      ))}
    </div>
  );
}
