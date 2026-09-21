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

async function fetchSnapshot(): Promise<KnowledgeInput> {
  const sb = serverSupabase();
  const results = await Promise.all(
    SNAPSHOT_TABLES.map(async (table) => {
      const { data, error } = await sb.from(table).select("*");
      if (error) throw new Error(`${table}: ${error.message}`);
      return [table, data ?? []] as const;
    }),
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

/** Limitador simples por chave (IP), em memória — por instância. */
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
  if (buckets.size > 5000) buckets.clear();
  return false;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
