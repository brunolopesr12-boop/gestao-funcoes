"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, SectionTitle, Select, Stat } from "@/components/ui";
import type { ArticleDraft } from "@/components/vila-gpt/ArticleSheet";
import { useData } from "@/lib/store";
import { sortedCompanies } from "@/lib/selectors";
import { fmtRelative } from "@/lib/format";
import {
  HOT_TOPIC_MESSAGE,
  hotTopics,
  summarize,
  topicStats,
  unansweredTopics,
  type TopicStat,
} from "@/lib/vila-gpt/analytics";
import type { GptQuestion, KbArticle } from "@/lib/types";

/** Aba "Painel": dúvidas mais frequentes, alertas de treinamento e perguntas sem resposta. */
export function DashboardTab({
  rows,
  loading,
  onReload,
  onCreate,
  onEdit,
}: {
  rows: GptQuestion[] | null;
  loading: boolean;
  onReload: () => void;
  onCreate: (draft: ArticleDraft) => void;
  onEdit: (a: KbArticle) => void;
}) {
  const { data } = useData();
  const companies = sortedCompanies(data);
  const [companyId, setCompanyId] = useState("");
  const [days, setDays] = useState(30);

  const scoped = useMemo(
    () => (rows ?? []).filter((r) => !companyId || r.company_id === companyId),
    [rows, companyId],
  );
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const stats = useMemo(() => topicStats(scoped, { days }), [scoped, days]);
  const hot = useMemo(() => hotTopics(stats), [stats]);
  const unanswered = useMemo(() => unansweredTopics(scoped, { days: 90 }), [scoped]);
  const negative = useMemo(
    () => scoped.filter((r) => r.helpful === false).slice(0, 10),
    [scoped],
  );

  const articleOf = (t: TopicStat): KbArticle | null => {
    const id = t.source?.id ?? "";
    if (!id.startsWith("kb:")) return null;
    return data.kb_articles.find((a) => a.id === id.slice(3)) ?? null;
  };

  const act = (t: TopicStat) => {
    const a = articleOf(t);
    if (a) onEdit(a);
    else
      onCreate({
        title: t.label.replace(/\?+$/, ""),
        question: t.samples[0] ?? t.label,
        company_id: companyId || null,
      });
  };

  const pct = summary.total ? Math.round((summary.found / summary.total) * 100) : 0;

  return (
    <div>
      <div className="mb-4 grid grid-cols-[1fr_auto_auto] gap-2">
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="!py-2 text-sm">
          <option value="">Todas as empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </Select>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="!py-2 text-sm">
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </Select>
        <Button variant="soft" onClick={onReload} disabled={loading} aria-label="Atualizar">
          {loading ? "…" : "↻"}
        </Button>
      </div>

      {rows === null ? (
        <p className="text-center text-sm text-slate-500">Carregando…</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-2">
            <Stat label="Últimos 7 dias" value={summary.last7} tone="blue" emoji="💬" />
            <Stat label="Respondidas" value={`${pct}%`} tone={pct >= 80 ? "green" : pct >= 50 ? "amber" : "red"} emoji="✅" />
            <Stat label="Sem resposta" value={summary.notFound} tone={summary.notFound ? "amber" : "slate"} emoji="⚠️" />
          </div>

          {hot.length > 0 && (
            <div className="mb-6">
              <SectionTitle hint="Vários funcionários perguntando a mesma coisa">
                Precisa de treinamento
              </SectionTitle>
              <div className="space-y-2">
                {hot.map((t) => (
                  <div key={t.topic} className="card border-amber-500/40 bg-amber-500/10 p-4">
                    <p className="font-semibold text-amber-100">🎓 {t.label}</p>
                    <p className="mt-1 text-sm text-amber-200/90">{HOT_TOPIC_MESSAGE}</p>
                    <p className="mt-1 text-xs text-amber-200/70">
                      {t.count} perguntas · {t.people} {t.people === 1 ? "pessoa" : "pessoas"} · última{" "}
                      {fmtRelative(t.lastAt)}
                      {t.notFound ? ` · ${t.notFound} sem resposta` : ""}
                    </p>
                    <Button size="sm" variant="primary" className="mt-3" onClick={() => act(t)}>
                      {articleOf(t) ? "Atualizar procedimento" : "Criar procedimento / treinamento"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6">
            <SectionTitle hint={`Assuntos mais perguntados nos últimos ${days} dias`}>
              Dúvidas mais frequentes
            </SectionTitle>
            {stats.length === 0 ? (
              <EmptyState emoji="📊" title="Sem perguntas no período" />
            ) : (
              <ul className="card divide-y divide-[var(--line)]">
                {stats.slice(0, 12).map((t, i) => (
                  <li key={t.topic} className="flex items-center gap-3 p-3.5">
                    <span className="w-6 text-center text-sm font-bold text-slate-500">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">
                        {t.source ? "✅ " : "⚠️ "}
                        {t.label}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {t.count}× · {t.people} {t.people === 1 ? "pessoa" : "pessoas"}
                        {t.unhelpful ? ` · ${t.unhelpful} 👎` : ""}
                        {t.samples[0] && t.samples[0] !== t.label ? ` · “${t.samples[0]}”` : ""}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => act(t)}>
                      {articleOf(t) ? "Editar" : "Criar"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mb-6">
            <SectionTitle hint="A base oficial não tinha resposta — cadastre e o VILA GPT passa a responder">
              Perguntas sem resposta
            </SectionTitle>
            {unanswered.length === 0 ? (
              <EmptyState emoji="🎉" title="Tudo respondido" description="Nenhuma pergunta ficou sem resposta nos últimos 90 dias." />
            ) : (
              <div className="space-y-2">
                {unanswered.slice(0, 12).map((t) => (
                  <div key={t.topic} className="card flex items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-snug">{t.label}</p>
                      <p className="text-xs text-slate-400">
                        {t.count}× · {t.people} {t.people === 1 ? "pessoa" : "pessoas"} · {fmtRelative(t.lastAt)}
                      </p>
                    </div>
                    <Button size="sm" variant="primary" onClick={() => act(t)}>
                      + Criar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {negative.length > 0 && (
            <div className="mb-6">
              <SectionTitle hint="O funcionário marcou 👎 — vale revisar o texto da fonte">
                Respostas que não ajudaram
              </SectionTitle>
              <ul className="card divide-y divide-[var(--line)]">
                {negative.map((r) => (
                  <li key={r.id} className="p-3.5">
                    <p className="text-[15px] font-semibold leading-snug">{r.question}</p>
                    <p className="text-xs text-slate-400">
                      {r.employee_name || "sem nome"} · {fmtRelative(r.created_at)}
                      {r.sources?.[0] ? ` · ${r.sources[0].label}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-center text-xs text-slate-600">
            {summary.total} perguntas registradas · {summary.people}{" "}
            {summary.people === 1 ? "funcionário" : "funcionários"} · 👍 {summary.helpfulYes} · 👎{" "}
            {summary.helpfulNo}
          </p>
        </>
      )}
    </div>
  );
}
