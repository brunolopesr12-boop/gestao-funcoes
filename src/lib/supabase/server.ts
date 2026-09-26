import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./env";

/** Cliente que age como o usuário logado (lê a sessão do cookie). Para rotas /api e server components. */
export async function supabaseServer(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured) throw new Error("Supabase não configurado no servidor.");
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* chamado a partir de um server component: o middleware renova a sessão */
        }
      },
    },
  });
}

export function serviceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    ""
  ).trim();
}

export function isServiceRoleConfigured(): boolean {
  return serviceRoleKey().length > 0;
}

let service: SupabaseClient | null = null;
/** Cliente com a chave de serviço (ignora RLS). NUNCA vai para o navegador. */
export function supabaseService(): SupabaseClient {
  const key = serviceRoleKey();
  if (!isSupabaseConfigured || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  }
  if (!service) {
    service = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return service;
}

/** Usuário autenticado da requisição atual (ou null). */
export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
