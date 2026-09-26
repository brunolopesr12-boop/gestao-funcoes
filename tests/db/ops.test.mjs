// Testes de integração do banco (PostgreSQL local + shim de auth).
// Rode com: npm run test:db   (requer Postgres local; ver scripts/db-local.sh)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import pg from "pg";

const DB = process.env.PGDATABASE_TEST ?? "vila_test";
const cfg = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: DB,
};

const VILA = "11111111-1111-4111-8111-111111111111";
const STRO = "22222222-2222-4222-8222-222222222222";
const U = {
  admin: "10000000-0000-4000-8000-000000000001",
  estoq: "10000000-0000-4000-8000-000000000002",
  coz:   "10000000-0000-4000-8000-000000000003",
  func:  "10000000-0000-4000-8000-000000000004",
  other: "10000000-0000-4000-8000-000000000005",
};

let client;
const ctx = {};

/** executa `sql` como o usuário autenticado `uid` (RLS ativo) */
async function as(uid, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated", email: `${uid}@teste.local` }),
    ]);
    const r = await client.query(sql, params);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
/** executa como a chave de serviço (cron/integrações) */
async function asService(sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    const r = await client.query(sql, params);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
async function anon(sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local role anon");
    const r = await client.query(sql, params);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
const root = (sql, params = []) => client.query(sql, params);
async function fails(promise, match) {
  try {
    await promise;
  } catch (e) {
    if (match && !new RegExp(match, "i").test(String(e.message))) {
      throw new Error(`erro diferente do esperado (${match}): ${e.message}`);
    }
    return e;
  }
  throw new Error("esperava erro, mas a operação passou");
}
const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0];
const val = async (uid, sql, params) => Object.values((await as(uid, sql, params)).rows[0])[0];

before(async () => {
  const r = spawnSync("bash", ["scripts/db-local.sh"], { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`não consegui preparar o banco de testes:\n${r.stderr}`);
  }
  client = new pg.Client(cfg);
  await client.connect();
  for (const [k, id] of Object.entries(U)) {
    await root("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id, `${k}@teste.local`, { full_name: `Usuário ${k}` },
    ]);
  }
});
after(async () => {
  await client?.end();
});

/* ================================================================== */
test("bootstrap: primeiro usuário vira admin das empresas existentes", async () => {
  assert.equal(await anon("select public.ops_needs_bootstrap() as v").then((r) => r.rows[0].v), true);
  assert.equal(await val(U.admin, "select public.ops_bootstrap_admin()"), true);
  assert.equal(await val(U.admin, "select public.ops_needs_bootstrap()"), false);
  assert.equal(await val(U.admin, "select public.ops_bootstrap_admin()"), false, "segunda chamada não faz nada");
  const r = await as(U.admin, "select company_id from public.memberships where user_id = $1 order by company_id", [U.admin]);
  assert.deepEqual(r.rows.map((x) => x.company_id), [VILA, STRO]);
  // perfil criado pelo trigger em auth.users
  const p = await one(U.admin, "select full_name, email from public.profiles where id = $1", [U.admin]);
  assert.equal(p.full_name, "Usuário admin");
});

test("padrões da empresa: unidade, locais, motivos de perda, etiquetas, categorias, checklists", async () => {
  const stores = await as(U.admin, "select id, name from public.stores where company_id = $1", [VILA]);
  assert.equal(stores.rows.length, 1);
  ctx.store1 = stores.rows[0].id;
  assert.equal(stores.rows[0].name, "Vila Rica — Matriz");
  assert.equal(Number(await val(U.admin, "select count(*) from public.stock_locations where store_id = $1", [ctx.store1])), 4);
  assert.equal(Number(await val(U.admin, "select count(*) from public.loss_reasons where company_id = $1", [VILA])), 10);
  assert.equal(Number(await val(U.admin, "select count(*) from public.label_templates where company_id = $1", [VILA])), 8);
  assert.ok(Number(await val(U.admin, "select count(*) from public.categories where company_id = $1", [VILA])) >= 10);
  assert.equal(Number(await val(U.admin, "select count(*) from public.checklists where company_id = $1", [VILA])), 3);
  assert.equal(await val(U.admin, "select public.ops_setting($1, 'estoque.metodo_custo') #>> '{}'", [ctx.store1]), "medio");
});

test("admin cria segunda unidade, usuários e permissões", async () => {
  ctx.store2 = (await one(U.admin, "insert into public.stores (company_id, name, code, position) values ($1, 'Filial', 'U2', 1) returning id", [VILA])).id;
  ctx.loc2 = (await one(U.admin, "insert into public.stock_locations (store_id, name, kind) values ($1, 'Estoque seco', 'estoque_seco') returning id", [ctx.store2])).id;
  const locs = await as(U.admin, "select id, name from public.stock_locations where store_id = $1 order by position", [ctx.store1]);
  ctx.locSeco = locs.rows[0].id;
  ctx.locGel = locs.rows[1].id;

  const role = async (code) => (await one(U.admin, "select id from public.access_roles where company_id is null and code = $1", [code])).id;
  // estoquista só na Matriz
  const m = await one(U.admin,
    "insert into public.memberships (company_id, user_id, access_role_id, all_stores) values ($1, $2, $3, false) returning id",
    [VILA, U.estoq, await role("estoquista")]);
  await as(U.admin, "insert into public.membership_stores (membership_id, store_id) values ($1, $2)", [m.id, ctx.store1]);
  await as(U.admin, "insert into public.memberships (company_id, user_id, access_role_id, all_stores) values ($1, $2, $3, true)", [VILA, U.coz, await role("cozinha")]);
  await as(U.admin, "insert into public.memberships (company_id, user_id, access_role_id, all_stores) values ($1, $2, $3, true)", [VILA, U.func, await role("funcionario")]);
  await as(U.admin, "insert into public.memberships (company_id, user_id, access_role_id, all_stores) values ($1, $2, $3, true)", [STRO, U.other, await role("gerente")]);

  const perms = await as(U.estoq, "select permission_code from public.ops_my_permissions() where store_id = $1", [ctx.store1]);
  assert.ok(perms.rows.some((p) => p.permission_code === "recebimento.finalizar"));
  assert.ok(!perms.rows.some((p) => p.permission_code === "producao.finalizar"));
  const perms2 = await as(U.estoq, "select count(*) from public.ops_my_permissions() where store_id = $1", [ctx.store2]);
  assert.equal(Number(perms2.rows[0].count), 0, "estoquista não tem acesso à Filial");
});

