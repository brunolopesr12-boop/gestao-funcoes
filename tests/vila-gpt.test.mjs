// Testes do VILA GPT: texto, base de conhecimento, busca e painel.
// Rode com: npm test
import test from "node:test";
import assert from "node:assert/strict";

import { normalize, stem, tokenize, uniqueTokens, topicKey } from "../.tmp-test/vila-gpt/text.js";
import { buildKnowledge, groupByCategory } from "../.tmp-test/vila-gpt/knowledge.js";
import {
  buildIndex,
  candidatesForAI,
  isConfident,
  quickSearch,
  search,
} from "../.tmp-test/vila-gpt/retrieval.js";
import {
  frequentQuestions,
  hotTopics,
  summarize,
  topicOf,
  topicStats,
  unansweredTopics,
} from "../.tmp-test/vila-gpt/analytics.js";

/* ---------------------------------------------------------------- */
/* Fixtures                                                          */
/* ---------------------------------------------------------------- */

const T = "2026-09-01T10:00:00.000Z";
const C1 = "c1";
const C2 = "c2";

const article = (id, over = {}) => ({
  id,
  company_id: null,
  kind: "procedimento",
  category: "Caixa",
  title: "",
  question: "",
  content: "",
  keywords: "",
  official: true,
  position: 0,
  updated_by: "",
  created_at: T,
  updated_at: T,
  ...over,
});

const base = () => ({
  companies: [
    { id: C1, name: "Sr. Strogonoff", emoji: "👨‍🍳", color: "#000", notes: "", active: true, position: 0, created_at: T, updated_at: T },
    { id: C2, name: "Vila Rica", emoji: "🏪", color: "#000", notes: "", active: true, position: 1, created_at: T, updated_at: T },
  ],
  roles: [
    { id: "r1", company_id: C1, name: "Montador de pedidos", description: "Monta os pedidos do delivery.", responsibilities: "Conferir cada pedido antes de sair\nManter a bancada limpa", emoji: "📦", position: 0, active: true, created_at: T, updated_at: T },
    { id: "r2", company_id: C2, name: "Caixa", description: "", responsibilities: "", emoji: "💵", position: 0, active: true, created_at: T, updated_at: T },
  ],
  competencies: [{ id: "k1", role_id: "r1", name: "agilidade", position: 0, created_at: T }],
  checklist_items: [{ id: "ck1", role_id: "r1", text: "Conferir estoque de embalagens no início do turno", position: 0, created_at: T }],
  processes: [
    { id: "p1", role_id: "r1", name: "Fazer arroz", description: "1. Lave o arroz.\n2. Refogue com alho.\n3. Cozinhe 18 minutos.", required: true, position: 0, created_at: T, updated_at: T },
    { id: "p2", role_id: "r1", name: "Montar pedido", description: "", required: true, position: 1, created_at: T, updated_at: T },
  ],
  employees: [
    { id: "e1", company_id: C1, name: "Ana", status: "ativo", hired_on: null, phone: "", notes: "", created_at: T, updated_at: T },
    { id: "e2", company_id: C1, name: "Bruno", status: "ativo", hired_on: null, phone: "", notes: "", created_at: T, updated_at: T },
    { id: "e3", company_id: C1, name: "Carla", status: "inativo", hired_on: null, phone: "", notes: "", created_at: T, updated_at: T },
  ],
  employee_roles: [
    { id: "l1", employee_id: "e1", role_id: "r1", kind: "atual", created_at: T },
    { id: "l2", employee_id: "e2", role_id: "r1", kind: "treinando", created_at: T },
    { id: "l3", employee_id: "e3", role_id: "r1", kind: "atual", created_at: T },
  ],
  training_steps: ["mostrei", "fez", "ensinou", "certifiquei"].flatMap((s) => [
    { id: `e1-p1-${s}`, employee_id: "e1", process_id: "p1", step: s, done_at: T, trainer: "", notes: "", created_at: T },
    { id: `e1-p2-${s}`, employee_id: "e1", process_id: "p2", step: s, done_at: T, trainer: "", notes: "", created_at: T },
  ]).concat([
    { id: "e2-p1-mostrei", employee_id: "e2", process_id: "p1", step: "mostrei", done_at: T, trainer: "", notes: "", created_at: T },
  ]),
  kb_articles: [
    article("a1", {
      company_id: C1,
      title: "Fechamento de caixa",
      question: "Como faço o fechamento do caixa?",
      content: "1. Confira os pedidos.\n2. Conte a gaveta.\n3. Emita o relatório.",
      keywords: "fechar caixa, gaveta, troco",
    }),
    article("a2", {
      kind: "regra",
      category: "Atendimento",
      title: "Cliente reclamando do pedido",
      question: "O que faço quando o cliente reclama?",
      content: "1. Ouça o cliente.\n2. Chame o gerente.",
      keywords: "reclamação, troca, reembolso",
    }),
    article("a3", {
      kind: "ficha_tecnica",
      category: "Cozinha",
      company_id: C1,
      title: "Strogonoff de frango",
      question: "Qual a quantidade de cada ingrediente do strogonoff de frango?",
      content: "1,5 kg de frango, 2 caixas de creme de leite, 200 g de ketchup.",
      keywords: "estrogonofe, receita",
    }),
    article("a4", {
      company_id: C2,
      title: "Abertura da loja",
      question: "Como abro a loja?",
      content: "1. Ligar as luzes.\n2. Ligar os equipamentos.",
      keywords: "abrir",
      official: false,
    }),
  ],
});

