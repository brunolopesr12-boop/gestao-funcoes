// Testes do KDS: normalização do pedido do iFood, alertas, conferência,
// idempotência (pedido duplicado), cancelamento e reconexão.
//
// Rode com: npm test
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeIfoodOrder,
  stageFromIfood,
} from "../.tmp-test/kds/normalize.js";
import {
  buildAlerts,
  buildChecklist,
  elapsedSeconds,
  fmtElapsed,
  isChecklistComplete,
  isLate,
  requiredChecklistKeys,
} from "../.tmp-test/kds/alerts.js";
import { mergeStage } from "../.tmp-test/kds/row.js";
import { SAMPLE_ORDERS } from "../.tmp-test/kds/samples.js";
import { DEFAULT_SETTINGS } from "../.tmp-test/kds/types.js";

/* ---------------------------------------------------------------- */
/* Ajudantes                                                         */
/* ---------------------------------------------------------------- */

/** Normaliza um pedido de exemplo e devolve {order, alerts}. */
function comanda(key, stage = "novo") {
  const raw = SAMPLE_ORDERS[key].build();
  const order = { ...normalizeIfoodOrder(raw, DEFAULT_SETTINGS), id: "x", stage };
  return { raw, order, alerts: buildAlerts(order, DEFAULT_SETTINGS) };
}

const kinds = (alerts) => alerts.map((a) => a.kind);
const pick = (alerts, kind) => alerts.find((a) => a.kind === kind);

/* ---------------------------------------------------------------- */
/* Pedido normal                                                     */
/* ---------------------------------------------------------------- */

test("pedido normal: dados completos e sem alerta crítico de erro", () => {
  const { order, alerts } = comanda("normal");

  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].name, "Strogonoff de frango");
  assert.equal(order.items[0].quantity, 1);
  assert.equal(order.orderType, "DELIVERY");
  assert.ok(order.displayId);
  assert.ok(order.placedAt);
  assert.equal(order.total, 34.9);

  // Pago pelo app, sem bebida/adicional/observação: nada bloqueia o despacho.
  assert.deepEqual(kinds(alerts).filter((k) => k !== "teste" && k !== "pagamento_pago"), []);
  assert.equal(alerts.filter((a) => a.blocking).length, 0);
});

/* ---------------------------------------------------------------- */
/* Bebida                                                            */
/* ---------------------------------------------------------------- */

test("pedido com bebida gera alerta piscante listando as bebidas", () => {
  const { order, alerts } = comanda("bebida");
  const bebida = pick(alerts, "bebida");

  assert.ok(bebida, "deveria existir alerta de bebida");
  assert.equal(bebida.level, "critico");
  assert.equal(bebida.blocking, true);
  assert.equal(bebida.icon, "🥤");
  assert.match(bebida.title, /NÃO ESQUECER BEBIDA/);
  assert.deepEqual(bebida.lines, [
    "2× Coca-Cola 350ml",
    "1× Coca-Cola Zero lata",
  ]);
  assert.equal(order.items.filter((i) => i.isDrink).length, 2);
  assert.equal(order.items.filter((i) => !i.isDrink).length, 1);
});

test("comida com nome parecido não é confundida com bebida", () => {
  const order = {
    ...normalizeIfoodOrder(
      { id: "o", items: [{ name: "Strogonoff de carne", quantity: 1 }] },
      DEFAULT_SETTINGS,
    ),
    id: "x",
    stage: "novo",
  };
  assert.equal(order.items[0].isDrink, false);
});

/* ---------------------------------------------------------------- */
/* Adicional e molho                                                 */
/* ---------------------------------------------------------------- */

test("pedido com adicional separa item extra de molho", () => {
  const { alerts } = comanda("adicional");
  const extra = pick(alerts, "adicional");
  const molho = pick(alerts, "molho");

  assert.ok(extra);
  assert.equal(extra.blocking, true);
  assert.deepEqual(extra.lines, ["Strogonoff de frango: 1× Batata palha extra"]);

  assert.ok(molho);
  assert.equal(molho.blocking, true);
  assert.deepEqual(molho.lines, ["Strogonoff de frango: 2× Molho de alho"]);
});

