// Testes da lógica de progresso, aptidão e pendências.
// Rode com: npm test   (compila src/lib para .tmp-test antes)
import test from "node:test";
import assert from "node:assert/strict";

import { buildTrainingIndex, roleProgress, roleCoverage } from "../.tmp-test/derive.js";
import {
  companyOverview,
  employeeSummary,
  pendingsByEmployee,
  processKnowledge,
  stalledTrainings,
} from "../.tmp-test/selectors.js";

/* ---------------------------------------------------------------- */
/* Fixtures                                                          */
/* ---------------------------------------------------------------- */

const T = "2026-09-01T10:00:00.000Z";

const company = {
  id: "c1",
  name: "Sr. Strogonoff",
  emoji: "👨‍🍳",
  color: "#f59e0b",
  notes: "",
  active: true,
  position: 0,
  created_at: T,
  updated_at: T,
};

const role = (id, name, position = 0) => ({
  id,
  company_id: "c1",
  name,
  description: "",
  responsibilities: "",
  emoji: "📦",
  position,
  active: true,
  created_at: T,
  updated_at: T,
});

const proc = (id, role_id, name, position, required = true) => ({
  id,
  role_id,
  name,
  description: "",
  required,
  position,
  created_at: T,
  updated_at: T,
});

const emp = (id, name) => ({
  id,
  company_id: "c1",
  name,
  status: "ativo",
  hired_on: null,
  phone: "",
  notes: "",
  created_at: T,
  updated_at: T,
});

const link = (id, employee_id, role_id, kind) => ({
  id,
  employee_id,
  role_id,
  kind,
  created_at: T,
});

const step = (employee_id, process_id, s, done_at = T) => ({
  id: `${employee_id}-${process_id}-${s}`,
  employee_id,
  process_id,
  step: s,
  done_at,
  trainer: "Bruno",
  notes: "",
  created_at: done_at,
});

const ALL_STEPS = ["mostrei", "fez", "ensinou", "certifiquei"];
const fullyCertified = (e, p, at) => ALL_STEPS.map((s) => step(e, p, s, at));

/** Monta um AppData mínimo. */
function makeData(overrides = {}) {
  return {
    companies: [company],
    roles: [role("r1", "Montador de pedidos"), role("r2", "Caixa", 1)],
    competencies: [],
    checklist_items: [],
    processes: [
      proc("p1", "r1", "Fazer arroz", 0),
      proc("p2", "r1", "Fritar", 1),
      proc("p3", "r2", "Abrir o caixa", 0),
    ],
    employees: [emp("e1", "William"), emp("e2", "João"), emp("e3", "Carlos")],
    employee_roles: [
      link("l1", "e1", "r1", "atual"),
      link("l2", "e2", "r1", "atual"),
      link("l3", "e3", "r2", "atual"),
    ],
    training_steps: [],
    training_events: [],
    activity_log: [],
    ...overrides,
  };
}

const processesOf = (d, roleId) => d.processes.filter((p) => p.role_id === roleId);

/* ---------------------------------------------------------------- */
/* Progresso de um processo                                          */
/* ---------------------------------------------------------------- */

test("processo sem nenhuma etapa fica 'não iniciado' e 0%", () => {
  const d = makeData();
  const idx = buildTrainingIndex(d.training_steps);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.equal(prog.pct, 0);
  assert.equal(prog.fitness, "nao_treinado");
  assert.equal(prog.all[0].status, "nao_iniciado");
});

