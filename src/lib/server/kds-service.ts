// Módulo de servidor: regras de avanço do pedido no KDS + espelho no iFood.

import { buildAlerts, buildChecklist, isChecklistComplete } from "@/lib/kds/alerts";
import { rowToOrder, type KdsOrderRow } from "@/lib/kds/row";
import type { KdsStage } from "@/lib/kds/types";
import { IfoodError, sendTransition, type IfoodTransition } from "@/lib/ifood/client";
import { isIfoodConfigured } from "@/lib/ifood/config";
import { findOrder, loadSettings, logKds, patchOrder } from "./kds-repo";

export type KdsAction =
  | "aceitar"
  | "produzir"
  | "pronto"
  | "conferir"
  | "despachar"
  | "ocultar";

export type ActionResult = {
  row: KdsOrderRow;
  ifood: { sent: IfoodTransition[]; skipped: string[] };
  warning?: string;
};

export class KdsRuleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "KdsRuleError";
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();

/**
 * Manda o status para o iFood. Pedidos de teste e pedidos sem integração
 * configurada são registrados como "não enviado" — nunca como enviado.
 */
async function mirror(
  row: KdsOrderRow,
  transitions: IfoodTransition[],
  opts: { optional?: IfoodTransition[] } = {},
): Promise<{ sent: IfoodTransition[]; skipped: string[]; warning?: string }> {
  const sent: IfoodTransition[] = [];
  const skipped: string[] = [];

  if (row.source !== "ifood" || !row.ifood_order_id) {
    return { sent, skipped: [`pedido ${row.source}: nada enviado ao iFood`] };
  }
  if (!isIfoodConfigured()) {
    return {
      sent,
      skipped: ["integração iFood não configurada"],
      warning: "Integração iFood não configurada — o status mudou só aqui no KDS.",
    };
  }

  for (const t of transitions) {
    try {
      await sendTransition(row.ifood_order_id, t);
      sent.push(t);
    } catch (e) {
      const optional = opts.optional?.includes(t);
      const msg = e instanceof IfoodError ? `${e.message} ${e.body}`.trim() : String(e);
      await logKds({
        order_id: row.id,
        level: optional ? "info" : "erro",
        message: `Status "${t}" não aceito pelo iFood`,
        detail: msg,
      });
      if (optional) {
        skipped.push(`${t}: ${msg}`);
        continue;
      }
      throw e;
    }
  }
  return { sent, skipped };
}

function ensureStage(row: KdsOrderRow, allowed: KdsStage[]): void {
  if (row.stage === "cancelado") {
    throw new KdsRuleError("Pedido cancelado pelo iFood — não pode avançar.", 409);
  }
  if (!allowed.includes(row.stage as KdsStage)) {
    throw new KdsRuleError(
      `Pedido está em "${row.stage}" e não pode receber essa ação.`,
      409,
    );
  }
}

export async function runAction(args: {
  id: string;
  action: KdsAction;
  operator?: string;
  checklist?: string[];
  force?: boolean;
}): Promise<ActionResult> {
  const row = await findOrder(args.id);
  if (!row) throw new KdsRuleError("Pedido não encontrado.", 404);

  const settings = await loadSettings();
  const order = rowToOrder(row);
  const alerts = buildAlerts(order, settings);

  switch (args.action) {
    /* ------------------------- aceitar (novo) --------------------- */
    case "aceitar": {
      ensureStage(row, ["novo"]);
      const res = await mirror(row, ["confirm", "startPreparation"], {
        // startPreparation é opcional: nem toda loja tem o status habilitado.
        optional: ["startPreparation"],
      });
      const updated = await patchOrder(row.id, {
        stage: "producao",
        confirmed_at: nowIso(),
        sync_error: res.warning ?? "",
      });
      return { row: updated, ifood: res, warning: res.warning };
    }

    /* ------------------------- voltar a produzir ------------------ */
    case "produzir": {
      ensureStage(row, ["pronto"]);
      const updated = await patchOrder(row.id, {
        stage: "producao",
        checklist: [],
        checked_at: null,
        checked_by: "",
        forced: false,
      });
      return { row: updated, ifood: { sent: [], skipped: [] } };
    }

    /* ------------------------- pronto ----------------------------- */
    case "pronto": {
      ensureStage(row, ["novo", "producao"]);
      const transitions: IfoodTransition[] =
        row.stage === "novo"
          ? ["confirm", "startPreparation", "readyToPickup"]
          : ["readyToPickup"];
      const res = await mirror(row, transitions, {
        optional: ["startPreparation", "readyToPickup"],
      });
      const updated = await patchOrder(row.id, {
        stage: "pronto",
        confirmed_at: row.confirmed_at ?? nowIso(),
        ready_at: nowIso(),
        sync_error: res.warning ?? "",
      });
      return { row: updated, ifood: res, warning: res.warning };
    }

    /* ------------------------- conferência ------------------------ */
    case "conferir": {
      ensureStage(row, ["pronto"]);
      const checklist = buildChecklist(order, alerts);
      const checked = args.checklist ?? [];
      if (!isChecklistComplete(checklist, checked) && !args.force) {
        throw new KdsRuleError(
          "Ainda faltam itens obrigatórios na conferência.",
          422,
        );
      }
      const updated = await patchOrder(row.id, {
        checklist: checked,
        checked_at: nowIso(),
        checked_by: (args.operator ?? "").slice(0, 80),
        forced: Boolean(args.force),
      });
      return { row: updated, ifood: { sent: [], skipped: [] } };
    }

    /* ------------------------- despacho --------------------------- */
    case "despachar": {
      ensureStage(row, ["pronto"]);

      const blocking = alerts.filter((a) => a.blocking);
      if (blocking.length > 0 && !row.checked_at && !args.force) {
        throw new KdsRuleError(
          "Pedido tem alertas críticos e ainda não foi conferido. Confira antes de despachar.",
          428,
        );
      }

      // Entrega do iFood: quem despacha é o entregador do iFood; o status
      // correto que a loja envia é "pronto para retirada". Entrega própria:
      // o despacho é da loja e o iFood aceita /dispatch.
      const transitions: IfoodTransition[] = order.delivery.byMerchant
        ? ["dispatch"]
        : [];
      const res = await mirror(row, transitions);
      if (!order.delivery.byMerchant) {
        res.skipped.push(
          "entrega pelo iFood: o despacho é feito pelo entregador; o KDS já enviou 'pronto para retirada'.",
        );
      }

      const updated = await patchOrder(row.id, {
        stage: "despachado",
        dispatched_at: nowIso(),
        dispatch_method: order.delivery.byMerchant ? "dispatch" : "readyToPickup",
        forced: row.forced || Boolean(args.force),
        sync_error: res.warning ?? "",
      });
      await logKds({
        order_id: row.id,
        level: "info",
        message: `Pedido ${row.display_id} despachado`,
        detail: { operador: args.operator ?? "", forcado: Boolean(args.force) },
      });
      return { row: updated, ifood: res, warning: res.warning };
    }

    /* ------------------------- ocultar ---------------------------- */
    case "ocultar": {
      // Só some da tela (cancelado ou já despachado). Nada vai ao iFood.
      const updated = await patchOrder(row.id, { hidden_at: nowIso() });
      return { row: updated, ifood: { sent: [], skipped: [] } };
    }

    default:
      throw new KdsRuleError("Ação desconhecida.", 400);
  }
}