test("cadastros: unidades, categoria, produtos com conversão, fornecedor", async () => {
  const u = async (code) => (await one(U.admin, "select id from public.units where company_id is null and code = $1", [code])).id;
  ctx.kg = await u("kg"); ctx.g = await u("g"); ctx.cx = await u("cx"); ctx.un = await u("un");
  ctx.cat = (await one(U.admin, "select id from public.categories where company_id = $1 and name = 'Carnes e frios'", [VILA])).id;
  ctx.supplier = (await one(U.admin, "insert into public.suppliers (company_id, name, cnpj) values ($1, 'Frigorífico Boa Carne', '12.345.678/0001-90') returning id", [VILA])).id;

  ctx.frango = (await one(U.admin, `insert into public.products (company_id, name, internal_code, category_id, product_kind, stock_unit_id, purchase_unit_id, purchase_factor,
      min_stock, max_stock, reorder_point, shelf_life_days, storage_type, default_supplier_id)
    values ($1, 'Frango (peito)', public.ops_next_internal_code($1), $2, 'materia_prima', $3, $4, 10, 15, 40, 18, 5, 'refrigerado', $5) returning id, internal_code`,
    [VILA, ctx.cat, ctx.kg, ctx.cx, ctx.supplier])).id;
  ctx.tempero = (await one(U.admin, `insert into public.products (company_id, name, internal_code, product_kind, stock_unit_id, min_stock)
    values ($1, 'Tempero da casa', public.ops_next_internal_code($1), 'materia_prima', $2, 100) returning id`, [VILA, ctx.g])).id;
  ctx.recheio = (await one(U.admin, `insert into public.products (company_id, name, internal_code, product_kind, stock_unit_id, shelf_life_days, shelf_life_open_days)
    values ($1, 'Recheio de frango', public.ops_next_internal_code($1), 'semipronto', $2, 3, 1) returning id`, [VILA, ctx.kg])).id;
  await as(U.admin, "insert into public.product_units (product_id, unit_id, factor) values ($1, $2, 0.5)", [ctx.frango, (await one(U.admin, "select id from public.units where code = 'pct' and company_id is null")).id]);

  const codes = await as(U.admin, "select internal_code from public.products where company_id = $1 order by internal_code", [VILA]);
  assert.deepEqual(codes.rows.map((r) => r.internal_code), ["00001", "00002", "00003"]);
  assert.equal(Number(await val(U.admin, "select public.ops_convert_qty($1, 2, $2)", [ctx.frango, ctx.cx])), 20, "2 caixas = 20 kg");
  assert.equal(Number(await val(U.admin, "select public.ops_convert_qty($1, 500, $2)", [ctx.frango, ctx.g])), 0.5, "500 g = 0,5 kg");
  assert.equal(Number(await val(U.admin, "select public.ops_convert_qty($1, 3, (select id from public.units where code = 'pct' and company_id is null))", [ctx.frango])), 1.5, "3 pacotes = 1,5 kg");
  await fails(as(U.admin, "select public.ops_convert_qty($1, 1, $2)", [ctx.frango, ctx.un]), "não sei converter");

  // auditoria automática do cadastro
  const a = await one(U.admin, "select user_name, action, entity_label from public.audit_logs where entity = 'products' and entity_id = $1", [ctx.frango]);
  assert.equal(a.action, "criou"); assert.equal(a.user_name, "Usuário admin"); assert.equal(a.entity_label, "Frango (peito)");
});

test("sem permissão: funcionário não cadastra produto nem vê recebimentos; outra empresa não vê nada", async () => {
  await fails(as(U.func, "insert into public.products (company_id, name, stock_unit_id) values ($1, 'X', $2)", [VILA, ctx.kg]), "row-level security");
  assert.equal(Number(await val(U.func, "select count(*) from public.receipts")), 0);
  assert.equal(Number(await val(U.other, "select count(*) from public.products where company_id = $1", [VILA])), 0);
  assert.equal(Number(await val(U.other, "select count(*) from public.stores where company_id = $1", [VILA])), 0);
  assert.equal(Number(await val(U.func, "select count(*) from public.products where company_id = $1", [VILA])), 3, "funcionário vê produtos");
});

