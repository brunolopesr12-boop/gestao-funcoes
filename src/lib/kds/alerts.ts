/**
 * Motor de alertas do KDS.
 *
 * O objetivo é que o funcionário NÃO precise ler o pedido inteiro para
 * descobrir o que pode dar errado na entrega. Cada regra olha o pedido
 * normalizado e devolve zero ou mais alertas.
 *
 * Para criar um alerta novo no futuro basta acrescentar uma regra em
 * `ALERT_RULES` — nada mais no KDS precisa mudar.
 */
import { brl } from "./money";
import { matchesKeyword } from "./normalize";
import {
  DEFAULT_SETTINGS,
  type KdsAlert,
  type KdsChecklistItem,
  type KdsOrder,
  type KdsSettings,
} from "./types";

export type AlertRule = {
  kind: string;
  build: (order: KdsOrder, settings: KdsSettings) => KdsAlert | KdsAlert[] | null;
};

const alert = (a: Omit<KdsAlert, "lines"> & { lines?: string[] }): KdsAlert => ({
  lines: [],
  ...a,
});

export const ALERT_RULES: AlertRule[] = [
  /* ---------------------------- cancelamento ---------------------- */
  {
    kind: "cancelado",
    build: (o) =>
      o.stage === "cancelado"
        ? alert({
            kind: "cancelado",
            level: "critico",
            icon: "🚫",
            title: "PEDIDO CANCELADO — NÃO ENTREGAR",
            lines: o.cancelReason ? [o.cancelReason] : [],
            blocking: false,
          })
        : null,
  },

  /* ---------------------------- pagamento ------------------------- */
  {
    kind: "pagamento",
    build: (o) => {
      if (o.stage === "cancelado") return null;
      const out: KdsAlert[] = [];
      if (o.payment.pending > 0) {
        const forma = o.payment.methods
          .filter((m) => !m.prepaid)
          .map((m) => m.label)
          .join(" + ");
        out.push(
          alert({
            kind: "pagamento_receber",
            level: "critico",
            icon: "💰",
            title: `RECEBER ${brl(o.payment.pending)}`,
            lines: forma ? [forma] : [],
            blocking: true,
            checklistKey: "pagamento",
          }),
        );
      } else {
        out.push(
          alert({
            kind: "pagamento_pago",
            level: "ok",
            icon: "✅",
            title: "PAGO PELO APP",
            lines: o.payment.methods.map((m) =>
              m.brand ? `${m.label} · ${m.brand}` : m.label,
            ),
            blocking: false,
          }),
        );
      }
      return out;
    },
  },
  {
    kind: "troco",
    build: (o) => {
      if (o.stage === "cancelado" || o.payment.changeFor <= 0) return null;
      const levar = Math.max(0, o.payment.changeFor - o.payment.pending);
      return alert({
        kind: "troco",
        level: "critico",
        icon: "💵",
        title: `TROCO PARA ${brl(o.payment.changeFor)}`,
        lines: [`Levar ${brl(levar)} de troco`],
        blocking: true,
        checklistKey: "troco",
      });
    },
  },

  /* ------------------------------ bebida -------------------------- */
  {
    kind: "bebida",
    build: (o) => {
      const drinks = o.items.filter((i) => i.isDrink);
      if (drinks.length === 0) return null;
      return alert({
        kind: "bebida",
        level: "critico",
        icon: "🥤",
        title: "NÃO ESQUECER BEBIDA",
        lines: drinks.map((d) => `${d.quantity}× ${d.name}`),
        blocking: true,
        checklistKey: "bebida",
      });
    },
  },

  /* --------------------------- item extra ------------------------- */
  {
    kind: "adicional",
    build: (o, s) => {
      const extras: string[] = [];
      const molhos: string[] = [];
      for (const item of o.items) {
        for (const opt of item.options) {
          const linha = `${item.name}: ${opt.quantity}× ${opt.name}`;
          if (matchesKeyword(opt.name, s.sauceKeywords)) molhos.push(linha);
          else extras.push(linha);
        }
      }
      const out: KdsAlert[] = [];
      if (extras.length > 0) {
        out.push(
          alert({
            kind: "adicional",
            level: "critico",
            icon: "➕",
            title: "ITEM EXTRA",
            lines: extras,
            blocking: true,
            checklistKey: "adicionais",
          }),
        );
      }
      if (molhos.length > 0) {
        out.push(
          alert({
            kind: "molho",
            level: "critico",
            icon: "🧂",
            title: "MOLHO / ACOMPANHAMENTO",
            lines: molhos,
            blocking: true,
            checklistKey: "molhos",
          }),
        );
      }
      return out;
    },
  },

  /* --------------------------- observações ------------------------ */
  {
    kind: "observacao",
    build: (o) =>
      o.observations.length === 0
        ? null
        : alert({
            kind: "observacao",
            level: "critico",
            icon: "⚠️",
            title: "OBSERVAÇÃO IMPORTANTE",
            lines: o.observations,
            blocking: true,
            checklistKey: "observacoes",
          }),
  },

  /* --------------------------- entrega ---------------------------- */
  {
    kind: "motoboy",
    build: (o) => {
      if (o.orderType !== "DELIVERY") return null;
      if (!o.delivery.byMerchant) return null;
      return alert({
        kind: "motoboy",
        level: "critico",
        icon: "🛵",
        title: "CHAMAR OUTRO MOTOBOY",
        lines: ["Entrega por conta da loja — o iFood não manda entregador."],
        blocking: true,
        checklistKey: "entrega",
      });
    },
  },
  {
    kind: "retirada",
    build: (o) =>
      o.orderType === "TAKEOUT"
        ? alert({
            kind: "retirada",
            level: "atencao",
            icon: "🏃",
            title: "CLIENTE RETIRA NO BALCÃO",
            lines: [],
            blocking: false,
            checklistKey: "entrega",
          })
        : null,
  },
  {
    kind: "entrega_atencao",
    build: (o) => {
      if (o.orderType !== "DELIVERY") return null;
      const lines: string[] = [];
      if (o.delivery.complement) lines.push(`Complemento: ${o.delivery.complement}`);
      if (o.delivery.reference) lines.push(`Referência: ${o.delivery.reference}`);
      if (o.delivery.observations) lines.push(o.delivery.observations);
      if (lines.length === 0) return null;
      return alert({
        kind: "entrega_atencao",
        level: "critico",
        icon: "📍",
        title: "ATENÇÃO NA ENTREGA",
        lines,
        blocking: true,
        checklistKey: "entrega",
      });
    },
  },
  {
    kind: "agendado",
    build: (o) =>
      o.delivery.scheduledFor
        ? alert({
            kind: "agendado",
            level: "atencao",
            icon: "🕒",
            title: "PEDIDO AGENDADO",
            lines: [o.delivery.scheduledFor],
            blocking: false,
          })
        : null,
  },

  /* ----------------------------- teste ---------------------------- */
  {
    kind: "teste",
    build: (o) =>
      o.isTest || o.source === "teste"
        ? alert({
            kind: "teste",
            level: "info",
            icon: "🧪",
            title: "PEDIDO DE TESTE",
            lines: ["Não produzir — pedido gerado para conferir o KDS."],
            blocking: false,
          })
        : null,
  },
];

