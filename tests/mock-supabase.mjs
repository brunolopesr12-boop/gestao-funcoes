/**
 * Servidor PostgREST mínimo em memória — SÓ PARA TESTES LOCAIS.
 *
 * Permite rodar o app inteiro (npm run dev) sem um projeto Supabase real,
 * para conferir os fluxos de tela. Não faz parte do app publicado.
 *
 *   node tests/mock-supabase.mjs            (porta 54321)
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 npm run dev
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const T = new Date().toISOString();

/* ---------------------------------------------------------------- */
/* Dados iniciais (espelham supabase/schema.sql)                     */
/* ---------------------------------------------------------------- */

const VILA = "11111111-1111-4111-8111-111111111111";
const STRO = "22222222-2222-4222-8222-222222222222";
const R = (n) => `2a000000-0000-4000-8000-00000000000${n}`;
const V = (n) => `1a000000-0000-4000-8000-00000000000${n}`;
const P = (n) => `2b000000-0000-4000-8000-00000000000${n}`;

const db = {
  companies: [
    { id: VILA, name: "Vila Rica", emoji: "🏪", color: "#e11d48", notes: "", active: true, position: 0, created_at: T, updated_at: T },
    { id: STRO, name: "Sr. Strogonoff", emoji: "👨‍🍳", color: "#f59e0b", notes: "", active: true, position: 1, created_at: T, updated_at: T },
  ],
  roles: [
    { id: R(1), company_id: STRO, name: "Montador de pedidos", emoji: "📦", position: 0 },
    { id: R(2), company_id: STRO, name: "Cozinheiro", emoji: "🍳", position: 1 },
    { id: R(3), company_id: STRO, name: "Atendimento", emoji: "🙋", position: 2 },
    { id: R(4), company_id: STRO, name: "Caixa", emoji: "💵", position: 3 },
    { id: V(1), company_id: VILA, name: "Atendente", emoji: "🙋", position: 0 },
    { id: V(2), company_id: VILA, name: "Caixa", emoji: "💵", position: 1 },
    { id: V(3), company_id: VILA, name: "Produção de salgados", emoji: "🥟", position: 2 },
    { id: V(4), company_id: VILA, name: "Produção de pizza", emoji: "🍕", position: 3 },
    { id: V(5), company_id: VILA, name: "Produção de lanches", emoji: "🍔", position: 4 },
    { id: V(6), company_id: VILA, name: "Montador de pedidos", emoji: "📦", position: 5 },
  ].map((r) => ({
    description: "",
    responsibilities: "",
    active: true,
    created_at: T,
    updated_at: T,
    ...r,
  })),
  competencies: [],
  checklist_items: [],
  processes: [
    { id: P(1), role_id: R(1), name: "Fazer arroz", position: 0 },
    { id: P(2), role_id: R(1), name: "Fazer estrogonofe de frango", position: 1 },
    { id: P(3), role_id: R(1), name: "Fazer estrogonofe de carne", position: 2 },
    { id: P(4), role_id: R(1), name: "Fritar", position: 3 },
    { id: P(5), role_id: R(1), name: "Montar pedido", position: 4 },
    { id: P(6), role_id: R(1), name: "Fazer checklist", position: 5 },
    { id: P(7), role_id: R(1), name: "Conferir pedido", position: 6 },
  ].map((p) => ({
    description: "",
    required: true,
    created_at: T,
    updated_at: T,
    ...p,
  })),
  employees: [],
  employee_roles: [],
  training_steps: [],
  training_events: [],
  activity_log: [],
};

/** filhos que somem junto quando o pai é excluído */
const CASCADE = {
  companies: [
    ["roles", "company_id"],
    ["employees", "company_id"],
    ["training_events", "company_id"],
    ["activity_log", "company_id"],
  ],
  roles: [
    ["competencies", "role_id"],
    ["checklist_items", "role_id"],
    ["processes", "role_id"],
    ["employee_roles", "role_id"],
  ],
  processes: [["training_steps", "process_id"]],
  employees: [
    ["employee_roles", "employee_id"],
    ["training_steps", "employee_id"],
  ],
};

function cascadeDelete(table, row) {
  for (const [child, fk] of CASCADE[table] ?? []) {
    const doomed = db[child].filter((r) => r[fk] === row.id);
    db[child] = db[child].filter((r) => r[fk] !== row.id);
    for (const d of doomed) cascadeDelete(child, d);
  }
}

/* ---------------------------------------------------------------- */
/* HTTP                                                              */
/* ---------------------------------------------------------------- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,prefer,x-client-info,accept-profile,content-profile,range",
  "Access-Control-Expose-Headers": "content-range",
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** aplica filtros no formato coluna=eq.valor */
function applyFilters(rows, params) {
  let out = rows;
  for (const [key, value] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const [op, ...rest] = value.split(".");
    const v = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[key]) === v);
    if (op === "in") {
      const list = v.replace(/^\(|\)$/g, "").split(",");
      out = out.filter((r) => list.includes(String(r[key])));
    }
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body) => {
    res.writeHead(code, { ...CORS, "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (!match) return send(404, { message: "rota não suportada", path: url.pathname });

  const table = match[1];
  if (!db[table]) return send(404, { message: `tabela ${table} não existe` });

  const params = [...url.searchParams.entries()];

  if (req.method === "GET") {
    let rows = applyFilters(db[table], params);
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) =>
        dir === "desc"
          ? String(b[col]).localeCompare(String(a[col]))
          : String(a[col]).localeCompare(String(b[col])),
      );
    }
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    return send(200, rows);
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : [body];
    for (const row of incoming) {
      if (db[table].some((r) => r.id === row.id)) {
        return send(409, {
          message: `duplicate key value violates unique constraint on ${table}`,
          code: "23505",
        });
      }
      db[table].push({ ...row });
    }
    const wantsBody = (req.headers.prefer ?? "").includes("return=representation");
    return send(201, wantsBody ? incoming : undefined);
  }

  if (req.method === "PATCH") {
    const patch = await readBody(req);
    const targets = applyFilters(db[table], params);
    for (const row of targets) Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return send(204);
  }

  if (req.method === "DELETE") {
    const targets = applyFilters(db[table], params);
    const ids = new Set(targets.map((r) => r.id));
    db[table] = db[table].filter((r) => !ids.has(r.id));
    for (const row of targets) cascadeDelete(table, row);
    return send(204);
  }

  return send(405, { message: "método não suportado" });
});

server.listen(PORT, () => {
  console.log(`[mock-supabase] ouvindo em http://localhost:${PORT}`);
});