test("recebimento → lote, validade, estoque, custo, histórico de preço, pedido", async () => {
  const r = await one(U.estoq, "insert into public.receipts (company_id, store_id, supplier_id, invoice_number, invoice_date) values ($1, $2, $3, 'NF 123', current_date) returning id, number, received_by_name",
    [VILA, ctx.store1, ctx.supplier]);
  ctx.receipt = r.id;
  assert.match(r.number, /^RC-\d{4}-0001$/);
  assert.equal(r.received_by_name, "Usuário estoq");
  await as(U.estoq, `insert into public.receipt_items (receipt_id, product_id, quantity, unit_id, lot_code, expires_at, unit_price, temperature, location_id, position)
    values ($1, $2, 2, $3, 'FR-001', current_date + 10, 25, 3.5, $4, 0)`, [ctx.receipt, ctx.frango, ctx.cx, ctx.locGel]);
  await as(U.estoq, `insert into public.receipt_items (receipt_id, product_id, quantity, unit_id, unit_price, location_id, position)
    values ($1, $2, 500, $3, 0.02, $4, 1)`, [ctx.receipt, ctx.tempero, ctx.g, ctx.locSeco]);
  await as(U.estoq, `insert into public.receipt_items (receipt_id, product_id, quantity, unit_id, unit_price, result, rejection_reason, notes, position)
    values ($1, $2, 1, $3, 25, 'recusado', 'temperatura_inadequada', 'chegou a 12 °C', 2)`, [ctx.receipt, ctx.frango, ctx.cx]);
  const it = await one(U.estoq, "select quantity_stock, total_price from public.receipt_items where receipt_id = $1 and position = 0", [ctx.receipt]);
  assert.equal(Number(it.quantity_stock), 20); assert.equal(Number(it.total_price), 50);
  assert.equal(Number(await val(U.estoq, "select total from public.receipts where id = $1", [ctx.receipt])), 60, "total ignora recusados");

  // status não muda por update direto
  await fails(as(U.estoq, "update public.receipts set status = 'finalizado' where id = $1", [ctx.receipt]), "ações do sistema");
  // cozinha não finaliza recebimento
  await fails(as(U.coz, "select public.ops_receive($1)", [ctx.receipt]), "Sem permissão");

  const res = (await one(U.estoq, "select public.ops_receive($1) as r", [ctx.receipt])).r;
  assert.equal(res.result, "aprovado_ressalva");
  assert.equal(res.approved, 2); assert.equal(res.rejected, 1);
  ctx.lotFrango1 = res.lots.find((l) => l.product_id === ctx.frango).lot_id;
  assert.equal(res.lots.find((l) => l.product_id === ctx.frango).lot_code, "FR-001");

  const bal = await one(U.estoq, "select quantity, location_name, expires_at, unit_cost, total_value from public.v_stock_balances where lot_id = $1", [ctx.lotFrango1]);
  assert.equal(Number(bal.quantity), 20); assert.equal(bal.location_name, "Geladeira"); assert.equal(Number(bal.unit_cost), 2.5); assert.equal(Number(bal.total_value), 50);
  const prod = await one(U.estoq, "select cost, last_purchase_price from public.products where id = $1", [ctx.frango]);
  assert.equal(Number(prod.cost), 2.5); assert.equal(Number(prod.last_purchase_price), 2.5);
  const temp = await one(U.estoq, "select quantity, expires_at from public.v_stock_balances where product_id = $1", [ctx.tempero]);
  assert.equal(Number(temp.quantity), 500); assert.equal(temp.expires_at, null);
  assert.equal(Number(await val(U.estoq, "select count(*) from public.supplier_price_history where product_id = $1 and supplier_id = $2", [ctx.frango, ctx.supplier])), 1);
  assert.equal(Number(await val(U.estoq, "select last_price from public.supplier_products where product_id = $1 and supplier_id = $2", [ctx.frango, ctx.supplier])), 2.5);
  const mov = await one(U.estoq, "select movement_type, quantity, balance_after, created_by_name, reference_type from public.stock_movements where lot_id = $1", [ctx.lotFrango1]);
  assert.equal(mov.movement_type, "entrada"); assert.equal(Number(mov.quantity), 20); assert.equal(Number(mov.balance_after), 20); assert.equal(mov.created_by_name, "Usuário estoq");
  assert.equal(await val(U.estoq, "select status from public.receipts where id = $1", [ctx.receipt]), "finalizado");
  await fails(as(U.estoq, "select public.ops_receive($1)", [ctx.receipt]), "já foi finalizado");
  await fails(as(U.estoq, "update public.receipt_items set quantity = 3 where receipt_id = $1", [ctx.receipt]), "já foi finalizado");
  // alerta de recebimento com problema
  const al = await one(U.admin, "select kind, severity from public.alerts where entity_type = 'receipt' and entity_id = $1 and kind = 'recebimento_problema' order by severity", [ctx.receipt]);
  assert.equal(al.kind, "recebimento_problema");
  const au = await one(U.admin, "select action, user_name from public.audit_logs where entity = 'receipts' and entity_id = $1 and action = 'finalizou_recebimento'", [ctx.receipt]);
  assert.equal(au.user_name, "Usuário estoq");
});

test("ficha técnica: custo, rendimento e fator de correção", async () => {
  ctx.recipe = (await one(U.admin, `insert into public.recipes (company_id, product_id, name, yield_quantity, portion_quantity, shelf_life_days)
    values ($1, $2, 'Recheio de frango', 3.2, 0.1, 3) returning id`, [VILA, ctx.recheio])).id;
  await as(U.admin, "insert into public.recipe_items (recipe_id, ingredient_product_id, gross_quantity, unit_id, net_quantity, position) values ($1, $2, 5, $3, 3.2, 0)", [ctx.recipe, ctx.frango, ctx.kg]);
  await as(U.admin, "insert into public.recipe_items (recipe_id, ingredient_product_id, gross_quantity, unit_id, position) values ($1, $2, 200, $3, 1)", [ctx.recipe, ctx.tempero, ctx.g]);
  const c = (await one(U.coz, "select public.ops_recipe_cost($1) as c", [ctx.recipe])).c;
  assert.equal(Number(c.total_cost), 16.5, "5 kg × 2,50 + 200 g × 0,02");
  assert.equal(Number(c.cost_per_unit), Number((16.5 / 3.2).toFixed(4)));
  assert.equal(Number(c.portions), 32);
  assert.equal(Number(c.items[0].loss_pct), 36); assert.equal(Number(c.items[0].correction_factor), 1.5625);
  assert.equal(Number(c.gross_total), 5.2); assert.equal(Number(c.yield_factor), Number((3.2 / 5.2).toFixed(4)));
  await fails(as(U.func, "insert into public.recipe_items (recipe_id, ingredient_product_id, gross_quantity, unit_id) values ($1, $2, 1, $3)", [ctx.recipe, ctx.frango, ctx.kg]), "row-level security");
});

