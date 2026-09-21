import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/vila-gpt/server/auth";
import {
  invalidateSnapshot,
  isDbConfigured,
  isMissingTable,
  isUuid,
  newId,
  SCHEMA_HINT,
  serverSupabase,
} from "@/lib/vila-gpt/server/db";
import { KB_KINDS, type KbArticle, type KbKind } from "@/lib/types";

export const dynamic = "force-dynamic";

type Input = Partial<Record<keyof KbArticle, unknown>>;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Valida e normaliza os campos editáveis. */
function fields(input: Input, partial: boolean) {
  const out: Partial<KbArticle> = {};
  const has = (k: keyof KbArticle) => !partial || input[k] !== undefined;

  if (has("company_id")) {
    out.company_id = isUuid(input.company_id) ? input.company_id : null;
  }
  if (has("kind")) {
    const kind = str(input.kind, 40) as KbKind;
    out.kind = (KB_KINDS as readonly string[]).includes(kind) ? kind : "procedimento";
  }
  if (has("category")) out.category = str(input.category, 80);
  if (has("title")) out.title = str(input.title, 200);
  if (has("question")) out.question = str(input.question, 500);
  if (has("content")) out.content = str(input.content, 20_000);
  if (has("keywords")) out.keywords = str(input.keywords, 500);
  if (has("official")) out.official = input.official !== false;
  if (has("position")) {
    out.position = typeof input.position === "number" && Number.isFinite(input.position)
      ? Math.round(input.position)
      : 0;
  }
  if (has("updated_by")) out.updated_by = str(input.updated_by, 80);
  return out;
}

function guard(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }
  if (!isAdmin(req)) {
    return NextResponse.json({ erro: "Acesso restrito a administradores." }, { status: 401 });
  }
  return null;
}

async function readJson(req: Request): Promise<Input | null> {
  try {
    const b = (await req.json()) as unknown;
    return typeof b === "object" && b !== null ? (b as Input) : null;
  } catch {
    return null;
  }
}

async function logActivity(entry: {
  company_id: string | null;
  entity_name: string;
  action: string;
  actor: string;
  detail?: string;
}) {
  try {
    await serverSupabase().from("activity_log").insert({
      id: newId(),
      company_id: entry.company_id,
      entity: "base de conhecimento",
      entity_name: entry.entity_name,
      action: entry.action,
      detail: entry.detail ?? "",
      actor: entry.actor,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[vila-gpt] activity_log:", e);
  }
}

/** Criar artigo. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const input = await readJson(req);
  if (!input) return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });

  const f = fields(input, false);
  if (!f.title) return NextResponse.json({ erro: "Informe o título." }, { status: 400 });
  if (!f.content && !f.question) {
    return NextResponse.json({ erro: "Informe o conteúdo." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const row: KbArticle = {
    id: newId(),
    company_id: f.company_id ?? null,
    kind: f.kind ?? "procedimento",
    category: f.category ?? "",
    title: f.title,
    question: f.question ?? "",
    content: f.content ?? "",
    keywords: f.keywords ?? "",
    official: f.official ?? true,
    position: f.position ?? 0,
    updated_by: f.updated_by ?? "",
    created_at: now,
    updated_at: now,
  };
  const { error } = await serverSupabase().from("kb_articles").insert(row);
  if (error) {
    console.error("[vila-gpt] criar informação:", error.message);
    if (isMissingTable(error)) return NextResponse.json({ erro: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ erro: "Não consegui salvar a informação." }, { status: 502 });
  }
  invalidateSnapshot();
  await logActivity({
    company_id: row.company_id,
    entity_name: row.title,
    action: "criou",
    actor: row.updated_by,
    detail: row.official ? "oficial" : "rascunho",
  });
  return NextResponse.json({ article: row });
}

/** Editar artigo. */
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const input = await readJson(req);
  if (!input || !isUuid(input.id)) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const patch = fields(input, true);
  if (patch.title !== undefined && !patch.title) {
    return NextResponse.json({ erro: "Informe o título." }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  const sb = serverSupabase();
  const { data: before } = await sb.from("kb_articles").select("*").eq("id", input.id).maybeSingle();
  if (!before) return NextResponse.json({ erro: "Informação não encontrada." }, { status: 404 });
  const { error } = await sb.from("kb_articles").update(patch).eq("id", input.id);
  if (error) {
    console.error("[vila-gpt] editar informação:", error.message);
    return NextResponse.json({ erro: "Não consegui salvar a alteração." }, { status: 502 });
  }
  invalidateSnapshot();
  const row = { ...(before as KbArticle), ...patch } as KbArticle;
  await logActivity({
    company_id: row.company_id ?? null,
    entity_name: row.title,
    action: "editou",
    actor: patch.updated_by ?? "",
    detail: patch.official === undefined ? "" : patch.official ? "oficial" : "rascunho",
  });
  return NextResponse.json({ article: row });
}

/** Excluir artigo. */
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const actor = url.searchParams.get("by") ?? "";
  if (!isUuid(id)) return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });

  const sb = serverSupabase();
  const { data: before } = await sb.from("kb_articles").select("*").eq("id", id).maybeSingle();
  const { error } = await sb.from("kb_articles").delete().eq("id", id);
  if (error) {
    console.error("[vila-gpt] excluir informação:", error.message);
    return NextResponse.json({ erro: "Não consegui excluir a informação." }, { status: 502 });
  }
  invalidateSnapshot();
  const b = before as KbArticle | null;
  await logActivity({
    company_id: b?.company_id ?? null,
    entity_name: b?.title ?? "",
    action: "excluiu",
    actor: actor.slice(0, 80),
  });
  return NextResponse.json({ ok: true });
}
