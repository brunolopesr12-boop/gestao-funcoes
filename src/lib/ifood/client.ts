// Módulo de servidor: só é importado por rotas em src/app/api.

/**
 * Cliente da Merchant API do iFood (oficial).
 *
 * Cobre exatamente o que o KDS precisa:
 *   - polling de eventos + acknowledgment (obrigatório pelo iFood)
 *   - detalhe do pedido
 *   - mudança de status: confirmar, iniciar preparo, pronto, despachar
 *
 * Sem scraping e sem simulação: se faltar credencial, cada chamada devolve
 * erro explícito em vez de fingir que funcionou.
 */
import { getAccessToken, IfoodError, invalidateToken } from "./auth";
import { readIfoodConfig } from "./config";

export type IfoodEvent = {
  id: string;
  code: string;
  fullCode?: string;
  orderId: string;
  merchantId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  /** Usado internamente para repetir uma vez após 401. */
  retryOn401?: boolean;
};

async function call(path: string, opts: RequestOptions = {}): Promise<Response> {
  const status = readIfoodConfig();
  if (!status.ok) throw new IfoodError(status.message, 503);

  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${status.config.baseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });

  if (res.status === 401 && opts.retryOn401 !== false) {
    invalidateToken();
    return call(path, { ...opts, retryOn401: false });
  }
  return res;
}

async function failure(res: Response, what: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new IfoodError(
    `${what} falhou no iFood (HTTP ${res.status}).`,
    res.status,
    body.slice(0, 500),
  );
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

/**
 * Busca os eventos pendentes. O iFood permite 1 chamada a cada 30s —
 * quem chama é responsável por respeitar o intervalo (ver poll/route.ts).
 */
export async function pollEvents(): Promise<IfoodEvent[]> {
  const status = readIfoodConfig();
  if (!status.ok) throw new IfoodError(status.message, 503);

  const res = await call("/events/v1.0/events:polling", {
    headers: { "x-polling-merchants": status.config.merchantIds.join(",") },
  });

  if (res.status === 204) return [];
  if (!res.ok) await failure(res, "Polling de eventos");

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e.id === "string")
    .map((e) => ({
      id: String(e.id),
      code: String(e.code ?? e.fullCode ?? ""),
      fullCode: e.fullCode ? String(e.fullCode) : undefined,
      orderId: String(e.orderId ?? ""),
      merchantId: e.merchantId ? String(e.merchantId) : undefined,
      createdAt: e.createdAt ? String(e.createdAt) : undefined,
      metadata: (e.metadata ?? undefined) as Record<string, unknown> | undefined,
    }));
}

/**
 * Confirma o recebimento dos eventos. Sem isso o iFood reentrega os mesmos
 * eventos indefinidamente.
 */
export async function acknowledgeEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // O iFood aceita no máximo 2000 ids por chamada.
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500).map((id) => ({ id }));
    const res = await call("/events/v1.0/events/acknowledgment", {
      method: "POST",
      body: slice,
    });
    if (!res.ok && res.status !== 202) await failure(res, "Acknowledgment de eventos");
  }
}

/* ------------------------------------------------------------------ */
/* Pedido                                                              */
/* ------------------------------------------------------------------ */

export async function fetchOrder(orderId: string): Promise<Record<string, unknown>> {
  const res = await call(`/order/v1.0/orders/${encodeURIComponent(orderId)}`);
  if (!res.ok) await failure(res, `Busca do pedido ${orderId}`);
  return (await res.json()) as Record<string, unknown>;
}

export type IfoodTransition =
  | "confirm"
  | "startPreparation"
  | "readyToPickup"
  | "dispatch";

/** Envia a mudança de status para o iFood. Devolve o HTTP status. */
export async function sendTransition(
  orderId: string,
  transition: IfoodTransition,
): Promise<number> {
  const res = await call(
    `/order/v1.0/orders/${encodeURIComponent(orderId)}/${transition}`,
    { method: "POST" },
  );
  if (!res.ok && res.status !== 202) await failure(res, `Status "${transition}"`);
  return res.status;
}

export { IfoodError };