test("produção: plano, baixa automática FEFO, novo lote com validade e custo real", async () => {
  const plan = (await one(U.coz, "select public.ops_production_plan($1, $2, 3.2) as p", [ctx.store1, ctx.recipe])).p;
  assert.equal(plan.items[0].needed, 5); assert.equal(plan.items[0].available, 20); assert.equal(plan.has_shortage, false);
  assert.equal(plan.shelf_life_days, 3);
  await fails(as(U.estoq, "select public.ops_produce_now($1, $2, 3.2, 3.0)", [ctx.store1, ctx.recipe]), "Sem permissão");
  const r = (await one(U.coz, "select public.ops_produce_now($1, $2, 3.2, 3.0, $3, '', null, null, 'primeira leva', $4) as r", [ctx.store1, ctx.recipe, ctx.locGel, "20000000-0000-4000-8000-000000000001"])).r;
  assert.equal(r.ok, true); assert.equal(Number(r.produced), 3);
  assert.equal(Number(r.total_cost), 16.5); assert.equal(Number(r.unit_cost), 5.5);
  ctx.lotRecheio = r.lot_id; ctx.production = r.production_id;
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango1])), 15);
  assert.equal(Number(await val(U.coz, "select sum(quantity) from public.stock_items where product_id = $1", [ctx.tempero])), 300);
  const lot = await one(U.coz, "select expires_at::text as e, (current_date + 3)::text as exp, origin, unit_cost, status from public.stock_lots where id = $1", [ctx.lotRecheio]);
  assert.equal(lot.e, lot.exp); assert.equal(lot.origin, "producao"); assert.equal(Number(lot.unit_cost), 5.5); assert.equal(lot.status, "ativo");
  const p = await one(U.coz, "select status, actual_yield_pct, produced_by_name, lot_code from public.productions where id = $1", [ctx.production]);
  assert.equal(p.status, "concluida"); assert.equal(Number(p.actual_yield_pct), 93.75); assert.equal(p.produced_by_name, "Usuário coz"); assert.match(p.lot_code, /^P\d{6}-\d{3}$/);
  assert.equal(Number(await val(U.coz, "select count(*) from public.production_items where production_id = $1", [ctx.production])), 2);
  assert.equal(Number(await val(U.coz, "select cost from public.products where id = $1", [ctx.recheio])), 5.5);
  // idempotência
  const dup = (await one(U.coz, "select public.ops_produce_now($1, $2, 3.2, 3.0, $3, '', null, null, '', $4) as r", [ctx.store1, ctx.recipe, ctx.locGel, "20000000-0000-4000-8000-000000000001"])).r;
  assert.equal(dup.duplicated, true);
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango1])), 15, "não consumiu de novo");
  // insuficiente
  await fails(as(U.coz, "select public.ops_produce_now($1, $2, 32, 30)", [ctx.store1, ctx.recipe]), "Estoque insuficiente");
});

test("FEFO: lote que vence primeiro sai primeiro; consumo com lote errado avisa", async () => {
  ctx.lotFrango2 = await val(U.estoq, "select public.ops_create_lot($1, $2, $3, 5, 'FR-VELHO', current_date + 2, 2.0, 'inicial')", [ctx.store1, ctx.frango, ctx.locGel]);
  assert.equal(await val(U.estoq, "select public.ops_fefo_first_lot($1, $2)", [ctx.store1, ctx.frango]), ctx.lotFrango2);
  const c = (await one(U.coz, "select public.ops_consume($1, $2, 2, null, null, 'teste', '', $3) as r", [ctx.store1, ctx.frango, "20000000-0000-4000-8000-000000000002"])).r;
  assert.equal(c.movements[0].lot_id, ctx.lotFrango2); assert.equal(c.fefo_warning, false);
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango2])), 3);
  const dup = (await one(U.coz, "select public.ops_consume($1, $2, 2, null, null, 'teste', '', $3) as r", [ctx.store1, ctx.frango, "20000000-0000-4000-8000-000000000002"])).r;
  assert.equal(dup.duplicated, true);
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango2])), 3, "idempotente");
  const w = (await one(U.coz, "select public.ops_consume($1, $2, 1, $3) as r", [ctx.store1, ctx.frango, ctx.lotFrango1])).r;
  assert.equal(w.fefo_warning, true, "consumiu do lote novo enquanto o velho ainda tem saldo");
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango1])), 14);
  const sum = (await one(U.coz, "select public.ops_lot_summary($1) as s", [ctx.lotFrango2])).s;
  assert.equal(sum.fefo_first, true); assert.equal(Number(sum.balance), 3); assert.equal(sum.product.name, "Frango (peito)");
  await fails(as(U.other, "select public.ops_lot_summary($1)", [ctx.lotFrango2]), "Sem permissão");
});

test("perda: baixa de estoque com custo e motivo; foto obrigatória quando exigida", async () => {
  const reason = (await one(U.func, "select id from public.loss_reasons where company_id = $1 and code = 'quebra'", [VILA])).id;
  const contam = (await one(U.func, "select id from public.loss_reasons where company_id = $1 and code = 'contaminacao'", [VILA])).id;
  await fails(as(U.func, "select public.ops_register_loss($1, $2, 1, $3)", [ctx.store1, ctx.frango, contam]), "exige foto");
  ctx.loss = await val(U.func, "select public.ops_register_loss($1, $2, 1, $3, $4, null, 'caiu no chão')", [ctx.store1, ctx.frango, reason, ctx.lotFrango1]);
  const l = await one(U.admin, "select quantity, unit_cost, total_cost, reason_name, created_by_name from public.v_losses where id = $1", [ctx.loss]);
  assert.equal(Number(l.quantity), 1); assert.equal(Number(l.unit_cost), 2.5); assert.equal(Number(l.total_cost), 2.5); assert.equal(l.reason_name, "Quebra"); assert.equal(l.created_by_name, "Usuário func");
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango1])), 13);
  assert.equal(await val(U.admin, "select movement_type from public.stock_movements where id = (select movement_id from public.losses where id = $1)", [ctx.loss]), "perda");
  // funcionário vê a própria perda mas não a lista (perdas.ver)
  assert.equal(Number(await val(U.func, "select count(*) from public.losses")), 1);
  // auditor não registra perda
  await fails(as(U.other, "select public.ops_register_loss($1, $2, 1, $3)", [ctx.store1, ctx.frango, reason]), "Sem permissão");
});

