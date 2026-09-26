/** Transforma erros do PostgREST/Supabase em mensagens para o funcionário. */
export class OpsError extends Error {
  code?: string;
  network: boolean;
  constructor(message: string, code?: string, network = false) {
    super(message);
    this.name = "OpsError";
    this.code = code;
    this.network = network;
  }
}

type Raw = { message?: string; code?: string; details?: string; hint?: string } | Error | string | null | undefined;

export function isNetworkError(e: Raw): boolean {
  const msg = typeof e === "string" ? e : e && "message" in e ? String(e.message ?? "") : "";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|network|fetch failed|load failed|ERR_INTERNET|timeout|ECONN/i.test(msg);
}

export function toOpsError(e: Raw): OpsError {
  if (e instanceof OpsError) return e;
  const msg = typeof e === "string" ? e : (e && "message" in e && e.message) || "Erro inesperado.";
  const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
  if (isNetworkError(e)) return new OpsError("Sem conexão com o servidor. Verifique a internet.", code, true);
  if (code === "42501" || /row-level security|permission denied|Sem permissão/i.test(msg)) {
    return new OpsError(/Sem permissão/i.test(msg) ? msg.replace(/\s*\(.*\)$/, "") : "Você não tem permissão para esta ação.", code);
  }
  if (code === "23505" || /duplicate key/i.test(msg)) return new OpsError("Já existe um registro com esses dados.", code);
  if (code === "23503" || /foreign key/i.test(msg)) return new OpsError("Este registro está em uso e não pode ser removido. Inative-o em vez de excluir.", code);
  if (code === "23514" || /check constraint/i.test(msg)) return new OpsError("Valor inválido para um dos campos.", code);
  if (code === "PGRST116") return new OpsError("Registro não encontrado.", code);
  if (code === "PGRST205" || code === "42P01" || /does not exist|schema cache/i.test(msg)) {
    return new OpsError("O banco de dados está desatualizado. Rode o arquivo supabase/install.sql no Supabase.", code);
  }
  return new OpsError(msg.replace(/^ERROR:\s*/i, ""), code);
}
