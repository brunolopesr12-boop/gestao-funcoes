import { NextResponse } from "next/server";
import { acknowledgeEvents, IfoodError, pollEvents, fetchOrder } from "@/lib/ifood/client";
import { readIfoodConfig } from "@/lib/ifood/config";
import { normalizeIfoodOrder, stageFromIfood } from "@/lib/kds/normalize";
import type { KdsStage } from "@/lib/kds/types";
import {
  acquirePollSlot,
  claimEvent,
  findOrderByIfoodId,
  loadSettings,
  logKds,
  markEventProcessed,
  patchOrder,
  readPollState,
  releaseEvent,
  savePollResult,
  upsertIfoodOrder,
} from "@/lib/server/kds-repo";
import { isDbConfigured } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** O iFood permite uma chamada de polling a cada 30 segundos. */
const MIN_INTERVAL_MS = 30_000;

type PollSummary = {
  ok: boolean;
  conectado: boolean;
  configurado: boolean;
  mensagem: string;
  eventos: number;
  novos: number;
  atualizados: number;
  cancelados: number;
  ignorados: number;
  aguardando_intervalo?: boolean;
  ultimo_polling?: string | null;
};

/**
 * Ciclo completo da integração:
 *   1. busca eventos no iFood
 *   2. registra cada evento (idempotente — evento repetido não vira pedido novo)
 *   3. busca o detalhe do pedido e grava/atualiza a comanda
 *   4. confirma (acknowledge) os eventos processados
 *
 * A tela do KDS chama esta rota a cada 30s. Nada de credencial passa pelo
 * navegador: tudo acontece aqui no servidor.
 */
async function poll(): Promise<PollSummary> {
  const config = readIfoodConfig();

  if (!isDbConfigured) {
    return {
      ok: false,
      conectado: false,
      configurado: config.ok,
      mensagem: "Banco de dados não configurado no servidor.",
      eventos: 0,
      novos: 0,
      atualizados: 0,
      cancelados: 0,
      ignorados: 0,
    };
  }

  if (!config.ok) {
    const state = await readPollState().catch(() => null);
    return {
      ok: false,
      conectado: false,
      configurado: false,
      mensagem: config.message,
      eventos: 0,
      novos: 0,
      atualizados: 0,
      cancelados: 0,
      ignorados: 0,
      ultimo_polling: state?.last_poll_at ?? null,
    };
  }

  let slot = false;
  try {
    slot = await acquirePollSlot(MIN_INTERVAL_MS);
  } catch (e) {
    return {
      ok: false,
      conectado: false,
      configurado: true,
      mensagem: e instanceof Error ? e.message : String(e),
      eventos: 0,
      novos: 0,
      atualizados: 0,
      cancelados: 0,
      ignorados: 0,
    };
  }

  if (!slot) {
    const state = await readPollState();
    return {
      ok: true,
      conectado: state.last_poll_ok,
      configurado: true,
      mensagem: state.last_poll_ok
        ? "Aguardando o intervalo mínimo de 30s do iFood."
        : state.last_poll_error || "Sem conexão com o iFood.",
      eventos: 0,
      novos: 0,
      atualizados: 0,
      cancelados: 0,
      ignorados: 0,
      aguardando_intervalo: true,
      ultimo_polling: state.last_poll_at,
    };
  }

  const settings = await loadSettings();
  const companyId = process.env.KDS_COMPANY_ID?.trim() || null;

  let events;
  try {
    events = await pollEvents();
  } catch (e) {
    const msg = e instanceof IfoodError ? `${e.message} ${e.body}`.trim() : String(e);
    await savePollResult(false, msg);
    await logKds({ level: "erro", message: "Polling falhou", detail: msg });
    return {
      ok: false,
      conectado: false,
      configurado: true,
      mensagem: msg,
      eventos: 0,
      novos: 0,
      atualizados: 0,
      cancelados: 0,
      ignorados: 0,
    };
  }

  const summary = { novos: 0, atualizados: 0, cancelados: 0, ignorados: 0 };
  const toAck: string[] = [];
  const orderCache = new Map<string, Record<string, unknown>>();

  for (const ev of events) {
    let claimed = false;
    try {
      claimed = await claimEvent(ev);
    } catch (e) {
      await logKds({
        level: "erro",
        message: `Não consegui registrar o evento ${ev.id}`,
        detail: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // Evento repetido: já foi tratado antes. Confirma para o iFood parar de
    // reenviar, mas não cria outra comanda.
    if (!claimed) {
      toAck.push(ev.id);
      summary.ignorados += 1;
      continue;
    }

    const stage = stageFromIfood(ev.fullCode ?? ev.code);
    if (!stage || !ev.orderId) {
      await markEventProcessed(ev.id);
      toAck.push(ev.id);
      summary.ignorados += 1;
      continue;
    }

    try {
      await applyEvent({
        stage,
        orderId: ev.orderId,
        metadata: ev.metadata,
        settings,
        companyId,
        cache: orderCache,
        summary,
      });
      await markEventProcessed(ev.id);
      toAck.push(ev.id);
    } catch (e) {
      // Não confirma o evento: o iFood reenvia e tentamos de novo.
      await releaseEvent(ev.id);
      await logKds({
        level: "erro",
        message: `Falha ao processar evento ${ev.code} do pedido ${ev.orderId}`,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    await acknowledgeEvents(toAck);
  } catch (e) {
    await logKds({
      level: "erro",
      message: "Falha no acknowledgment de eventos",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  await savePollResult(true, "");

  return {
    ok: true,
    conectado: true,
    configurado: true,
    mensagem: "",
    eventos: events.length,
    ...summary,
  };
}

async function applyEvent(args: {
  stage: KdsStage;
  orderId: string;
  metadata?: Record<string, unknown>;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  companyId: string | null;
  cache: Map<string, Record<string, unknown>>;
  summary: { novos: number; atualizados: number; cancelados: number; ignorados: number };
}): Promise<void> {
  const existing = await findOrderByIfoodId(args.orderId);

  // Cancelamento de um pedido que já está na tela: não precisa rebuscar.
  if (args.stage === "cancelado" && existing) {
    const reason =
      typeof args.metadata?.reason === "string"
        ? (args.metadata.reason as string)
        : typeof args.metadata?.cancellationReason === "string"
          ? (args.metadata.cancellationReason as string)
          : "Cancelado pelo iFood";
    await patchOrder(existing.id, {
      stage: "cancelado",
      cancel_reason: reason,
      cancelled_at: new Date().toISOString(),
    });
    args.summary.cancelados += 1;
    return;
  }

  let raw = args.cache.get(args.orderId);
  if (!raw) {
    raw = await fetchOrder(args.orderId);
    args.cache.set(args.orderId, raw);
  }

  const normalized = normalizeIfoodOrder(raw, args.settings);
  if (!normalized.ifoodOrderId) normalized.ifoodOrderId = args.orderId;

  const { created } = await upsertIfoodOrder({
    order: normalized,
    stage: args.stage,
    settings: args.settings,
    companyId: args.companyId,
  });

  if (args.stage === "cancelado") args.summary.cancelados += 1;
  else if (created) args.summary.novos += 1;
  else args.summary.atualizados += 1;
}

export async function GET() {
  try {
    return NextResponse.json(await poll());
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        configurado: false,
        mensagem: e instanceof Error ? e.message : String(e),
        eventos: 0,
        novos: 0,
        atualizados: 0,
        cancelados: 0,
        ignorados: 0,
      },
      { status: 500 },
    );
  }
}

export const POST = GET;