/* ---------------------------------------------------------------- */
/* Observação                                                        */
/* ---------------------------------------------------------------- */

test("observação do cliente e do item viram um alerta só, bem visível", () => {
  const { alerts } = comanda("observacao");
  const obs = pick(alerts, "observacao");

  assert.ok(obs);
  assert.equal(obs.level, "critico");
  assert.equal(obs.blocking, true);
  assert.deepEqual(obs.lines, [
    "Mandar molho separado, por favor.",
    "Strogonoff de carne: Sem cebola",
  ]);
});

/* ---------------------------------------------------------------- */
/* Pagamento                                                         */
/* ---------------------------------------------------------------- */

test("pedido em dinheiro sem troco: alerta de receber o valor", () => {
  const { order, alerts } = comanda("dinheiro");
  const receber = pick(alerts, "pagamento_receber");

  assert.equal(order.payment.pending, 34.9);
  assert.equal(order.payment.prepaid, 0);
  assert.equal(order.payment.changeFor, 0);
  assert.ok(receber);
  assert.equal(receber.title, "RECEBER R$ 34,90");
  assert.equal(receber.blocking, true);
  assert.deepEqual(receber.lines, ["Dinheiro"]);
  assert.equal(pick(alerts, "troco"), undefined);
});

test("pedido com troco avisa para quanto e quanto levar", () => {
  const { order, alerts } = comanda("troco");
  const troco = pick(alerts, "troco");

  assert.equal(order.payment.changeFor, 100);
  assert.equal(order.payment.pending, 46.9);
  assert.ok(troco);
  assert.equal(troco.title, "TROCO PARA R$ 100,00");
  assert.deepEqual(troco.lines, ["Levar R$ 53,10 de troco"]);
  assert.equal(troco.blocking, true);
});

test("pedido já pago mostra PAGO e não bloqueia o despacho", () => {
  const { order, alerts } = comanda("pago");
  const pago = pick(alerts, "pagamento_pago");

  assert.equal(order.payment.pending, 0);
  assert.equal(order.payment.prepaid, 69.8);
  assert.ok(pago);
  assert.equal(pago.level, "ok");
  assert.equal(pago.blocking, false);
  assert.match(pago.title, /PAGO/);
  assert.equal(pick(alerts, "pagamento_receber"), undefined);
});

test("formato antigo de payments (array) também é entendido", () => {
  const order = normalizeIfoodOrder(
    {
      id: "o",
      items: [],
      payments: [
        { method: "CASH", type: "OFFLINE", value: 50, cash: { changeFor: 100 } },
      ],
    },
    DEFAULT_SETTINGS,
  );
  assert.equal(order.payment.pending, 50);
  assert.equal(order.payment.changeFor, 100);
  assert.equal(order.payment.methods[0].label, "Dinheiro");
});

/* ---------------------------------------------------------------- */
/* Entrega                                                           */
/* ---------------------------------------------------------------- */

test("entrega própria manda chamar outro motoboy e destaca o endereço", () => {
  const { order, alerts } = comanda("entrega");

  assert.equal(order.delivery.byMerchant, true);
  const motoboy = pick(alerts, "motoboy");
  assert.ok(motoboy);
  assert.equal(motoboy.icon, "🛵");
  assert.match(motoboy.title, /CHAMAR OUTRO MOTOBOY/);
  assert.equal(motoboy.blocking, true);

  const entrega = pick(alerts, "entrega_atencao");
  assert.ok(entrega);
  assert.deepEqual(entrega.lines, [
    "Complemento: Bloco B, apto 42",
    "Referência: Portão verde",
    "Entregar na portaria",
  ]);
});

