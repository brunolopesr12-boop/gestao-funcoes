import { NextResponse } from "next/server";
import { buildAlerts } from "@/lib/kds/alerts";
import { normalizeIfoodOrder } from "@/lib/kds/normalize";
import { orderToColumns } from "@/lib/kds/row";
import { SAMPLE_ORDERS, type SampleKey } from "@/lib/kds/samples";
import { loadSettings, ORDERS_TABLE } from "@/lib/server/kds-repo";
import { db, isDbConfigured } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * Cria uma comanda de TESTE (nunca toca no iFood).
 *
 * Serve para a equipe treinar o fluxo e para conferir os alertas antes de a
 * integração estar homologada. A comanda nasce marcada como `teste` e aparece
 * com selo 🧪 na tela — não há como confundir com pedido real.
 */
export async function POST(request: Request) {
  if (!isDbConfigured) {
    return NextResponse.json({ ok: false, erro: "Banco não configurado." }, { status: 500 });
  }

  let body: { tipo?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* corpo opcional */
  }

  const key = (body.tipo ?? "completo") as SampleKey;
  const sample = SAMPLE_ORDERS[key] ?? SAMPLE_ORDERS.completo;

  const settings = await loadSettings();
  const raw = sample.build();
  const normalized = { ...normalizeIfoodOrder(raw, settings), source: "teste" as const };
  const alerts = buildAlerts({ ...normalized, id: "", stage: "novo" }, settings);

  const { data, error } = await db()
    .from(ORDERS_TABLE)
    .insert({
      ...orderToColumns(normalized),
      stage: "novo",
      alerts,
      is_test: true,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, pedido: data });
}
