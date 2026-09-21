// Módulo de servidor: leitura/escrita das tabelas do KDS.

import { buildAlerts } from "@/lib/kds/alerts";
import {
  mergeStage,
  orderToColumns,
  rowToOrder,
  settingsFromRow,
  type KdsOrderRow,
  type KdsSettingsRow,
} from "@/lib/kds/row";
import { DEFAULT_SETTINGS, type KdsOrder, type KdsSettings, type KdsStage } from "@/lib/kds/types";
import { db } from "./supabase-admin";

export const ORDERS_TABLE = "kds_orders";
export const EVENTS_TABLE = "kds_ifood_events";
export const SETTINGS_TABLE = "kds_settings";
export const LOG_TABLE = "kds_log";

export async function loadSettings(): Promise<KdsSettings> {
  try {
    const { data } = await db()
      .from(SETTINGS_TABLE)
      .select("*")
      .eq("id", "default")
      .maybeSingle();
    return settingsFromRow(data as Partial<KdsSettingsRow> | null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function logKds(entry: {
  order_id?: string | null;
  level: "info" | "erro";
  message: string;
  detail?: unknown;
}): Promise<void> {
  try {
    await db().from(LOG_TABLE).insert({
      order_id: entry.order_id ?? null,
      level: entry.level,
      message: entry.message.slice(0, 500),
      detail: entry.detail === undefined ? {} : { detail: entry.detail },
    });
  } catch {
    // Log nunca pode derrubar o fluxo do pedido.
  }
}

/**
 * Marca o evento como recebido. Devolve `false` quando o evento já tinha
 * sido processado antes — é o que impede pedido duplicado quando o iFood
 * reenvia o mesmo evento (ou quando dois pollings acontecem juntos).
 */
export async function claimEvent(event: {
  id: string;
  code: string;
  orderId: string;
  createdAt?: string;
}): Promise<boolean> {
  const { error } = await db()
    .from(EVENTS_TABLE)
    .insert({
      id: event.id,
      code: event.code,
      ifood_order_id: event.orderId,
      event_at: event.createdAt ?? new Date().toISOString(),
    });
  if (!error) return true;
  // 23505 = unique_violation -> evento repetido, ignorar em silêncio.
  if (error.code === "23505") return false;
  throw new Error(`Falha ao registrar evento ${event.id}: ${error.message}`);
}

export async function findOrderByIfoodId(
  ifoodOrderId: string,
): Promise<KdsOrderRow | null> {
  const { data, error } = await db()
    .from(ORDERS_TABLE)
    .select("*")
    .eq("ifood_order_id", ifoodOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as KdsOrderRow | null) ?? null;
}

export async function findOrder(id: string): Promise<KdsOrderRow | null> {
  const { data, error } = await db()
    .from(ORDERS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as KdsOrderRow | null) ?? null;
}

/**
 * Grava (ou atualiza) o pedido vindo do iFood.
 *
 * Idempotente pelo `ifood_order_id`: o mesmo pedido nunca vira duas comandas.
 * A etapa nunca retrocede — eventos podem chegar fora de ordem.
 */
export async function upsertIfoodOrder(args: {
  order: Omit<KdsOrder, "id" | "stage">;
  stage: KdsStage;
  settings: KdsSettings;
  companyId?: string | null;
}): Promise<{ row: KdsOrderRow; created: boolean }> {
  const existing = await findOrderByIfoodId(args.order.ifoodOrderId);
  const stage = existing
    ? mergeStage((existing.stage as KdsStage) ?? "novo", args.stage)
    : args.stage;

  const full: KdsOrder = { ...args.order, id: existing?.id ?? "", stage };
  const alerts = buildAlerts(full, args.settings);

  const columns = {
    ...orderToColumns(args.order),
    stage,
    alerts,
    company_id: args.companyId ?? existing?.company_id ?? null,
    sync_error: "",
    ...(stage === "cancelado" && !existing?.cancelled_at
      ? { cancelled_at: new Date().toISOString() }
      : {}),
  };

  if (existing) {
    const { data, error } = await db()
      .from(ORDERS_TABLE)
      .update(columns)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { row: data as KdsOrderRow, created: false };
  }

  const { data, error } = await db()
    .from(ORDERS_TABLE)
    .insert(columns)
    .select("*")
    .single();

  if (error) {
    // Corrida entre dois pollings: o outro já inseriu — busca e segue.
    if (error.code === "23505") {
      const row = await findOrderByIfoodId(args.order.ifoodOrderId);
      if (row) return { row, created: false };
    }
    throw new Error(error.message);
  }
  return { row: data as KdsOrderRow, created: true };
}

/** Atualiza colunas do pedido e devolve a linha já recalculada. */
export async function patchOrder(
  id: string,
  patch: Partial<KdsOrderRow> & { alerts?: unknown },
): Promise<KdsOrderRow> {
  const { data, error } = await db()
    .from(ORDERS_TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as KdsOrderRow;
}

export { rowToOrder };

/** Desfaz o `claimEvent` quando o processamento falhou, para tentar de novo. */
export async function releaseEvent(id: string): Promise<void> {
  try {
    await db().from(EVENTS_TABLE).delete().eq("id", id);
  } catch {
    /* melhor esforço */
  }
}

export async function markEventProcessed(id: string): Promise<void> {
  try {
    await db()
      .from(EVENTS_TABLE)
      .update({ processed_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    /* melhor esforço */
  }
}

/**
 * Trava distribuída simples para o polling: o iFood permite 1 chamada a cada
 * 30s, e em produção pode haver mais de uma instância chamando. Só consegue
 * o "slot" quem atualizar a linha cujo último polling já passou do intervalo.
 */
export async function acquirePollSlot(minIntervalMs: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - minIntervalMs).toISOString();
  const { data, error } = await db()
    .from(SETTINGS_TABLE)
    .update({ last_poll_at: new Date().toISOString() })
    .eq("id", "default")
    .or(`last_poll_at.is.null,last_poll_at.lt.${cutoff}`)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function savePollResult(ok: boolean, message: string): Promise<void> {
  try {
    await db()
      .from(SETTINGS_TABLE)
      .update({ last_poll_ok: ok, last_poll_error: message.slice(0, 500) })
      .eq("id", "default");
  } catch {
    /* melhor esforço */
  }
}

export async function readPollState(): Promise<{
  last_poll_at: string | null;
  last_poll_ok: boolean;
  last_poll_error: string;
}> {
  const { data } = await db()
    .from(SETTINGS_TABLE)
    .select("last_poll_at, last_poll_ok, last_poll_error")
    .eq("id", "default")
    .maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    last_poll_at: (row.last_poll_at as string | null) ?? null,
    last_poll_ok: (row.last_poll_ok as boolean) ?? false,
    last_poll_error: (row.last_poll_error as string) ?? "",
  };
}
