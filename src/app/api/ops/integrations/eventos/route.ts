import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseService } from "@/lib/supabase/server";
import { authenticateApiKey, storeOfCompany } from "@/lib/ops/server/api-key";

export const dynamic = "force-dynamic";

const Body = z.object({
  provider: z.string().min(1).max(40),
  kind: z.string().min(1).max(80),
  store_id: z.string().uuid().optional(),
  payload: z.unknown(),
});

/**
 * POST /api/ops/integrations/eventos — recebe um evento externo (pedido do
 * iFood, venda do PDV, leitura de balança...) e guarda na fila
 * integration_events para processamento. Escopo: eventos.enviar
 * GET — lista eventos pendentes (escopo eventos.ler), para o sistema externo
 * consumir o "outbox" (ex.: enviar estoque ao ERP).
 */
export async function POST(req: NextRequest) {
  const { ctx, denied } = await authenticateApiKey(req, "eventos.enviar");
  if (denied) return denied;
  if (!ctx) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: "Corpo inválido.", detalhes: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;
  if (b.store_id && !(await storeOfCompany(b.store_id, ctx.companyId))) {
    return NextResponse.json({ ok: false, erro: "Unidade não pertence à empresa da chave." }, { status: 403 });
  }
  const { data, error } = await supabaseService()
    .from("integration_events")
    .insert({ company_id: ctx.companyId, store_id: b.store_id ?? null, direction: "in", provider: b.provider, kind: b.kind, payload: b.payload ?? {}, status: "pendente" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 502 });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { ctx, denied } = await authenticateApiKey(req, "eventos.ler");
  if (denied) return denied;
  if (!ctx) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pendente";
  const { data, error } = await supabaseService()
    .from("integration_events")
    .select("*")
    .eq("company_id", ctx.companyId)
    .eq("status", status)
    .order("created_at")
    .limit(200);
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 502 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}