/* ---------------------------------------------------------------- */
/* Texto                                                             */
/* ---------------------------------------------------------------- */

test("normalize tira acentos, pontuação e caixa", () => {
  assert.equal(normalize("  Fechamento do CAIXA, hoje?! "), "fechamento do caixa hoje");
  assert.equal(normalize("Ação — coração"), "acao coracao");
});

test("stem reduz plural e sufixos comuns", () => {
  assert.equal(stem("pedidos"), stem("pedido"));
  assert.equal(stem("fechamento"), stem("fechar"));
  assert.equal(stem("limpeza"), stem("limpar"));
  assert.equal(stem("montagem"), stem("montar"));
  assert.equal(stem("operacoes"), stem("operacao"));
  assert.equal(stem("caixa"), "caix");
  assert.equal(stem("sal"), "sal");
});

test("tokenize remove palavras de pergunta e unifica sinônimos", () => {
  const t = tokenize("Como faço o fechamento do caixa?");
  assert.deepEqual(t, [stem("fechar"), stem("caixa")]);
  assert.deepEqual(uniqueTokens("Qual é o procedimento para abrir a loja?"), [
    stem("procedimento"),
    stem("abrir"),
    "loj",
  ]);
  // sinônimos: ifood ~ delivery ~ entrega
  assert.deepEqual(tokenize("problema no iFood"), tokenize("erro no delivery"));
  assert.deepEqual(tokenize("estrogonofe"), tokenize("strogonoff"));
});

test("topicKey é estável para perguntas parecidas", () => {
  assert.equal(topicKey("Como faço o fechamento do caixa?"), topicKey("como fechar o caixa"));
  assert.equal(topicKey(""), "");
});

/* ---------------------------------------------------------------- */
/* Base de conhecimento                                              */
/* ---------------------------------------------------------------- */

