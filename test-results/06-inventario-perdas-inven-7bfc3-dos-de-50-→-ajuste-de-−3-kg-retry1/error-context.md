# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 06-inventario-perdas.spec.mjs >> inventário e perdas >> contagem completa do estoque seco: 47 contados de 50 → ajuste de −3 kg
- Location: tests/e2e/06-inventario-perdas.spec.mjs:21:3

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.click: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Nova contagem' })

```

# Page snapshot

```yaml
- paragraph [ref=f4e8]: Carregando sua sessão…
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { ensureAdmin, ensureProduct, gotoRetry, login, rpc, select, selectByText, selectStore, token, UNITS, vilaStore, warmRoutes } from "./helpers.mjs";
  3  | 
  4  | /** Contagem completa (teórico × contado → ajuste) e registro de perda com custo. */
  5  | test.describe.serial("inventário e perdas", () => {
  6  |   let tok, batata, store, seco;
  7  | 
  8  |   test.beforeAll(async ({ request }) => {
  9  |     await ensureAdmin(request);
  10 |     tok = await token(request);
  11 |     const v = await vilaStore(request, tok);
  12 |     store = v.store;
  13 |     seco = v.locations.find((l) => l.kind === "estoque_seco") ?? v.locations[0];
  14 |     batata = await ensureProduct(request, tok, { name: "Batata", internal_code: "00401", stock_unit_id: UNITS.kg, cost: 4, min_stock: 10 });
  15 |     const has = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
  16 |     if (!has[0] || Number(has[0].quantity) === 0) {
  17 |       await rpc(request, tok, "ops_create_lot", { p_store: store.id, p_product: batata.id, p_location: seco.id, p_quantity: 50, p_lot_code: "BT-1", p_expires_at: "2026-10-20", p_unit_cost: 4, p_origin: "inicial" });
  18 |     }
  19 |   });
  20 | 
  21 |   test("contagem completa do estoque seco: 47 contados de 50 → ajuste de −3 kg", async ({ page, request }) => {
  22 |     await login(page);
  23 |     await selectStore(page);
  24 |     await warmRoutes(page, ["/inventario", "/perdas"]);
  25 |     await gotoRetry(page, "/inventario");
> 26 |     await page.getByRole("button", { name: "Nova contagem" }).click();
     |                                                               ^ Error: locator.click: Test timeout of 90000ms exceeded.
  27 |     const sheet = page.locator('[class*="sheet-up"]').last();
  28 |     await sheet.getByRole("button", { name: /completa/i }).click();
  29 |     await selectByText(sheet.locator("select").first(), "Estoque seco");
  30 |     await sheet.getByRole("button", { name: "Abrir contagem" }).click();
  31 |     await expect(page).toHaveURL(/\/inventario\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  32 |     await expect(page.getByText("Batata").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  33 | 
  34 |     await page.getByText("Batata").filter({ visible: true }).first().click();
  35 |     const item = page.locator('[class*="sheet-up"]').last();
  36 |     await item.getByPlaceholder("0", { exact: true }).first().fill("47");
  37 |     const reason = item.getByRole("button", { name: /quebra/i }).first();
  38 |     if (await reason.count()) await reason.click();
  39 |     await item.getByRole("button", { name: /Confirmar contagem|Salvar correção/ }).click();
  40 |     await expect(page.getByText(/-3 kg|−3 kg/).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  41 | 
  42 |     await page.getByRole("button", { name: "Finalizar" }).click();
  43 |     await page.getByRole("button", { name: "Finalizar e ajustar estoque" }).click();
  44 |     await expect(page.getByText("Contagem finalizada").first()).toBeVisible({ timeout: 60_000 });
  45 | 
  46 |     const bal = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
  47 |     expect(Number(bal[0].quantity)).toBe(47);
  48 |     const movs = await select(request, tok, `v_movements?select=movement_type,quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}&movement_type=eq.inventario`);
  49 |     expect(movs.length).toBe(1);
  50 |     expect(Number(movs[0].quantity)).toBe(-3);
  51 |   });
  52 | 
  53 |   test("registra perda de 1 kg por quebra com custo R$ 4,00", async ({ page, request }) => {
  54 |     await login(page);
  55 |     await selectStore(page);
  56 |     await gotoRetry(page, "/perdas/nova");
  57 |     await expect(page.getByRole("heading", { name: "Registrar perda" })).toBeVisible({ timeout: 60_000 });
  58 |     await page.getByPlaceholder(/Buscar produto/).first().fill("Batata");
  59 |     await page.getByRole("button", { name: /Batata/ }).first().click();
  60 |     await page.getByPlaceholder("0", { exact: true }).first().fill("1");
  61 |     await page.getByRole("button", { name: /quebra/i }).first().click();
  62 |     await page.getByRole("button", { name: "Registrar perda", exact: true }).first().click();
  63 |     await page.getByRole("button", { name: "Registrar perda", exact: true }).last().click();
  64 |     await expect(page.getByRole("button", { name: "Registrar outra" })).toBeVisible({ timeout: 60_000 });
  65 | 
  66 |     const losses = await select(request, tok, `v_losses?select=quantity,total_cost,reason_name&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
  67 |     expect(losses.length).toBe(1);
  68 |     expect(Number(losses[0].quantity)).toBe(1);
  69 |     expect(Number(losses[0].total_cost)).toBe(4);
  70 |     expect(losses[0].reason_name).toBe("Quebra");
  71 |     const bal = await select(request, tok, `v_stock_by_product?select=quantity&store_id=eq.${store.id}&product_id=eq.${batata.id}`);
  72 |     expect(Number(bal[0].quantity)).toBe(46);
  73 | 
  74 |     await gotoRetry(page, "/perdas");
  75 |     await expect(page.getByText("Batata").filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  76 |   });
  77 | });
  78 | 
```