# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-login-e-fundacao.spec.mjs >> login, primeiro acesso e navegação básica >> primeiro acesso cria o administrador e entra no sistema
- Location: tests/e2e/01-login-e-fundacao.spec.mjs:12:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Primeiro acesso.')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Primeiro acesso.') with timeout 15000ms
  - waiting for getByText('Primeiro acesso.')

```

```yaml
- text: V
- heading "Vila Rica · Cozinha" [level=1]
- paragraph: Estoque, produção, validade e operação
- text: E-mail
- textbox "E-mail":
  - /placeholder: voce@empresa.com
- text: Senha
- textbox "Senha"
- button "Entrar"
- button "Esqueci a senha"
- button "Fui convidado"
- paragraph: Acesso restrito aos funcionários autorizados.
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const ADMIN = { name: "Bruno Lopes", email: "bruno@vila.local", password: "senha-forte-1" };
  4  | 
  5  | test.describe.serial("login, primeiro acesso e navegação básica", () => {
  6  |   test("sem sessão, qualquer tela redireciona para /login", async ({ page }) => {
  7  |     await page.goto("/estoque");
  8  |     await expect(page).toHaveURL(/\/login\?next=%2Festoque/);
  9  |     await expect(page.getByRole("heading", { name: /Vila Rica/ })).toBeVisible();
  10 |   });
  11 | 
  12 |   test("primeiro acesso cria o administrador e entra no sistema", async ({ page }) => {
  13 |     await page.goto("/login");
> 14 |     await expect(page.getByText("Primeiro acesso.")).toBeVisible();
     |                                                      ^ Error: expect(locator).toBeVisible() failed
  15 |     await page.getByRole("button", { name: "Criar conta" }).first().click();
  16 |     await page.getByPlaceholder("Ex.: Bruno Lopes").fill(ADMIN.name);
  17 |     await page.getByPlaceholder("voce@empresa.com").fill(ADMIN.email);
  18 |     await page.locator('input[type="password"]').fill(ADMIN.password);
  19 |     await page.getByRole("button", { name: "Criar conta" }).last().click();
  20 |     // no desktop a tela inicial redireciona para o painel
  21 |     await expect(page).toHaveURL(/\/(painel)?$/, { timeout: 60_000 });
  22 |     // o administrador vê as duas empresas iniciais: o seletor de unidade lista a Matriz da Vila Rica
  23 |     const switcher = page.locator('select[aria-label="Unidade"]').first();
  24 |     await expect(switcher).toBeVisible({ timeout: 60_000 });
  25 |     await expect(switcher.locator("option", { hasText: "Vila Rica — Matriz" })).toHaveCount(1);
  26 |     await expect(page.getByRole("link", { name: "Estoque", exact: true }).first()).toBeVisible();
  27 |   });
  28 | 
  29 |   test("sidebar mostra os módulos e o painel carrega os cartões", async ({ page }) => {
  30 |     await page.goto("/login");
  31 |     await page.getByPlaceholder("voce@empresa.com").fill(ADMIN.email);
  32 |     await page.locator('input[type="password"]').fill(ADMIN.password);
  33 |     await page.getByRole("button", { name: "Entrar" }).click();
  34 |     await page.waitForURL(/\/(painel)?$/, { timeout: 60_000 });
  35 |     await page.goto("/perfil");
  36 |     for (const label of ["Estoque", "Recebimento", "Produção", "Inventário", "Perdas", "Temperaturas", "Checklists", "Etiquetas", "Produtos", "Fichas técnicas", "Fornecedores", "Relatórios", "Auditoria", "Usuários", "Configurações"]) {
  37 |       await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
  38 |     }
  39 |     await page.goto("/perfil");
  40 |     await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
  41 |     await expect(page.getByText("Administrador").first()).toBeVisible();
  42 |   });
  43 | 
  44 |   test("sincronização e onboarding abrem", async ({ page }) => {
  45 |     await page.goto("/login");
  46 |     await page.getByPlaceholder("voce@empresa.com").fill(ADMIN.email);
  47 |     await page.locator('input[type="password"]').fill(ADMIN.password);
  48 |     await page.getByRole("button", { name: "Entrar" }).click();
  49 |     await page.waitForURL(/\/(painel)?$/, { timeout: 60_000 });
  50 |     await page.goto("/sincronizacao");
  51 |     await expect(page.getByText("Nada pendente")).toBeVisible();
  52 |     await page.goto("/inicio");
  53 |     await expect(page.getByRole("heading", { name: "Nova empresa" })).toBeVisible();
  54 |   });
  55 | });
  56 | 
```