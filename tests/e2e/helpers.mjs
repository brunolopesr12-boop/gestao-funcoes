// Utilidades dos testes ponta a ponta (login pela tela e acesso REST direto ao gateway local).
import { expect } from "@playwright/test";

export const GATEWAY = "http://localhost:54321";
export const ADMIN = { name: "Bruno Lopes", email: "bruno@vila.local", password: "senha-forte-1" };
export const VILA = "11111111-1111-4111-8111-111111111111";
export const UNITS = { kg: "b0000000-0000-4000-8000-000000000001", g: "b0000000-0000-4000-8000-000000000002", un: "b0000000-0000-4000-8000-000000000005", cx: "b0000000-0000-4000-8000-000000000007" };

/** Entra pela tela de login e espera o app carregar. */
export async function login(page, user = ADMIN) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** Cria a conta do administrador (primeiro acesso) se ainda não existir. */
export async function ensureAdmin(request) {
  const r = await request.post(`${GATEWAY}/auth/v1/token?grant_type=password`, { data: { email: ADMIN.email, password: ADMIN.password } });
  if (r.ok()) return (await r.json()).access_token;
  const s = await request.post(`${GATEWAY}/auth/v1/signup`, { data: { email: ADMIN.email, password: ADMIN.password, data: { full_name: ADMIN.name } } });
  expect(s.ok()).toBeTruthy();
  const token = (await s.json()).access_token;
  await rpc(request, token, "ops_bootstrap_admin", {});
  return token;
}

export async function token(request, user = ADMIN) {
  const r = await request.post(`${GATEWAY}/auth/v1/token?grant_type=password`, { data: { email: user.email, password: user.password } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).access_token;
}

const headers = (tok, extra = {}) => ({ authorization: `Bearer ${tok}`, "content-type": "application/json", ...extra });

export async function rpc(request, tok, fn, args = {}) {
  const r = await request.post(`${GATEWAY}/rest/v1/rpc/${fn}`, { headers: headers(tok), data: args });
  const body = await r.text();
  expect(r.ok(), `${fn}: ${body}`).toBeTruthy();
  return body ? JSON.parse(body) : null;
}

export async function insert(request, tok, table, row) {
  const r = await request.post(`${GATEWAY}/rest/v1/${table}?select=*`, { headers: headers(tok, { prefer: "return=representation" }), data: row });
  const body = await r.text();
  expect(r.ok(), `${table}: ${body}`).toBeTruthy();
  const rows = JSON.parse(body);
  return Array.isArray(row) ? rows : rows[0];
}

export async function select(request, tok, path) {
  const r = await request.get(`${GATEWAY}/rest/v1/${path}`, { headers: headers(tok) });
  const body = await r.text();
  expect(r.ok(), `${path}: ${body}`).toBeTruthy();
  return JSON.parse(body);
}

/** Unidade principal da Vila Rica e seus locais. */
export async function vilaStore(request, tok) {
  const stores = await select(request, tok, `stores?select=id,name&company_id=eq.${VILA}&order=position`);
  const store = stores[0];
  const locations = await select(request, tok, `stock_locations?select=id,name,kind&store_id=eq.${store.id}&order=position`);
  return { store, locations };
}

/** Garante um produto (por código interno) na Vila Rica. */
export async function ensureProduct(request, tok, p) {
  const found = await select(request, tok, `products?select=*&company_id=eq.${VILA}&internal_code=eq.${p.internal_code}`);
  if (found[0]) return found[0];
  return insert(request, tok, "products", { company_id: VILA, product_kind: "materia_prima", stock_unit_id: UNITS.kg, ...p });
}

export async function ensureSupplier(request, tok, name) {
  const found = await select(request, tok, `suppliers?select=*&company_id=eq.${VILA}&name=eq.${encodeURIComponent(name)}`);
  if (found[0]) return found[0];
  return insert(request, tok, "suppliers", { company_id: VILA, name });
}

/** Seleciona a opção de um <select> cujo texto contém `text`. */
export async function selectByText(select, text) {
  const value = await select.evaluate((el, t) => {
    const opt = Array.from(el.options).find((o) => (o.textContent ?? "").includes(t));
    return opt ? opt.value : null;
  }, text);
  if (value === null) throw new Error(`opção com texto "${text}" não encontrada`);
  await select.selectOption(value);
}

/** Seleciona a unidade no seletor do topo/sidebar (quando o usuário tem mais de uma). */
export async function selectStore(page, label = "Vila Rica — Matriz") {
  const switcher = page.locator('select[aria-label="Unidade"]').first();
  if (await switcher.count()) {
    const current = await switcher.evaluate((el) => el.options[el.selectedIndex]?.textContent ?? "");
    if (!current.includes(label)) {
      await selectByText(switcher, label);
      await page.waitForTimeout(500);
    }
  }
}

/** Navega com nova tentativa quando o servidor de desenvolvimento ainda está compilando a rota. */
export async function gotoRetry(page, url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (!res || res.status() < 500) return res;
      last = new Error(`HTTP ${res.status()} em ${url}`);
    } catch (e) {
      last = e;
    }
    await page.waitForTimeout(1500 * (i + 1));
  }
  throw last;
}

/** Pré-compila rotas do dev server (evita falhas de navegação durante os testes). */
export async function warmRoutes(page, routes) {
  for (const r of routes) {
    try {
      await gotoRetry(page, r, 3);
      await page.waitForTimeout(300);
    } catch {
      /* rota inexistente ou ainda com erro: o teste correspondente vai apontar */
    }
  }
}
