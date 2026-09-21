/**
 * Acesso de administrador do VILA GPT.
 *
 * O app não tem login. A administração da base de conhecimento é protegida
 * por uma senha (PIN) definida na variável de ambiente VILA_GPT_ADMIN_PIN.
 * Ao acertar a senha o servidor grava um cookie HttpOnly assinado; as rotas
 * de escrita só aceitam pedidos com esse cookie válido.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "vgpt_admin";
const SESSION_DAYS = 30;

export function adminPin(): string {
  return (process.env.VILA_GPT_ADMIN_PIN ?? "").trim();
}

export function isPinConfigured(): boolean {
  return adminPin().length >= 4;
}

function secret(): Buffer {
  return createHash("sha256").update(`vila-gpt-admin:${adminPin()}`).digest();
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function checkPin(input: string): boolean {
  if (!isPinConfigured()) return false;
  const a = createHash("sha256").update(input.trim()).digest("hex");
  const b = createHash("sha256").update(adminPin()).digest("hex");
  return safeEqual(a, b);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** token = <expira em ms>.<assinatura> */
export function signSession(now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${sign(exp)}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || !isPinConfigured()) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  return safeEqual(sig, sign(exp));
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
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
