import { test, expect } from "@playwright/test";
import { ensureAdmin, ensureProduct, gotoRetry, login, rpc, select, selectByText, selectStore, token, UNITS, vilaStore, warmRoutes } from "./helpers.mjs";

/** Contagem completa (teórico × contado → ajuste) e registro de perda com custo. */
test.describe.serial("inventário e perdas", () => {
  let tok, batata, store, seco;

  test.beforeAll(async ({ request }) => {
    await ensureAdmin(request);
    tok = await token(request);
    const v = await vilaStore(request, tok);
    store = v.store;
    seco = v.locations.find((l) => l.kind === "estoque_seco") ?? v.locations[0];
    batata = await ensureProduct(request, tok, { name: "Batata", internal_code: "00401", stock_unit_id: UNITS.kg, cost: 4, min_stock: 10 });
    const has = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
    if (!has[0] || Number(has[0].quantity) === 0) {
      await rpc(request, tok, "ops_create_lot", { p_store: store.id, p_product: batata.id, p_location: seco.id, p_quantity: 50, p_lot_code: "BT-1", p_expires_at: "2026-10-20", p_unit_cost: 4, p_origin: "inicial" });
    }
  });

  test("contagem completa do estoque seco: 47 contados de 50 → ajuste de −3 kg", async ({ page, request }) => {
    await login(page);
    await selectStore(page);
    await warmRoutes(page, ["/inventario", "/perdas"]);
    await gotoRetry(page, "/inventario");
    await page.getByRole("button", { name: "Nova contagem" }).click();
    const sheet = page.locator('[class*="sheet-up"]').last();
    await sheet.getByRole("button", { name: /completa/i }).click();
    await selectByText(sheet.locator("select").first(), "Estoque seco");
    await sheet.getByRole("button", { name: "Abrir contagem" }).click();
    await expect(page).toHaveURL(/\/inventario\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByText("Batata").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    await page.getByText("Batata").filter({ visible: true }).first().click();
    const item = page.locator('[class*="sheet-up"]').last();
    await item.getByPlaceholder("0", { exact: true }).first().fill("47");
    const reason = item.getByRole("button", { name: /quebra/i }).first();
    if (await reason.count()) await reason.click();
    await item.getByRole("button", { name: /Confirmar contagem|Salvar correção/ }).click();
    await expect(page.getByText(/-3 kg|−3 kg/).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Finalizar" }).click();
    await page.getByRole("button", { name: "Finalizar e ajustar estoque" }).click();
    await expect(page.getByText("Contagem finalizada").first()).toBeVisible({ timeout: 60_000 });

    const bal = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
    expect(Number(bal[0].quantity)).toBe(47);
    const movs = await select(request, tok, `v_movements?select=movement_type,quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}&movement_type=eq.inventario`);
    expect(movs.length).toBe(1);
    expect(Number(movs[0].quantity)).toBe(-3);
  });

  test("registra perda de 1 kg por quebra com custo R$ 4,00", async ({ page, request }) => {
    await login(page);
    await selectStore(page);
    await gotoRetry(page, "/perdas/nova");
    await expect(page.getByRole("heading", { name: "Registrar perda" })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder(/Buscar produto/).first().fill("Batata");
    await page.getByRole("button", { name: /Batata/ }).first().click();
    await page.getByPlaceholder("0", { exact: true }).first().fill("1");
    await page.getByRole("button", { name: /quebra/i }).first().click();
    await page.getByRole("button", { name: "Registrar perda", exact: true }).first().click();
    await page.getByRole("button", { name: "Registrar perda", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "Registrar outra" })).toBeVisible({ timeout: 60_000 });

    const losses = await select(request, tok, `v_losses?select=quantity,total_cost,reason_name&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
    expect(losses.length).toBe(1);
    expect(Number(losses[0].quantity)).toBe(1);
    expect(Number(losses[0].total_cost)).toBe(4);
    expect(losses[0].reason_name).toBe("Quebra");
    const bal = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
    expect(Number(bal[0].quantity)).toBe(46);

    await gotoRetry(page, "/perdas");
    await expect(page.getByText("Batata").filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  });
});
