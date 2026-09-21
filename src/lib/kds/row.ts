/**
 * Ponte entre a linha da tabela `kds_orders` e o objeto `KdsOrder` usado
 * pela tela. O pedido normalizado fica em `payload` (jsonb); as colunas
 * soltas existem só para consulta/índice e para o banco ser a fonte da
 * verdade das etapas.
 */
import { money, num } from "./money";
import {
  DEFAULT_SETTINGS,
  KDS_STAGES,
  type KdsOrder,
  type KdsSettings,
  type KdsStage,
} from "./types";

export type KdsOrderRow = {
  id: string;
  company_id: string | null;
  source: string;
  ifood_order_id: string;
  merchant_id: string;
  display_id: string;
  customer_name: string;
  order_type: string;
  stage: string;
  ifood_status: string;
  placed_at: string;
  total: number;
  payment_pending: number;
  payment_prepaid: number;
  change_for: number;
  is_test: boolean;
  payload: Record<string, unknown>;
  checklist: string[];
  checked_at: string | null;
  checked_by: string;
  forced: boolean;
  confirmed_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  dispatch_method: string;
  hidden_at: string | null;
  sync_error: string;
  created_at: string;
  updated_at: string;
};

export type KdsSettingsRow = {
  id: string;
  late_minutes: number;
  sound: boolean;
  auto_confirm: boolean;
  drink_keywords: string[];
  sauce_keywords: string[];
  updated_at: string;
};

export function isStage(v: unknown): v is KdsStage {
  return typeof v === "string" && (KDS_STAGES as readonly string[]).includes(v);
}

/** Reconstrói o pedido da comanda a partir da linha do banco. */
export function rowToOrder(row: KdsOrderRow): KdsOrder {
  const payload = (row.payload ?? {}) as Partial<KdsOrder>;
  return {
    ...(payload as KdsOrder),
    id: row.id,
    source: row.source === "teste" ? "teste" : "ifood",
    ifoodOrderId: row.ifood_order_id ?? payload.ifoodOrderId ?? "",
    displayId: row.display_id || payload.displayId || "—",
    merchantId: row.merchant_id || payload.merchantId || "",
    customerName: row.customer_name || payload.customerName || "",
    orderType: row.order_type || payload.orderType || "DELIVERY",
    isTest: row.is_test ?? payload.isTest ?? false,
    placedAt: row.placed_at || payload.placedAt || row.created_at,
    stage: isStage(row.stage) ? row.stage : "novo",
    ifoodStatus: row.ifood_status || "",
    items: payload.items ?? [],
    observations: payload.observations ?? [],
    payment: payload.payment ?? {
      prepaid: money(num(row.payment_prepaid)),
      pending: money(num(row.payment_pending)),
      changeFor: money(num(row.change_for)),
      methods: [],
    },
    delivery:
      payload.delivery ?? {
        mode: "",
        deliveredBy: "",
        byMerchant: true,
        address: "",
        number: "",
        complement: "",
        reference: "",
        neighborhood: "",
        city: "",
        observations: "",
        scheduledFor: null,
      },
    subTotal: payload.subTotal ?? 0,
    deliveryFee: payload.deliveryFee ?? 0,
    total: money(num(row.total ?? payload.total)),
    cancelReason: row.cancel_reason || "",
  };
}

export function settingsFromRow(row: Partial<KdsSettingsRow> | null): KdsSettings {
  if (!row) return DEFAULT_SETTINGS;
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.length > 0 ? (v as string[]) : fallback;
  return {
    lateMinutes: Math.max(1, Math.round(num(row.late_minutes) || DEFAULT_SETTINGS.lateMinutes)),
    sound: row.sound ?? DEFAULT_SETTINGS.sound,
    autoConfirm: row.auto_confirm ?? DEFAULT_SETTINGS.autoConfirm,
    drinkKeywords: list(row.drink_keywords, DEFAULT_SETTINGS.drinkKeywords),
    sauceKeywords: list(row.sauce_keywords, DEFAULT_SETTINGS.sauceKeywords),
  };
}

/** Colunas derivadas do pedido normalizado, para gravar no banco. */
export function orderToColumns(
  order: Omit<KdsOrder, "id" | "stage">,
): Omit<
  KdsOrderRow,
  | "id"
  | "company_id"
  | "stage"
  | "checklist"
  | "checked_at"
  | "checked_by"
  | "forced"
  | "confirmed_at"
  | "ready_at"
  | "dispatched_at"
  | "cancelled_at"
  | "dispatch_method"
  | "hidden_at"
  | "sync_error"
  | "created_at"
  | "updated_at"
> {
  return {
    source: order.source,
    ifood_order_id: order.ifoodOrderId,
    merchant_id: order.merchantId,
    display_id: order.displayId,
    customer_name: order.customerName,
    order_type: order.orderType,
    ifood_status: order.ifoodStatus,
    placed_at: order.placedAt,
    total: order.total,
    payment_pending: order.payment.pending,
    payment_prepaid: order.payment.prepaid,
    change_for: order.payment.changeFor,
    is_test: order.isTest,
    payload: order as unknown as Record<string, unknown>,
    cancel_reason: order.cancelReason,
  };
}

/**
 * Nunca deixa o pedido voltar para uma etapa anterior (eventos do iFood
 * podem chegar fora de ordem). Cancelamento sempre vence.
 */
export function mergeStage(current: KdsStage, incoming: KdsStage): KdsStage {
  if (current === "cancelado" || incoming === "cancelado") return "cancelado";
  const rank: Record<KdsStage, number> = {
    novo: 0,
    producao: 1,
    pronto: 2,
    despachado: 3,
    cancelado: 4,
  };
  return rank[incoming] > rank[current] ? incoming : current;
}
