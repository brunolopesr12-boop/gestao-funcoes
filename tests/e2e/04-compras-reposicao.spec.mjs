import { test, expect } from "@playwright/test";
import { ensureAdmin, ensureProduct, ensureSupplier, gotoRetry, login, rpc, selectStore, token, UNITS, vilaStore, warmRoutes } from "./helpers.mjs";

/** Reposição → pedido de compra → aprovação → recebimento pré-preenchido → pedido recebido. */
test.describe.serial("reposição → compra → recebimento", () => {
  let tok, queijo, supplier, store;

  test.beforeAll(async ({ request }) => {
    await ensureAdmin(request);
    tok = await token(request);
    supplier = await ensureSupplier(request, tok, "Laticínios Serra");
    queijo = await ensureProduct(request, tok, {
      name: "Queijo mussarela", internal_code: "00201", stock_unit_id: UNITS.kg, purchase_unit_id: UNITS.cx, purchase_factor: 4,
      min_stock: 10, max_stock: 30, reorder_point: 12, shelf_life_days: 30, storage_type: "refrigerado", default_supplier_id: supplier.id, cost: 38,
    });
    ({ store } = await vilaStore(request, tok));
  });

  test("reposição lista o produto abaixo do mínimo e gera o pedido de compra", async ({ page }) => {
    await login(page);
    await selectStore(page);
    await warmRoutes(page, ["/compras", "/recebimento"]);
    await gotoRetry(page, "/reposicao");
    await expect(page.getByRole("heading", { name: "Reposição" })).toBeVisible({ timeout: 60_000 });
    const row = page.locator("table").first().getByRole("row", { name: /Queijo mussarela/ }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(/30 kg/).first()).toBeVisible(); // sugestão = máximo − atual (0)
    await row.getByLabel("Selecionar").check();
    await page.getByRole("button", { name: "Gerar pedido de compra" }).click();
    await page.getByRole("button", { name: /Criar pedido/ }).click();
    // confirmação (toast); com um único pedido o sistema abre o pedido em seguida
    await expect(page.getByText(/criado como rascunho|pedidos criados/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("pedido: solicitar → aprovar → receber → pedido recebido", async ({ page, request }) => {
    const pos = await (await request.get(`http://localhost:54321/rest/v1/purchase_orders?select=id,number,status&store_id=eq.${store.id}&order=created_at.desc&limit=1`, { headers: { authorization: `Bearer ${tok}` } })).json();
    expect(pos.length).toBe(1);
    const po = pos[0];
    await login(page);
    await selectStore(page);
    await gotoRetry(page, `/compras/${po.id}`);
    await expect(page.getByRole("heading", { name: `Pedido ${po.number}` })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Queijo mussarela").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/R\$\s?1\.216,00/).first()).toBeVisible(); // 8 cx × 4 kg × R$ 38

    await page.getByRole("button", { name: "Solicitar aprovação" }).click();
    await page.getByRole("button", { name: "Solicitar", exact: true }).click();
    await expect(page.getByText("Solicitado").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Aprovar", exact: true }).first().click();
    await page.getByRole("button", { name: "Aprovar", exact: true }).last().click();
    await expect(page.getByText("Aprovado").first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Receber mercadoria" }).click();
    await page.getByRole("button", { name: "Ir para a conferência" }).click();
    // o rascunho do recebimento é criado pela RPC; se a navegação falhar (dev server compilando), abrimos direto
    await page.waitForURL(/\/recebimento\/[0-9a-f-]{36}$/, { timeout: 20_000 }).catch(async () => {
      const rc = await (await request.get(`http://localhost:54321/rest/v1/receipts?select=id&purchase_order_id=eq.${po.id}&status=eq.rascunho`, { headers: { authorization: `Bearer ${tok}` } })).json();
      expect(rc.length).toBe(1);
      await gotoRetry(page, `/recebimento/${rc[0].id}`);
    });
    await expect(page).toHaveURL(/\/recebimento\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByText("Queijo mussarela").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Finalizar recebimento" }).click();
    await page.getByRole("button", { name: "Finalizar e dar entrada" }).click();
    await expect(page.getByRole("heading", { name: /Recebimento .* finalizado/ })).toBeVisible({ timeout: 60_000 });

    // pedido virou "Recebido" e o estoque tem 30 kg (8 caixas × 4 kg)
    const after = await rpc(request, tok, "ops_dashboard", { p_store: store.id });
    expect(Number(after.cards.stock_products)).toBeGreaterThanOrEqual(1);
    const poAfter = await (await request.get(`http://localhost:54321/rest/v1/purchase_orders?select=status&id=eq.${po.id}`, { headers: { authorization: `Bearer ${tok}` } })).json();
    expect(poAfter[0].status).toBe("recebido");
    const bal = await (await request.get(`http://localhost:54321/rest/v1/v_stock_by_product?select=quantity,level&store_id=eq.${store.id}&product_id=eq.${queijo.id}`, { headers: { authorization: `Bearer ${tok}` } })).json();
    expect(Number(bal[0].quantity)).toBe(32);
    expect(bal[0].level).toBe("normal");
  });
});
