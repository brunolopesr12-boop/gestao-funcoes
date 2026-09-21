/**
 * Converte o pedido cru do iFood (Order API v1.0) para o formato da comanda.
 *
 * Tudo aqui é defensivo: a API pode omitir campos e o KDS nunca pode quebrar
 * por causa de um pedido com formato diferente. Função pura — testável sem
 * rede (ver tests/kds.test.mjs).
 */
import { money, num } from "./money";
import {
  DEFAULT_SETTINGS,
  type KdsDelivery,
  type KdsItem,
  type KdsOption,
  type KdsOrder,
  type KdsPayment,
  type KdsPaymentMethod,
  type KdsSettings,
  type KdsStage,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const METHOD_LABELS: Record<string, string> = {
  CASH: "Dinheiro",
  CREDIT: "Cartão de crédito",
  DEBIT: "Cartão de débito",
  MEAL_VOUCHER: "Vale-refeição",
  FOOD_VOUCHER: "Vale-alimentação",
  PIX: "Pix",
  DIGITAL_WALLET: "Carteira digital",
  GIFT_CARD: "Vale-presente",
  OTHER: "Outro",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? (method ? method : "Não informado");
}

export function matchesKeyword(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => k && t.includes(k.toLowerCase()));
}

/** Mapeia o código de evento/status do iFood para a etapa do KDS. */
export function stageFromIfood(code: string): KdsStage | null {
  const c = str(code).toUpperCase();
  switch (c) {
    case "PLC":
    case "PLACED":
      return "novo";
    case "CFM":
    case "CONFIRMED":
      return "producao";
    case "RTP":
    case "READY_TO_PICKUP":
      return "pronto";
    case "DSP":
    case "DISPATCHED":
    case "CON":
    case "CONCLUDED":
      return "despachado";
    case "CAN":
    case "CANCELLED":
    case "CANCELED":
      return "cancelado";
    default:
      return null;
  }
}

function normalizeOptions(raw: Raw[]): KdsOption[] {
  return raw.map((o) => ({
    name: str(o?.name) || "Adicional",
    quantity: Math.max(1, Math.round(num(o?.quantity) || 1)),
    price: money(num(o?.price ?? o?.unitPrice)),
  }));
}

function normalizeItems(raw: Raw[], settings: KdsSettings): KdsItem[] {
  return raw.map((it, i) => {
    const name = str(it?.name) || "Item";
    const options = normalizeOptions(Array.isArray(it?.options) ? it.options : []);
    const optionNames = options.map((o) => o.name).join(" ");
    return {
      id: str(it?.uniqueId) || str(it?.id) || `item-${i}`,
      name,
      quantity: Math.max(1, Math.round(num(it?.quantity) || 1)),
      unitPrice: money(num(it?.unitPrice ?? it?.price)),
      totalPrice: money(num(it?.totalPrice ?? it?.price)),
      observations: str(it?.observations),
      externalCode: str(it?.externalCode),
      options,
      isDrink:
        matchesKeyword(name, settings.drinkKeywords) ||
        (options.length === 0 && matchesKeyword(optionNames, settings.drinkKeywords)),
    };
  });
}

function normalizePayment(raw: Raw): KdsPayment {
  const source = raw?.payments;
  const rawMethods: Raw[] = Array.isArray(source)
    ? source
    : Array.isArray(source?.methods)
      ? source.methods
      : [];

  const methods: KdsPaymentMethod[] = rawMethods.map((m) => {
    const method = str(m?.method ?? m?.name).toUpperCase();
    const type = str(m?.type ?? (m?.prepaid ? "ONLINE" : "")).toUpperCase();
    const prepaid = type === "ONLINE" || m?.prepaid === true;
    return {
      method,
      label: methodLabel(method),
      type,
      value: money(num(m?.value ?? m?.amount)),
      prepaid,
      changeFor: money(num(m?.cash?.changeFor ?? m?.changeFor)),
      brand: str(m?.card?.brand ?? m?.wallet?.name ?? m?.brand),
    };
  });

  const sum = (fn: (m: KdsPaymentMethod) => boolean) =>
    money(methods.filter(fn).reduce((acc, m) => acc + m.value, 0));

  const declaredPending = source && !Array.isArray(source) ? num(source.pending) : NaN;
  const declaredPrepaid = source && !Array.isArray(source) ? num(source.prepaid) : NaN;

  const pending = Number.isFinite(declaredPending) && source?.pending !== undefined
    ? money(declaredPending)
    : sum((m) => !m.prepaid);
  const prepaid = Number.isFinite(declaredPrepaid) && source?.prepaid !== undefined
    ? money(declaredPrepaid)
    : sum((m) => m.prepaid);

  const changeFor = money(
    methods.reduce((acc, m) => Math.max(acc, m.changeFor), 0),
  );

  return { prepaid, pending, changeFor, methods };
}

function normalizeDelivery(raw: Raw): KdsDelivery {
  const d: Raw = raw?.delivery ?? {};
  const addr: Raw = d?.deliveryAddress ?? {};
  const deliveredBy = str(d?.deliveredBy).toUpperCase();
  const street = str(addr?.streetName ?? addr?.formattedAddress);
  const number = str(addr?.streetNumber);
  return {
    mode: str(d?.mode).toUpperCase(),
    deliveredBy,
    // Sem informação explícita tratamos como entrega própria: é o caso que
    // exige ação da equipe, então errar para o lado do alerta é mais seguro.
    byMerchant: deliveredBy !== "IFOOD",
    address: street,
    number,
    complement: str(addr?.complement),
    reference: str(addr?.reference),
    neighborhood: str(addr?.neighborhood),
    city: str(addr?.city),
    observations: str(d?.observations),
    scheduledFor: str(d?.deliveryDateTime) || null,
  };
}

function collectObservations(raw: Raw, items: KdsItem[]): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(str(raw?.extraInfo));
  push(str(raw?.observations));
  push(str(raw?.delivery?.observations));
  push(str(raw?.takeout?.observations));
  for (const it of items) {
    if (it.observations) push(`${it.name}: ${it.observations}`);
  }
  return out;
}

export function normalizeIfoodOrder(
  raw: Raw,
  settings: KdsSettings = DEFAULT_SETTINGS,
): Omit<KdsOrder, "id" | "stage"> {
  const items = normalizeItems(Array.isArray(raw?.items) ? raw.items : [], settings);
  const total: Raw = raw?.total ?? {};
  const orderType = str(raw?.orderType ?? raw?.type).toUpperCase() || "DELIVERY";

  return {
    source: "ifood",
    ifoodOrderId: str(raw?.id) || str(raw?.orderId),
    displayId: str(raw?.displayId) || str(raw?.shortReference) || "—",
    merchantId: str(raw?.merchant?.id),
    customerName: str(raw?.customer?.name),
    customerPhone: str(raw?.customer?.phone?.number ?? raw?.customer?.phone),
    orderType,
    isTest: raw?.isTest === true,
    placedAt: str(raw?.createdAt) || new Date().toISOString(),
    ifoodStatus: str(raw?.status).toUpperCase(),
    items,
    observations: collectObservations(raw, items),
    payment: normalizePayment(raw),
    delivery: normalizeDelivery(raw),
    subTotal: money(num(total?.subTotal)),
    deliveryFee: money(num(total?.deliveryFee)),
    total: money(num(total?.orderAmount ?? total?.subTotal)),
    cancelReason: "",
  };
}
