import { NextResponse, type NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/server";
import { authenticateApiKey, storeOfCompany } from "@/lib/ops/server/api-key";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/integrations/estoque?store=<uuid>&page=0&size=200
 * Saldo consolidado por produto (view v_stock_by_product). Escopo: estoque.ler
 * Também aceita &lotes=1 para devolver saldo por lote/local (v_stock_balances).
 */
export async function GET(req: NextRequest) {
  const { ctx, denied } = await authenticateApiKey(req, "estoque.ler");
  if (denied) return denied;
  if (!ctx) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const url = new URL(req.url);
  const store = url.searchParams.get("store") ?? "";
  if (!store || !(await storeOfCompany(store, ctx.companyId))) {
    return NextResponse.json({ ok: false, erro: "Informe ?store=<id> de uma unidade da sua empresa." }, { status: 400 });
  }
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const size = Math.min(500, Math.max(1, Number(url.searchParams.get("size") ?? 200) || 200));
  const byLot = url.searchParams.get("lotes") === "1";
  const sb = supabaseService();
  const view = byLot ? "v_stock_balances" : "v_stock_by_product";
  let q = sb.from(view).select("*", { count: "exact" }).eq("store_id", store).range(page * size, page * size + size - 1);
  q = byLot ? q.order("product_name").order("expires_at", { ascending: true, nullsFirst: false }) : q.order("product_name");
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 502 });
  return NextResponse.json({ ok: true, store, page, size, total: count ?? 0, rows: data ?? [] });
}
