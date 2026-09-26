/**
 * SUPABASE LOCAL PARA TESTES PONTA A PONTA (sem Docker)
 *
 *   PostgreSQL local (scripts/db-local.sh)  ←  postgrest-lite.mjs  ←  este gateway
 *                                                                          ├─ /rest/v1/*  → PostgREST lite (SQL real + RLS)
 *                                                                                   ├─ /auth/v1/*  → GoTrue falso (senha + JWT HS256)
 *                                                                                   ├─ /storage/v1 → 501
 *                                                                                   └─ /realtime   → 404
 *
 * Uso:  node tests/local-supabase/server.mjs        (porta 54321)
 *       NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$(node tests/local-supabase/server.mjs --anon-key) npm run dev
 *
 * Não é o Supabase real: serve só para exercitar as telas contra o banco e o RLS
 * de verdade. Nunca use em produção.
 */
import { createServer } from "node:http";
import { createHmac, randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const PORT = Number(process.env.LOCAL_SUPABASE_PORT ?? 54321);
const SECRET = process.env.LOCAL_JWT_SECRET ?? "vila-rica-local-jwt-secret-for-tests-only-0123456789";
const DB = process.env.PGDATABASE_TEST ?? "vila_test";
const PGUSER = process.env.PGUSER ?? "postgres";
const PGPASSWORD = process.env.PGPASSWORD ?? "postgres";
const PGHOST = process.env.PGHOST ?? "localhost";
const PGPORT = process.env.PGPORT ?? "5432";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ------------------------------ JWT ------------------------------ */
const b64 = (s) => Buffer.from(s).toString("base64url");
function sign(payload) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [h, b, s] = String(token ?? "").split(".");
  if (!h || !b || !s) return null;
  const sig = createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  if (sig !== s) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
const ANON_KEY = sign({ role: "anon", iss: "local", iat: 1700000000, exp: 2000000000 });
const SERVICE_KEY = sign({ role: "service_role", iss: "local", iat: 1700000000, exp: 2000000000 });

if (process.argv.includes("--anon-key")) {
  process.stdout.write(ANON_KEY);
  process.exit(0);
}
if (process.argv.includes("--service-key")) {
  process.stdout.write(SERVICE_KEY);
  process.exit(0);
}

/* ------------------------------ banco ----------------------------- */
const db = new pg.Client({ host: PGHOST, port: Number(PGPORT), user: PGUSER, password: PGPASSWORD, database: DB });
await db.connect();
// GoTrue falso guarda as senhas (hash) numa tabela própria do shim
await db.query(`create table if not exists auth.local_passwords (user_id uuid primary key, hash text not null)`);
await db.query(`alter role ${PGUSER} set pgrst.db_schemas = 'public'`).catch(() => undefined);

const hashPw = (p) => createHash("sha256").update(`${SECRET}:${p}`).digest("hex");

async function userRow(id) {
  const { rows } = await db.query("select id, email, raw_user_meta_data, created_at from auth.users where id = $1", [id]);
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at,
    phone: "", confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.raw_user_meta_data ?? {}, identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
  };
}
function session(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = sign({ sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, iss: "local", exp, iat: exp - 3600, session_id: randomUUID() });
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `r_${user.id}`, user };
}

/* ------------------------------ PostgREST lite -------------------- */
import { createPostgrestLite } from "./postgrest-lite.mjs";
const pool = new pg.Pool({ host: PGHOST, port: Number(PGPORT), user: PGUSER, password: PGPASSWORD, database: DB, max: 8 });
const postgrest = await createPostgrestLite({ pool, secret: SECRET });

