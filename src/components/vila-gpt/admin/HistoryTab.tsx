"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, Select, TextInput } from "@/components/ui";
import { AnswerText } from "@/components/vila-gpt/AnswerText";
import { useData } from "@/lib/store";
import { sortedCompanies } from "@/lib/selectors";
import { fmtDateTime } from "@/lib/format";
import type { GptQuestion } from "@/lib/types";

const MODE_LABEL: Record<string, string> = {
  ia: "IA",
  busca: "busca",
  sem_resposta: "sem resposta",
};

/** Aba "Perguntas": quem perguntou o quê, quando, e o que foi respondido. */
export function HistoryTab({
  rows,
  loading,
  onReload,
  onCreateFrom,
  onDelete,
}: {
  rows: GptQuestion[] | null;
  loading: boolean;
  onReload: () => void;
  onCreateFrom: (q: GptQuestion) => void;
  onDelete: (id: string) => void;
}) {
  const { data } = useData();
  const companies = sortedCompanies(data);
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [filter, setFilter] = useState<"" | "nao_encontrou" | "negativo">("");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (companyId && r.company_id !== companyId) return false;
      if (filter === "nao_encontrou" && r.found) return false;
      if (filter === "negativo" && r.helpful !== false) return false;
      if (!q) return true;
      return (
        r.question.toLowerCase().includes(q) ||
        r.answer.toLowerCase().includes(q) ||
        r.employee_name.toLowerCase().includes(q)
      );
    });
  }, [rows, query, companyId, filter]);

  const companyName = (id: string | null) =>
    companies.find((c) => c.id === id)?.name ?? "";

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔎 Buscar por pergunta, resposta ou funcionário…"
        />
        <Button variant="soft" onClick={onReload} disabled={loading} aria-label="Atualizar">
          {loading ? "…" : "↻"}
        </Button>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="!py-2 text-sm">
          <option value="">Todas as empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="!py-2 text-sm"
        >
          <option value="">Todas as perguntas</option>
          <option value="nao_encontrou">Só sem resposta</option>
          <option value="negativo">Só com 👎</option>
        </Select>
      </div>

      {rows === null ? (
        <p className="text-center text-sm text-slate-500">Carregando…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          emoji="🕓"
          title="Nenhuma pergunta registrada"
          description="Cada pergunta feita ao VILA GPT aparece aqui com funcionário, data, resposta e fonte."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((r) => {
            const isOpen = open === r.id;
            return (
              <div key={r.id} className={`card p-3.5 ${!r.found ? "border-amber-500/30" : ""}`}>
                <button onClick={() => setOpen(isOpen ? null : r.id)} className="w-full text-left">
                  <div className="flex items-start gap-2">
                    <span className="text-lg leading-none">{r.found ? "✅" : "⚠️"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-snug">{r.question}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {r.employee_name || "sem nome"} · {fmtDateTime(r.created_at)}
                        {r.company_id ? ` · ${companyName(r.company_id)}` : ""} ·{" "}
                        {MODE_LABEL[r.mode] ?? r.mode}
                        {r.helpful === true ? " · 👍" : r.helpful === false ? " · 👎" : ""}
                      </p>
                    </div>
                    <span className="text-slate-600">{isOpen ? "▾" : "▸"}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-3 border-t border-[var(--line)] pt-3">
                    <AnswerText text={r.answer} className="text-sm" />
                    {r.sources?.length > 0 && (
                      <p className="mt-2 text-xs text-slate-500">
                        📎 Fonte: {r.sources.map((s) => s.label).join(" · ")}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!r.found && (
                        <Button size="sm" variant="primary" onClick={() => onCreateFrom(r)}>
                          + Criar procedimento para esta dúvida
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="!text-rose-400" onClick={() => onDelete(r.id)}>
                        Excluir registro
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {rows && rows.length >= 1000 && (
        <p className="mt-4 text-center text-xs text-slate-600">Mostrando as 1000 perguntas mais recentes.</p>
      )}
    </div>
  );
}
