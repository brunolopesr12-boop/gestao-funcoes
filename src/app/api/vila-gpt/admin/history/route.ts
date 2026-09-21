import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/vila-gpt/server/auth";
import { isDbConfigured, isUuid, selectAll, serverSupabase } from "@/lib/vila-gpt/server/db";
import type { GptQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Histórico de perguntas (só administração). */
export async function GET(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }
  if (!isAdmin(req)) {
    return NextResponse.json({ erro: "Acesso restrito a administradores." }, { status: 401 });
  }
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") ?? 1000) || 1000));

  try {
    const rows = await selectAll<GptQuestion>("gpt_questions", {
      eq: isUuid(companyId) ? [["company_id", companyId]] : [],
      order: { column: "created_at", ascending: false },
      max: limit,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[vila-gpt] histórico:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Não consegui carregar o histórico." }, { status: 502 });
  }
}

/** Apagar uma pergunta do histórico (só administração). */
export async function DELETE(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }
  if (!isAdmin(req)) {
    return NextResponse.json({ erro: "Acesso restrito a administradores." }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  const { error } = await serverSupabase().from("gpt_questions").delete().eq("id", id);
  if (error) {
    console.error("[vila-gpt] excluir pergunta:", error.message);
    return NextResponse.json({ erro: "Não consegui excluir o registro." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
