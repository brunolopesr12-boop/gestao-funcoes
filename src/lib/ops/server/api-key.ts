import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured, supabaseService } from "@/lib/supabase/server";

/**
 * Autenticação das rotas de integração (/api/ops/integrations/*).
 *
 * O sistema externo (PDV, iFood, ERP, balança, BI...) envia a chave criada em
 * Configurações → Integrações no cabeçalho `Authorization: Bearer vr_...`.
 * Só o hash sha256 da chave fica no banco (tabela api_keys).
 */
export type ApiKeyContext = { keyId: string; companyId: string; name: string; scopes: string[] };

export async function authenticateApiKey(req: NextRequest, requiredScope: string): Promise<{ ctx: ApiKeyContext | null; denied: NextResponse | null }> {
  if (!isServiceRoleConfigured()) {
    return { ctx: null, denied: NextResponse.json({ ok: false, erro: "Integrações desativadas: configure SUPABASE_SERVICE_ROLE_KEY no servidor." }, { status: 501 }) };
  }
  const header = req.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : (req.headers.get("x-api-key") ?? "").trim();
  if (!raw) return { ctx: null, denied: NextResponse.json({ ok: false, erro: "Informe a chave de API (Authorization: Bearer ...)." }, { status: 401 }) };
  const hash = createHash("sha256").update(raw).digest("hex");
  const sb = supabaseService();
  const { data, error } = await sb.from("api_keys").select("id, company_id, name, scopes, active").eq("key_hash", hash).maybeSingle();
  if (error || !data || !data.active) {
    return { ctx: null, denied: NextResponse.json({ ok: false, erro: "Chave de API inválida ou revogada." }, { status: 401 }) };
  }
  const scopes = (data.scopes as string[]) ?? [];
  if (!scopes.includes("*") && !scopes.includes(requiredScope)) {
    return { ctx: null, denied: NextResponse.json({ ok: false, erro: `A chave não tem o escopo ${requiredScope}.` }, { status: 403 }) };
  }
  void sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { ctx: { keyId: data.id as string, companyId: data.company_id as string, name: data.name as string, scopes }, denied: null };
}

/** Confere que a unidade pertence à empresa da chave. */
export async function storeOfCompany(storeId: string, companyId: string): Promise<boolean> {
  const { data } = await supabaseService().from("stores").select("id").eq("id", storeId).eq("company_id", companyId).maybeSingle();
  return Boolean(data);
}

export async function logIntegrationEvent(companyId: string, storeId: string | null, provider: string, kind: string, payload: unknown, status: "processado" | "erro" | "pendente", lastError = "") {
  try {
    await supabaseService().from("integration_events").insert({
      company_id: companyId, store_id: storeId, direction: "in", provider, kind, payload, status, last_error: lastError,
      processed_at: status === "pendente" ? null : new Date().toISOString(),
    });
  } catch {
    /* não derruba a integração por falha de log */
  }
}