test("inventário: teórico × contado, diferença e ajuste ao finalizar", async () => {
  const count = await val(U.estoq, "select public.ops_count_open($1, 'rapida', $2)", [ctx.store1, ctx.locGel]);
  // frango na geladeira: 13 (FR-001) + 3 (FR-VELHO) = 16 teórico. Contado no lote FR-001: 10 (faltam 3)
  const item = await val(U.func, "select public.ops_count_set_item($1, $2, $3, 10, $4, 'quebra não registrada')", [count, ctx.frango, ctx.locGel, ctx.lotFrango1]);
  const it = await one(U.estoq, "select theoretical_quantity, counted_quantity, difference, counted_by_name from public.inventory_items where id = $1", [item]);
  assert.equal(Number(it.theoretical_quantity), 13); assert.equal(Number(it.counted_quantity), 10); assert.equal(Number(it.difference), -3); assert.equal(it.counted_by_name, "Usuário func");
  // recheio sem informar lote (só um lote no local): sobra de 0,5
  await as(U.func, "select public.ops_count_set_item($1, $2, $3, 3.5)", [count, ctx.recheio, ctx.locGel]);
  const c = await one(U.estoq, "select items_count, differences, difference_value from public.inventory_counts where id = $1", [count]);
  assert.equal(Number(c.items_count), 2); assert.equal(Number(c.differences), 2);
  assert.equal(Number(c.difference_value), -3 * 2.5 + 0.5 * 5.5);
  await fails(as(U.func, "select public.ops_finalize_count($1)", [count]), "Sem permissão");
  const fin = (await one(U.estoq, "select public.ops_finalize_count($1) as r", [count])).r;
  assert.equal(fin.adjustments, 2);
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotFrango1])), 10);
  assert.equal(Number(await val(U.coz, "select quantity from public.stock_items where lot_id = $1", [ctx.lotRecheio])), 3.5);
  assert.equal(await val(U.estoq, "select status from public.inventory_counts where id = $1", [count]), "finalizada");
  const movs = await as(U.estoq, "select movement_type, quantity, reason from public.stock_movements where reference_type = 'inventory_count' and reference_id = $1 order by quantity", [count]);
  assert.equal(movs.rows.length, 2); assert.equal(movs.rows[0].movement_type, "inventario"); assert.equal(movs.rows[0].reason, "quebra não registrada");
});

test("transferências: interna (mesmo lote) e entre unidades (lote espelho)", async () => {
  await as(U.estoq, "select public.ops_transfer_internal($1, $2, $3, $4, $5, 2)", [ctx.store1, ctx.frango, ctx.lotFrango1, ctx.locGel, ctx.locSeco]);
  const b = await as(U.estoq, "select location_id, quantity from public.stock_items where lot_id = $1 and quantity > 0 order by quantity", [ctx.lotFrango1]);
  assert.deepEqual(b.rows.map((r) => [r.location_id, Number(r.quantity)]), [[ctx.locSeco, 2], [ctx.locGel, 8]]);
  // estoquista não acessa a Filial
  await fails(as(U.estoq, "select public.ops_transfer_between_stores($1, $2, $3, $4, $5, $6, 1)", [ctx.store1, ctx.store2, ctx.frango, ctx.lotFrango1, ctx.locGel, ctx.loc2]), "Sem permissão");
  const t = await val(U.admin, "select public.ops_transfer_between_stores($1, $2, $3, $4, $5, $6, 1)", [ctx.store1, ctx.store2, ctx.frango, ctx.lotFrango1, ctx.locGel, ctx.loc2]);
  const mirror = await one(U.admin, "select id, lot_code, expires_at, unit_cost, origin from public.stock_lots where store_id = $1 and origin_lot_id = $2", [ctx.store2, ctx.lotFrango1]);
  assert.equal(mirror.lot_code, "FR-001"); assert.equal(Number(mirror.unit_cost), 2.5); assert.equal(mirror.origin, "transferencia");
  ctx.lotFilial = mirror.id;
  assert.equal(Number(await val(U.admin, "select quantity from public.stock_items where lot_id = $1", [mirror.id])), 1);
  assert.equal(Number(await val(U.admin, "select quantity from public.stock_items where lot_id = $1 and location_id = $2", [ctx.lotFrango1, ctx.locGel])), 7);
  assert.equal(Number(await val(U.admin, "select count(*) from public.transfer_items where transfer_id = $1", [t])), 1);
  // isolamento por unidade: estoquista (só Matriz) não vê o estoque da Filial
  assert.equal(Number(await val(U.estoq, "select count(*) from public.stock_items where store_id = $1", [ctx.store2])), 0);
  assert.equal(Number(await val(U.estoq, "select count(*) from public.v_stock_balances where store_id = $1", [ctx.store2])), 0);
  await fails(as(U.estoq, "select public.ops_create_lot($1, $2, $3, 1)", [ctx.store2, ctx.frango, ctx.loc2]), "Sem permissão");
});

test("eventos de lote: abertura reduz validade; bloqueio impede consumo", async () => {
  const ev = (await one(U.coz, "select public.ops_lot_event($1, 'abertura') as r", [ctx.lotRecheio])).r;
  assert.equal(ev.expires_at, (await one(U.coz, "select (current_date + 1)::text as d")).d, "validade após abertura = 1 dia");
  await as(U.estoq, "select public.ops_lot_event($1, 'bloqueio', now(), 'suspeita de contaminação')", [ctx.lotFrango2]);
  await fails(as(U.coz, "select public.ops_consume($1, $2, 1, $3)", [ctx.store1, ctx.frango, ctx.lotFrango2]), "bloqueado");
  assert.notEqual(await val(U.coz, "select public.ops_fefo_first_lot($1, $2)", [ctx.store1, ctx.frango]), ctx.lotFrango2, "lote bloqueado sai do FEFO");
  await as(U.estoq, "select public.ops_lot_event($1, 'desbloqueio')", [ctx.lotFrango2]);
});

