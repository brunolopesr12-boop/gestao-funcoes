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
  /** fração do título do documento coberta pela pergunta (0-1) */
  titleCoverage: number;
  /** quantos termos úteis a pergunta tinha */
  termCount: number;
};

const FIELD_WEIGHTS = {
  title: 4,
  question: 4,
  keywords: 3,
  category: 0.8,
  body: 1,
} as const;

type IndexedDoc = {
  doc: KnowledgeDoc;
  tf: Map<string, number>;
  /** termos do título ou da pergunta cadastrada (valem bônus na pontuação) */
  head: Set<string>;
  /** termos só do título (medem se o documento é mesmo sobre o assunto) */
  title: Set<string>;
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
    const title = new Set(tokenize(doc.title));
    const head = new Set([...title, ...tokenize(doc.question)]);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    indexed.push({ doc, tf, head, title, length });
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
  for (const { doc, tf, head, title, length } of index.docs) {
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
    hits.push({
      doc,
      score,
      coverage,
      matched,
      strong,
      headMatched,
      titleCoverage: title.size
        ? matched.filter((t) => title.has(t)).length / title.size
        : 0,
      termCount: terms.length,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, "pt-BR"));
  return hits.slice(0, limit);
}

/**
 * Decide se a melhor resposta é confiável o bastante para ser mostrada
 * sem IA (modo busca). Três exigências, todas necessárias:
 *   1. a pergunta precisa estar coberta: metade dos termos encontrados;
 *   2. pelo menos um termo discriminante (raro na base);
 *   3. o documento precisa ser mesmo SOBRE o assunto: a pergunta cobre
 *      metade do título dele, ou casa 2+ termos.
 *
 * A terceira regra é o que impede uma resposta inventada por coincidência:
 * em "Posso dar desconto para o cliente?" a palavra "cliente" aparece no
 * título "Cliente reclamando do pedido", mas a regra de reclamação não é
 * sobre desconto — e o documento cobre só 1/3 do próprio título.
 */
export function isConfident(hit: SearchHit | undefined): boolean {
  if (!hit) return false;
  if (hit.coverage < 0.5 || hit.strong.length === 0) return false;
  return hit.titleCoverage >= 0.5 || hit.matched.length >= 2;
}

/**
 * Candidatos a fonte para a IA.
 *
 * Mais permissivo que `isConfident` (quem decide é o modelo), mas ainda
 * exige alguma relação de verdade: um termo discriminante e, além disso,
 * 2+ termos casados, metade do título coberto, ou metade da pergunta
 * coberta. Assim uma palavra solta ("funciona") não arrasta um documento
 * qualquer para dentro do prompt — o que gastaria tokens e daria ao modelo
 * a chance de errar.
 */
export function candidatesForAI(hits: SearchHit[], max = 6): SearchHit[] {
  return hits
    .filter(
      (h) =>
        h.strong.length > 0 &&
        (h.matched.length >= 2 || h.titleCoverage >= 0.5 || h.coverage >= 0.5),
    )
    .slice(0, max);
}

/** Atalho: monta o índice e busca de uma vez (para listas pequenas). */
export function quickSearch(docs: KnowledgeDoc[], query: string, opts?: SearchOptions): SearchHit[] {
  return search(buildIndex(docs), query, opts);
}
