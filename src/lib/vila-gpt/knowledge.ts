/**
 * Base de conhecimento unificada do VILA GPT.
 *
 * Junta, num único formato, tudo o que o sistema já sabe:
 *   - artigos oficiais cadastrados pela administração (kb_articles);
 *   - funções (descrição, responsabilidades, competências);
 *   - checklists de cada função;
 *   - processos (como fazer) de cada função;
 *   - quem exerce cada função e quem sabe fazer cada processo.
 *
 * Nada é duplicado no banco: os documentos são montados na hora a partir
 * das tabelas existentes. Puro (sem React) para ser testável.
 */
import { buildTrainingIndex, roleProgress, sortByPosition, statusFromStepMap, stepsFor } from "../derive";
import { KB_KIND_META, type AppData, type KbArticle } from "../types";

export type DocKind =
  | "kb"
  | "funcao"
  | "checklist"
  | "processo"
  | "responsaveis";

export type KnowledgeDoc = {
  /** id único: kb:<uuid> | role:<uuid> | checklist:<roleId> | process:<uuid> | who:role:<id> | who:process:<id> */
  id: string;
  kind: DocKind;
  kindLabel: string;
  emoji: string;
  title: string;
  /** como o funcionário perguntaria (só artigos) */
  question: string;
  category: string;
  keywords: string;
  /** texto completo usado na resposta */
  body: string;
  /** "Procedimento — Fechamento de caixa" */
  label: string;
  href: string;
  companyId: string | null;
  companyName: string;
  updatedAt: string;
  /** artigo editável na administração */
  article: KbArticle | null;
  /** peso de desempate na busca (0-1) */
  weight: number;
};

export type KnowledgeInput = Pick<
  AppData,
  | "companies"
  | "roles"
  | "competencies"
  | "checklist_items"
  | "processes"
  | "employees"
  | "employee_roles"
  | "training_steps"
  | "kb_articles"
>;

export type BuildOptions = {
  /** null/undefined = todas as empresas */
  companyId?: string | null;
  /** inclui funções, processos, checklists e responsáveis (padrão: sim) */
  includeSystem?: boolean;
  /** inclui artigos não oficiais (rascunhos) — só para a administração */
  includeDrafts?: boolean;
};

export function sourceLabel(kindLabel: string, title: string): string {
  return `${kindLabel} — ${title}`;
}

export function articleDoc(a: KbArticle, companyName: string): KnowledgeDoc {
  const meta = KB_KIND_META[a.kind] ?? KB_KIND_META.outro;
  return {
    id: `kb:${a.id}`,
    kind: "kb",
    kindLabel: meta.label,
    emoji: meta.emoji,
    title: a.title,
    question: a.question,
    category: a.category,
    keywords: a.keywords,
    body: a.content,
    label: sourceLabel(meta.label, a.title),
    href: `/vila-gpt?doc=kb:${a.id}`,
    companyId: a.company_id,
    companyName,
    updatedAt: a.updated_at,
    article: a,
    weight: 1,
  };
}