test("validade → alerta; vencido não pode ser consumido; estoque mínimo → alerta/reposição", async () => {
  await as(U.admin, "update public.stock_lots set expires_at = current_date - 1 where id = $1", [ctx.lotFrango2]);
  const r = (await one(U.admin, "select public.ops_refresh_alerts($1) as r", [ctx.store1])).r;
  assert.ok(r.touched >= 2);
  const al = await one(U.admin, "select kind, severity, status from public.alerts where entity_type = 'stock_lot' and entity_id = $1", [ctx.lotFrango2]);
  assert.equal(al.kind, "vencido"); assert.equal(al.severity, "critico");
  assert.equal(await val(U.admin, "select status from public.stock_lots where id = $1", [ctx.lotFrango2]), "vencido");
  await fails(as(U.coz, "select public.ops_consume($1, $2, 1, $3)", [ctx.store1, ctx.frango, ctx.lotFrango2]), "vencido");
  const vencendo = await one(U.admin, "select kind from public.alerts where entity_type = 'stock_lot' and entity_id = $1", [ctx.lotRecheio]);
  assert.equal(vencendo.kind, "vencendo");
  // frango: 7 (gel) + 2 (seco) + 3 (vencido) = 12 < mínimo 15
  const rep = await one(U.admin, "select quantity, min_stock, max_stock, level, suggested_purchase, suggested_purchase_units from public.v_replenishment where store_id = $1 and product_id = $2", [ctx.store1, ctx.frango]);
  assert.equal(Number(rep.quantity), 9, "vencido não conta como disponível");
  assert.equal(rep.level, "baixo"); assert.equal(Number(rep.suggested_purchase), 31); assert.equal(Number(rep.suggested_purchase_units), 4, "4 caixas de 10 kg");
  const min = await one(U.admin, "select kind from public.alerts where dedupe_key = $1", [`estoque:${ctx.store1}:${ctx.frango}`]);
  assert.equal(min.kind, "estoque_minimo");
  // alerta pode ser lido e resolvido
  const alertId = (await one(U.admin, "select id from public.alerts where entity_type = 'stock_lot' and entity_id = $1", [ctx.lotFrango2])).id;
  await as(U.func, "select public.ops_alert_mark($1, 'lido')", [alertId]);
  assert.equal(await val(U.admin, "select status from public.alerts where id = $1", [alertId]), "lido");
  await fails(as(U.func, "select public.ops_alert_mark($1, 'resolvido')", [alertId]), "Sem permissão");
  await as(U.estoq, "select public.ops_alert_mark($1, 'resolvido')", [alertId]);
  // perda do vencido
  const venc = (await one(U.estoq, "select id from public.loss_reasons where company_id = $1 and code = 'vencimento'", [VILA])).id;
  await as(U.estoq, "select public.ops_register_loss($1, $2, 3, $3, $4)", [ctx.store1, ctx.frango, venc, ctx.lotFrango2]);
  assert.equal(await val(U.estoq, "select status from public.stock_lots where id = $1", [ctx.lotFrango2]), "esgotado");
});

test("imutabilidade: movimentos, auditoria e histórico de preço não mudam nem somem", async () => {
  const del = await as(U.admin, "delete from public.stock_movements where lot_id = $1", [ctx.lotFrango1]);
  assert.equal(del.rowCount, 0, "RLS: nenhuma linha apagável pela API");
  assert.ok(Number(await val(U.admin, "select count(*) from public.stock_movements where lot_id = $1", [ctx.lotFrango1])) > 0);
  await fails(root("delete from public.stock_movements where lot_id = $1", [ctx.lotFrango1]), "imutável");
  await fails(root("update public.stock_movements set quantity = 0 where lot_id = $1", [ctx.lotFrango1]), "imutável");
  await fails(root("delete from public.audit_logs where entity = 'products'"), "imutável");
  await fails(root("update public.supplier_price_history set price = 0"), "imutável");
  await fails(as(U.admin, "insert into public.stock_items (store_id, location_id, product_id, lot_id, quantity) values ($1, $2, $3, $4, 100)", [ctx.store1, ctx.locGel, ctx.frango, ctx.lotFrango1]), "row-level security");
  // funções internas não são chamáveis pela API
  await fails(as(U.admin, "select public.ops_move_stock($1, $2, $3, $4, 'ajuste', 100)", [ctx.store1, ctx.frango, ctx.lotFrango1, ctx.locGel]), "permission denied");
  await fails(as(U.admin, "select public.ops_audit($1, null, 'x', 'y', null)", [VILA]), "permission denied");
});

