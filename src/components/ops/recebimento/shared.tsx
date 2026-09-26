"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDateTime } from "@/lib/ops/format";
import type { PurchaseOrderDetail } from "@/lib/ops/modules/recebimento";
import { PO_STATUS_LABEL, type PurchaseOrderStatus } from "@/lib/ops/types";
import { Icon } from "@/components/ops/Icon";
import { Badge, Sheet, Button, TextArea, toneFor } from "@/components/ops/ui";
import { QrScanner } from "@/components/ops/QrScanner";

/** Bloco de campo sem <label> (para grupos de botões, como o Choice). */
export function FieldBlock({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="mb-1">
      <p className="mb-1.5 text-sm font-semibold text-slate-300">
        {label} {required && <span className="text-rose-400">*</span>}
      </p>
      {children}
      {hint && <p className="-mt-3 mb-4 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Folha com a câmera para ler código de barras / QR. */
export function ScanSheet({ open, onClose, onResult, hint }: { open: boolean; onClose: () => void; onResult: (text: string) => void; hint?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title="Ler código">
      {open && <QrScanner onResult={onResult} onClose={onClose} hint={hint ?? "Aponte para o código de barras do produto"} />}
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
        <Button variant="soft" full onClick={onClose} disabled={busy}>Voltar</Button>
        <Button
          variant="danger"
          full
          disabled={busy || (required && !reason.trim())}
          onClick={() => {
            void onConfirm(reason.trim());
            setReason("");
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}

/** Selo de status de pedido de compra. */
export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={toneFor(status)}>{PO_STATUS_LABEL[status]}</Badge>;
}

/** Linha do tempo do pedido de compra. */
export function PoTimeline({ po }: { po: PurchaseOrderDetail }) {
  const steps: { label: string; at: string | null; who?: string; detail?: string; tone: "done" | "current" | "todo" | "cancel" }[] = [];
  const done = (at: string | null | undefined) => (at ? "done" : "todo") as "done" | "todo";
  steps.push({ label: "Criado", at: po.created_at, who: po.created_by_name, tone: "done" });
  steps.push({ label: "Solicitado", at: po.requested_at, tone: done(po.requested_at) });
  steps.push({ label: "Aprovado", at: po.approved_at, tone: done(po.approved_at) });
  steps.push({ label: "Pedido ao fornecedor", at: po.ordered_at, tone: done(po.ordered_at) });
  if (po.status === "cancelado") {
    steps.push({ label: "Cancelado", at: po.cancelled_at ?? null, detail: po.cancel_reason || undefined, tone: "cancel" });
  } else {
    steps.push({ label: "Recebido", at: po.received_at, tone: done(po.received_at) });
  }
  // marca a etapa atual
  const currentIdx = { rascunho: 0, solicitado: 1, aprovado: 2, pedido: 3, recebido: 4, cancelado: 4 }[po.status];
  return (
    <ol className="relative ml-2 border-l border-[var(--line)] pl-4">
      {steps.map((s, i) => {
        const isCurrent = i === currentIdx && po.status !== "recebido";
        const cls = s.tone === "cancel" ? "bg-rose-500" : s.tone === "done" ? "bg-emerald-500" : isCurrent ? "bg-amber-400" : "bg-slate-600";
        return (
          <li key={s.label} className="mb-3 last:mb-0">
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${cls}`} />
            <p className={`text-sm font-semibold ${s.tone === "todo" && !isCurrent ? "text-slate-500" : "text-slate-100"}`}>{s.label}</p>
            <p className="text-xs text-slate-500">
              {s.at ? fmtDateTime(s.at) : isCurrent ? "etapa atual" : s.tone === "cancel" ? "" : "—"}
              {s.who ? ` · ${s.who}` : ""}
            </p>
            {s.detail && <p className="mt-0.5 text-xs text-rose-300">Motivo: {s.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** Link discreto com ícone. */
export function LinkChip({ href, children, icon = "chevronRight" }: { href: string; children: React.ReactNode; icon?: "chevronRight" | "file" | "truck" | "package" }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white/5 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">
      <Icon name={icon} size={14} />
      {children}
    </Link>
  );
}

/** Confirmação com botão principal (não destrutivo), para finalizar/avançar etapas. */
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

/** Link com aparência de botão. */
export function LinkButton({ href, children, variant = "primary", size = "md", full, className = "" }: { href: string; children: React.ReactNode; variant?: "primary" | "soft" | "ghost"; size?: "md" | "lg"; full?: boolean; className?: string }) {
  const v = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/60 shadow-lg shadow-blue-900/30",
    soft: "bg-white/5 hover:bg-white/10 text-slate-100 border border-[var(--line)]",
    ghost: "bg-transparent hover:bg-white/5 text-slate-300 border border-transparent",
  }[variant];
  const s = size === "lg" ? "text-base px-5 py-3.5 rounded-2xl font-semibold" : "text-[15px] px-4 py-2.5 rounded-xl";
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] ${v} ${s} ${full ? "w-full" : ""} ${className}`}>
      {children}
    </Link>
  );
}
