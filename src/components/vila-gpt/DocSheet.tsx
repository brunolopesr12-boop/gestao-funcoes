"use client";

import Link from "next/link";
import { Sheet } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { KnowledgeDoc } from "@/lib/vila-gpt/knowledge";
import { AnswerText } from "./AnswerText";

/** Mostra um documento da base (artigo, função, processo, checklist…). */
export function DocSheet({
  doc,
  onClose,
  adminHref,
}: {
  doc: KnowledgeDoc | null;
  onClose: () => void;
  /** link para editar (só na administração) */
  adminHref?: string;
}) {
  return (
    <Sheet open={Boolean(doc)} onClose={onClose} title={doc ? `${doc.emoji} ${doc.title}` : ""}>
      {doc && (
        <>
          <p className="mb-3 text-xs text-slate-400">
            {doc.kindLabel}
            {doc.category ? ` · ${doc.category}` : ""}
            {doc.companyName ? ` · ${doc.companyName}` : ""}
            {doc.updatedAt ? ` · atualizado em ${fmtDate(doc.updatedAt)}` : ""}
          </p>
          {doc.question && (
            <p className="mb-3 rounded-xl border border-[var(--line)] bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
              ❓ {doc.question}
            </p>
          )}
          <div className="card p-4">
            <AnswerText text={doc.body} />
          </div>
          <p className="mt-3 text-xs text-slate-500">Fonte: {doc.label}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {!doc.href.startsWith("/vila-gpt") && (
              <Link
                href={doc.href}
                className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200"
              >
                Abrir no sistema →
              </Link>
            )}
            {adminHref && doc.article && (
              <Link
                href={adminHref}
                className="rounded-xl border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-semibold text-blue-100"
              >
                ✏️ Editar
              </Link>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
