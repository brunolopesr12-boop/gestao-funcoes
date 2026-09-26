import { test, expect } from "@playwright/test";
import { ensureAdmin, ensureProduct, ensureSupplier, login, selectByText, selectStore, token, UNITS } from "./helpers.mjs";

/** Fluxo real: recebimento → lote/validade → estoque → consumo → ficha do lote. */
test.describe.serial("recebimento → estoque → consumo", () => {
  let tok, frango, supplier, receiptUrl;

  test.beforeAll(async ({ request }) => {
    await ensureAdmin(request);
    tok = await token(request);
    supplier = await ensureSupplier(request, tok, "Frigorífico Boa Carne");
    frango = await ensureProduct(request, tok, {
      name: "Frango (peito)", internal_code: "00101", stock_unit_id: UNITS.kg, purchase_unit_id: UNITS.cx, purchase_factor: 10,
      min_stock: 15, max_stock: 40, reorder_point: 18, shelf_life_days: 5, storage_type: "refrigerado", default_supplier_id: supplier.id,
    });
  });

  test("cria o recebimento e confere um item", async ({ page }) => {
    await login(page);
    await selectStore(page);
    await page.goto("/recebimento/novo");
    await expect(page.getByRole("heading", { name: "Novo recebimento" })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Fornecedor").selectOption({ label: "Frigorífico Boa Carne" });
    await page.getByPlaceholder("Ex.: 12345").fill("98765");
    await page.getByRole("button", { name: "Começar conferência" }).click();
    await expect(page).toHaveURL(/\/recebimento\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    receiptUrl = page.url();

    await page.getByRole("button", { name: "Adicionar item" }).first().click();
    const drawer = page.locator('[class*="sheet-up"]').last();
    await drawer.getByPlaceholder(/Buscar produto/).fill("Frango");
    await drawer.getByRole("button", { name: /Frango \(peito\)/ }).first().click();
    const qty = drawer.getByPlaceholder("0", { exact: true }).first();
    await qty.fill("2");
    // unidade de compra: caixa (1 cx = 10 kg)
    await selectByText(drawer.locator("select").first(), "cx");
    await drawer.getByPlaceholder("Nº do lote na embalagem").fill("FR-001");
    await drawer.locator('input[type="date"]').first().fill("2026-10-06");
    await drawer.getByPlaceholder("0,00", { exact: true }).first().fill("25");
    await drawer.getByRole("button", { name: /^(Salvar|Adicionar|Salvar e adicionar outro)/ }).last().click();
    await expect(page.getByText("FR-001").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/20 kg/).filter({ visible: true }).first()).toBeVisible();
  });

  test("finaliza: lote criado, estoque atualizado e custo por kg calculado", async ({ page }) => {
    await login(page);
    await selectStore(page);
    await page.goto(receiptUrl);
    await page.getByRole("button", { name: "Finalizar recebimento" }).click();
    await page.getByRole("button", { name: "Finalizar e dar entrada" }).click();
    await expect(page.getByText(/Aprovado/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: /FR-001/ }).first()).toBeVisible();

    await page.goto("/estoque");
    await expect(page.getByRole("heading", { name: /Estoque/ }).first()).toBeVisible({ timeout: 60_000 });
    const table = page.locator("table").first();
    const row = table.getByRole("row", { name: /Frango \(peito\)/ }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(/20 kg/)).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/estoque/produto/${frango.id}`), { timeout: 60_000 });
    await expect(page.getByText("FR-001").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/R\$\s?2,50/).filter({ visible: true }).first()).toBeVisible();
  });

  test("consome 2 kg (FEFO) e a ficha do lote mostra o histórico", async ({ page }) => {
    await login(page);
    await selectStore(page);
    await page.goto(`/estoque/produto/${frango.id}`);
    await page.getByRole("button", { name: /Consumir/ }).first().click();
    const drawer = page.locator('[class*="sheet-up"]').last();
    await drawer.getByPlaceholder("0", { exact: true }).first().fill("2");
    await drawer.getByRole("button", { name: "Registrar consumo" }).click();
    await expect(page.getByText(/18 kg/).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    // linha do lote na tabela "Saldos por lote e local" abre a ficha do lote
    await page.locator("table").first().getByRole("row", { name: /FR-001/ }).first().click();
    await expect(page).toHaveURL(/\/lote\//, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Lote FR-001/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Histórico de movimentações")).toBeVisible();
    await expect(page.getByText(/Consumo/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/Entrada/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("QR Code do lote")).toBeVisible();
  });
});
