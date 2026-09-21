export const STEPS = ["mostrei", "fez", "ensinou", "certifiquei"] as const;
export type StepKey = (typeof STEPS)[number];

export const STEP_META: Record<
  StepKey,
  { label: string; emoji: string; short: string; help: string }
> = {
  mostrei: {
    label: "Mostrei",
    emoji: "👀",
    short: "Mostrei",
    help: "Eu mostrei ao funcionário como fazer.",
  },
  fez: {
    label: "Fez",
    emoji: "👤",
    short: "Fez",
    help: "O funcionário realizou o processo enquanto eu acompanhei.",
  },
  ensinou: {
    label: "Ensinou",
    emoji: "🗣️",
    short: "Ensinou",
    help: "O funcionário conseguiu me explicar/ensinar como o processo deve ser feito.",
  },
  certifiquei: {
    label: "Certifiquei",
    emoji: "✅",
    short: "Certifiquei",
    help: "Eu vi o funcionário realizando sozinho e confirmei que ele está apto.",
  },
};

export type Company = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  notes: string;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type Role = {
  id: string;
  company_id: string;
  name: string;
  description: string;
  responsibilities: string;
  emoji: string;
  position: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Competency = {
  id: string;
  role_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type ChecklistItem = {
  id: string;
  role_id: string;
  text: string;
  position: number;
  created_at: string;
};

export type Process = {
  id: string;
  role_id: string;
  name: string;
  description: string;
  required: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type EmployeeStatus = "ativo" | "afastado" | "inativo";

export type Employee = {
  id: string;
  company_id: string;
  name: string;
  status: EmployeeStatus;
  hired_on: string | null;
  phone: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type EmployeeRoleKind = "atual" | "treinando";

export type EmployeeRole = {
  id: string;
  employee_id: string;
  role_id: string;
  kind: EmployeeRoleKind;
  created_at: string;
};

export type TrainingStep = {
  id: string;
  employee_id: string;
  process_id: string;
  step: StepKey;
  done_at: string;
  trainer: string;
  notes: string;
  created_at: string;
};

export type TrainingEvent = {
  id: string;
  company_id: string | null;
  employee_id: string | null;
  process_id: string | null;
  employee_name: string;
  process_name: string;
  role_name: string;
  step: string;
  action: string;
  trainer: string;
  notes: string;
  created_at: string;
};

export type ActivityLog = {
  id: string;
  company_id: string | null;
  entity: string;
  entity_name: string;
  action: string;
  detail: string;
  actor: string;
  created_at: string;
};

/** Status de um processo para um funcionário. */
export type ProcessStatus = "nao_iniciado" | "em_treinamento" | "certificado";

/** Status de aptidão de um funcionário em uma função. */
export type Fitness = "apto" | "em_treinamento" | "nao_treinado" | "sem_processos";

export const STATUS_META: Record<
  ProcessStatus | Fitness,
  { label: string; dot: string; className: string }
> = {
  certificado: {
    label: "Certificado",
    dot: "🟢",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  em_treinamento: {
    label: "Em treinamento",
    dot: "🟡",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  nao_iniciado: {
    label: "Não iniciado",
    dot: "🔴",
    className: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
  apto: {
    label: "Apto",
    dot: "🟢",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  nao_treinado: {
    label: "Não treinado",
    dot: "🔴",
    className: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
  sem_processos: {
    label: "Sem processos",
    dot: "⚪",
    className: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  },
};


/* ------------------------------------------------------------------ */
/* VILA GPT — base de conhecimento e histórico de perguntas            */
/* ------------------------------------------------------------------ */

export const KB_KINDS = [
  "procedimento",
  "pergunta",
  "regra",
  "treinamento",
  "ficha_tecnica",
  "cardapio",
  "produto",
  "documento",
  "sistema",
  "outro",
] as const;
export type KbKind = (typeof KB_KINDS)[number];

export const KB_KIND_META: Record<KbKind, { label: string; emoji: string; hint: string }> = {
  procedimento: { label: "Procedimento", emoji: "📋", hint: "Passo a passo de como fazer algo" },
  pergunta: { label: "Pergunta e resposta", emoji: "❓", hint: "Uma dúvida comum e a resposta oficial" },
  regra: { label: "Regra", emoji: "📌", hint: "Regra de atendimento, delivery, caixa…" },
  treinamento: { label: "Treinamento", emoji: "🎓", hint: "Material de treinamento" },
  ficha_tecnica: { label: "Ficha técnica", emoji: "🧾", hint: "Receita, quantidades e preparo" },
  cardapio: { label: "Cardápio", emoji: "🍽️", hint: "Itens do cardápio e composição" },
  produto: { label: "Produto / ingrediente", emoji: "📦", hint: "Produto, ingrediente, embalagem, estoque" },
  documento: { label: "Documento", emoji: "📄", hint: "Material oficial da empresa" },
  sistema: { label: "Informação do sistema", emoji: "🖥️", hint: "Como usar o sistema" },
  outro: { label: "Outro", emoji: "🗂️", hint: "Qualquer outra informação oficial" },
};

/** Sugestões de área para organizar a base. O campo é livre. */
export const KB_CATEGORIES = [
  "Abertura e fechamento",
  "Caixa",
  "Atendimento",
  "Cozinha",
  "Montagem de pedidos",
  "Delivery",
  "Cardápio",
  "Estoque",
  "Limpeza",
  "Perdas e devoluções",
  "Sistema",
  "Geral",
];

export type KbArticle = {
  id: string;
  /** null = vale para todas as empresas */
  company_id: string | null;
  kind: KbKind;
  category: string;
  title: string;
  /** como o funcionário perguntaria (opcional) */
  question: string;
  /** resposta / passo a passo, um passo por linha */
  content: string;
  /** sinônimos e termos de busca, separados por vírgula */
  keywords: string;
  /** só o que é oficial entra nas respostas do VILA GPT */
  official: boolean;
  position: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type GptSource = {
  /** id do documento na base unificada, ex.: kb:<uuid>, process:<uuid> */
  id: string;
  title: string;
  /** texto exibido: "Procedimento — Fechamento de caixa" */
  label: string;
  href: string;
};

export type GptMode = "ia" | "busca" | "sem_resposta";

export type GptQuestion = {
  id: string;
  company_id: string | null;
  employee_id: string | null;
  employee_name: string;
  question: string;
  answer: string;
  sources: GptSource[];
  found: boolean;
  topic: string;
  topic_label: string;
  mode: GptMode;
  helpful: boolean | null;
  model: string;
  created_at: string;
};

/** Frase oficial quando a base não cobre a pergunta. */
export const GPT_NOT_FOUND =
  "Não encontrei esse procedimento na base oficial da empresa. Procure um gerente ou responsável.";

/** Snapshot completo do banco carregado no cliente. */
export type AppData = {
  companies: Company[];
  roles: Role[];
  competencies: Competency[];
  checklist_items: ChecklistItem[];
  processes: Process[];
  employees: Employee[];
  employee_roles: EmployeeRole[];
  training_steps: TrainingStep[];
  training_events: TrainingEvent[];
  activity_log: ActivityLog[];
  kb_articles: KbArticle[];
};
