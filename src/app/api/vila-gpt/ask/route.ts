import { NextResponse } from "next/server";
import { answerQuestion, type ChatTurn } from "@/lib/vila-gpt/server/answer";
import {
  clientIp,
  isDbConfigured,
  isUuid,
  loadSnapshot,
  newId,
  rateLimited,
  serverSupabase,
} from "@/lib/vila-gpt/server/db";
import { topicOf } from "@/lib/vila-gpt/analytics";
import type { GptQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUESTION = 600;

type Body = {
  question?: unknown;
  company_id?: unknown;
  employee_name?: unknown;
  employee_id?: unknown;
  history?: unknown;
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }
  if (rateLimited(`ask:${clientIp(req)}`, 30, 5 * 60_000)) {
    return NextResponse.json(
      { erro: "Muitas perguntas em pouco tempo. Aguarde um minuto e tente de novo." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }

  const question = str(body.question, MAX_QUESTION);
  if (question.length < 2) {
    return NextResponse.json({ erro: "Escreva sua dúvida." }, { status: 400 });
  }
  const companyId = isUuid(body.company_id) ? body.company_id : null;
  const employeeId = isUuid(body.employee_id) ? body.employee_id : null;
  const employeeName = str(body.employee_name, 80);
  const history: ChatTurn[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter(
          (t): t is ChatTurn =>
            typeof t === "object" &&
            t !== null &&
            ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") &&
            typeof (t as ChatTurn).content === "string",
        )
        .slice(-6)
        .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))
    : [];

  let snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (e) {
    return NextResponse.json(
      { erro: `Não consegui ler a base: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const result = await answerQuestion(snapshot, { question, companyId, employeeName, history });

  /* ---- histórico --------------------------------------------------- */
  const { topic, topic_label } = topicOf(question, result.found, result.sources[0] ?? null);
  const row: GptQuestion = {
    id: newId(),
    company_id: companyId,
    employee_id: employeeId,
    employee_name: employeeName,
    question,
    answer: result.answer,
    sources: result.sources,
    found: result.found,
    topic,
    topic_label,
    mode: result.mode,
    helpful: null,
    model: result.model,
    created_at: new Date().toISOString(),
  };
  let logged = true;
  try {
    const { error } = await serverSupabase().from("gpt_questions").insert(row);
    if (error) {
      logged = false;
      console.error("[vila-gpt] não gravou histórico:", error.message);
    }
  } catch (e) {
    logged = false;
    console.error("[vila-gpt] não gravou histórico:", e);
  }

  return NextResponse.json({
    id: row.id,
    answer: result.answer,
    found: result.found,
    mode: result.mode,
    sources: result.sources,
    warning: result.warning ?? null,
    logged,
  });
}