test("compras: pedido → aprovação → recebimento pré-preenchido → recebido", async () => {
  const po = await one(U.estoq, "insert into public.purchase_orders (company_id, store_id, supplier_id) values ($1, $2, $3) returning id, number", [VILA, ctx.store1, ctx.supplier]);
  assert.match(po.number, /^PC-\d{4}-0001$/);
  await as(U.estoq, "insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_id, estimated_price) values ($1, $2, 3, $3, 24)", [po.id, ctx.frango, ctx.cx]);
  const i = await one(U.estoq, "select quantity_stock, total from public.purchase_order_items where purchase_order_id = $1", [po.id]);
  assert.equal(Number(i.quantity_stock), 30); assert.equal(Number(i.total), 72);
  assert.equal(Number(await val(U.estoq, "select total from public.purchase_orders where id = $1", [po.id])), 72);
  await fails(as(U.estoq, "update public.purchase_orders set status = 'aprovado' where id = $1", [po.id]), "ações do sistema");
  await as(U.estoq, "select public.ops_po_set_status($1, 'solicitado')", [po.id]);
  await fails(as(U.estoq, "select public.ops_po_set_status($1, 'aprovado')", [po.id]), "Sem permissão");
  await as(U.admin, "select public.ops_po_set_status($1, 'aprovado')", [po.id]);
  await fails(as(U.estoq, "select public.ops_receipt_from_po($1)", ["00000000-0000-4000-8000-000000000000"]), "não encontrado");
  const rc = await val(U.estoq, "select public.ops_receipt_from_po($1)", [po.id]);
  const items = await as(U.estoq, "select quantity, unit_id, unit_price, quantity_stock from public.receipt_items where receipt_id = $1", [rc]);
  assert.equal(items.rows.length, 1); assert.equal(Number(items.rows[0].quantity), 3); assert.equal(Number(items.rows[0].quantity_stock), 30); assert.equal(Number(items.rows[0].unit_price), 24);
  await as(U.estoq, "update public.receipt_items set lot_code = 'FR-002', expires_at = current_date + 8, location_id = $2 where receipt_id = $1", [rc, ctx.locGel]);
  const res = (await one(U.estoq, "select public.ops_receive($1) as r", [rc])).r;
  assert.equal(res.result, "aprovado");
  assert.equal(await val(U.estoq, "select status from public.purchase_orders where id = $1", [po.id]), "recebido");
  assert.equal(Number(await val(U.estoq, "select received_quantity from public.purchase_order_items where purchase_order_id = $1", [po.id])), 30);
  // custo médio ponderado sobre o estoque disponível da empresa (Matriz + Filial), sem vencidos
  const cost = Number(await val(U.estoq, "select cost from public.products where id = $1", [ctx.frango]));
  assert.equal(cost, Number(((10 * 2.5 + 30 * 2.4) / 40).toFixed(4)), "9 kg na Matriz + 1 kg na Filial a 2,50; 30 kg novos a 2,40");
  // comparação de preços
  const cmp = (await one(U.admin, "select public.ops_supplier_price_comparison($1) as c", [ctx.frango])).c;
  assert.equal(cmp.length, 1); assert.equal(Number(cmp[0].purchases), 2); assert.equal(Number(cmp[0].min_price), 2.4);
});

test("temperatura: fora da faixa gera alerta crítico e exige ação; volta à faixa resolve", async () => {
  const eq = await one(U.admin, "insert into public.temperature_equipment (store_id, name, kind, min_temp, max_temp) values ($1, 'Geladeira 1', 'geladeira', 0, 5) returning id", [ctx.store1]);
  await fails(as(U.func, "select public.ops_temperature_register($1, 8)", [eq.id]), "ação corretiva");
  const r = (await one(U.func, "select public.ops_temperature_register($1, 8, 'ajuste_equipamento', 'termostato ajustado', now(), $2) as r", [eq.id, "20000000-0000-4000-8000-000000000003"])).r;
  assert.equal(r.in_range, false); assert.ok(r.alert_id);
  const al = await one(U.admin, "select kind, severity, status from public.alerts where id = $1", [r.alert_id]);
  assert.equal(al.kind, "temperatura"); assert.equal(al.severity, "critico"); assert.equal(al.status, "aberto");
  const dup = (await one(U.func, "select public.ops_temperature_register($1, 8, 'ajuste_equipamento', 'x', now(), $2) as r", [eq.id, "20000000-0000-4000-8000-000000000003"])).r;
  assert.equal(dup.duplicated, true);
  const ok = (await one(U.func, "select public.ops_temperature_register($1, 3) as r", [eq.id])).r;
  assert.equal(ok.in_range, true);
  assert.equal(await val(U.admin, "select status from public.alerts where id = $1", [r.alert_id]), "resolvido");
  assert.equal(Number(await val(U.admin, "select count(*) from public.temperature_logs where equipment_id = $1", [eq.id])), 2);
  await fails(as(U.other, "select public.ops_temperature_register($1, 3)", [eq.id]), "Sem permissão");
});

test("checklists: geração diária, tarefa crítica exige evidência, conclusão obrigatória", async () => {
  const n = Number(await val(U.func, "select public.ops_generate_checklists($1, current_date)", [ctx.store1]));
  assert.ok(n >= 2, "abertura e fechamento do dia");
  assert.equal(Number(await val(U.func, "select public.ops_generate_checklists($1, current_date)", [ctx.store1])), 0, "idempotente");
  const ex = await one(U.func, "select e.id, e.total_items from public.checklist_executions e join public.checklists c on c.id = e.checklist_id where e.store_id = $1 and c.kind = 'abertura' and e.due_date = current_date", [ctx.store1]);
  assert.equal(Number(ex.total_items), 5);
  const crit = await one(U.func, "select id from public.checklist_execution_items where execution_id = $1 and critical order by position limit 1", [ex.id]);
  await fails(as(U.func, "select public.ops_checklist_item_set($1, true)", [crit.id]), "crítica");
  const r = (await one(U.func, "select public.ops_checklist_item_set($1, true, 'geladeiras a 3 °C') as r", [crit.id])).r;
  assert.equal(r.done_items, 1);
  assert.equal(await val(U.func, "select status from public.checklist_executions where id = $1", [ex.id]), "em_andamento");
  await fails(as(U.func, "select public.ops_checklist_finish($1)", [ex.id]), "pendente");
  await as(U.func, "select public.ops_checklist_item_set(i.id, true, 'ok') from public.checklist_execution_items i where i.execution_id = $1 and not i.done", [ex.id]);
  const fin = (await one(U.func, "select public.ops_checklist_finish($1) as r", [ex.id])).r;
  assert.equal(fin.pending, 0);
  const done = await one(U.admin, "select status, finished_by_name, done_items from public.checklist_executions where id = $1", [ex.id]);
  assert.equal(done.status, "concluido"); assert.equal(done.finished_by_name, "Usuário func"); assert.equal(Number(done.done_items), 5);
  await fails(as(U.other, "select public.ops_generate_checklists($1, current_date)", [ctx.store1]), "Sem permissão");
});

