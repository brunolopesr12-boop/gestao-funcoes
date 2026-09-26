# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-treinamentos-e-vila-gpt.spec.mjs >> módulos existentes sob o novo login >> funções e treinamentos: lista só as empresas do usuário e abre a Vila Rica
- Location: tests/e2e/02-treinamentos-e-vila-gpt.spec.mjs:9:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 60000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - generic [ref=f1e3]:
    - generic [ref=f1e4]:
      - text: V
      - generic [ref=f1e5]:
        - heading "Vila Rica · Cozinha" [level=1] [ref=f1e6]
        - paragraph [ref=f1e7]: Estoque, produção, validade e operação
    - generic [ref=f1e8]:
      - generic [ref=f1e9]:
        - text: E-mail
        - textbox "E-mail" [active] [ref=f1e10]:
          - /placeholder: voce@empresa.com
      - generic [ref=f1e11]:
        - text: Senha
        - textbox "Senha" [ref=f1e12]
      - button "Entrar" [ref=f1e13]
    - generic [ref=f1e14]:
      - button "Esqueci a senha" [ref=f1e15]
      - button "Fui convidado" [ref=f1e16]
  - paragraph [ref=f1e17]: Acesso restrito aos funcionários autorizados.
```

# Test source

```ts
  1   | // Utilidades dos testes ponta a ponta (login pela tela e acesso REST direto ao gateway local).
  2   | import { expect } from "@playwright/test";
  3   | 
  4   | export const GATEWAY = "http://localhost:54321";
  5   | export const ADMIN = { name: "Bruno Lopes", email: "bruno@vila.local", password: "senha-forte-1" };
  6   | export const VILA = "11111111-1111-4111-8111-111111111111";
  7   | export const UNITS = { kg: "b0000000-0000-4000-8000-000000000001", g: "b0000000-0000-4000-8000-000000000002", un: "b0000000-0000-4000-8000-000000000005", cx: "b0000000-0000-4000-8000-000000000007" };
  8   | 
  9   | /** Entra pela tela de login e espera o app carregar. */
  10  | export async function login(page, user = ADMIN) {
  11  |   await page.goto("/login");
  12  |   await page.getByPlaceholder("voce@empresa.com").fill(user.email);
  13  |   await page.locator('input[type="password"]').fill(user.password);
  14  |   await page.getByRole("button", { name: "Entrar" }).click();
> 15  |   await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
      |              ^ TimeoutError: page.waitForURL: Timeout 60000ms exceeded.
  16  | }
  17  | 
  18  | /** Cria a conta do administrador (primeiro acesso) se ainda não existir. */
  19  | export async function ensureAdmin(request) {
  20  |   const r = await request.post(`${GATEWAY}/auth/v1/token?grant_type=password`, { data: { email: ADMIN.email, password: ADMIN.password } });
  21  |   if (r.ok()) return (await r.json()).access_token;
  22  |   const s = await request.post(`${GATEWAY}/auth/v1/signup`, { data: { email: ADMIN.email, password: ADMIN.password, data: { full_name: ADMIN.name } } });
  23  |   expect(s.ok()).toBeTruthy();
  24  |   const token = (await s.json()).access_token;
  25  |   await rpc(request, token, "ops_bootstrap_admin", {});
  26  |   return token;
  27  | }
  28  | 
  29  | export async function token(request, user = ADMIN) {
  30  |   const r = await request.post(`${GATEWAY}/auth/v1/token?grant_type=password`, { data: { email: user.email, password: user.password } });
  31  |   expect(r.ok(), await r.text()).toBeTruthy();
  32  |   return (await r.json()).access_token;
  33  | }
  34  | 
  35  | const headers = (tok, extra = {}) => ({ authorization: `Bearer ${tok}`, "content-type": "application/json", ...extra });
  36  | 
  37  | export async function rpc(request, tok, fn, args = {}) {
  38  |   const r = await request.post(`${GATEWAY}/rest/v1/rpc/${fn}`, { headers: headers(tok), data: args });
  39  |   const body = await r.text();
  40  |   expect(r.ok(), `${fn}: ${body}`).toBeTruthy();
  41  |   return body ? JSON.parse(body) : null;
  42  | }
  43  | 
  44  | export async function insert(request, tok, table, row) {
  45  |   const r = await request.post(`${GATEWAY}/rest/v1/${table}?select=*`, { headers: headers(tok, { prefer: "return=representation" }), data: row });
  46  |   const body = await r.text();
  47  |   expect(r.ok(), `${table}: ${body}`).toBeTruthy();
  48  |   const rows = JSON.parse(body);
  49  |   return Array.isArray(row) ? rows : rows[0];
  50  | }
  51  | 
  52  | export async function select(request, tok, path) {
  53  |   const r = await request.get(`${GATEWAY}/rest/v1/${path}`, { headers: headers(tok) });
  54  |   const body = await r.text();
  55  |   expect(r.ok(), `${path}: ${body}`).toBeTruthy();
  56  |   return JSON.parse(body);
  57  | }
  58  | 
  59  | /** Unidade principal da Vila Rica e seus locais. */
  60  | export async function vilaStore(request, tok) {
  61  |   const stores = await select(request, tok, `stores?select=id,name&company_id=eq.${VILA}&order=position`);
  62  |   const store = stores[0];
  63  |   const locations = await select(request, tok, `stock_locations?select=id,name,kind&store_id=eq.${store.id}&order=position`);
  64  |   return { store, locations };
  65  | }
  66  | 
  67  | /** Garante um produto (por código interno) na Vila Rica. */
  68  | export async function ensureProduct(request, tok, p) {
  69  |   const found = await select(request, tok, `products?select=*&company_id=eq.${VILA}&internal_code=eq.${p.internal_code}`);
  70  |   if (found[0]) return found[0];
  71  |   return insert(request, tok, "products", { company_id: VILA, product_kind: "materia_prima", stock_unit_id: UNITS.kg, ...p });
  72  | }
  73  | 
  74  | export async function ensureSupplier(request, tok, name) {
  75  |   const found = await select(request, tok, `suppliers?select=*&company_id=eq.${VILA}&name=eq.${encodeURIComponent(name)}`);
  76  |   if (found[0]) return found[0];
  77  |   return insert(request, tok, "suppliers", { company_id: VILA, name });
  78  | }
  79  | 
  80  | /** Seleciona a opção de um <select> cujo texto contém `text`. */
  81  | export async function selectByText(select, text) {
  82  |   const value = await select.evaluate((el, t) => {
  83  |     const opt = Array.from(el.options).find((o) => (o.textContent ?? "").includes(t));
  84  |     return opt ? opt.value : null;
  85  |   }, text);
  86  |   if (value === null) throw new Error(`opção com texto "${text}" não encontrada`);
  87  |   await select.selectOption(value);
  88  | }
  89  | 
  90  | /** Seleciona a unidade no seletor do topo/sidebar (quando o usuário tem mais de uma). */
  91  | export async function selectStore(page, label = "Vila Rica — Matriz") {
  92  |   const switcher = page.locator('select[aria-label="Unidade"]').first();
  93  |   if (await switcher.count()) {
  94  |     const current = await switcher.evaluate((el) => el.options[el.selectedIndex]?.textContent ?? "");
  95  |     if (!current.includes(label)) {
  96  |       await selectByText(switcher, label);
  97  |       await page.waitForTimeout(500);
  98  |     }
  99  |   }
  100 | }
  101 | 
  102 | /** Navega com nova tentativa quando o servidor de desenvolvimento ainda está compilando a rota. */
  103 | export async function gotoRetry(page, url, attempts = 4) {
  104 |   let last;
  105 |   for (let i = 0; i < attempts; i++) {
  106 |     try {
  107 |       const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  108 |       if (!res || res.status() < 500) return res;
  109 |       last = new Error(`HTTP ${res.status()} em ${url}`);
  110 |     } catch (e) {
  111 |       last = e;
  112 |     }
  113 |     await page.waitForTimeout(1500 * (i + 1));
  114 |   }
  115 |   throw last;
```