/* ------------------------------ gateway --------------------------- */
function json(res, status, body, headers = {}) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD", "access-control-expose-headers": "content-range, content-type, x-total-count", ...headers });
  res.end(s);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function bearer(req) {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function gotrue(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (path === "/health") return json(res, 200, { name: "gotrue-local" });
  if (path === "/settings") return json(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });

  if (path === "/token" && req.method === "POST") {
    const body = await readBody(req);
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const { rows } = await db.query("select id from auth.users where lower(email) = lower($1)", [body.email ?? ""]);
      const id = rows[0]?.id;
      if (!id) return json(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: 400, msg: "Invalid login credentials" });
      const { rows: pw } = await db.query("select hash from auth.local_passwords where user_id = $1", [id]);
      if (!pw[0] || pw[0].hash !== hashPw(body.password ?? "")) {
        return json(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: 400, msg: "Invalid login credentials" });
      }
      return json(res, 200, session(await userRow(id)));
    }
    if (grant === "refresh_token") {
      const id = String(body.refresh_token ?? "").replace(/^r_/, "");
      const u = await userRow(id);
      if (!u) return json(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      return json(res, 200, session(u));
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  if (path === "/signup" && req.method === "POST") {
    const body = await readBody(req);
    const email = String(body.email ?? "").toLowerCase();
    if (!email || !body.password) return json(res, 422, { code: 422, msg: "Informe e-mail e senha" });
    const { rows } = await db.query("select id from auth.users where lower(email) = $1", [email]);
    if (rows[0]) return json(res, 422, { code: 422, msg: "User already registered" });
    const id = randomUUID();
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, body.data ?? {}]);
    await db.query("insert into auth.local_passwords (user_id, hash) values ($1, $2)", [id, hashPw(body.password)]);
    return json(res, 200, session(await userRow(id)));
  }
  if (path === "/user") {
    const payload = verify(bearer(req));
    if (!payload?.sub) return json(res, 401, { code: 401, msg: "invalid JWT" });
    if (req.method === "GET") return json(res, 200, await userRow(payload.sub));
    if (req.method === "PUT") {
      const body = await readBody(req);
      if (body.password) await db.query("insert into auth.local_passwords (user_id, hash) values ($1, $2) on conflict (user_id) do update set hash = excluded.hash", [payload.sub, hashPw(body.password)]);
      if (body.data) await db.query("update auth.users set raw_user_meta_data = raw_user_meta_data || $2 where id = $1", [payload.sub, body.data]);
      return json(res, 200, await userRow(payload.sub));
    }
  }
  if (path === "/logout") return json(res, 204, {});
  if (path === "/recover") return json(res, 200, {});
  // admin (chave de serviço): criar usuário
  if (path === "/admin/users" && req.method === "POST") {
    const payload = verify(bearer(req));
    if (payload?.role !== "service_role") return json(res, 401, { msg: "service role required" });
    const body = await readBody(req);
    const email = String(body.email ?? "").toLowerCase();
    const { rows } = await db.query("select id from auth.users where lower(email) = $1", [email]);
    if (rows[0]) return json(res, 422, { code: 422, msg: "A user with this email address has already been registered" });
    const id = randomUUID();
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, body.user_metadata ?? {}]);
    await db.query("insert into auth.local_passwords (user_id, hash) values ($1, $2)", [id, hashPw(body.password ?? randomUUID())]);
    return json(res, 200, await userRow(id));
  }
  if (path === "/admin/users" && req.method === "GET") {
    const payload = verify(bearer(req));
    if (payload?.role !== "service_role") return json(res, 401, { msg: "service role required" });
    const { rows } = await db.query("select id from auth.users order by created_at limit 1000");
    return json(res, 200, { users: await Promise.all(rows.map((r) => userRow(r.id))), aud: "authenticated" });
  }
  const m = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && req.method === "PUT") {
    const payload = verify(bearer(req));
    if (payload?.role !== "service_role") return json(res, 401, { msg: "service role required" });
    const body = await readBody(req);
    if (body.password) await db.query("insert into auth.local_passwords (user_id, hash) values ($1, $2) on conflict (user_id) do update set hash = excluded.hash", [m[1], hashPw(body.password)]);
    return json(res, 200, await userRow(m[1]));
  }
  return json(res, 404, { msg: `gotrue-local: rota não implementada ${req.method} ${path}` });
}

function proxyRest(req, res, url) {
  return postgrest(req, res, url.pathname.replace(/^\/rest\/v1/, ""), url);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (url.pathname.startsWith("/auth/v1")) return await gotrue(req, res, url);
    if (url.pathname.startsWith("/rest/v1")) return await proxyRest(req, res, url);
    if (url.pathname.startsWith("/storage/v1")) return json(res, 501, { message: "Storage não disponível no ambiente local de testes." });
    if (url.pathname.startsWith("/realtime")) return json(res, 404, {});
    return json(res, 404, { message: "local-supabase" });
  } catch (e) {
    json(res, 500, { message: e instanceof Error ? e.message : String(e) });
  }
});
server.listen(PORT, () => {
  console.log(`[local-supabase] http://localhost:${PORT}  (banco ${DB})`);
  console.log(`[local-supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}`);
});