test("tarefas: atribuição, atraso automático e permissões", async () => {
  const t = await one(U.admin, "insert into public.tasks (store_id, title, assigned_to, priority, due_at) values ($1, 'Organizar câmara fria', $2, 'alta', now() - interval '1 hour') returning id, status, assigned_name, created_by_name", [ctx.store1, U.func]);
  assert.equal(t.status, "atrasada"); assert.equal(t.assigned_name, "Usuário func"); assert.equal(t.created_by_name, "Usuário admin");
  await fails(as(U.func, "insert into public.tasks (store_id, title) values ($1, 'x')", [ctx.store1]), "row-level security");
  await as(U.func, "update public.tasks set status = 'concluida' where id = $1", [t.id]);
  const d = await one(U.admin, "select status, completed_at, completed_by from public.tasks where id = $1", [t.id]);
  assert.equal(d.status, "concluida"); assert.ok(d.completed_at); assert.equal(d.completed_by, U.func);
});

test("painel e relatórios", async () => {
  const d = (await one(U.admin, "select public.ops_dashboard($1) as d", [ctx.store1])).d;
  assert.ok(Number(d.cards.stock_value) > 0);
  assert.equal(Number(d.cards.losses_count), 2);
  assert.equal(Number(d.cards.below_min), 0, "após a compra de 30 kg nada está abaixo do mínimo");
  assert.equal(Number(d.cards.stock_products), 3);
  assert.ok(Array.isArray(d.series.losses_by_reason) && d.series.losses_by_reason.length === 2);
  assert.ok(d.series.stock_by_category.length >= 1);
  await fails(as(U.other, "select public.ops_dashboard($1)", [ctx.store1]), "Sem permissão");
  const cons = (await one(U.other, "select 1")).rows;
  const rep = (await one(U.admin, "select public.ops_report_consumption($1, current_date - 30, current_date, 'produto') as r", [ctx.store1])).r;
  assert.ok(rep.some((x) => x.label === "Frango (peito)" && Number(x.quantity) === 8), JSON.stringify(rep));
  await fails(as(U.func, "select public.ops_report_consumption($1, current_date - 30, current_date)", [ctx.store1]), "Sem permissão");
  const losses = (await one(U.admin, "select public.ops_report_losses($1, current_date - 30, current_date, 'motivo') as r", [ctx.store1])).r;
  assert.equal(losses.length, 2);
  const prod = (await one(U.admin, "select public.ops_report_production($1, current_date - 30, current_date) as r", [ctx.store1])).r;
  assert.equal(prod.length, 1); assert.equal(Number(prod[0].produced), 3);
  // etiqueta emitida fica registrada
  await as(U.coz, "insert into public.labels (store_id, template_id, product_id, lot_id, kind, copies, payload) values ($1, (select id from public.label_templates where company_id = $2 and kind = 'producao' limit 1), $3, $4, 'producao', 2, '{\"product_name\":\"Recheio de frango\"}')", [ctx.store1, VILA, ctx.recheio, ctx.lotRecheio]);
  const lb = await one(U.coz, "select printed_by_name, copies from public.labels where lot_id = $1", [ctx.lotRecheio]);
  assert.equal(lb.printed_by_name, "Usuário coz"); assert.equal(lb.copies, 2);
  await fails(root("delete from public.labels where lot_id = $1", [ctx.lotRecheio]), "imutável");
  // auditoria completa da jornada
  const acts = await as(U.admin, "select distinct action from public.audit_logs where company_id = $1", [VILA]);
  for (const a of ["criou", "finalizou_recebimento", "concluiu_producao", "registrou_perda", "finalizou_inventario", "concluiu_checklist", "status:aprovado"]) {
    assert.ok(acts.rows.some((r) => r.action === a), `auditoria sem ação ${a}`);
  }
  assert.equal(Number(await val(U.func, "select count(*) from public.audit_logs")), 0, "funcionário não vê auditoria");
});

test("chave de serviço: cron consegue gerar checklists e atualizar alertas sem usuário", async () => {
  const r = (await asService("select public.ops_refresh_alerts($1) as r", [ctx.store1])).rows[0].r;
  assert.equal(r.ok, true);
  const n = Number((await asService("select public.ops_generate_checklists($1, current_date + 1) as n", [ctx.store1])).rows[0].n);
  assert.ok(n >= 2, "checklists de amanhã gerados pelo cron");
  // integração: baixa por API (chave de serviço) fica auditada com usuário vazio
  const c = (await asService("select public.ops_consume($1, $2, 0.5, null, null, 'venda PDV', 'via API', $3) as r", [ctx.store1, ctx.frango, "20000000-0000-4000-8000-000000000010"])).rows[0].r;
  assert.equal(c.ok, true);
});

test("onboarding: criar empresa nova torna o criador admin e aplica padrões; ninguém mais vê", async () => {
  const id = await val(U.other, "select public.ops_create_company('Nova Loja', '🍕', '#2563eb', 'Centro')");
  assert.equal(await val(U.other, "select public.ops_is_admin($1)", [id]), true);
  assert.equal(Number(await val(U.other, "select count(*) from public.stores where company_id = $1", [id])), 1);
  assert.equal(Number(await val(U.other, "select count(*) from public.loss_reasons where company_id = $1", [id])), 10);
  assert.equal(Number(await val(U.admin, "select count(*) from public.companies where id = $1", [id])), 0, "admin da Vila Rica não vê a empresa nova");
  // convite por e-mail vira vínculo no cadastro
  const role = (await one(U.other, "select id from public.access_roles where company_id is null and code = 'cozinha'")).id;
  await as(U.other, "insert into public.memberships (company_id, invited_email, access_role_id) values ($1, 'novo@teste.local', $2)", [id, role]);
  assert.equal(await anon("select public.ops_invite_exists('NOVO@teste.local') as v").then((r) => r.rows[0].v), true);
  await root("insert into auth.users (id, email) values ($1, 'novo@teste.local')", ["10000000-0000-4000-8000-000000000009"]);
  const m = await one(U.other, "select user_id, invited_email from public.memberships where company_id = $1 and access_role_id = $2", [id, role]);
  assert.equal(m.user_id, "10000000-0000-4000-8000-000000000009"); assert.equal(m.invited_email, "");
  assert.equal(await anon("select public.ops_invite_exists('novo@teste.local') as v").then((r) => r.rows[0].v), false);
  // anon não lê tabelas
  await fails(anon("select count(*) from public.products"), "permission denied");
});