test("entrega pelo iFood não pede motoboy da loja", () => {
  const { order, alerts } = comanda("bebida");
  assert.equal(order.delivery.byMerchant, false);
  assert.equal(pick(alerts, "motoboy"), undefined);
});

test("retirada no balcão avisa que ninguém entrega", () => {
  const { order, alerts } = comanda("retirada");
  assert.equal(order.orderType, "TAKEOUT");
  assert.ok(pick(alerts, "retirada"));
  assert.equal(pick(alerts, "motoboy"), undefined);
});

/* ---------------------------------------------------------------- */
/* Pedido completo: todos os alertas de uma vez                       */
/* ---------------------------------------------------------------- */

test("pedido completo dispara todos os alertas que costumam causar erro", () => {
  const { alerts } = comanda("completo");
  for (const kind of [
    "pagamento_receber",
    "troco",
    "bebida",
    "adicional",
    "molho",
    "observacao",
    "motoboy",
    "entrega_atencao",
  ]) {
    assert.ok(pick(alerts, kind), `faltou o alerta ${kind}`);
  }
  // Críticos vêm primeiro na lista, para aparecerem no topo da comanda.
  assert.equal(alerts[0].level, "critico");
});

/* ---------------------------------------------------------------- */
/* Conferência                                                       */
/* ---------------------------------------------------------------- */

test("conferência lista os 8 itens e só exige o que o pedido tem", () => {
  const { order, alerts } = comanda("completo");
  const lista = buildChecklist(order, alerts);

  assert.deepEqual(
    lista.map((i) => i.key),
    ["comida", "bebida", "adicionais", "molhos", "observacoes", "pagamento", "troco", "entrega"],
  );
  assert.deepEqual(requiredChecklistKeys(lista).sort(), [
    "adicionais",
    "bebida",
    "comida",
    "entrega",
    "molhos",
    "observacoes",
    "pagamento",
    "troco",
  ]);
});

test("pedido simples: itens que não se aplicam já vêm liberados", () => {
  const { order, alerts } = comanda("normal");
  const lista = buildChecklist(order, alerts);

  assert.deepEqual(requiredChecklistKeys(lista), ["comida"]);
  assert.equal(isChecklistComplete(lista, []), false);
  assert.equal(isChecklistComplete(lista, ["comida"]), true);
});

test("despacho só libera quando tudo que é obrigatório foi marcado", () => {
  const { order, alerts } = comanda("troco");
  const lista = buildChecklist(order, alerts);

  assert.equal(isChecklistComplete(lista, ["comida", "bebida"]), false);
  assert.equal(
    isChecklistComplete(lista, ["comida", "bebida", "pagamento", "troco"]),
    true,
  );
});

/* ---------------------------------------------------------------- */
/* Cronômetro e atraso                                               */
/* ---------------------------------------------------------------- */

test("cronômetro conta desde a entrada e marca atraso no limite configurado", () => {
  const agora = Date.parse("2026-09-21T12:30:00.000Z");
  const entrada = "2026-09-21T12:12:00.000Z";

  assert.equal(elapsedSeconds(entrada, agora), 18 * 60);
  assert.equal(fmtElapsed(elapsedSeconds(entrada, agora)), "18:00");
  assert.equal(fmtElapsed(65), "01:05");

  assert.equal(isLate(entrada, 25, agora), false);
  assert.equal(isLate(entrada, 18, agora), true);
  assert.equal(isLate(entrada, 10, agora), true);
});

/* ---------------------------------------------------------------- */
/* Códigos de evento do iFood                                        */
/* ---------------------------------------------------------------- */

test("códigos de evento do iFood viram etapas do KDS", () => {
  assert.equal(stageFromIfood("PLC"), "novo");
  assert.equal(stageFromIfood("PLACED"), "novo");
  assert.equal(stageFromIfood("CFM"), "producao");
  assert.equal(stageFromIfood("RTP"), "pronto");
  assert.equal(stageFromIfood("DSP"), "despachado");
  assert.equal(stageFromIfood("CON"), "despachado");
  assert.equal(stageFromIfood("CAN"), "cancelado");
  assert.equal(stageFromIfood("CANCELLED"), "cancelado");
  // Evento que o KDS não usa (disputa, handshake): ignorado, não quebra.
  assert.equal(stageFromIfood("HANDSHAKE_DISPUTE"), null);
  assert.equal(stageFromIfood(""), null);
});