test("3 de 4 etapas deixam o processo 'em treinamento', nunca certificado", () => {
  const d = makeData({
    training_steps: [
      step("e1", "p1", "mostrei"),
      step("e1", "p1", "fez"),
      step("e1", "p1", "ensinou"),
    ],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.equal(prog.all[0].status, "em_treinamento");
  assert.deepEqual(prog.all[0].missingSteps, ["certifiquei"]);
  assert.equal(prog.fitness, "em_treinamento");
  // 3 etapas de 8 (2 processos x 4)
  assert.equal(prog.doneStepCount, 3);
  assert.equal(prog.totalStepCount, 8);
  assert.equal(prog.pct, 38);
});

test("as 4 etapas certificam o processo", () => {
  const d = makeData({ training_steps: fullyCertified("e1", "p1") });
  const idx = buildTrainingIndex(d.training_steps);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.equal(prog.all[0].status, "certificado");
  assert.equal(prog.certifiedCount, 1);
});

/* ---------------------------------------------------------------- */
/* Aptidão — a regra mais importante                                 */
/* ---------------------------------------------------------------- */

test("NÃO fica apto com qualquer etapa obrigatória pendente", () => {
  const d = makeData({
    training_steps: [
      ...fullyCertified("e1", "p1"),
      step("e1", "p2", "mostrei"),
      step("e1", "p2", "fez"),
      step("e1", "p2", "ensinou"),
      // falta certificar p2
    ],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.notEqual(prog.fitness, "apto");
  assert.equal(prog.fitness, "em_treinamento");
  assert.equal(prog.pct, 88);
  assert.equal(prog.pending.length, 1);
  assert.equal(prog.pending[0].process.name, "Fritar");
});

test("fica APTO quando todos os processos obrigatórios estão certificados", () => {
  const d = makeData({
    training_steps: [...fullyCertified("e1", "p1"), ...fullyCertified("e1", "p2")],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.equal(prog.fitness, "apto");
  assert.equal(prog.pct, 100);
  assert.equal(prog.pending.length, 0);
});

test("processo marcado como extra não bloqueia a aptidão", () => {
  const d = makeData();
  d.processes.push(proc("p9", "r1", "Limpar a fritadeira", 2, false));
  d.training_steps = [...fullyCertified("e1", "p1"), ...fullyCertified("e1", "p2")];
  const idx = buildTrainingIndex(d.training_steps);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.equal(prog.fitness, "apto");
  assert.equal(prog.optional.length, 1);
  assert.equal(prog.optional[0].status, "nao_iniciado");
  assert.equal(prog.pct, 100);
});

test("função sem processos não gera ninguém apto", () => {
  const d = makeData({ processes: [] });
  const idx = buildTrainingIndex([]);
  const prog = roleProgress(idx, "e1", processesOf(d, "r1"));
  assert.equal(prog.fitness, "sem_processos");
  const cov = roleCoverage(idx, "r1", [emp("e1", "William")], []);
  assert.equal(cov.apt.length, 0);
  assert.equal(cov.hasProcesses, false);
});

/* ---------------------------------------------------------------- */
/* Cobertura da função                                               */
/* ---------------------------------------------------------------- */

test("cobertura separa aptos, em treinamento e não treinados", () => {
  const d = makeData({
    training_steps: [
      ...fullyCertified("e1", "p1"),
      ...fullyCertified("e1", "p2"),
      step("e2", "p1", "mostrei"),
    ],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const cov = roleCoverage(
    idx,
    "r1",
    [d.employees[0], d.employees[1], d.employees[2]],
    processesOf(d, "r1"),
  );
  assert.equal(cov.apt.length, 1);
  assert.equal(cov.apt[0].employee.name, "William");
  assert.equal(cov.training.length, 1);
  assert.equal(cov.training[0].employee.name, "João");
  assert.equal(cov.untrained.length, 1);
  assert.equal(cov.risk, "atencao"); // apenas 1 apto
});

/* ---------------------------------------------------------------- */
/* Resumo do funcionário e visão da empresa                          */
/* ---------------------------------------------------------------- */

test("employeeSummary classifica o funcionário e calcula o %", () => {
  const d = makeData({
    training_steps: [...fullyCertified("e1", "p1"), ...fullyCertified("e1", "p2")],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const s = employeeSummary(d, idx, d.employees[0]);
  assert.equal(s.bucket, "apto");
  assert.equal(s.pct, 100);
  assert.equal(s.current.link.role.name, "Montador de pedidos");
});

test("funcionário sem vínculo cai em 'sem_funcao'", () => {
  const d = makeData({ employee_roles: [] });
  const idx = buildTrainingIndex([]);
  const s = employeeSummary(d, idx, d.employees[0]);
  assert.equal(s.bucket, "sem_funcao");
  assert.equal(s.pct, 0);
});

test("companyOverview aponta funções sem apto, sem gente e sem processo", () => {
  const d = makeData({
    roles: [role("r1", "Montador"), role("r2", "Caixa", 1), role("r3", "Cozinha", 2)],
    training_steps: [...fullyCertified("e1", "p1"), ...fullyCertified("e1", "p2")],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const ov = companyOverview(d, idx, "c1");

  assert.equal(ov.aptos, 1);
  assert.equal(ov.roles.length, 3);
  // r3 não tem ninguém vinculado
  assert.deepEqual(
    ov.rolesSemFuncionario.map((r) => r.name),
    ["Cozinha"],
  );
  // r2 tem Carlos vinculado mas sem treino
  assert.deepEqual(
    ov.rolesSemApto.map((r) => r.name),
    ["Caixa"],
  );
  // r3 não tem processos
  assert.deepEqual(
    ov.rolesSemProcesso.map((r) => r.name),
    ["Cozinha"],
  );
});

/* ---------------------------------------------------------------- */
/* Pendências                                                        */
/* ---------------------------------------------------------------- */

test("pendências listam o que falta por funcionário, mais adiantado primeiro", () => {
  const d = makeData({
    training_steps: [
      step("e1", "p2", "mostrei"),
      step("e1", "p2", "fez"),
      // p1 nem começou
    ],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const pend = pendingsByEmployee(d, idx, "c1");

  const william = pend.find((p) => p.employee.name === "William");
  assert.equal(william.items.length, 2);
  assert.equal(william.items[0].process.name, "Fritar"); // 2 etapas feitas
  assert.deepEqual(william.items[0].missingSteps, ["ensinou", "certifiquei"]);
  assert.equal(william.items[1].process.name, "Fazer arroz");
  assert.deepEqual(william.items[1].missingSteps, ALL_STEPS);
});

test("quem está 100% certificado sai da lista de pendências", () => {
  const d = makeData({
    training_steps: [...fullyCertified("e1", "p1"), ...fullyCertified("e1", "p2")],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const pend = pendingsByEmployee(d, idx, "c1");
  assert.equal(
    pend.find((p) => p.employee.name === "William"),
    undefined,
  );
});

/* ---------------------------------------------------------------- */
/* Quem sabe fazer isso?                                             */
/* ---------------------------------------------------------------- */

test("processKnowledge ordena certificados > em treinamento > não treinados", () => {
  const d = makeData({
    training_steps: [
      ...fullyCertified("e2", "p1"),
      step("e1", "p1", "mostrei"),
      step("e1", "p1", "fez"),
    ],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const rows = processKnowledge(d, idx, "c1", "p1");

  assert.deepEqual(
    rows.map((r) => [r.employee.name, r.status]),
    [
      ["João", "certificado"],
      ["William", "em_treinamento"],
      ["Carlos", "nao_iniciado"],
    ],
  );
  // Carlos é de outra função, então não aparece como vinculado
  assert.equal(rows[2].linked, false);
  assert.equal(rows[0].linked, true);
});

/* ---------------------------------------------------------------- */
/* Treinamentos parados                                              */
/* ---------------------------------------------------------------- */

test("treinamento começado e sem mexer há mais de 14 dias entra como parado", () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const d = makeData({
    training_steps: [
      step("e1", "p1", "mostrei", old),
      step("e2", "p1", "mostrei", recent),
    ],
  });
  const idx = buildTrainingIndex(d.training_steps);
  const parados = stalledTrainings(d, idx, "c1");

  assert.equal(parados.length, 1);
  assert.equal(parados[0].employee.name, "William");
  assert.equal(parados[0].process.name, "Fazer arroz");
  assert.ok(parados[0].days >= 29);
});

test("processo já certificado não conta como parado", () => {
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const d = makeData({ training_steps: fullyCertified("e1", "p1", old) });
  const idx = buildTrainingIndex(d.training_steps);
  assert.equal(stalledTrainings(d, idx, "c1").length, 0);
});
