import { test, expect } from "@playwright/test";
import { ensureAdmin, gotoRetry, insert, login, select, selectStore, token, vilaStore, warmRoutes } from "./helpers.mjs";

/** Temperatura fora da faixa → alerta; checklist do dia com tarefa crítica; tarefa com prazo. */
test.describe.serial("temperaturas, checklists e tarefas", () => {
  let tok, store, equipment;

  test.beforeAll(async ({ request }) => {
    await ensureAdmin(request);
    tok = await token(request);
    ({ store } = await vilaStore(request, tok));
    const found = await select(request, tok, `temperature_equipment?select=*&store_id=eq.${store.id}&name=eq.Geladeira%201`);
    equipment = found[0] ?? (await insert(request, tok, "temperature_equipment", { store_id: store.id, name: "Geladeira 1", kind: "geladeira", min_temp: 0, max_temp: 5 }));
  });

  test("temperatura fora da faixa exige ação corretiva e gera alerta crítico", async ({ page, request }) => {
    await login(page);
    await selectStore(page);
    await warmRoutes(page, ["/temperaturas", "/checklists", "/tarefas", "/alertas"]);
    await gotoRetry(page, "/temperaturas/registrar");
    await expect(page.getByRole("heading", { name: "Registrar temperatura" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Geladeira 1/ }).first().click();
    await page.getByPlaceholder("0,0").fill("8");
    await expect(page.getByText(/fora da faixa/i).first()).toBeVisible();
    await page.getByRole("button", { name: /Ajuste do equipamento/ }).click();
    await page.getByPlaceholder(/porta ficou aberta/).fill("Termostato ajustado; medir de novo em 1h");
    await page.getByRole("button", { name: /Registrar|Salvar/ }).first().click();
    await expect(page.getByText(/fora da faixa/i).first()).toBeVisible({ timeout: 30_000 });

    const logs = await select(request, tok, `temperature_logs?select=temperature,in_range,corrective_action,alert_id&equipment_id=eq.${equipment.id}&order=measured_at.desc&limit=1`);
    expect(Number(logs[0].temperature)).toBe(8);
    expect(logs[0].in_range).toBe(false);
    expect(logs[0].alert_id).toBeTruthy();
    const alerts = await select(request, tok, `alerts?select=kind,severity,status&id=eq.${logs[0].alert_id}`);
    expect(alerts[0].kind).toBe("temperatura");
    expect(alerts[0].severity).toBe("critico");
  });

  test("checklist de abertura: tarefa crítica pede observação; concluir exige todas as tarefas", async ({ page, request }) => {
    await login(page);
    await selectStore(page);
    await gotoRetry(page, "/checklists");
    await expect(page.getByRole("heading", { name: "Checklists" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Abertura da cozinha").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: /Abertura da cozinha/ }).first().click();
    await expect(page).toHaveURL(/\/checklists\/executar\//, { timeout: 60_000 });

    // primeira tarefa é crítica: marcar abre a folha pedindo observação
    const first = page.getByRole("button", { name: /Conferir temperatura das geladeiras/ }).first();
    await first.click();
    const sheet = page.locator('[class*="sheet-up"]').last();
    await sheet.getByPlaceholder(/O que foi verificado/).fill("Geladeiras a 3 °C, freezers a -18 °C");
    await sheet.getByRole("button", { name: /Marcar como feito|Confirmar|Salvar/ }).last().click();
    await expect(page.getByText(/1 de 5|1\/5/).first()).toBeVisible({ timeout: 30_000 });

    // tenta finalizar com pendências: o banco recusa (checklist obrigatório)
    await page.getByRole("button", { name: /Finalizar/ }).first().click();
    await page.getByRole("button", { name: /Finalizar|Concluir/ }).last().click();
    await expect(page.getByText(/pendente/i).first()).toBeVisible({ timeout: 30_000 });

    const exec = await select(request, tok, `checklist_executions?select=status,done_items,total_items&store_id=eq.${store.id}&due_date=eq.${new Date().toISOString().slice(0, 10)}&order=created_at&limit=1`);
    expect(exec[0].status).toBe("em_andamento");
    expect(Number(exec[0].done_items)).toBe(1);
  });

  test("tarefa: criar com prazo vencido fica atrasada e concluir registra data", async ({ page, request }) => {
    await login(page);
    await selectStore(page);
    await gotoRetry(page, "/tarefas");
    await expect(page.getByRole("heading", { name: "Tarefas" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Nova tarefa" }).first().click();
    const drawer = page.locator('[class*="sheet-up"]').last();
    await drawer.getByPlaceholder("Ex.: Limpar a câmara fria").fill("Organizar câmara fria");
    await drawer.getByRole("button", { name: /Alta/ }).click();
    await drawer.locator('input[type="datetime-local"]').fill("2026-09-25T08:00");
    await drawer.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Organizar câmara fria").first()).toBeVisible({ timeout: 30_000 });

    const t = await select(request, tok, `tasks?select=id,status,priority&store_id=eq.${store.id}&title=eq.Organizar%20c%C3%A2mara%20fria`);
    expect(t[0].status).toBe("atrasada");
    expect(t[0].priority).toBe("alta");

    await gotoRetry(page, "/tarefas?tab=atrasadas");
    const card = page.locator("text=Organizar câmara fria").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Concluir" }).first().click();
    await expect.poll(async () => (await select(request, tok, `tasks?select=status,completed_at&id=eq.${t[0].id}`))[0].status, { timeout: 30_000 }).toBe("concluida");
  });
});
