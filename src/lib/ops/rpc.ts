import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "./errors";

/** Chama uma função do banco (RPC) e converte erros em mensagens amigáveis. */
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw toOpsError(error);
  return data as T;
}

/** Lança OpsError a partir de uma resposta do PostgREST. */
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw toOpsError(res.error);
  return res.data as T;
}
