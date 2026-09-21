import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/vila-gpt/server/answer";
import {
  checkPin,
  clearSessionCookie,
  hasSessionSecret,
  isAdmin,
  isPinConfigured,
  MIN_PIN_LENGTH,
  sessionCookie,
  signSession,
} from "@/lib/vila-gpt/server/auth";
import {
  clientIp,
  countSince,
  isDbConfigured,
  isServiceRoleConfigured,
  newId,
  rateLimited,
  serverSupabase,
} from "@/lib/vila-gpt/server/db";

export const dynamic = "force-dynamic";

/** Tentativas erradas toleradas em 15 minutos: por IP e no total (todas as instâncias). */
const LOCK_WINDOW_MIN = 15;
const MAX_FAILED_PER_IP = 8;
const MAX_FAILED_TOTAL = 30;

async function status(req: Request) {
  const admin = isAdmin(req);
  const ai = aiConfig();
  let failedLogins24h: number | null = null;
  if (admin && isDbConfigured()) {
    failedLogins24h = await countSince(
      "gpt_login_attempts",
      new Date(Date.now() - 86_400_000).toISOString(),
      [["ok", false]],
    );
  }
  return {
    configured: isPinConfigured(),
    min_pin_length: MIN_PIN_LENGTH,
    admin,
    ai: admin ? { enabled: ai.enabled, model: ai.model, effort: ai.effort, max_per_day: ai.maxPerDay } : null,
    service_role: admin ? isServiceRoleConfigured() : null,
    session_secret: admin ? hasSessionSecret() : null,
    failed_logins_24h: failedLogins24h,
  };
}

/** Situação da sessão (e da configuração, para quem é admin). */
export async function GET(req: Request) {
  return NextResponse.json(await status(req));
}

async function recordAttempt(ip: string, ok: boolean) {
  if (!isDbConfigured()) return;
  try {
    await serverSupabase().from("gpt_login_attempts").insert({
      id: newId(),
      ip: ip.slice(0, 64),
      ok,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[vila-gpt] não registrou tentativa de login:", e);
  }
}

/** Trava persistente (no banco), que vale para todas as instâncias do servidor. */
async function lockedOut(ip: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000).toISOString();
  const [perIp, total] = await Promise.all([
    countSince("gpt_login_attempts", since, [["ip", ip.slice(0, 64)], ["ok", false]]),
    countSince("gpt_login_attempts", since, [["ok", false]]),
  ]);
  return (perIp !== null && perIp >= MAX_FAILED_PER_IP) || (total !== null && total >= MAX_FAILED_TOTAL);
}

/** Entrar com a senha de administrador. */
export async function POST(req: Request) {
  if (!isPinConfigured()) {
    return NextResponse.json(
      { erro: `A senha de administrador (VILA_GPT_ADMIN_PIN, mínimo ${MIN_PIN_LENGTH} caracteres) ainda não foi definida.` },
      { status: 503 },
    );
  }
  const ip = clientIp(req);
  if (rateLimited(`login:${ip}`, MAX_FAILED_PER_IP, LOCK_WINDOW_MIN * 60_000) || (await lockedOut(ip))) {
    return NextResponse.json(
      { erro: `Muitas tentativas. Aguarde ${LOCK_WINDOW_MIN} minutos.` },
      { status: 429 },
    );
  }
  let body: { pin?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!checkPin(pin)) {
    console.warn(`[vila-gpt] senha de administrador incorreta (ip ${ip}).`);
    await recordAttempt(ip, false);
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
  }
  await recordAttempt(ip, true);
  const res = NextResponse.json({ admin: true });
  res.headers.set("Set-Cookie", sessionCookie(signSession()));
  return res;
}

/** Sair. */
export async function DELETE() {
  const res = NextResponse.json({ admin: false });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
