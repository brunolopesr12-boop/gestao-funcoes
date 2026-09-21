/**
 * Busca da base de conhecimento (BM25 simples, com pesos por campo).
 *
 * Puro e determinístico. Usado:
 *   - no servidor, para escolher as fontes que vão para a IA;
 *   - no cliente, para a aba "Manual" e a pesquisa da administração;
 *   - no modo sem IA (busca), em que a melhor fonte vira a resposta.
 */
import { tokenize, uniqueTokens } from "./text";
import type { KnowledgeDoc } from "./knowledge";

export type SearchHit = {
  doc: KnowledgeDoc;
  /** pontuação BM25 (quanto maior, melhor) */
  score: number;
  /** fração dos termos da pergunta encontrados no documento (0-1) */
  coverage: number;
  /** termos da pergunta encontrados */
  matched: string[];
  /** termos encontrados que são raros na base (discriminantes) */
  strong: string[];
  /** termos encontrados no título ou na pergunta do documento */
  headMatched: string[];
  /** quantos termos úteis a pergunta tinha */
  termCount: number;
};

const FIELD_WEIGHTS = {
  title: 4,
  question: 4,
  keywords: 3,
  category: 1.5,
  body: 1,
} as const;

type IndexedDoc = {
  doc: KnowledgeDoc;
  tf: Map<string, number>;
  /** termos que aparecem no título ou na pergunta (valem bônus) */
  head: Set<string>;
  length: number;
};

export type SearchIndex = {
  docs: IndexedDoc[];
  df: Map<string, number>;
  avgLength: number;
  size: number;
};

export function buildIndex(docs: KnowledgeDoc[]): SearchIndex {
  const indexed: IndexedDoc[] = [];
  const df = new Map<string, number>();
  let total = 0;

  for (const doc of docs) {
    const tf = new Map<string, number>();
    let length = 0;
    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) {
        tf.set(t, (tf.get(t) ?? 0) + weight);
        length += weight;
      }
    };
    add(doc.title, FIELD_WEIGHTS.title);
    add(doc.question, FIELD_WEIGHTS.question);
    add(doc.keywords, FIELD_WEIGHTS.keywords);
    add(doc.category, FIELD_WEIGHTS.category);
    add(doc.body, FIELD_WEIGHTS.body);
    const head = new Set([...tokenize(doc.title), ...tokenize(doc.question)]);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    indexed.push({ doc, tf, head, length });
    total += length;
  }

  return {
    docs: indexed,
    df,
    avgLength: indexed.length ? total / indexed.length : 1,
    size: indexed.length,
  };
}

const K1 = 1.2;
const B = 0.75;
/** bônus (proporcional ao idf) para termo encontrado no título/pergunta */
const HEAD_BONUS = 0.6;
/** idf a partir do qual um termo é considerado "discriminante" */
const STRONG_IDF = 0.3;

function idf(index: SearchIndex, term: string): number {
  const n = index.df.get(term) ?? 0;
  return Math.log(1 + (index.size - n + 0.5) / (n + 0.5));
}

export type SearchOptions = {
  limit?: number;
  /** cobertura mínima (0-1) para considerar o documento candidato */
  minCoverage?: number;
};

export function search(index: SearchIndex, query: string, opts: SearchOptions = {}): SearchHit[] {
  const terms = uniqueTokens(query);
  if (terms.length === 0 || index.size === 0) return [];
  const limit = opts.limit ?? 8;
  const minCoverage = opts.minCoverage ?? 0;

  const hits: SearchHit[] = [];
  for (const { doc, tf, head, length } of index.docs) {
    let score = 0;
    const matched: string[] = [];
    const strong: string[] = [];
    const headMatched: string[] = [];
    for (const term of terms) {
      const f = tf.get(term);
      if (!f) continue;
      const termIdf = idf(index, term);
      const norm = f * (K1 + 1) / (f + K1 * (1 - B + (B * length) / index.avgLength));
      score += termIdf * norm;
      if (head.has(term)) {
        score += termIdf * HEAD_BONUS;
        headMatched.push(term);
      }
      matched.push(term);
      if (termIdf >= STRONG_IDF) strong.push(term);
    }
    if (matched.length === 0) continue;
    const coverage = matched.length / terms.length;
    if (coverage < minCoverage) continue;
    // desempate: cobertura e peso do tipo de documento
    score = score * (0.6 + 0.4 * coverage) * doc.weight;
    hits.push({ doc, score, coverage, matched, strong, headMatched, termCount: terms.length });
  }

  hits.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, "pt-BR"));
  return hits.slice(0, limit);
}

/**
 * Decide se a melhor resposta é confiável o bastante para ser mostrada
 * sem IA (modo busca). Regras:
 *   - cobre pelo menos metade dos termos da pergunta;
 *   - pelo menos um termo discriminante (raro na base);
 *   - com 2+ termos na pergunta, ou casa 2+ termos, ou casa no título /
 *     pergunta do documento — um verbo solto no meio do texto
 *     ("registre…") não basta para afirmar que é o procedimento certo.
 */
export function isConfident(hit: SearchHit | undefined): boolean {
  if (!hit) return false;
  if (hit.coverage < 0.5 || hit.strong.length === 0) return false;
  if (hit.termCount <= 1) return true;
  return hit.matched.length >= 2 || hit.headMatched.length >= 1;
}

/** Candidatos a fonte para a IA: os melhores, com pelo menos um termo forte. */
export function candidatesForAI(hits: SearchHit[], max = 6): SearchHit[] {
  const withStrong = hits.filter((h) => h.strong.length > 0);
  return (withStrong.length ? withStrong : hits).slice(0, max);
}

/** Atalho: monta o índice e busca de uma vez (para listas pequenas). */
export function quickSearch(docs: KnowledgeDoc[], query: string, opts?: SearchOptions): SearchHit[] {
  return search(buildIndex(docs), query, opts);
}
