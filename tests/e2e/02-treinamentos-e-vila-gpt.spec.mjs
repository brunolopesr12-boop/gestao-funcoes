import { test, expect } from "@playwright/test";
import { ensureAdmin, login } from "./helpers.mjs";

test.describe.serial("módulos existentes sob o novo login", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdmin(request);
  });

  test("funções e treinamentos: lista só as empresas do usuário e abre a Vila Rica", async ({ page }) => {
    await login(page);
    await page.goto("/treinamentos");
    await expect(page.getByRole("heading", { name: "Minhas empresas" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Vila Rica" })).toBeVisible();
    await page.getByRole("link", { name: /Vila Rica/ }).first().click();
    await expect(page).toHaveURL(/\/empresa\//);
    await expect(page.getByText("Funções").first()).toBeVisible();
  });

  test("VILA GPT responde em modo busca e grava o histórico com o usuário logado", async ({ page, request }) => {
    await login(page);
    await page.goto("/vila-gpt");
    await expect(page.getByRole("heading", { name: /VILA GPT/ }).first()).toBeVisible({ timeout: 60_000 });
    // a rota do servidor exige sessão (cookie) e usa as empresas do usuário
    const res = await page.request.post("/api/vila-gpt/ask", { data: { question: "Como funciona a certificação de treinamento?", company_id: null, employee_name: "", employee_id: null, history: [] } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.found).toBeTruthy();
    expect(body.mode).toBe("busca");
    expect(body.logged).toBeTruthy();
    // sem sessão: negado
    const anon = await request.post("http://localhost:3100/api/vila-gpt/ask", { data: { question: "teste", company_id: null, employee_name: "", employee_id: null, history: [] } });
    expect(anon.status()).toBe(401);
  });
});
