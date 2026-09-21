import { NextResponse } from "next/server";
import { frequentTopics } from "@/lib/vila-gpt/analytics";
import { buildKnowledge } from "@/lib/vila-gpt/knowledge";
import { isDbConfigured, isUuid, loadSnapshot, selectAll } from "@/lib/vila-gpt/server/db";
import type { GptQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Sugestões para a tela do chat: os assuntos oficiais mais perguntados.
 * Nunca devolve texto digitado por funcionários — só o título/pergunta
 * cadastrado na fonte oficial.
 */
export async function GET(req: Request) {
  if (!isDbConfigured()) return NextResponse.json({ frequent: [] });
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  try {
    const [rows, snapshot] = await Promise.all([
      selectAll<GptQuestion>("gpt_questions", {
        eq: [["found", true], ...(isUuid(companyId) ? [["company_id", companyId] as [string, string]] : [])],
        order: { column: "created_at", ascending: false },
        max: 300,
      }),
      loadSnapshot(),
    ]);
    const docs = buildKnowledge(snapshot, { companyId: isUuid(companyId) ? companyId : null });
    const byId = new Map(docs.map((d) => [d.id, d]));
    const frequent: string[] = [];
    for (const t of frequentTopics(rows, { limit: 12 })) {
      const doc = t.source ? byId.get(t.source.id) : undefined;
      if (!doc) continue;
      const label = doc.question || doc.title;
      if (label && !frequent.includes(label)) frequent.push(label);
      if (frequent.length >= 6) break;
    }
    return NextResponse.json({ frequent });
  } catch (e) {
    console.error("[vila-gpt] sugestões:", e instanceof Error ? e.message : e);
    return NextResponse.json({ frequent: [] });
  }
}
