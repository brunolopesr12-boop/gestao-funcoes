"use client";

import { useState } from "react";
import { Button, ConfirmSheet, Field, Select, Sheet, TextArea, TextInput } from "@/components/ui";
import { useData } from "@/lib/store";
import { sortedCompanies } from "@/lib/selectors";
import { createArticle, deleteArticle, updateArticle } from "@/lib/vila-gpt/client";
import { KB_CATEGORIES, KB_KINDS, KB_KIND_META, type KbArticle, type KbKind } from "@/lib/types";

export type ArticleDraft = Partial<
  Pick<KbArticle, "company_id" | "kind" | "category" | "title" | "question" | "content" | "keywords" | "official">
>;

/**
 * Formulário de artigo da base de conhecimento (criar / editar / excluir).
 * Grava pelo servidor (só administradores) e recarrega os dados.
 */
export function ArticleSheet({
  open,
  onClose,
  article,
  draft,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** artigo existente (edição) */
  article: KbArticle | null;
  /** valores iniciais para um artigo novo */
  draft?: ArticleDraft;
  onSaved?: (a: KbArticle) => void;
}) {
  const { data, trainer, refresh, notify } = useData();
  const companies = sortedCompanies(data);

  const [companyId, setCompanyId] = useState<string>("");
  const [kind, setKind] = useState<KbKind>("procedimento");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [official, setOfficial] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState("");

  const currentKey = `${article?.id ?? "novo"}-${open}-${draft?.title ?? ""}-${draft?.question ?? ""}`;
  if (key !== currentKey) {
    setKey(currentKey);
    const src: ArticleDraft = article ?? draft ?? {};
    setCompanyId(src.company_id ?? "");
    setKind(src.kind ?? "procedimento");
    setCategory(src.category ?? "");
    setTitle(src.title ?? "");
    setQuestion(src.question ?? "");
    setContent(src.content ?? "");
    setKeywords(src.keywords ?? "");
    setOfficial(src.official ?? true);
  }

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const payload = {
        company_id: companyId || null,
        kind,
        category: category.trim(),
        title: title.trim(),
        question: question.trim(),
        content: content.trim(),
        keywords: keywords.trim(),
        official,
        updated_by: trainer || "",
      };
      const res = article
        ? await updateArticle(article.id, payload)
        : await createArticle(payload);
      await refresh();
      notify(article ? "Informação atualizada" : "Informação cadastrada");
      onSaved?.(res.article);
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao salvar", "erro");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!article) return;
    try {
      await deleteArticle(article.id, trainer || "");
      await refresh();
      notify("Informação excluída");
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao excluir", "erro");
    }
  };

  const meta = KB_KIND_META[kind];

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={article ? "Editar informação" : "Nova informação"}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as KbKind)}>
              {KB_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KB_KIND_META[k].emoji} {KB_KIND_META[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Empresa">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Todas as empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="-mt-2 mb-4 text-xs text-slate-500">{meta.hint}.</p>

        <Field label="Título" hint='Ex.: "Fechamento de caixa", "Strogonoff de frango"'>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nome do procedimento, regra ou item"
            autoFocus={!article}
          />
        </Field>

        <Field label="Área" hint="Para organizar o manual">
          <TextInput
            list="kb-categorias"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Ex.: Caixa, Cozinha, Delivery…"
          />
          <datalist id="kb-categorias">
            {KB_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Como o funcionário perguntaria"
          hint="Opcional, mas ajuda muito a busca. Ex.: “Como faço o fechamento do caixa?”"
        >
          <TextInput
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="A dúvida, do jeito que ela aparece no dia a dia"
          />
        </Field>

        <Field
          label="Conteúdo oficial"
          hint="Um passo por linha (1. 2. 3.). O VILA GPT responde exatamente com base nisto."
        >
          <TextArea
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"1. Faça X.\n2. Depois faça Y.\n3. Confira Z.\n4. Finalize no sistema."}
          />
        </Field>

        <Field label="Palavras-chave e sinônimos" hint="Separadas por vírgula. Ex.: fechar caixa, gaveta, troco">
          <TextInput
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Outros jeitos de chamar a mesma coisa"
          />
        </Field>

        <button
          type="button"
          onClick={() => setOfficial((v) => !v)}
          className="mb-5 flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-white/[0.03] p-3.5 text-left"
        >
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-xs ${
              official ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-600"
            }`}
          >
            {official ? "✓" : ""}
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-slate-200">
              Informação oficial
            </span>
            <span className="block text-xs text-slate-400">
              {official
                ? "O VILA GPT usa esta informação nas respostas."
                : "Rascunho: fica salvo, mas o VILA GPT NÃO usa nas respostas."}
            </span>
          </span>
        </button>

        <Button
          variant="primary"
          size="lg"
          full
          onClick={save}
          disabled={!title.trim() || (!content.trim() && !question.trim()) || saving}
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>

        {article && (
          <Button
            variant="ghost"
            full
            className="mt-3 !text-rose-400"
            onClick={() => setConfirmDelete(true)}
          >
            Excluir informação
          </Button>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Excluir informação?"
        message={`"${article?.title ?? ""}" sai da base oficial e o VILA GPT deixa de usá-la. Não dá para desfazer.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
