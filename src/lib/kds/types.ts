/**
 * Tipos do KDS (Kitchen Display System).
 *
 * Tudo aqui é puro: nenhum acesso a rede ou banco. O pedido do iFood é
 * convertido para `KdsOrder` (ver `normalize.ts`) e é só esse formato que a
 * tela conhece — assim a integração fica separada da interface.
 */

export const KDS_STAGES = [
  "novo",
  "producao",
  "pronto",
  "despachado",
  "cancelado",
] as const;

export type KdsStage = (typeof KDS_STAGES)[number];

export const STAGE_META: Record<
  KdsStage,
  { label: string; short: string; emoji: string; accent: string; rank: number }
> = {
  novo: {
    label: "Novos",
    short: "NOVO",
    emoji: "🔔",
    accent: "#3b82f6",
    rank: 0,
  },
  producao: {
    label: "Em produção",
    short: "PRODUÇÃO",
    emoji: "🍳",
    accent: "#f59e0b",
    rank: 1,
  },
  pronto: {
    label: "Prontos / conferência",
    short: "CONFERIR",
    emoji: "🧾",
    accent: "#a855f7",
    rank: 2,
  },
  despachado: {
    label: "Despachados",
    short: "DESPACHADO",
    emoji: "🛵",
    accent: "#10b981",
    rank: 3,
  },
  cancelado: {
    label: "Cancelados",
    short: "CANCELADO",
    emoji: "🚫",
    accent: "#ef4444",
    rank: 4,
  },
};

/** Etapas que ainda exigem ação da equipe. */
export const ACTIVE_STAGES: KdsStage[] = ["novo", "producao", "pronto"];

export type KdsOption = {
  name: string;
  quantity: number;
  price: number;
};

export type KdsItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  observations: string;
  externalCode: string;
  options: KdsOption[];
  /** Detectado por palavra-chave configurável (ver `drinkKeywords`). */
  isDrink: boolean;
};

export type KdsPaymentMethod = {
  /** Código bruto do iFood (CASH, CREDIT, PIX...). */
  method: string;
  label: string;
  /** ONLINE = pago no app; OFFLINE = a receber na entrega. */
  type: string;
  value: number;
  prepaid: boolean;
  changeFor: number;
  brand: string;
};

export type KdsPayment = {
  /** Valor já pago pelo cliente no app. */
  prepaid: number;
  /** Valor que a equipe precisa receber na entrega. */
  pending: number;
  /** Troco para quanto (0 = sem troco). */
  changeFor: number;
  methods: KdsPaymentMethod[];
};

export type KdsDelivery = {
  mode: string;
  /** IFOOD = logística do iFood; MERCHANT = entrega própria. */
  deliveredBy: string;
  byMerchant: boolean;
  address: string;
  number: string;
  complement: string;
  reference: string;
  neighborhood: string;
  city: string;
  observations: string;
  scheduledFor: string | null;
};

export type KdsOrder = {
  /** Identificador interno (uuid da linha em kds_orders). */
  id: string;
  source: "ifood" | "teste";
  /** Identificador único do pedido no iFood — base da idempotência. */
  ifoodOrderId: string;
  /** Número curto mostrado ao cliente/entregador. */
  displayId: string;
  merchantId: string;
  customerName: string;
  customerPhone: string;
  /** DELIVERY | TAKEOUT | INDOOR */
  orderType: string;
  isTest: boolean;
  placedAt: string;
  stage: KdsStage;
  ifoodStatus: string;
  items: KdsItem[];
  observations: string[];
  payment: KdsPayment;
  delivery: KdsDelivery;
  subTotal: number;
  deliveryFee: number;
  total: number;
  cancelReason: string;
};

/* ------------------------------------------------------------------ */
/* Alertas                                                             */
/* ------------------------------------------------------------------ */

export type KdsAlertLevel = "critico" | "atencao" | "info" | "ok";

export type KdsAlert = {
  /** Identificador estável da regra que gerou o alerta. */
  kind: string;
  level: KdsAlertLevel;
  icon: string;
  title: string;
  lines: string[];
  /** Alertas bloqueantes exigem conferência antes do despacho. */
  blocking: boolean;
  /** Item da conferência ligado a este alerta. */
  checklistKey?: KdsChecklistKey;
};

export const KDS_CHECKLIST_KEYS = [
  "comida",
  "bebida",
  "adicionais",
  "molhos",
  "observacoes",
  "pagamento",
  "troco",
  "entrega",
] as const;

export type KdsChecklistKey = (typeof KDS_CHECKLIST_KEYS)[number];

export type KdsChecklistItem = {
  key: KdsChecklistKey;
  label: string;
  detail: string;
  /** false = não se aplica a este pedido (já vem marcado). */
  required: boolean;
};

export type KdsSettings = {
  /** Minutos até o pedido ser marcado como ATRASADO. */
  lateMinutes: number;
  /** Som ao chegar pedido novo. */
  sound: boolean;
  /** Aceitar pedidos automaticamente ao chegar. */
  autoConfirm: boolean;
  /** Palavras que identificam bebida no nome do item. */
  drinkKeywords: string[];
  /** Palavras que identificam molho/adicional para a conferência. */
  sauceKeywords: string[];
};

export const DEFAULT_DRINK_KEYWORDS = [
  "coca",
  "refrigerante",
  "refri",
  "guarana",
  "guaraná",
  "fanta",
  "sprite",
  "pepsi",
  "soda",
  "suco",
  "agua",
  "água",
  "cerveja",
  "chá",
  "cha ",
  "energético",
  "energetico",
  "h2o",
  "tônica",
  "tonica",
  "kuat",
  "schweppes",
  "del valle",
  "ice tea",
  "iced tea",
  "lata",
  "garrafa",
  "1l",
  "2l",
  "350ml",
  "600ml",
  "510ml",
  "zero açúcar",
  "zero acucar",
];

export const DEFAULT_SAUCE_KEYWORDS = [
  "molho",
  "maionese",
  "ketchup",
  "mostarda",
  "barbecue",
  "cheddar",
  "alho",
  "pimenta",
  "vinagrete",
  "sachê",
  "sache",
];

export const DEFAULT_SETTINGS: KdsSettings = {
  lateMinutes: 25,
  sound: true,
  autoConfirm: false,
  drinkKeywords: DEFAULT_DRINK_KEYWORDS,
  sauceKeywords: DEFAULT_SAUCE_KEYWORDS,
};
