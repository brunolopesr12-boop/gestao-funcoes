/**
 * Acesso ao banco pelo servidor (rotas /api/vila-gpt/*).
 *
 * Usa a chave de serviço (SUPABASE_SERVICE_ROLE_KEY) quando existir — ela
 * nunca vai para o navegador — e cai para a chave anon caso contrário,
 * que é o padrão do app.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KnowledgeInput } from "../knowledge";

function first(...values: (string | undefined)[]): string {
  return values.find((v) => typeof v === "string" && v.length > 0) ?? "";
}

export function supabaseEnv() {
  const url = first(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_URL,
    process.env.POSTGRES_SUPABASE_URL,
  );
  const anonKey = first(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const serviceKey = first(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
  );
  return { url, anonKey, serviceKey };
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(supabaseEnv().serviceKey);
}

export function isDbConfigured(): boolean {
  const { url, anonKey, serviceKey } = supabaseEnv();
  return Boolean(url && url.startsWith("http") && (serviceKey || anonKey));
}

let client: SupabaseClient | null = null;
let clientKey = "";

export function serverSupabase(): SupabaseClient {
  const { url, anonKey, serviceKey } = supabaseEnv();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    throw new Error("Supabase não configurado no servidor.");
  }
  if (!client || clientKey !== `${url}|${key}`) {
    client = createClient(url, key, { auth: { persistSession: false } });
    clientKey = `${url}|${key}`;
  }
  return client;
}

/* ------------------------------------------------------------------ */
/* Tabela ainda não criada                                             */
/* ------------------------------------------------------------------ */

/**
 * Detecta "essa tabela não existe".
 *
 * Acontece quando o schema.sql novo ainda não foi rodado no Supabase.
 * Nesse caso o VILA GPT trabalha só com o que os outros módulos já têm,
 * em vez de derrubar o app inteiro.
 */
export function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(err.message ?? "");
}

export const SCHEMA_HINT =
  "As tabelas do VILA GPT ainda não foram criadas. Abra o Supabase → SQL Editor e rode o arquivo supabase/schema.sql.";

/* ------------------------------------------------------------------ */
/* Leitura paginada (o PostgREST devolve no máximo 1000 linhas por vez) */
/* ------------------------------------------------------------------ */

const PAGE = 1000;

export type SelectAllOptions = {
  /** filtros de igualdade */
  eq?: [string, string | boolean][];
  /** coluna para ordenar (desc = mais recentes primeiro) */
  order?: { column: string; ascending?: boolean };
  /** máximo de linhas (padrão: sem limite prático) */
  max?: number;
  /** se a tabela ainda não existir, devolve lista vazia em vez de erro */
  optional?: boolean;
};

/** Lê todas as linhas de uma tabela, página a página. */
export async function selectAll<T = Record<string, unknown>>(
  table: string,
  opts: SelectAllOptions = {},
): Promise<T[]> {
  const sb = serverSupabase();
  const max = opts.max ?? 100_000;
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE, max) - 1;
    let q = sb.from(table).select("*");
    for (const [col, val] of opts.eq ?? []) q = q.eq(col, val);
    if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? false });
    else q = q.order("id", { ascending: true });
    const { data, error } = await q.range(from, to);
    if (error) {
      if (opts.optional && isMissingTable(error)) {
        console.warn(`[vila-gpt] tabela ${table} ainda não existe. ${SCHEMA_HINT}`);
        return [];
      }
      throw new Error(`${table}: ${error.message}`);
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Snapshot do que o VILA GPT precisa saber                            */
/* ------------------------------------------------------------------ */

const SNAPSHOT_TABLES = [
  "companies",
  "roles",
  "competencies",
  "checklist_items",
  "processes",
  "employees",
  "employee_roles",
  "training_steps",
  "kb_articles",
] as const satisfies readonly (keyof KnowledgeInput)[];

const SNAPSHOT_TTL_MS = 15_000;
let cached: { at: number; data: Promise<KnowledgeInput> } | null = null;

/** tabelas novas do VILA GPT: ausentes = schema ainda não aplicado */
const OPTIONAL_TABLES = new Set<string>(["kb_articles"]);

async function fetchSnapshot(): Promise<KnowledgeInput> {
  const results = await Promise.all(
    SNAPSHOT_TABLES.map(
      async (table) =>
        [table, await selectAll(table, { optional: OPTIONAL_TABLES.has(table) })] as const,
    ),
  );
  const out = {} as Record<(typeof SNAPSHOT_TABLES)[number], unknown[]>;
  for (const [table, rows] of results) out[table] = rows;
  return out as unknown as KnowledgeInput;
}

/** Carrega tudo (com cache curto, para não bater no banco a cada pergunta). */
export function loadSnapshot(): Promise<KnowledgeInput> {
  const now = Date.now();
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.data;
  const data = fetchSnapshot().catch((e) => {
    cached = null;
    throw e;
  });
  cached = { at: now, data };
  return data;
}

export function invalidateSnapshot(): void {
  cached = null;
}

/* ------------------------------------------------------------------ */
/* Contagens (orçamento de IA, tentativas de login)                    */
/* ------------------------------------------------------------------ */

/** Quantas linhas existem desde `sinceIso`, com filtros. Null se não der para contar. */
export async function countSince(
  table: string,
  sinceIso: string,
  eq: [string, string | boolean][] = [],
): Promise<number | null> {
  try {
    let q = serverSupabase().from(table).select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
    for (const [col, val] of eq) q = q.eq(col, val);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  } catch (e) {
    console.error(`[vila-gpt] não consegui contar ${table}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

export function newId(): string {
  return crypto.randomUUID();
}

export function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

/** Limitador simples por chave, em memória — por instância (primeira barreira). */
const buckets = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    buckets.set(key, list);
    return true;
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return false;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
