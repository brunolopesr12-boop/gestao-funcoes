/**
 * Acesso ao banco pelo servidor (rotas /api/vila-gpt/*).
 *
 * Usa a chave de serviço (SUPABASE_SERVICE_ROLE_KEY) quando existir — ela
 * nunca vai para o navegador — e cai para a chave anon caso contrário,
 * que é o padrão do app.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
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

/**
 * Cliente para as rotas do VILA GPT:
 *  - com SUPABASE_SERVICE_ROLE_KEY: chave de serviço (ignora RLS; as rotas
 *    restringem por empresa usando o contexto do usuário logado);
 *  - sem ela: a sessão do próprio usuário (cookie) — o RLS do banco decide.
 */
export async function dbClient(): Promise<SupabaseClient> {
  const { serviceKey } = supabaseEnv();
  if (serviceKey) return serverSupabase();
  return supabaseServer();
}

export type UserContext = {
  id: string;
  email: string;
  name: string;
  /** empresas onde o usuário é membro ativo */
  companyIds: string[];
};

/** Usuário autenticado (sessão em cookie) e suas empresas. Null se não logado. */
export async function userContext(): Promise<UserContext | null> {
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    const [{ data: ids }, { data: prof }] = await Promise.all([
      sb.rpc("ops_member_company_ids"),
      sb.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle(),
    ]);
    const list = Array.isArray(ids) ? (ids as unknown[]).map((r) => (typeof r === "string" ? r : (r as { ops_member_company_ids?: string }).ops_member_company_ids ?? "")).filter(Boolean) : [];
    const name = (prof as { full_name?: string } | null)?.full_name || (data.user.user_metadata?.full_name as string) || data.user.email || "";
    return { id: data.user.id, email: data.user.email ?? "", name, companyIds: list };
  } catch {
    return null;
  }
}

/** Escolhe a empresa do pedido: precisa ser uma das empresas do usuário. */
export function resolveCompany(ctx: UserContext, requested: string | null): { companyId: string | null; ok: boolean } {
  if (requested) return { companyId: requested, ok: ctx.companyIds.includes(requested) };
  return { companyId: ctx.companyIds[0] ?? null, ok: ctx.companyIds.length > 0 };
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
  const sb = await dbClient();
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
const cache = new Map<string, { at: number; data: Promise<KnowledgeInput> }>();

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

/**
 * Carrega tudo (com cache curto, para não bater no banco a cada pergunta).
 * Com chave de serviço o cache é global; com a sessão do usuário, é por usuário
 * (o RLS já limita o que ele enxerga).
 */
export function loadSnapshot(cacheKey = "service"): Promise<KnowledgeInput> {
  const key = isServiceRoleConfigured() ? "service" : `user:${cacheKey}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < SNAPSHOT_TTL_MS) return hit.data;
  const data = fetchSnapshot().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: now, data });
  if (cache.size > 200) {
    for (const [k, v] of cache) if (now - v.at >= SNAPSHOT_TTL_MS) cache.delete(k);
  }
  return data;
}

export function invalidateSnapshot(): void {
  cache.clear();
}

/** Restringe o snapshot às empresas do usuário (necessário com a chave de serviço). */
export function restrictSnapshot(snapshot: KnowledgeInput, companyIds: string[]): KnowledgeInput {
  const allow = new Set(companyIds);
  const roleIds = new Set(snapshot.roles.filter((r) => allow.has(r.company_id)).map((r) => r.id));
  const employeeIds = new Set(snapshot.employees.filter((e) => allow.has(e.company_id)).map((e) => e.id));
  return {
    ...snapshot,
    companies: snapshot.companies.filter((c) => allow.has(c.id)),
    roles: snapshot.roles.filter((r) => allow.has(r.company_id)),
    competencies: snapshot.competencies.filter((c) => roleIds.has(c.role_id)),
    checklist_items: snapshot.checklist_items.filter((c) => roleIds.has(c.role_id)),
    processes: snapshot.processes.filter((p) => roleIds.has(p.role_id)),
    employees: snapshot.employees.filter((e) => allow.has(e.company_id)),
    employee_roles: snapshot.employee_roles.filter((l) => employeeIds.has(l.employee_id)),
    training_steps: snapshot.training_steps.filter((t) => employeeIds.has(t.employee_id)),
    kb_articles: snapshot.kb_articles.filter((a) => a.company_id === null || allow.has(a.company_id)),
  };
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
    let q = (await dbClient()).from(table).select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
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
