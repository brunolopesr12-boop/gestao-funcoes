/**
 * Compatibilidade com o módulo de funções/treinamentos e o VILA GPT:
 * o cliente agora é o do navegador com sessão (login obrigatório).
 */
import { supabaseBrowser, isSupabaseConfigured } from "./supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export { isSupabaseConfigured };

export function supabase(): SupabaseClient {
  return supabaseBrowser();
}
