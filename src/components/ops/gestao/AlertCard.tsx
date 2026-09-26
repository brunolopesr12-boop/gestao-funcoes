"use client";

import Link from "next/link";
import { fmtDateTime, fmtRelative } from "@/lib/ops/format";
import { ALERT_KIND_LABEL, type Alert } from "@/lib/ops/types";
import { ALERT_STATUS_LABEL, SEVERITY_META, alertHref } from "@/lib/ops/modules/gestao";
import { Badge, Button } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

export function AlertCard({
  alert, storeName, canResolve, canRead, busy, onRead, onResolve,
}: {
  alert: Alert; storeName?: string | null; canResolve: boolean; canRead: boolean; busy?: boolean; onRead: (a: Alert) => void; onResolve: (a: Alert) => void;
}) {
  const sev = SEVERITY_META[alert.severity] ?? SEVERITY_META.info;
  const link = alertHref(alert);
  const resolved = alert.status === "resolvido";
  return (
    <article className={`card flex gap-3 p-3.5 ${resolved ? "opacity-70" : ""} ${alert.status === "aberto" ? sev.border : ""}`}>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${sev.bg} ${sev.text}`} aria-label={sev.label} title={sev.label}>
        <Icon name={sev.icon} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className={`font-bold leading-tight ${resolved ? "line-through decoration-slate-500" : ""}`}>{alert.title}</h3>
          <Badge tone={sev.tone}>{sev.label}</Badge>
          <Badge tone="slate">{ALERT_KIND_LABEL[alert.kind] ?? alert.kind}</Badge>
          {alert.status !== "aberto" && <Badge tone={resolved ? "green" : "amber"}>{ALERT_STATUS_LABEL[alert.status]}</Badge>}
        </div>
        {alert.message && <p className="mt-1 text-sm text-slate-300">{alert.message}</p>}
        <p className="mt-1 text-xs text-slate-500" title={fmtDateTime(alert.created_at)}>
          {fmtRelative(alert.created_at)}
          {storeName !== undefined && <> · {storeName ?? "Toda a empresa"}</>}
          {alert.read_at && alert.status === "lido" && <> · lido {fmtRelative(alert.read_at)}</>}
          {alert.resolved_at && resolved && <> · resolvido {fmtRelative(alert.resolved_at)}</>}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {link && (
            <Link href={link.href} className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-white/10">
              {link.label} <Icon name="chevronRight" size={14} />
            </Link>
          )}
          {alert.status === "aberto" && canRead && (
            <Button size="sm" variant="soft" disabled={busy} onClick={() => onRead(alert)}>
              <Icon name="eye" size={16} /> Marcar como lido
            </Button>
          )}
          {!resolved && canResolve && (
            <Button size="sm" variant="success" disabled={busy} onClick={() => onResolve(alert)}>
              <Icon name="check" size={16} /> Resolver
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
