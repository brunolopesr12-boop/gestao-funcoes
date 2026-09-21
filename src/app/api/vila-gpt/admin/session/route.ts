import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/vila-gpt/server/answer";
import {
  checkPin,
  clearSessionCookie,
  isAdmin,
  isPinConfigured,
  sessionCookie,
  signSession,
} from "@/lib/vila-gpt/server/auth";
import { clientIp, isServiceRoleConfigured, rateLimited } from "@/lib/vila-gpt/server/db";

export const dynamic = "force-dynamic";

function status(req: Request) {
  const admin = isAdmin(req);
  const ai = aiConfig();
  return {
    configured: isPinConfigured(),
    admin,
    ai: admin ? { enabled: ai.enabled, model: ai.model, effort: ai.effort } : null,
    service_role: admin ? isServiceRoleConfigured() : null,
  };
}

/** Situação da sessão (e da configuração, para quem é admin). */
export async function GET(req: Request) {
  return NextResponse.json(status(req));
}

/** Entrar com a senha de administrador. */
export async function POST(req: Request) {
  if (!isPinConfigured()) {
    return NextResponse.json(
      { erro: "A senha de administrador (VILA_GPT_ADMIN_PIN) ainda não foi definida." },
      { status: 503 },
    );
  }
  if (rateLimited(`login:${clientIp(req)}`, 8, 15 * 60_000)) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Aguarde 15 minutos." },
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
    return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
  }
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