test("buildKnowledge junta artigos oficiais e dados do sistema", () => {
  const docs = buildKnowledge(base(), { companyId: C1 });
  const ids = docs.map((d) => d.id);
  assert.ok(ids.includes("kb:a1"), "artigo da empresa");
  assert.ok(ids.includes("kb:a2"), "artigo global");
  assert.ok(!ids.includes("kb:a4"), "rascunho de outra empresa não entra");
  assert.ok(ids.includes("role:r1"));
  assert.ok(ids.includes("checklist:r1"));
  assert.ok(ids.includes("process:p1"));
  assert.ok(ids.includes("who:role:r1"));
  assert.ok(ids.includes("who:process:p1"));
  assert.ok(!ids.includes("role:r2"), "função de outra empresa não entra");

  const role = docs.find((d) => d.id === "role:r1");
  assert.match(role.body, /Conferir cada pedido/);
  assert.match(role.body, /agilidade/);
  assert.equal(role.label, "Função — Montador de pedidos");
  assert.equal(role.href, `/empresa/${C1}/funcoes/r1`);

  const who = docs.find((d) => d.id === "who:role:r1");
  assert.match(who.body, /hoje: Ana\./);
  assert.match(who.body, /Em treinamento .*Bruno/);
  assert.match(who.body, /Aptos .*Ana/);
  assert.ok(!/Carla/.test(who.body), "inativo não aparece");

  const whoP = docs.find((d) => d.id === "who:process:p1");
  assert.match(whoP.body, /certificados\) "Fazer arroz": Ana/);
  assert.match(whoP.body, /Em treinamento: Bruno/);
});

test("buildKnowledge sem empresa inclui tudo; rascunhos só quando pedido", () => {
  const all = buildKnowledge(base());
  assert.ok(all.some((d) => d.id === "role:r2"));
  assert.ok(!all.some((d) => d.id === "kb:a4"));
  const admin = buildKnowledge(base(), { includeDrafts: true, includeSystem: false });
  assert.ok(admin.some((d) => d.id === "kb:a4"));
  assert.ok(!admin.some((d) => d.kind !== "kb"));
});

test("groupByCategory ordena por categoria e título", () => {
  const groups = groupByCategory(buildKnowledge(base(), { includeSystem: false }));
  assert.deepEqual(groups.map((g) => g.category), ["Atendimento", "Caixa", "Cozinha"]);
});

/* ---------------------------------------------------------------- */
/* Busca                                                             */
/* ---------------------------------------------------------------- */

test("search encontra o procedimento certo com sinônimos e variações", () => {
  const docs = buildKnowledge(base(), { companyId: C1 });
  const index = buildIndex(docs);

  const a = search(index, "Como faço o fechamento do caixa?");
  assert.equal(a[0].doc.id, "kb:a1");
  assert.ok(isConfident(a[0]));

  const b = search(index, "como fechar o caixa");
  assert.equal(b[0].doc.id, "kb:a1");

  const c = search(index, "O que faço quando o cliente reclama?");
  assert.equal(c[0].doc.id, "kb:a2");

  const d = search(index, "quantidade de ingredientes do estrogonofe");
  assert.equal(d[0].doc.id, "kb:a3");

  const e = search(index, "Como preparo o arroz?");
  assert.equal(e[0].doc.id, "process:p1");

  const f = search(index, "Quem sabe fazer arroz?");
  assert.equal(f[0].doc.id, "who:process:p1");

  const g = search(index, "Quem é responsável por montar os pedidos?");
  assert.ok(["who:role:r1", "role:r1", "who:process:p2"].includes(g[0].doc.id), g[0].doc.id);
});

test("search não inventa: pergunta fora da base não é confiável", () => {
  const docs = buildKnowledge(base(), { companyId: C1 });
  const index = buildIndex(docs);
  const hits = search(index, "Como funciona o plano de saúde?");
  assert.ok(!isConfident(hits[0]));
  assert.deepEqual(search(index, "como faço isso?"), [], "só stopwords");
  assert.deepEqual(candidatesForAI([]), []);
});

test("search não se deixa enganar por um verbo solto no meio do texto", () => {
  // "Cliente reclamando" manda "registrar a ocorrência"; a pergunta é sobre
  // registrar uma PERDA. Sem artigo de perdas, a resposta tem de ser "não achei".
  const docs = buildKnowledge(base(), { companyId: C1 });
  const hits = quickSearch(docs, "Como registro uma perda?");
  assert.ok(!isConfident(hits[0]), `não deveria confiar em ${hits[0]?.doc.id}`);

  // com o artigo certo cadastrado, ele vence e é confiável
  const d = base();
  d.kb_articles.push(
    article("a5", {
      title: "Registrar uma perda",
      question: "Como registro uma perda?",
      content: "1. Pese o produto.\n2. Lance no sistema em Perdas.",
      keywords: "perda, quebra, desperdício",
      category: "Perdas e devoluções",
    }),
  );
  const hits2 = quickSearch(buildKnowledge(d, { companyId: C1 }), "Como registro uma perda?");
  assert.equal(hits2[0].doc.id, "kb:a5");
  assert.ok(isConfident(hits2[0]));
});

