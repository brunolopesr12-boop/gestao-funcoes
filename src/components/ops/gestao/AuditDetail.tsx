"use client";

import Link from "next/link";
import { fmtDateTime } from "@/lib/ops/format";
import type { AuditLog } from "@/lib/ops/types";
import { actionLabel, actionTone, auditHref, auditKeys, entityLabel, fieldLabel, fmtAuditValue, isChanged } from "@/lib/ops/modules/gestao";
import { Badge, Drawer, Row } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/** Painel com o detalhe de um registro de auditoria: antes/depois lado a lado. */
export function AuditDetailDrawer({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  const keys = log ? auditKeys(log.before, log.after) : [];
  const href = log ? auditHref(log.entity, log.entity_id) : null;
  const showBefore = Boolean(log?.before);
  const showAfter = Boolean(log?.after);
  const changed = log ? keys.filter((k) => isChanged(k, log.before, log.after)) : [];
  return (
    <Drawer open={Boolean(log)} onClose={onClose} title="Detalhe da auditoria" wide>
      {log && (
        <>
          <div className="mb-4 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] px-3">
            <Row label="Data/hora">{fmtDateTime(log.created_at)}</Row>
            <Row label="Usuário">{log.user_name || "Sistema"}</Row>
            <Row label="Ação"><Badge tone={actionTone(log.action)}>{actionLabel(log.action)}</Badge></Row>
            <Row label="Entidade">{entityLabel(log.entity)} <span className="font-mono text-xs text-slate-500">({log.entity})</span></Row>
            <Row label="Registro">
              {href ? (
                <Link href={href} className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">{log.entity_label || "abrir"} <Icon name="chevronRight" size={14} /></Link>
              ) : (
                <>{log.entity_label || "—"}</>
              )}
            </Row>
            {log.entity_id && <Row label="ID"><span className="font-mono text-xs">{log.entity_id}</span></Row>}
            <Row label="Unidade">{log.store_name ?? "Toda a empresa"}</Row>
            {log.detail && <Row label="Detalhe">{log.detail}</Row>}
          </div>

          {keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Esta ação não registrou campos antes/depois.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">
                {showBefore && showAfter ? `${changed.length} campo(s) alterado(s), destacados.` : showAfter ? "Valores gravados no registro." : "Valores do registro antes de ser excluído."}
              </p>
              <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 font-bold">Campo</th>
                      {showBefore && <th className="px-3 py-2 font-bold">Antes</th>}
                      {showAfter && <th className="px-3 py-2 font-bold">Depois</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {keys.map((k) => {
                      const diff = showBefore && showAfter && isChanged(k, log.before, log.after);
                      return (
                        <tr key={k} className={diff ? "bg-amber-500/10" : ""}>
                          <td className="px-3 py-2 align-top font-semibold text-slate-300">
                            {diff && <span className="mr-1 text-amber-300" aria-label="alterado">●</span>}
                            {fieldLabel(k)}
                            <span className="block font-mono text-[10px] font-normal text-slate-600">{k}</span>
                          </td>
                          {showBefore && <td className={`px-3 py-2 align-top break-words ${diff ? "text-rose-200 line-through decoration-rose-400/60" : "text-slate-400"}`}>{fmtAuditValue(k, log.before?.[k])}</td>}
                          {showAfter && <td className={`px-3 py-2 align-top break-words ${diff ? "font-semibold text-emerald-200" : "text-slate-200"}`}>{fmtAuditValue(k, log.after?.[k])}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <details className="mt-4 rounded-xl border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-400">Dados brutos (JSON)</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Antes</p>
                <pre className="scrollbar-thin max-h-72 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-slate-300">{log.before ? JSON.stringify(log.before, null, 2) : "null"}</pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Depois</p>
                <pre className="scrollbar-thin max-h-72 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-slate-300">{log.after ? JSON.stringify(log.after, null, 2) : "null"}</pre>
              </div>
            </div>
          </details>
        </>
      )}
    </Drawer>
  );
}