test("etapa nunca retrocede e cancelamento sempre vence", () => {
  assert.equal(mergeStage("producao", "novo"), "producao");
  assert.equal(mergeStage("novo", "producao"), "producao");
  assert.equal(mergeStage("pronto", "producao"), "pronto");
  assert.equal(mergeStage("despachado", "novo"), "despachado");
  assert.equal(mergeStage("despachado", "cancelado"), "cancelado");
  assert.equal(mergeStage("cancelado", "novo"), "cancelado");
});

/* ---------------------------------------------------------------- */
/* Integração: idempotência, cancelamento, reconexão                 */
/*                                                                   */
/* Simula o ciclo do servidor (src/app/api/ifood/poll) usando as      */
/* mesmas funções puras e as mesmas garantias do banco:               */
/*   - id do evento é chave primária em kds_ifood_events              */
/*   - ifood_order_id é índice único em kds_orders                    */
/* ---------------------------------------------------------------- */

function criarIngestor() {
  const eventos = new Set(); // kds_ifood_events (PK = id)
  const pedidos = new Map(); // kds_orders (único por ifood_order_id)
  const naoConfirmados = [];

  return {
    pedidos,
    eventos,
    naoConfirmados,
    /** Processa um lote de eventos vindo do polling. */
    receber(lote, { conectado = true, detalhe = (id) => ({ id, items: [] }) } = {}) {
      if (!conectado) {
        // Perda de conexão: nada é gravado e nada é confirmado ao iFood,
        // então os mesmos eventos voltam no próximo polling.
        for (const ev of lote) naoConfirmados.push(ev);
        return { ok: false, novos: 0, duplicados: 0 };
      }
      let novos = 0;
      let duplicados = 0;
      for (const ev of lote) {
        if (eventos.has(ev.id)) {
          duplicados += 1;
          continue; // evento repetido: confirma e ignora
        }
        eventos.add(ev.id);
        const stage = stageFromIfood(ev.code);
        if (!stage) continue;

        const existente = pedidos.get(ev.orderId);
        if (stage === "cancelado" && existente) {
          existente.stage = "cancelado";
          existente.cancelReason = ev.metadata?.reason ?? "Cancelado pelo iFood";
          continue;
        }
        const normalizado = normalizeIfoodOrder(detalhe(ev.orderId), DEFAULT_SETTINGS);
        if (existente) {
          existente.stage = mergeStage(existente.stage, stage);
          Object.assign(existente, { items: normalizado.items });
        } else {
          pedidos.set(ev.orderId, { ...normalizado, id: ev.orderId, stage });
          novos += 1;
        }
      }
      return { ok: true, novos, duplicados };
    },
  };
}

const detalheFrango = (id) => ({
  id,
  displayId: "4321",
  items: [{ name: "Strogonoff de frango", quantity: 1, unitPrice: 34.9, totalPrice: 34.9 }],
  payments: { prepaid: 34.9, pending: 0, methods: [{ method: "CREDIT", type: "ONLINE", value: 34.9 }] },
  total: { subTotal: 34.9, deliveryFee: 0, orderAmount: 34.9 },
});

test("pedido duplicado: o mesmo evento não cria duas comandas", () => {
  const ing = criarIngestor();
  const evento = { id: "ev-1", code: "PLC", orderId: "pedido-777" };

  const a = ing.receber([evento], { detalhe: detalheFrango });
  const b = ing.receber([evento], { detalhe: detalheFrango });

  assert.equal(a.novos, 1);
  assert.equal(b.novos, 0);
  assert.equal(b.duplicados, 1);
  assert.equal(ing.pedidos.size, 1);
});