test("candidatesForAI prioriza documentos com termos discriminantes", () => {
  const docs = buildKnowledge(base(), { companyId: C1 });
  const hits = quickSearch(docs, "procedimento para fechar o caixa", { limit: 10 });
  const cands = candidatesForAI(hits, 3);
  assert.ok(cands.length <= 3);
  assert.equal(cands[0].doc.id, "kb:a1");
  assert.ok(cands.every((h) => h.strong.length > 0));
});

/* ---------------------------------------------------------------- */
/* Painel                                                            */
/* ---------------------------------------------------------------- */

const q = (id, over = {}) => ({
  id,
  company_id: C1,
  employee_id: null,
  employee_name: "Ana",
  question: "Como faço o fechamento do caixa?",
  answer: "1. Confira…",
  sources: [{ id: "kb:a1", title: "Fechamento de caixa", label: "Procedimento — Fechamento de caixa", href: "/vila-gpt?doc=kb:a1" }],
  found: true,
  topic: "src:kb:a1",
  topic_label: "Fechamento de caixa",
  mode: "ia",
  helpful: null,
  model: "",
  created_at: "2026-09-20T10:00:00.000Z",
  ...over,
});

const NOW = new Date("2026-09-21T12:00:00.000Z").getTime();

test("topicOf usa a fonte quando achou e a pergunta quando não achou", () => {
  const src = { id: "kb:a1", title: "Fechamento de caixa", label: "", href: "" };
  assert.deepEqual(topicOf("como fechar o caixa", true, src), { topic: "src:kb:a1", topic_label: "Fechamento de caixa" });
  const nf = topicOf("Como funciona o plano de saúde?", false, null);
  assert.ok(nf.topic.startsWith("q:"));
  assert.equal(nf.topic_label, "Como funciona o plano de saúde?");
  assert.equal(topicOf("como?", false, null).topic, "q:vazio");
});

test("topicStats agrupa, conta pessoas e respeita a janela", () => {
  const rows = [
    q("1"),
    q("2", { employee_name: "Bruno" }),
    q("3", { employee_name: "ana ", question: "como fechar o caixa" }),
    q("4", { created_at: "2026-01-01T10:00:00.000Z" }), // fora da janela
    q("5", { found: false, topic: "q:plano saud", topic_label: "Plano de saúde?", question: "Plano de saúde?", sources: [] }),
  ];
  const stats = topicStats(rows, { now: NOW });
  assert.equal(stats.length, 2);
  assert.equal(stats[0].topic, "src:kb:a1");
  assert.equal(stats[0].count, 3);
  assert.equal(stats[0].people, 2);
  assert.equal(stats[0].samples.length, 2);
  assert.equal(stats[1].notFound, 1);

  const hot = hotTopics(stats, { minCount: 3, minPeople: 2 });
  assert.deepEqual(hot.map((h) => h.topic), ["src:kb:a1"]);
  assert.deepEqual(hotTopics(stats, { minCount: 4 }), []);

  const un = unansweredTopics(rows, { now: NOW });
  assert.deepEqual(un.map((u) => u.label), ["Plano de saúde?"]);

  assert.deepEqual(frequentQuestions(rows, { now: NOW }), ["Como faço o fechamento do caixa?"]);

  const s = summarize(rows, NOW);
  assert.equal(s.total, 5);
  assert.equal(s.found, 4);
  assert.equal(s.notFound, 1);
  assert.equal(s.last30, 4);
  assert.equal(s.people, 2);
});
