import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseService } from "@/lib/supabase/server";
import { authenticateApiKey, logIntegrationEvent, storeOfCompany } from "@/lib/ops/server/api-key";

export const dynamic = "force-dynamic";

const Body = z.object({
  store_id: z.string().uuid(),
  provider: z.string().min(1).max(40).default("externo"),
  /** id único da operação no sistema de origem (idempotência) */
  external_id: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid().optional(),
        barcode: z.string().max(60).optional(),
        internal_code: z.string().max(40).optional(),
        quantity: z.number().positive(),
        /** consumo (venda/uso) ou entrada (devolução) */
        type: z.enum(["consumo", "entrada"]).default("consumo"),
        reason: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(200),
});

function opId(seed: string): string {
  // uuid v5-like determinístico a partir do external_id (idempotência)
  const h = Array.from(new TextEncoder().encode(seed)).reduce<number[]>((acc, b, i) => {
    acc[i % 16] = (acc[i % 16] ?? 0) ^ b ^ ((i * 31) & 0xff);
    return acc;
  }, new Array(16).fill(0));
  const hex = h.map((x) => (x & 0xff).toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * POST /api/ops/integrations/movimentos — baixa (consumo) ou entrada de estoque
 * vinda de um sistema externo (PDV, pedidos, iFood...). Escopo: estoque.movimentar
 * Body: { store_id, provider, external_id, items: [{ product_id | barcode | internal_code, quantity, type }] }
 * Idempotente por external_id + índice do item.
 */
export async function POST(req: NextRequest) {
  const { ctx, denied } = await authenticateApiKey(req, "estoque.movimentar");
  if (denied || !ctx) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: "Corpo inválido.", detalhes: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  if (!(await storeOfCompany(body.store_id, ctx.companyId))) {
    return NextResponse.json({ ok: false, erro: "Unidade não pertence à empresa da chave." }, { status: 403 });
  }
  const sb = supabaseService();
  const results: unknown[] = [];
  let failed = 0;
  for (const [i, it] of body.items.entries()) {
    let productId = it.product_id ?? null;
    if (!productId) {
      let q = sb.from("products").select("id").eq("company_id", ctx.companyId).eq("active", true).limit(1);
      q = it.barcode ? q.eq("barcode", it.barcode) : q.eq("internal_code", it.internal_code ?? "");
      const { data } = await q.maybeSingle();
      productId = (data?.id as string) ?? null;
    }
    if (!productId) {
      failed++;
      results.push({ index: i, ok: false, erro: "Produto não encontrado." });
      continue;
    }
    const clientOp = opId(`${ctx.companyId}:${body.provider}:${body.external_id}:${i}`);
    try {
      if (it.type === "consumo") {
        const { data, error } = await sb.rpc("ops_consume", {
          p_store: body.store_id, p_product: productId, p_quantity: it.quantity, p_lot: null, p_location: null,
          p_reason: it.reason ?? `integração ${body.provider} ${body.external_id}`, p_notes: `via API (${ctx.name})`, p_client_op_id: clientOp, p_unit: null,
        });
        if (error) throw new Error(error.message);
        results.push({ index: i, ok: true, product_id: productId, result: data });
      } else {
        const { data, error } = await sb.rpc("ops_create_lot", {
          p_store: body.store_id, p_product: productId, p_location: null, p_quantity: it.quantity, p_lot_code: "", p_expires_at: null, p_unit_cost: null,
          p_origin: "devolucao", p_notes: `via API (${ctx.name}) ${body.provider} ${body.external_id}`, p_unit: null, p_supplier: null, p_client_op_id: clientOp, p_produced_at: null,
        });
        if (error) throw new Error(error.message);
        results.push({ index: i, ok: true, product_id: productId, lot_id: data });
      }
    } catch (e) {
      failed++;
      results.push({ index: i, ok: false, product_id: productId, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  await logIntegrationEvent(ctx.companyId, body.store_id, body.provider, "stock.movement", { external_id: body.external_id, items: body.items.length, failed }, failed ? "erro" : "processado", failed ? `${failed} item(ns) com erro` : "");
  return NextResponse.json({ ok: failed === 0, processed: body.items.length - failed, failed, results }, { status: failed === body.items.length ? 422 : 200 });
}
