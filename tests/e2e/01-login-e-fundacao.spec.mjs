import { test, expect } from "@playwright/test";

const ADMIN = { name: "Bruno Lopes", email: "bruno@vila.local", password: "senha-forte-1" };

test.describe.serial("login, primeiro acesso e navegação básica", () => {
  test("sem sessão, qualquer tela redireciona para /login", async ({ page }) => {
    await page.goto("/estoque");
    await expect(page).toHaveURL(/\/login\?next=%2Festoque/);
    await expect(page.getByRole("heading", { name: /Vila Rica/ })).toBeVisible();
  });

  test("primeiro acesso cria o administrador e entra no sistema", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Primeiro acesso.")).toBeVisible();
    await page.getByRole("button", { name: "Criar conta" }).first().click();
    await page.getByPlaceholder("Ex.: Bruno Lopes").fill(ADMIN.name);
    await page.getByPlaceholder("voce@empresa.com").fill(ADMIN.email);
    await page.locator('input[type="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: "Criar conta" }).last().click();
    // no desktop a tela inicial redireciona para o painel
    await expect(page).toHaveURL(/\/(painel)?$/, { timeout: 60_000 });
    // o administrador vê as duas empresas iniciais: o seletor de unidade lista a Matriz da Vila Rica
    const switcher = page.locator('select[aria-label="Unidade"]').first();
    await expect(switcher).toBeVisible({ timeout: 60_000 });
    await expect(switcher.locator("option", { hasText: "Vila Rica — Matriz" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Estoque", exact: true }).first()).toBeVisible();
  });

  test("sidebar mostra os módulos e o painel carrega os cartões", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("voce@empresa.com").fill(ADMIN.email);
    await page.locator('input[type="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/(painel)?$/, { timeout: 60_000 });
    await page.goto("/perfil");
    for (const label of ["Estoque", "Recebimento", "Produção", "Inventário", "Perdas", "Temperaturas", "Checklists", "Etiquetas", "Produtos", "Fichas técnicas", "Fornecedores", "Relatórios", "Auditoria", "Usuários", "Configurações"]) {
      await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
    }
    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
    await expect(page.getByText("Administrador").first()).toBeVisible();
  });

  test("sincronização e onboarding abrem", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("voce@empresa.com").fill(ADMIN.email);
    await page.locator('input[type="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/(painel)?$/, { timeout: 60_000 });
    await page.goto("/sincronizacao");
    await expect(page.getByText("Nada pendente")).toBeVisible();
    await page.goto("/inicio");
    await expect(page.getByRole("heading", { name: "Nova empresa" })).toBeVisible();
  });
});
