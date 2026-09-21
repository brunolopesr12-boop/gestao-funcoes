// Módulo de servidor: só é importado por rotas em src/app/api. As variáveis
// usadas aqui não têm prefixo NEXT_PUBLIC_, então nunca vão para o navegador.

/**
 * Configuração da integração oficial do iFood (Merchant API).
 *
 * As credenciais existem SÓ no servidor — nenhuma delas tem prefixo
 * NEXT_PUBLIC_, então nunca chegam ao navegador.
 */

export const IFOOD_BASE_URL =
  process.env.IFOOD_API_BASE?.replace(/\/+$/, "") ||
  "https://merchant-api.ifood.com.br";

export type IfoodConfig = {
  clientId: string;
  clientSecret: string;
  merchantIds: string[];
  baseUrl: string;
};

export type IfoodConfigStatus =
  | { ok: true; config: IfoodConfig }
  | { ok: false; missing: string[]; message: string };

export function readIfoodConfig(): IfoodConfigStatus {
  const clientId = process.env.IFOOD_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET?.trim() ?? "";
  const merchantIds = (process.env.IFOOD_MERCHANT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const missing: string[] = [];
  if (!clientId) missing.push("IFOOD_CLIENT_ID");
  if (!clientSecret) missing.push("IFOOD_CLIENT_SECRET");
  if (merchantIds.length === 0) missing.push("IFOOD_MERCHANT_ID");

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message:
        `Integração iFood não configurada. Falta definir ${missing.join(", ")} ` +
        "nas variáveis de ambiente do servidor (Vercel > Settings > Environment Variables).",
    };
  }

  return {
    ok: true,
    config: { clientId, clientSecret, merchantIds, baseUrl: IFOOD_BASE_URL },
  };
}

export const isIfoodConfigured = () => readIfoodConfig().ok;
