/**
 * Painel do VILA GPT: dúvidas mais frequentes, perguntas sem resposta e
 * alertas de treinamento. Puro, a partir das linhas de gpt_questions.
 */
import type { GptQuestion, GptSource } from "../types";
import { topicKey } from "./text";

export const DAY_MS = 86_400_000;

/** Define a chave e o rótulo do assunto de uma pergunta. */
export function topicOf(
  question: string,
  found: boolean,
  topSource: GptSource | null,
): { topic: string; topic_label: string } {
  if (found && topSource) {
    return { topic: `src:${topSource.id}`, topic_label: topSource.title };
  }
  const key = topicKey(question);
  return {
    topic: key ? `q:${key}` : "q:vazio",
    topic_label: question.trim(),
  };
}

export type TopicStat = {
  topic: string;
  label: string;
  count: number;
  /** quantos funcionários diferentes perguntaram */
  people: number;
  /** quantas vezes a base não tinha resposta */
  notFound: number;
  /** feedback negativo */
  unhelpful: number;
  lastAt: string;
  samples: string[];
  source: GptSource | null;
};

export type TopicOptions = {
  /** janela em dias (padrão 30) */
  days?: number;
  now?: number;
  companyId?: string | null;
};

export function inWindow(row: GptQuestion, days: number, now: number): boolean {
  const t = new Date(row.created_at).getTime();
  return !Number.isNaN(t) && now - t <= days * DAY_MS;
}

export function topicStats(rows: GptQuestion[], opts: TopicOptions = {}): TopicStat[] {
  const days = opts.days ?? 30;
  const now = opts.now ?? Date.now();
  const map = new Map<string, TopicStat & { peopleSet: Set<string> }>();

  for (const row of rows) {
    if (opts.companyId && row.company_id && row.company_id !== opts.companyId) continue;
    if (!inWindow(row, days, now)) continue;
    const key = row.topic || `q:${topicKey(row.question)}`;
    let stat = map.get(key);
    if (!stat) {
      stat = {
        topic: key,
        label: row.topic_label || row.question,
        count: 0,
        people: 0,
        notFound: 0,
        unhelpful: 0,
        lastAt: row.created_at,
        samples: [],
        source: row.found ? (row.sources?.[0] ?? null) : null,
        peopleSet: new Set(),
      };
      map.set(key, stat);
    }
    stat.count += 1;
    if (row.employee_name.trim()) stat.peopleSet.add(row.employee_name.trim().toLowerCase());
    if (!row.found) stat.notFound += 1;
    if (row.helpful === false) stat.unhelpful += 1;
    if (row.created_at > stat.lastAt) stat.lastAt = row.created_at;
    if (stat.samples.length < 3 && !stat.samples.includes(row.question)) {
      stat.samples.push(row.question);
    }
  }

  return [...map.values()]
    .map(({ peopleSet, ...s }) => ({ ...s, people: peopleSet.size }))
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

export type HotOptions = { minCount?: number; minPeople?: number };

/** Assuntos que estão gerando muitas dúvidas → sugerir treinamento. */
export function hotTopics(stats: TopicStat[], opts: HotOptions = {}): TopicStat[] {
  const minCount = opts.minCount ?? 3;
  const minPeople = opts.minPeople ?? 2;
  return stats.filter((s) => s.count >= minCount && s.people >= minPeople);
}

export const HOT_TOPIC_MESSAGE =
  "Este assunto está gerando muitas dúvidas. Considere criar ou atualizar um treinamento.";

export type Summary = {
  total: number;
  found: number;
  notFound: number;
  last7: number;
  last30: number;
  helpfulYes: number;
  helpfulNo: number;
  people: number;
};

export function summarize(rows: GptQuestion[], now = Date.now()): Summary {
  const people = new Set<string>();
  const s: Summary = {
    total: rows.length,
    found: 0,
    notFound: 0,
    last7: 0,
    last30: 0,
    helpfulYes: 0,
    helpfulNo: 0,
    people: 0,
  };
  for (const r of rows) {
    if (r.found) s.found += 1;
    else s.notFound += 1;
    if (inWindow(r, 7, now)) s.last7 += 1;
    if (inWindow(r, 30, now)) s.last30 += 1;
    if (r.helpful === true) s.helpfulYes += 1;
    if (r.helpful === false) s.helpfulNo += 1;
    if (r.employee_name.trim()) people.add(r.employee_name.trim().toLowerCase());
  }
  s.people = people.size;
  return s;
}

/** Perguntas sem resposta, agrupadas, mais recentes primeiro. */
export function unansweredTopics(rows: GptQuestion[], opts: TopicOptions = {}): TopicStat[] {
  return topicStats(rows.filter((r) => !r.found), { ...opts, days: opts.days ?? 90 }).sort(
    (a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt),
  );
}

/**
 * Assuntos oficiais mais perguntados (para sugerir na tela do chat).
 * Só assuntos ligados a uma fonte, perguntados mais de uma vez — nunca o
 * texto solto que um funcionário digitou.
 */
export function frequentTopics(rows: GptQuestion[], opts: TopicOptions & { limit?: number } = {}): TopicStat[] {
  const limit = opts.limit ?? 6;
  return topicStats(rows.filter((r) => r.found), { ...opts, days: opts.days ?? 60 })
    .filter((s) => s.topic.startsWith("src:") && s.source && s.count >= 2)
    .slice(0, limit);
}