function lines(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function names(list: { name: string }[]): string {
  return list.map((e) => e.name).join(", ");
}

export function buildKnowledge(d: KnowledgeInput, opts: BuildOptions = {}): KnowledgeDoc[] {
  const companyId = opts.companyId ?? null;
  const includeSystem = opts.includeSystem ?? true;
  const includeDrafts = opts.includeDrafts ?? false;
  const companyName = (id: string | null) =>
    id ? (d.companies.find((c) => c.id === id)?.name ?? "") : "Todas as empresas";

  const docs: KnowledgeDoc[] = [];

  /* ---- artigos cadastrados -------------------------------------- */
  for (const a of sortByPosition(d.kb_articles.map((x) => ({ ...x, name: x.title })))) {
    if (!includeDrafts && !a.official) continue;
    if (companyId && a.company_id && a.company_id !== companyId) continue;
    docs.push(articleDoc(a, companyName(a.company_id)));
  }

  if (!includeSystem) return docs;

  /* ---- funções, checklists, processos, responsáveis ------------- */
  const index = buildTrainingIndex(d.training_steps);
  const roles = sortByPosition(
    d.roles.filter((r) => r.active !== false && (!companyId || r.company_id === companyId)),
  );

  for (const role of roles) {
    const cname = companyName(role.company_id);
    const base = `/empresa/${role.company_id}`;
    const responsibilities = lines(role.responsibilities);
    const competencies = sortByPosition(d.competencies.filter((c) => c.role_id === role.id));
    const checklist = sortByPosition(d.checklist_items.filter((c) => c.role_id === role.id));
    const processes = sortByPosition(d.processes.filter((p) => p.role_id === role.id));

    const roleBody: string[] = [];
    if (role.description) roleBody.push(role.description);
    if (responsibilities.length) {
      roleBody.push("Responsabilidades da função:");
      responsibilities.forEach((r) => roleBody.push(`- ${r}`));
    }
    if (competencies.length) {
      roleBody.push(`Competências necessárias: ${names(competencies)}.`);
    }
    if (processes.length) {
      roleBody.push("Processos que a função precisa saber fazer:");
      processes.forEach((p) =>
        roleBody.push(`- ${p.name}${p.required ? "" : " (extra, não obrigatório)"}`),
      );
    }
    docs.push({
      id: `role:${role.id}`,
      kind: "funcao",
      kindLabel: "Função",
      emoji: role.emoji || "🧩",
      title: role.name,
      question: "",
      category: "Funções e responsabilidades",
      keywords: "função, cargo, responsabilidade, responsabilidades, competências, o que faz",
      body: roleBody.join("\n") || `Função ${role.name} cadastrada sem descrição.`,
      label: sourceLabel("Função", role.name),
      href: `${base}/funcoes/${role.id}`,
      companyId: role.company_id,
      companyName: cname,
      updatedAt: role.updated_at,
      article: null,
      weight: 0.9,
    });

    if (checklist.length) {
      docs.push({
        id: `checklist:${role.id}`,
        kind: "checklist",
        kindLabel: "Checklist",
        emoji: "☑️",
        title: `Checklist da função ${role.name}`,
        question: "",
        category: "Checklists",
        keywords: `checklist, rotina, conferir, ${role.name}`,
        body: checklist.map((c) => `☐ ${c.text}`).join("\n"),
        label: sourceLabel("Checklist", role.name),
        href: `${base}/funcoes/${role.id}`,
        companyId: role.company_id,
        companyName: cname,
        updatedAt: role.updated_at,
        article: null,
        weight: 0.9,
      });
    }

    for (const p of processes) {
      const pBody: string[] = [];
      if (p.description) pBody.push(p.description);
      pBody.push(
        `Faz parte da função ${role.name}.` +
          (p.required ? " É obrigatório para ficar apto." : " É um processo extra (não bloqueia a certificação)."),
      );
      docs.push({
        id: `process:${p.id}`,
        kind: "processo",
        kindLabel: "Processo",
        emoji: "📋",
        title: p.name,
        question: "",
        category: "Processos",
        keywords: `como fazer, processo, ${role.name}`,
        body: pBody.join("\n"),
        label: sourceLabel("Processo", `${p.name} (${role.name})`),
        href: `${base}/processos/${p.id}`,
        companyId: role.company_id,
        companyName: cname,
        updatedAt: p.updated_at,
        article: null,
        weight: p.description ? 0.95 : 0.6,
      });
    }

    /* quem exerce a função */
    const links = d.employee_roles.filter((l) => l.role_id === role.id);
    const active = (id: string) => {
      const e = d.employees.find((x) => x.id === id);
      return e && e.status === "ativo" ? e : null;
    };
    const current = links
      .filter((l) => l.kind === "atual")
      .map((l) => active(l.employee_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const training = links
      .filter((l) => l.kind === "treinando")
      .map((l) => active(l.employee_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const apt = [...current, ...training].filter(
      (e) => roleProgress(index, e.id, processes).fitness === "apto",
    );
    const whoBody: string[] = [];
    whoBody.push(
      current.length
        ? `Quem exerce a função ${role.name} hoje: ${names(current)}.`
        : `Ninguém está cadastrado como ocupante atual da função ${role.name}.`,
    );
    if (training.length) whoBody.push(`Em treinamento para ${role.name}: ${names(training)}.`);
    whoBody.push(
      apt.length
        ? `Aptos (certificados em todos os processos obrigatórios): ${names(apt)}.`
        : `Ninguém está apto (certificado em todos os processos obrigatórios) nesta função.`,
    );
    docs.push({
      id: `who:role:${role.id}`,
      kind: "responsaveis",
      kindLabel: "Responsáveis",
      emoji: "👥",
      title: `Quem exerce a função ${role.name}`,
      question: `Quem é o responsável por ${role.name}? Quem faz ${role.name}?`,
      category: "Funções e responsabilidades",
      keywords: `quem, responsável, responsáveis, quem faz, quem cuida, quem é, ${role.name}`,
      body: whoBody.join("\n"),
      label: sourceLabel("Cadastro de funcionários", `Função ${role.name}`),
      href: `${base}/funcoes/${role.id}`,
      companyId: role.company_id,
      companyName: cname,
      updatedAt: role.updated_at,
      article: null,
      weight: 0.7,
    });

    /* quem sabe fazer cada processo */
    const companyEmployees = d.employees.filter(
      (e) => e.company_id === role.company_id && e.status === "ativo",
    );
    for (const p of processes) {
      const certified: string[] = [];
      const learning: string[] = [];
      for (const e of companyEmployees) {
        const st = statusFromStepMap(stepsFor(index, e.id, p.id));
        if (st === "certificado") certified.push(e.name);
        else if (st === "em_treinamento") learning.push(e.name);
      }
      const b: string[] = [];
      b.push(
        certified.length
          ? `Sabem fazer (certificados) "${p.name}": ${certified.join(", ")}.`
          : `Ninguém está certificado em "${p.name}" ainda.`,
      );
      if (learning.length) b.push(`Em treinamento: ${learning.join(", ")}.`);
      b.push(`O processo pertence à função ${role.name}.`);
      docs.push({
        id: `who:process:${p.id}`,
        kind: "responsaveis",
        kindLabel: "Quem sabe fazer",
        emoji: "🔎",
        title: `Quem sabe fazer: ${p.name}`,
        question: `Quem sabe ${p.name}? Quem pode ${p.name}?`,
        category: "Funções e responsabilidades",
        keywords: `quem sabe, quem faz, quem pode, substituir, certificado, ${p.name}`,
        body: b.join("\n"),
        label: sourceLabel("Quem sabe fazer", p.name),
        href: `${base}/processos/${p.id}`,
        companyId: role.company_id,
        companyName: cname,
        updatedAt: p.updated_at,
        article: null,
        weight: 0.7,
      });
    }
  }

  return docs;
}

/** Agrupa documentos por categoria para a aba "Manual". */
export function groupByCategory(docs: KnowledgeDoc[]): { category: string; docs: KnowledgeDoc[] }[] {
  const map = new Map<string, KnowledgeDoc[]>();
  for (const doc of docs) {
    const key = doc.category || "Geral";
    (map.get(key) ?? map.set(key, []).get(key)!).push(doc);
  }
  return [...map.entries()]
    .map(([category, list]) => ({
      category,
      docs: [...list].sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, "pt-BR"));
}
