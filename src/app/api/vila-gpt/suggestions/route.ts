import { NextResponse } from "next/server";
import { frequentQuestions } from "@/lib/vila-gpt/analytics";
import { isDbConfigured, isUuid, serverSupabase } from "@/lib/vila-gpt/server/db";
import type { GptQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Perguntas mais frequentes (já respondidas) para sugerir na tela do chat. */
export async function GET(req: Request) {
  if (!isDbConfigured()) return NextResponse.json({ frequent: [] });
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  try {
    let query = serverSupabase()
      .from("gpt_questions")
      .select("*")
      .eq("found", true)
      .order("created_at", { ascending: false })
      .limit(300);
    if (isUuid(companyId)) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as GptQuestion[];
    return NextResponse.json({ frequent: frequentQuestions(rows, { limit: 6 }) });
  } catch (e) {
    console.error("[vila-gpt] sugestões:", e);
    return NextResponse.json({ frequent: [] });
  }
}
