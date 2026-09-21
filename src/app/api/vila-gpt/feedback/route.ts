import { NextResponse } from "next/server";
import { clientIp, isDbConfigured, isUuid, rateLimited, serverSupabase } from "@/lib/vila-gpt/server/db";

export const dynamic = "force-dynamic";

/** Funcionário diz se a resposta ajudou (👍 / 👎). */
export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }
  if (rateLimited(`feedback:${clientIp(req)}`, 60, 5 * 60_000)) {
    return NextResponse.json({ erro: "Aguarde um pouco." }, { status: 429 });
  }
  let body: { id?: unknown; helpful?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  if (!isUuid(body.id) || typeof body.helpful !== "boolean") {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const { error } = await serverSupabase()
    .from("gpt_questions")
    .update({ helpful: body.helpful })
    .eq("id", body.id);
  if (error) {
    console.error("[vila-gpt] feedback:", error.message);
    return NextResponse.json({ erro: "Não foi possível registrar o feedback." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
