import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Varredura diária (Vercel Cron, ver vercel.json): para cada unidade ativa,
 * gera os checklists do dia e atualiza os alertas de validade, estoque mínimo,
 * checklists atrasados, produções pendentes e tarefas atrasadas.
 *
 * Protegida por CRON_SECRET (a Vercel envia "Authorization: Bearer <CRON_SECRET>").
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 */
export async function GET(req: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = req.headers.get("authorization") ?? "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ ok: false, erro: "SUPABASE_SERVICE_ROLE_KEY não configurada; a varredura roda ao abrir o painel/alertas." }, { status: 501 });
  }
  const sb = supabaseService();
  const { data: stores, error } = await sb.from("stores").select("id, name").eq("active", true);
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 502 });

  const out: { store: string; checklists?: number; alerts?: number; erro?: string }[] = [];
  for (const s of stores ?? []) {
    try {
      const { data: n, error: e1 } = await sb.rpc("ops_generate_checklists", { p_store: s.id, p_date: new Date().toISOString().slice(0, 10) });
      if (e1) throw e1;
      const { data: r, error: e2 } = await sb.rpc("ops_refresh_alerts", { p_store: s.id });
      if (e2) throw e2;
      out.push({ store: s.name, checklists: Number(n ?? 0), alerts: Number((r as { touched?: number })?.touched ?? 0) });
    } catch (e) {
      out.push({ store: s.name, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, executado_em: new Date().toISOString(), unidades: out });
}
