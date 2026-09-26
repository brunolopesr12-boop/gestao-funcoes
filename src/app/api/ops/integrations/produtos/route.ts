import { NextResponse, type NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/server";
import { authenticateApiKey } from "@/lib/ops/server/api-key";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/integrations/produtos?page=0&size=200&atualizado_desde=<iso>
 * Catálogo de produtos da empresa (para PDV/ERP/BI). Escopo: produtos.ler
 */
export async function GET(req: NextRequest) {
  const { ctx, denied } = await authenticateApiKey(req, "produtos.ler");
  if (denied) return denied;
  if (!ctx) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const size = Math.min(500, Math.max(1, Number(url.searchParams.get("size") ?? 200) || 200));
  const since = url.searchParams.get("atualizado_desde");
  let q = supabaseService()
    .from("products")
    .select("id, name, internal_code, sku, barcode, product_kind, category_id, stock_unit_id, purchase_unit_id, purchase_factor, cost, min_stock, max_stock, storage_type, active, updated_at, categories(name), units:stock_unit_id(code)", { count: "exact" })
    .eq("company_id", ctx.companyId)
    .order("name")
    .range(page * size, page * size + size - 1);
  if (since) q = q.gte("updated_at", since);
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 502 });
  return NextResponse.json({ ok: true, page, size, total: count ?? 0, rows: data ?? [] });
}
