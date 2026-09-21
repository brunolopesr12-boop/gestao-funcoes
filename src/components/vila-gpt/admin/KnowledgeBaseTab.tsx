"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, EmptyState, SectionTitle, Select, TextInput } from "@/components/ui";
import { useData } from "@/lib/store";
import { sortedCompanies } from "@/lib/selectors";
import { fmtRelative } from "@/lib/format";
import type { KnowledgeDoc } from "@/lib/vila-gpt/knowledge";
import { quickSearch } from "@/lib/vila-gpt/retrieval";
import { KB_KINDS, KB_KIND_META, type KbArticle } from "@/lib/types";

/**
 * Aba "Base": tudo que está cadastrado, com busca e filtros.
 * Artigos abrem para edição; dados do sistema (funções, processos…) são
 * somente leitura aqui e têm link para o módulo de origem.
 */
export function KnowledgeBaseTab({
  docs,
  onNew,
  onEdit,
  onOpen,
}: {
  docs: KnowledgeDoc[];
  onNew: () => void;
  onEdit: (a: KbArticle) => void;
  onOpen: (d: KnowledgeDoc) => void;
}) {
  const { data } = useData();
  const companies = sortedCompanies(data);
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState<"" | "oficial" | "rascunho">("");
  const [system, setSystem] = useState(false);

  const filtered = useMemo(() => {
    let list = docs.filter((d) => (system ? true : d.kind === "kb"));
    if (companyId) list = list.filter((d) => !d.companyId || d.companyId === companyId);
    if (kind) list = list.filter((d) => (d.article ? d.article.kind === kind : kind === "sistema_dados"));
    if (status === "oficial") list = list.filter((d) => !d.article || d.article.official);
    if (status === "rascunho") list = list.filter((d) => d.article && !d.article.official);
    if (query.trim()) return quickSearch(list, query, { limit: 50 }).map((h) => h.doc);
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [docs, system, companyId, kind, status, query]);

  const articles = docs.filter((d) => d.article);
  const drafts = articles.filter((d) => d.article && !d.article.official).length;

  return (
    <div>
      <Button variant="primary" size="lg" full className="mb-4" onClick={onNew}>
        + Cadastrar informação oficial
      </Button>

      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔎 Pesquisar tudo que está cadastrado…"
        className="mb-2"
      />
      <div className="mb-2 grid grid-cols-3 gap-2">
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="!py-2 text-sm">
          <option value="">Todas as empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!py-2 text-sm">
          <option value="">Todos os tipos</option>
          {KB_KINDS.map((k) => (
            <option key={k} value={k}>
              {KB_KIND_META[k].emoji} {KB_KIND_META[k].label}
            </option>
          ))}
          {system && <option value="sistema_dados">🧩 Dados do sistema</option>}
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="!py-2 text-sm"
        >
          <option value="">Oficiais e rascunhos</option>
          <option value="oficial">Só oficiais</option>
          <option value="rascunho">Só rascunhos</option>
        </Select>
      </div>
      <label className="mb-4 flex items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={system}
          onChange={(e) => setSystem(e.target.checked)}
          className="h-4 w-4"
        />
        Mostrar também funções, processos, checklists e responsáveis (vêm dos outros módulos)
      </label>

      <SectionTitle
        hint={`${articles.length} ${articles.length === 1 ? "informação cadastrada" : "informações cadastradas"}${drafts ? ` · ${drafts} em rascunho` : ""}`}
      >
        Base de conhecimento
      </SectionTitle>

      {filtered.length === 0 ? (
        <EmptyState
          emoji="📚"
          title={query ? "Nada encontrado" : "Nenhuma informação cadastrada"}
          description={
            query
              ? "Tente outras palavras ou cadastre esta informação."
              : "Cadastre procedimentos, regras, perguntas e respostas, fichas técnicas e cardápios. O VILA GPT só responde com o que estiver aqui e nos outros módulos."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const a = d.article;
            return (
              <div key={d.id} className="card flex items-center gap-3 p-3.5">
                <button onClick={() => onOpen(d)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="text-2xl">{d.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{d.title}</p>
                      {a && !a.official && (
                        <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                          rascunho
                        </span>
                      )}
                      {!a && (
                        <span className="shrink-0 rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
                          sistema
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {d.kindLabel}
                      {d.category ? ` · ${d.category}` : ""} · {d.companyName}
                      {d.updatedAt ? ` · ${fmtRelative(d.updatedAt)}` : ""}
                    </p>
                  </div>
                </button>
                {a ? (
                  <button
                    onClick={() => onEdit(a)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white/10"
                    aria-label="Editar"
                  >
                    ✏️
                  </button>
                ) : (
                  <Link
                    href={d.href}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white/10"
                    aria-label="Abrir no sistema"
                    title="Editar no módulo de origem"
                  >
                    ↗
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