const LEVEL_ORDER: Record<KdsAlert["level"], number> = {
  critico: 0,
  atencao: 1,
  ok: 2,
  info: 3,
};

/** Executa todas as regras e devolve os alertas ordenados por gravidade. */
export function buildAlerts(
  order: KdsOrder,
  settings: KdsSettings = DEFAULT_SETTINGS,
): KdsAlert[] {
  const out: KdsAlert[] = [];
  for (const rule of ALERT_RULES) {
    let result: KdsAlert | KdsAlert[] | null = null;
    try {
      result = rule.build(order, settings);
    } catch {
      // Uma regra com defeito nunca pode derrubar a comanda inteira.
      result = null;
    }
    if (!result) continue;
    if (Array.isArray(result)) out.push(...result);
    else out.push(result);
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/* ------------------------------------------------------------------ */
/* Conferência                                                         */
/* ------------------------------------------------------------------ */

const CHECKLIST_LABELS: Record<
  KdsChecklistItem["key"],
  { label: string; icon: string }
> = {
  comida: { label: "Comida", icon: "🍛" },
  bebida: { label: "Bebida", icon: "🥤" },
  adicionais: { label: "Adicionais", icon: "➕" },
  molhos: { label: "Molhos", icon: "🧂" },
  observacoes: { label: "Observações", icon: "⚠️" },
  pagamento: { label: "Pagamento", icon: "💰" },
  troco: { label: "Troco", icon: "💵" },
  entrega: { label: "Entrega / motoboy", icon: "🛵" },
};

export const CHECKLIST_ICONS = CHECKLIST_LABELS;

/**
 * Monta a conferência do pedido. Os itens que não se aplicam continuam
 * visíveis (o funcionário confere a lista inteira) mas não travam o despacho.
 */
export function buildChecklist(
  order: KdsOrder,
  alerts: KdsAlert[],
): KdsChecklistItem[] {
  const byKey = new Map<string, KdsAlert[]>();
  for (const a of alerts) {
    if (!a.checklistKey) continue;
    const list = byKey.get(a.checklistKey) ?? [];
    list.push(a);
    byKey.set(a.checklistKey, list);
  }

  const comida = order.items.filter((i) => !i.isDrink);

  return (
    [
      {
        key: "comida" as const,
        detail: comida.map((i) => `${i.quantity}× ${i.name}`).join(" · "),
        required: comida.length > 0,
      },
      {
        key: "bebida" as const,
        detail: order.items
          .filter((i) => i.isDrink)
          .map((i) => `${i.quantity}× ${i.name}`)
          .join(" · "),
        required: order.items.some((i) => i.isDrink),
      },
      {
        key: "adicionais" as const,
        detail: (byKey.get("adicionais") ?? []).flatMap((a) => a.lines).join(" · "),
        required: byKey.has("adicionais"),
      },
      {
        key: "molhos" as const,
        detail: (byKey.get("molhos") ?? []).flatMap((a) => a.lines).join(" · "),
        required: byKey.has("molhos"),
      },
      {
        key: "observacoes" as const,
        detail: order.observations.join(" · "),
        required: order.observations.length > 0,
      },
      {
        key: "pagamento" as const,
        detail:
          order.payment.pending > 0
            ? `Receber ${brl(order.payment.pending)}`
            : "Pago pelo app",
        required: order.payment.pending > 0,
      },
      {
        key: "troco" as const,
        detail:
          order.payment.changeFor > 0
            ? `Troco para ${brl(order.payment.changeFor)}`
            : "Sem troco",
        required: order.payment.changeFor > 0,
      },
      {
        key: "entrega" as const,
        detail: (byKey.get("entrega") ?? [])
          .map((a) => a.title)
          .join(" · "),
        required: byKey.has("entrega"),
      },
    ] as const
  ).map((it) => ({
    key: it.key,
    label: CHECKLIST_LABELS[it.key].label,
    detail: it.detail,
    required: it.required,
  }));
}

/** Itens que o funcionário precisa marcar antes de despachar. */
export function requiredChecklistKeys(items: KdsChecklistItem[]): string[] {
  return items.filter((i) => i.required).map((i) => i.key);
}

/** O pedido só sai da conferência quando tudo que é obrigatório foi marcado. */
export function isChecklistComplete(
  items: KdsChecklistItem[],
  checked: string[],
): boolean {
  return requiredChecklistKeys(items).every((k) => checked.includes(k));
}

/* ------------------------------------------------------------------ */
/* Atraso                                                              */
/* ------------------------------------------------------------------ */

export function elapsedSeconds(placedAt: string, now: number = Date.now()): number {
  const t = new Date(placedAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 1000));
}

export function fmtElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function isLate(
  placedAt: string,
  lateMinutes: number,
  now: number = Date.now(),
): boolean {
  return elapsedSeconds(placedAt, now) >= Math.max(1, lateMinutes) * 60;
}
