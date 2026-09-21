// Módulo de servidor: só é importado por rotas em src/app/api. As variáveis
// usadas aqui não têm prefixo NEXT_PUBLIC_, então nunca vão para o navegador.
import { readIfoodConfig, type IfoodConfig } from "./config";

/**
 * Token OAuth da Merchant API (grant_type=client_credentials).
 * Guardado em memória e renovado 60s antes de expirar.
 *
 * Aplicações "distribuídas" do iFood exigem também authorizationCode +
 * authorizationCodeVerifier; este módulo cobre o fluxo centralizado, que é o
 * usado por quem integra a própria loja.
 */

type CachedToken = { token: string; expiresAt: number };

let cache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

export class IfoodError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "IfoodError";
    this.status = status;
    this.body = body;
  }
}

async function requestToken(config: IfoodConfig): Promise<string> {
  const body = new URLSearchParams({
    grantType: "client_credentials",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const res = await fetch(`${config.baseUrl}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    cache = null;
    throw new IfoodError(
      `Falha ao autenticar no iFood (HTTP ${res.status}).`,
      res.status,
      text.slice(0, 500),
    );
  }

  let parsed: { accessToken?: string; access_token?: string; expiresIn?: number };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IfoodError("Resposta de autenticação inválida do iFood.", 502, text.slice(0, 200));
  }

  const token = parsed.accessToken ?? parsed.access_token ?? "";
  if (!token) throw new IfoodError("iFood não devolveu accessToken.", 502);

  const ttl = Number(parsed.expiresIn) > 0 ? Number(parsed.expiresIn) : 3600;
  cache = { token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return token;
}

export async function getAccessToken(): Promise<string> {
  const status = readIfoodConfig();
  if (!status.ok) throw new IfoodError(status.message, 503);

  if (cache && cache.expiresAt > Date.now()) return cache.token;
  if (inFlight) return inFlight;

  inFlight = requestToken(status.config).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Descarta o token em memória (usado quando o iFood devolve 401). */
export function invalidateToken(): void {
  cache = null;
}
