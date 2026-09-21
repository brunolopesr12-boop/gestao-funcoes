// Módulo de servidor: cliente Supabase usado pelas rotas de API.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.POSTGRES_SUPABASE_URL ??
  "";

/**
 * Prefere a service role (não passa por RLS); cai para a anon, que já tem
 * acesso liberado pelas policies do schema. Nenhuma das duas chega ao
 * navegador — este arquivo só é importado por rotas de API.
 */
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SECRET_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "";

export const isDbConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!isDbConfigured) {
    throw new Error(
      "Banco não configurado no servidor: defina NEXT_PUBLIC_SUPABASE_URL e uma chave do Supabase.",
    );
  }
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
