import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/vila-gpt/server/auth";
import { dbClient, isDbConfigured, isUuid, selectAll, userContext } from "@/lib/vila-gpt/server/db";
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
  const ctx = await userContext();
  if (!ctx) return NextResponse.json({ erro: "Faça login." }, { status: 401 });
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (isUuid(companyId) && !ctx.companyIds.includes(companyId)) {
    return NextResponse.json({ erro: "Você não tem acesso a esta empresa." }, { status: 403 });
  }
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") ?? 1000) || 1000));

  try {
    const all = await selectAll<GptQuestion>("gpt_questions", {
      eq: isUuid(companyId) ? [["company_id", companyId]] : [],
      order: { column: "created_at", ascending: false },
      max: limit,
    });
    const rows = all.filter((r) => !r.company_id || ctx.companyIds.includes(r.company_id));
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
  const ctx = await userContext();
  if (!ctx) return NextResponse.json({ erro: "Faça login." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  const sb = await dbClient();
  const { data: q } = await sb.from("gpt_questions").select("company_id").eq("id", id).maybeSingle();
  if (q && q.company_id && !ctx.companyIds.includes(q.company_id as string)) {
    return NextResponse.json({ erro: "Você não tem acesso a esta empresa." }, { status: 403 });
  }
  const { error } = await sb.from("gpt_questions").delete().eq("id", id);
  if (error) {
    console.error("[vila-gpt] excluir pergunta:", error.message);
    return NextResponse.json({ erro: "Não consegui excluir o registro." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
