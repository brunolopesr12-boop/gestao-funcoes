// Testes das utilidades do sistema de cozinha (formatação, conversão de números, CSV, erros).
import test from "node:test";
import assert from "node:assert/strict";
import { parseDecimal, num, fmtQty, fmtMoney, toCSV, addDaysISO, daysLabel, slug } from "../.tmp-test/ops/format.js";
import { toOpsError, isNetworkError } from "../.tmp-test/ops/errors.js";

test("parseDecimal aceita vírgula, ponto e milhar", () => {
  assert.equal(parseDecimal("2,5"), 2.5);
  assert.equal(parseDecimal("2.5"), 2.5);
  assert.equal(parseDecimal("1.234,5"), 1234.5);
  assert.equal(parseDecimal(""), 0);
  assert.equal(parseDecimal("abc"), 0);
  assert.equal(num("3,25"), 3.25);
  assert.equal(num(null), 0);
});

test("fmtQty e fmtMoney em pt-BR", () => {
  assert.equal(fmtQty(20, "kg"), "20 kg");
  assert.equal(fmtQty(2.5, "kg"), "2,5 kg");
  assert.equal(fmtQty(1234.5678), "1.234,568");
  assert.equal(fmtMoney(16.5).replace(/ /g, " "), "R$ 16,50");
});

test("toCSV usa ; e escapa aspas/quebras", () => {
  const csv = toCSV([{ a: 'x;"y"', b: 2.5 }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]);
  assert.equal(csv, '﻿A;B\n"x;""y""";2,5');
});

test("datas e rótulos de validade", () => {
  assert.equal(addDaysISO("2026-09-26", 5), "2026-10-01");
  assert.equal(daysLabel(-2), "vencido há 2 dias");
  assert.equal(daysLabel(0), "vence hoje");
  assert.equal(daysLabel(1), "vence amanhã");
  assert.equal(daysLabel(7), "vence em 7 dias");
  assert.equal(daysLabel(null), "sem validade");
  assert.equal(slug("Recheio de Frango é ótimo!"), "recheio-de-frango-e-otimo");
});

test("mensagens de erro amigáveis", () => {
  assert.equal(toOpsError({ code: "42501", message: "permission denied for table x" }).message, "Você não tem permissão para esta ação.");
  assert.equal(toOpsError({ code: "P0001", message: "Sem permissão: estoque.ajustar (unidade 123)" }).message, "Sem permissão: estoque.ajustar");
  assert.equal(toOpsError({ code: "23505", message: "duplicate key value" }).message, "Já existe um registro com esses dados.");
  assert.equal(toOpsError({ code: "PGRST205", message: "Could not find the table in the schema cache" }).message.startsWith("O banco de dados está desatualizado"), true);
  assert.equal(toOpsError({ code: "P0002", message: "Estoque insuficiente no lote FR-001 (saldo 1, pedido 2)." }).message, "Estoque insuficiente no lote FR-001 (saldo 1, pedido 2).");
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(toOpsError(new TypeError("Failed to fetch")).network, true);
});
