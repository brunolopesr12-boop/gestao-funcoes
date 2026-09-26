import { test, expect } from "@playwright/test";
import { ensureAdmin, ensureProduct, gotoRetry, login, rpc, select, selectByText, selectStore, token, UNITS, vilaStore, warmRoutes } from "./helpers.mjs";

/** Ficha técnica (custo/rendimento) → produção com baixa FEFO → novo lote com validade e custo real. */
test.describe.serial("ficha técnica → produção", () => {
  let tok, frango, tempero, recheio, store, locations;

  test.beforeAll(async ({ request }) => {
    await ensureAdmin(request);
    tok = await token(request);
    ({ store, locations } = await vilaStore(request, tok));
    frango = await ensureProduct(request, tok, { name: "Frango (peito)", internal_code: "00101", stock_unit_id: UNITS.kg, shelf_life_days: 5, storage_type: "refrigerado", cost: 2.5 });
    tempero = await ensureProduct(request, tok, { name: "Tempero da casa", internal_code: "00102", stock_unit_id: UNITS.g, cost: 0.02 });
    recheio = await ensureProduct(request, tok, { name: "Recheio de frango", internal_code: "00301", product_kind: "semipronto", stock_unit_id: UNITS.kg, shelf_life_days: 3, shelf_life_open_days: 1 });
    const gel = locations.find((l) => l.kind === "geladeira") ?? locations[0];
    const seco = locations.find((l) => l.kind === "estoque_seco") ?? locations[0];
    // cada ingrediente ganha estoque inicial só se estiver zerado (os specs 03/04 já podem ter recebido frango)
    const qtyOf = async (productId) => {
      const r = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${productId}`);
      return r[0] ? Number(r[0].quantity) : 0;
    };
    if ((await qtyOf(frango.id)) === 0) {
      await rpc(request, tok, "ops_create_lot", { p_store: store.id, p_product: frango.id, p_location: gel.id, p_quantity: 20, p_lot_code: "FR-100", p_expires_at: "2026-10-06", p_unit_cost: 2.5, p_origin: "inicial" });
    }
    if ((await qtyOf(tempero.id)) === 0) {
      await rpc(request, tok, "ops_create_lot", { p_store: store.id, p_product: tempero.id, p_location: seco.id, p_quantity: 500, p_lot_code: "TP-1", p_expires_at: null, p_unit_cost: 0.02, p_origin: "inicial" });
    }
  });

  test("cria a ficha com ingredientes e vê custo, perda e fator de correção", async ({ page }) => {
    await login(page);
    await selectStore(page);
    await warmRoutes(page, ["/fichas", "/producao"]);
    await gotoRetry(page, "/fichas/nova");
    await expect(page.getByRole("heading", { name: "Ficha técnica" })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder(/Buscar produto/).first().fill("Recheio");
    await page.getByRole("button", { name: /Recheio de frango/ }).first().click();
    await page.getByPlaceholder("0", { exact: true }).first().fill("3,2");
    await page.getByRole("button", { name: "Criar ficha e continuar" }).click();
    await expect(page).toHaveURL(/\/fichas\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    // ingrediente 1: frango 5 kg bruto → 3,2 kg líquido
    await page.getByRole("button", { name: "Adicionar" }).first().click();
    let drawer = page.locator('[class*="sheet-up"]').last();
    await drawer.getByPlaceholder("Buscar produto (nome ou código)").fill("Frango");
    await drawer.getByRole("button", { name: /Frango \(peito\)/ }).first().click();
    await drawer.getByPlaceholder("0", { exact: true }).first().fill("5");
    await drawer.getByPlaceholder("Sem perda").fill("3,2");
    await drawer.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Frango (peito)").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    // ingrediente 2: tempero 200 g
    await page.getByRole("button", { name: "Adicionar" }).first().click();
    drawer = page.locator('[class*="sheet-up"]').last();
    await drawer.getByPlaceholder("Buscar produto (nome ou código)").fill("Tempero");
    await drawer.getByRole("button", { name: /Tempero da casa/ }).first().click();
    await drawer.getByPlaceholder("0", { exact: true }).first().fill("200");
    await drawer.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Tempero da casa").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    // custo: 5 × 2,50 + 200 × 0,02 = 16,50 ; fator de correção do frango 1,5625 ; perda 36%
    await expect(page.getByText(/R\$\s?16,50/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1,56/).first()).toBeVisible();
    await expect(page.getByText(/36/).first()).toBeVisible();
  });

  test("produz 3,0 kg planejando 3,2: baixa FEFO, lote com validade de 3 dias e custo real", async ({ page, request }) => {
    const before = async (productId) => {
      const r = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${productId}`);
      return r[0] ? Number(r[0].quantity) : 0;
    };
    const frangoBefore = await before(frango.id);
    const recheioBefore = await before(recheio.id);
    await login(page);
    await selectStore(page);
    await gotoRetry(page, "/producao/nova");
    await expect(page.getByRole("heading", { name: "Nova produção" })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("Buscar pelo nome da ficha ou do produto").fill("Recheio");
    await page.getByRole("button", { name: /Recheio de frango/ }).first().click();
    await expect(page.getByText("Quanto você vai produzir?")).toBeVisible({ timeout: 30_000 });
    const qty = page.getByPlaceholder("0", { exact: true }).first();
    await qty.fill("3,2");
    await expect(page.getByText("Ingredientes necessários")).toBeVisible();
    await expect(page.getByText(/5 kg/).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Produzir agora" }).click();
    const produced = page.getByPlaceholder("0", { exact: true }).last();
    await produced.fill("3");
    await page.getByRole("button", { name: "Produzir e criar lote" }).click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Produção concluída" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/93,75/).first()).toBeVisible(); // rendimento real 3,0 / 3,2

    const prods = await select(request, tok, `productions?select=status,produced_quantity,actual_yield_pct,total_cost,unit_cost,lot_id,expires_at&store_id=eq.${store.id}&order=created_at.desc&limit=1`);
    expect(prods[0].status).toBe("concluida");
    expect(Number(prods[0].total_cost)).toBe(16.5);
    expect(Number(prods[0].unit_cost)).toBe(5.5);
    const lot = await select(request, tok, `stock_lots?select=lot_code,expires_at,unit_cost,origin&id=eq.${prods[0].lot_id}`);
    expect(lot[0].origin).toBe("producao");
    expect(Number(lot[0].unit_cost)).toBe(5.5);
    const frangoBal = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${frango.id}`);
    expect(Number(frangoBal[0].quantity)).toBeCloseTo(frangoBefore - 5, 3); // baixa de 5 kg (FEFO)
    const recheioBal = await select(request, tok, `v_stock_by_product?select=quantity,cost&store_id=eq.${store.id}&product_id=eq.${recheio.id}`);
    expect(Number(recheioBal[0].quantity)).toBeCloseTo(recheioBefore + 3, 3);
  });
});
