/**
 * Pedidos de exemplo no formato da Order API do iFood.
 *
 * Usados por dois motivos:
 *   - testes automáticos (tests/kds.test.mjs), sem tocar na rede;
 *   - botão "pedido de teste" do KDS, para a equipe treinar o fluxo.
 *
 * Isto NÃO é uma integração simulada: comandas criadas daqui nascem marcadas
 * como `teste` e nenhuma delas envia status para o iFood.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

let counter = 0;
const nextDisplay = () => String(1000 + (counter = (counter + 1) % 9000));

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function base(overrides: Raw = {}): Raw {
  return {
    id: uid("teste"),
    displayId: nextDisplay(),
    createdAt: new Date().toISOString(),
    orderType: "DELIVERY",
    orderTiming: "IMMEDIATE",
    salesChannel: "IFOOD",
    isTest: true,
    merchant: { id: "merchant-teste", name: "Sr. Strogonoff" },
    customer: { name: "Cliente de Teste", phone: { number: "0800 000 0000" } },
    items: [],
    total: { subTotal: 0, deliveryFee: 0, orderAmount: 0 },
    payments: { prepaid: 0, pending: 0, methods: [] },
    delivery: {
      mode: "DEFAULT",
      deliveredBy: "IFOOD",
      deliveryAddress: {
        streetName: "Rua das Flores",
        streetNumber: "123",
        neighborhood: "Centro",
        city: "São Paulo",
      },
    },
    ...overrides,
  };
}

const item = (name: string, quantity = 1, price = 32.9, extra: Raw = {}): Raw => ({
  id: uid("item"),
  uniqueId: uid("uniq"),
  name,
  quantity,
  unitPrice: price,
  totalPrice: price * quantity,
  observations: "",
  options: [],
  ...extra,
});

const pagoNoApp = (valor: number): Raw => ({
  prepaid: valor,
  pending: 0,
  methods: [
    { method: "CREDIT", type: "ONLINE", value: valor, card: { brand: "VISA" } },
  ],
});

const dinheiroNaEntrega = (valor: number, trocoPara = 0): Raw => ({
  prepaid: 0,
  pending: valor,
  methods: [
    {
      method: "CASH",
      type: "OFFLINE",
      value: valor,
      ...(trocoPara > 0 ? { cash: { changeFor: trocoPara } } : {}),
    },
  ],
});

const totalizar = (raw: Raw): Raw => {
  const sub = (raw.items as Raw[]).reduce(
    (acc: number, it: Raw) =>
      acc +
      Number(it.totalPrice ?? 0) +
      ((it.options as Raw[]) ?? []).reduce(
        (a: number, o: Raw) => a + Number(o.price ?? 0) * Number(o.quantity ?? 1),
        0,
      ),
    0,
  );
  const fee = Number(raw.total?.deliveryFee ?? 0);
  raw.total = { subTotal: sub, deliveryFee: fee, orderAmount: sub + fee };
  return raw;
};

export type SampleKey =
  | "normal"
  | "bebida"
  | "adicional"
  | "observacao"
  | "dinheiro"
  | "troco"
  | "pago"
  | "entrega"
  | "retirada"
  | "completo";

export const SAMPLE_ORDERS: Record<SampleKey, { label: string; build: () => Raw }> = {
  normal: {
    label: "Pedido normal",
    build: () => {
      const raw = base({ items: [item("Strogonoff de frango", 1, 34.9)] });
      totalizar(raw);
      raw.payments = pagoNoApp(raw.total.orderAmount);
      return raw;
    },
  },

  bebida: {
    label: "Com bebida",
    build: () => {
      const raw = base({
        items: [
          item("Strogonoff de carne", 1, 39.9),
          item("Coca-Cola 350ml", 2, 7),
          item("Coca-Cola Zero lata", 1, 7),
        ],
      });
      totalizar(raw);
      raw.payments = pagoNoApp(raw.total.orderAmount);
      return raw;
    },
  },

  adicional: {
    label: "Com adicional",
    build: () => {
      const raw = base({
        items: [
          item("Strogonoff de frango", 1, 34.9, {
            options: [
              { name: "Batata palha extra", quantity: 1, price: 4 },
              { name: "Molho de alho", quantity: 2, price: 2.5 },
            ],
          }),
        ],
      });
      totalizar(raw);
      raw.payments = pagoNoApp(raw.total.orderAmount);
      return raw;
    },
  },

  observacao: {
    label: "Com observação",
    build: () => {
      const raw = base({
        items: [
          item("Strogonoff de carne", 1, 39.9, { observations: "Sem cebola" }),
        ],
        extraInfo: "Mandar molho separado, por favor.",
      });
      totalizar(raw);
      raw.payments = pagoNoApp(raw.total.orderAmount);
      return raw;
    },
  },

  dinheiro: {
    label: "Dinheiro (sem troco)",
    build: () => {
      const raw = base({ items: [item("Strogonoff de frango", 1, 34.9)] });
      totalizar(raw);
      raw.payments = dinheiroNaEntrega(raw.total.orderAmount);
      return raw;
    },
  },

  troco: {
    label: "Dinheiro com troco",
    build: () => {
      const raw = base({
        items: [item("Strogonoff de frango", 1, 34.9), item("Guaraná 1L", 1, 12)],
      });
      totalizar(raw);
      raw.payments = dinheiroNaEntrega(raw.total.orderAmount, 100);
      return raw;
    },
  },

  pago: {
    label: "Já pago pelo app",
    build: () => {
      const raw = base({ items: [item("Strogonoff de frango", 2, 34.9)] });
      totalizar(raw);
      raw.payments = pagoNoApp(raw.total.orderAmount);
      return raw;
    },
  },

  entrega: {
    label: "Entrega própria (chamar motoboy)",
    build: () => {
      const raw = base({
        items: [item("Strogonoff de carne", 1, 39.9)],
        delivery: {
          mode: "DEFAULT",
          deliveredBy: "MERCHANT",
          observations: "Entregar na portaria",
          deliveryAddress: {
            streetName: "Av. Brasil",
            streetNumber: "900",
            complement: "Bloco B, apto 42",
            reference: "Portão verde",
            neighborhood: "Jardim",
            city: "São Paulo",
          },
        },
      });
      totalizar(raw);
      raw.payments = dinheiroNaEntrega(raw.total.orderAmount, 60);
      return raw;
    },
  },

  retirada: {
    label: "Retirada no balcão",
    build: () => {
      const raw = base({
        orderType: "TAKEOUT",
        items: [item("Strogonoff de frango", 1, 34.9)],
        delivery: undefined,
        takeout: { mode: "DEFAULT", takeoutDateTime: new Date().toISOString() },
      });
      totalizar(raw);
      raw.payments = pagoNoApp(raw.total.orderAmount);
      return raw;
    },
  },

  completo: {
    label: "Pedido completo (todos os alertas)",
    build: () => {
      const raw = base({
        items: [
          item("Strogonoff de frango", 2, 34.9, {
            observations: "Sem cebola",
            options: [
              { name: "Batata palha extra", quantity: 1, price: 4 },
              { name: "Molho de alho", quantity: 2, price: 2.5 },
            ],
          }),
          item("Coca-Cola 350ml", 2, 7),
          item("Coca-Cola Zero lata", 1, 7),
        ],
        extraInfo: "Entregar na portaria e ligar antes.",
        delivery: {
          mode: "DEFAULT",
          deliveredBy: "MERCHANT",
          observations: "Cachorro no portão",
          deliveryAddress: {
            streetName: "Rua Sete de Setembro",
            streetNumber: "455",
            complement: "Casa dos fundos",
            reference: "Depois da padaria",
            neighborhood: "Vila Nova",
            city: "São Paulo",
          },
        },
        total: { subTotal: 0, deliveryFee: 8.9, orderAmount: 0 },
      });
      totalizar(raw);
      raw.payments = dinheiroNaEntrega(raw.total.orderAmount, 150);
      return raw;
    },
  },
};

export const SAMPLE_KEYS = Object.keys(SAMPLE_ORDERS) as SampleKey[];
