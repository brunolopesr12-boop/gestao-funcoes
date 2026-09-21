/**
 * Acesso de administrador do VILA GPT.
 *
 * O app não tem login. A administração da base de conhecimento é protegida
 * por uma senha definida na variável de ambiente VILA_GPT_ADMIN_PIN.
 * Ao acertar a senha o servidor grava um cookie HttpOnly assinado; as rotas
 * de escrita só aceitam pedidos com esse cookie válido.
 *
 * A assinatura usa VILA_GPT_SESSION_SECRET quando definida (recomendado);
 * senão, deriva um segredo da senha e da chave de serviço do Supabase, se
 * houver. Trocar a senha invalida todas as sessões.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "vgpt_admin";
const SESSION_DAYS = 30;
export const MIN_PIN_LENGTH = 6;

export function adminPin(): string {
  return (process.env.VILA_GPT_ADMIN_PIN ?? "").trim();
}

export function isPinConfigured(): boolean {
  return adminPin().length >= MIN_PIN_LENGTH;
}

export function hasSessionSecret(): boolean {
  return (process.env.VILA_GPT_SESSION_SECRET ?? "").trim().length >= 16;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** 8 caracteres que identificam a senha atual (para invalidar sessões antigas). */
function pinTag(): string {
  return sha256(`vila-gpt-pin:${adminPin()}`).slice(0, 8);
}

function secret(): Buffer {
  const own = (process.env.VILA_GPT_SESSION_SECRET ?? "").trim();
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "").trim();
  const material = own || `vila-gpt-admin:${adminPin()}:${service}`;
  return createHash("sha256").update(material).digest();
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function checkPin(input: string): boolean {
  if (!isPinConfigured()) return false;
  return safeEqual(sha256(input.trim()), sha256(adminPin()));
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** token = <expira em ms>.<tag da senha>.<assinatura> */
export function signSession(now = Date.now()): string {
  const payload = `${now + SESSION_DAYS * 86_400_000}.${pinTag()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || !isPinConfigured()) return false;
  const [exp, tag, sig] = token.split(".");
  if (!exp || !tag || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  if (!safeEqual(tag, pinTag())) return false;
  return safeEqual(sig, sign(`${exp}.${tag}`));
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== name) continue;
    const raw = rest.join("=");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function isAdmin(req: Request): boolean {
  return verifySession(readCookie(req, ADMIN_COOKIE));
}

function secure(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86_400;
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure()}`;
}

export function clearSessionCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;
}
