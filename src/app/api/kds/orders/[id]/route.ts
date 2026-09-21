import { NextResponse } from "next/server";
import { IfoodError } from "@/lib/ifood/client";
import { KdsRuleError, runAction, type KdsAction } from "@/lib/server/kds-service";

export const dynamic = "force-dynamic";

const ACTIONS: KdsAction[] = [
  "aceitar",
  "produzir",
  "pronto",
  "conferir",
  "despachar",
  "ocultar",
];

/**
 * Avança o pedido de etapa e espelha o status no iFood.
 * O navegador só manda a ação — token e credenciais ficam no servidor.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: {
    acao?: string;
    operador?: string;
    conferencia?: string[];
    forcar?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }

  const action = body.acao as KdsAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { ok: false, erro: `Ação inválida. Use uma de: ${ACTIONS.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const result = await runAction({
      id,
      action,
      operator: body.operador,
      checklist: Array.isArray(body.conferencia) ? body.conferencia : undefined,
      force: body.forcar === true,
    });
    return NextResponse.json({
      ok: true,
      pedido: result.row,
      ifood: result.ifood,
      aviso: result.warning ?? "",
    });
  } catch (e) {
    if (e instanceof KdsRuleError) {
      return NextResponse.json({ ok: false, erro: e.message }, { status: e.status });
    }
    if (e instanceof IfoodError) {
      return NextResponse.json(
        {
          ok: false,
          erro: e.message,
          detalhe: e.body,
          ifood: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
