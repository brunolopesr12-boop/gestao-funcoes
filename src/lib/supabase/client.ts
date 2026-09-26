import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./env";

let client: SupabaseClient | null = null;

/**
 * Cliente Supabase do navegador (singleton), com sessão persistida em cookie
 * para que o servidor (rotas /api e middleware) reconheça o mesmo login.
 */
export function supabaseBrowser(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase não configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

export { isSupabaseConfigured };