test("pedido duplicado: eventos diferentes do mesmo pedido continuam uma comanda", () => {
  const ing = criarIngestor();
  ing.receber(
    [
      { id: "ev-1", code: "PLC", orderId: "pedido-777" },
      { id: "ev-2", code: "PLC", orderId: "pedido-777" },
      { id: "ev-3", code: "CFM", orderId: "pedido-777" },
    ],
    { detalhe: detalheFrango },
  );

  assert.equal(ing.pedidos.size, 1);
  assert.equal(ing.pedidos.get("pedido-777").stage, "producao");
});

test("cancelamento do iFood marca a comanda e não a deixa avançar", () => {
  const ing = criarIngestor();
  ing.receber([{ id: "ev-1", code: "PLC", orderId: "p1" }], { detalhe: detalheFrango });
  ing.receber(
    [{ id: "ev-2", code: "CAN", orderId: "p1", metadata: { reason: "Cliente desistiu" } }],
    { detalhe: detalheFrango },
  );

  const pedido = ing.pedidos.get("p1");
  assert.equal(pedido.stage, "cancelado");
  assert.equal(pedido.cancelReason, "Cliente desistiu");

  // Evento atrasado de "pronto" chegando depois não ressuscita o pedido.
  ing.receber([{ id: "ev-3", code: "RTP", orderId: "p1" }], { detalhe: detalheFrango });
  assert.equal(ing.pedidos.get("p1").stage, "cancelado");

  // E o alerta de cancelado aparece na comanda.
  const alerts = buildAlerts({ ...pedido, observations: [], items: [] }, DEFAULT_SETTINGS);
  assert.ok(alerts.some((a) => a.kind === "cancelado"));
});

test("perda de conexão não perde pedido: na reconexão o evento é reentregue", () => {
  const ing = criarIngestor();
  const evento = { id: "ev-9", code: "PLC", orderId: "p9" };

  const offline = ing.receber([evento], { conectado: false });
  assert.equal(offline.ok, false);
  assert.equal(ing.pedidos.size, 0);
  assert.equal(ing.naoConfirmados.length, 1);

  // Reconectou: o iFood reentrega o que não foi confirmado.
  const online = ing.receber(ing.naoConfirmados.splice(0), { detalhe: detalheFrango });
  assert.equal(online.novos, 1);
  assert.equal(ing.pedidos.size, 1);

  // E uma segunda reentrega do mesmo evento não duplica.
  assert.equal(ing.receber([evento], { detalhe: detalheFrango }).novos, 0);
  assert.equal(ing.pedidos.size, 1);
});

test("fluxo completo: novo → produção → pronto → despachado", () => {
  const ing = criarIngestor();
  const passos = [
    ["ev-a", "PLC", "novo"],
    ["ev-b", "CFM", "producao"],
    ["ev-c", "RTP", "pronto"],
    ["ev-d", "DSP", "despachado"],
  ];
  for (const [id, code, esperado] of passos) {
    ing.receber([{ id, code, orderId: "p-fluxo" }], { detalhe: detalheFrango });
    assert.equal(ing.pedidos.get("p-fluxo").stage, esperado);
  }
  assert.equal(ing.pedidos.size, 1);
});

/* ---------------------------------------------------------------- */
/* Robustez                                                          */
/* ---------------------------------------------------------------- */

test("pedido com campos faltando não quebra o KDS", () => {
  const order = { ...normalizeIfoodOrder({}, DEFAULT_SETTINGS), id: "x", stage: "novo" };
  assert.equal(order.items.length, 0);
  assert.equal(order.displayId, "—");
  assert.equal(order.total, 0);
  assert.equal(order.payment.pending, 0);
  assert.doesNotThrow(() => buildAlerts(order, DEFAULT_SETTINGS));
  assert.doesNotThrow(() => buildChecklist(order, buildAlerts(order, DEFAULT_SETTINGS)));
});
