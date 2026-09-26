/**
 * PostgREST "lite" — implementação mínima em Node do subconjunto do PostgREST
 * usado pelo supabase-js neste projeto, executando SQL de verdade no
 * PostgreSQL local com RLS (papel + claims do JWT por transação).
 *
 * SÓ PARA TESTES LOCAIS. Não substitui o PostgREST/Supabase em produção.
 *
 * Suporta: select com colunas, apelidos e embeds (muitos-para-um e
 * um-para-muitos, com dica !coluna ou apelido:coluna(...)), filtros
 * (eq, neq, gt, gte, lt, lte, like, ilike, is, in, cs, not., or=(), and=()),
 * order, limit/offset, count=exact (Content-Range), insert/upsert/update/
 * delete com return=representation, rpc (POST/GET) com argumentos nomeados,
 * Accept vnd.pgrst.object+json (single).
 */
import { createHmac } from "node:crypto";

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

export async function createPostgrestLite({ pool, secret }) {
  /* ------------------------------ metadados ------------------------------ */
  const meta = { columns: new Map(), fks: [], pks: new Map(), fns: new Map() };
  async function loadMeta() {
    const c = await pool.query(
      `select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
    );
    meta.columns.clear();
    for (const r of c.rows) {
      if (!meta.columns.has(r.table_name)) meta.columns.set(r.table_name, new Map());
      meta.columns.get(r.table_name).set(r.column_name, r.udt_name);
    }
    const f = await pool.query(`
      select tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name as ref_table, ccu.column_name as ref_column
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`);
    meta.fks = f.rows.map((r) => ({ table: r.table_name, name: r.constraint_name, column: r.column_name, refTable: r.ref_table, refColumn: r.ref_column }));
    const p = await pool.query(`
      select tc.table_name, kcu.column_name from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'`);
    meta.pks.clear();
    for (const r of p.rows) {
      if (!meta.pks.has(r.table_name)) meta.pks.set(r.table_name, []);
      meta.pks.get(r.table_name).push(r.column_name);
    }
    const fn = await pool.query(`
      select p.proname, p.proretset, t.typname as rettype, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public'`);
    meta.fns.clear();
    for (const r of fn.rows) {
      const args = String(r.args || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^(?:(IN|OUT|INOUT|VARIADIC)\s+)?("?[\w]+"?)\s+(.+?)(?:\s+DEFAULT\s+.+)?$/i);
          return m ? { name: m[2].replace(/"/g, ""), type: m[3] } : null;
        })
        .filter(Boolean);
      meta.fns.set(r.proname, { retset: r.proretset, rettype: r.rettype, args });
    }
  }
  await loadMeta();

  /* ------------------------------ JWT ------------------------------------ */
  function verify(token) {
    const [h, b, s] = String(token ?? "").split(".");
    if (!h || !b || !s) return null;
    const sig = createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url");
    if (sig !== s) return null;
    try {
      const payload = JSON.parse(Buffer.from(b, "base64url").toString());
      if (payload.exp && payload.exp < Date.now() / 1000) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /* ------------------------------ util ----------------------------------- */
  const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const httpError = (status, code, message, details = null, hint = null) => Object.assign(new Error(message), { status, code, details, hint, isHttp: true });

  /** divide por vírgula respeitando parênteses e aspas */
  function splitTop(s, sep = ",") {
    const out = [];
    let depth = 0, cur = "", q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') q = !q;
      if (!q) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === sep && depth === 0) {
          out.push(cur);
          cur = "";
          continue;
        }
      }
      cur += ch;
    }
    if (cur !== "") out.push(cur);
    return out;
  }
  const unquote = (v) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

  /* ------------------------------ select --------------------------------- */
  function parseSelect(sel) {
    const items = [];
    for (const raw of splitTop(sel)) {
      const it = raw.trim();
      if (!it) continue;
      const open = it.indexOf("(");
      if (open === -1) {
        const [a, b] = it.split(":");
        items.push(b ? { kind: "col", name: b, alias: a } : { kind: "col", name: a, alias: a });
        continue;
      }
      const head = it.slice(0, open);
      const inner = it.slice(open + 1, it.lastIndexOf(")"));
      let alias = null, name = head, hint = null;
      if (head.includes(":")) [alias, name] = head.split(":");
      if (name.includes("!")) [name, hint] = name.split("!");
      items.push({ kind: "embed", name, alias: alias ?? name, hint, children: parseSelect(inner) });
    }
    return items;
  }

  function findRelationship(rel, name, hint) {
    const cols = meta.columns.get(rel);
    // dica = coluna FK do próprio registro
    if (hint && cols?.has(hint)) {
      const fk = meta.fks.find((f) => f.table === rel && f.column === hint);
      if (fk) return { kind: "m2o", table: fk.refTable, localCol: hint, refCol: fk.refColumn };
      // view: coluna termina em _id e existe tabela com o nome do embed
      if (meta.columns.has(name)) return { kind: "m2o", table: name, localCol: hint, refCol: "id" };
    }
    if (hint) {
      const byName = meta.fks.find((f) => f.name === hint);
      if (byName) {
        if (byName.table === rel) return { kind: "m2o", table: byName.refTable, localCol: byName.column, refCol: byName.refColumn };
        return { kind: "o2m", table: byName.table, localCol: byName.refColumn, refCol: byName.column };
      }
      const childFk = meta.fks.find((f) => f.table === name && f.column === hint && f.refTable === rel);
      if (childFk) return { kind: "o2m", table: name, localCol: childFk.refColumn, refCol: hint };
    }
    // nome do embed = coluna FK
    if (cols?.has(name)) {
      const fk = meta.fks.find((f) => f.table === rel && f.column === name);
      if (fk) return { kind: "m2o", table: fk.refTable, localCol: name, refCol: fk.refColumn };
    }
    const m2o = meta.fks.filter((f) => f.table === rel && f.refTable === name);
    if (m2o.length === 1) return { kind: "m2o", table: name, localCol: m2o[0].column, refCol: m2o[0].refColumn };
    if (m2o.length > 1) throw httpError(300, "PGRST201", `Could not embed because more than one relationship was found for '${rel}' and '${name}'`, m2o.map((f) => f.name).join(", "), "Use a dica !nome_da_fk ou apelido:coluna(...)");
    const o2m = meta.fks.filter((f) => f.table === name && f.refTable === rel);
    if (o2m.length === 1) return { kind: "o2m", table: name, localCol: o2m[0].refColumn, refCol: o2m[0].column };
    if (o2m.length > 1) throw httpError(300, "PGRST201", `Could not embed because more than one relationship was found for '${rel}' and '${name}'`);
    // heurística para views: coluna <singular>_id
    const guess = [name.replace(/ies$/, "y").replace(/s$/, "") + "_id", name + "_id"].find((c) => cols?.has(c));
    if (guess && meta.columns.has(name)) return { kind: "m2o", table: name, localCol: guess, refCol: "id" };
    throw httpError(400, "PGRST200", `Could not find a relationship between '${rel}' and '${name}' in the schema cache`);
  }

  let aliasSeq = 0;
  function buildColumns(rel, items, alias) {
    const cols = meta.columns.get(rel);
    if (!cols) throw httpError(404, "PGRST205", `Could not find the table 'public.${rel}' in the schema cache`);
    const parts = [];
    if (items.length === 0) items = [{ kind: "col", name: "*", alias: "*" }];
    for (const it of items) {
      if (it.kind === "col") {
        if (it.name === "*") {
          for (const c of cols.keys()) parts.push(`${alias}.${ident(c)} as ${ident(c)}`);
        } else if (it.name.includes("->")) {
          const [base, ...path] = it.name.split(/->>?/);
          const ops = it.name.match(/->>?/g);
          let expr = `${alias}.${ident(base)}`;
          path.forEach((k, i) => (expr += `${ops[i]}'${k.replace(/'/g, "''")}'`));
          parts.push(`${expr} as ${ident(it.alias)}`);
        } else {
          if (!cols.has(it.name)) throw httpError(400, "42703", `column ${rel}.${it.name} does not exist`);
          parts.push(`${alias}.${ident(it.name)} as ${ident(it.alias)}`);
        }
      } else {
        const r = findRelationship(rel, it.name, it.hint);
        const sub = `a${++aliasSeq}`;
        const inner = buildColumns(r.table, it.children, sub);
        if (r.kind === "m2o") {
          parts.push(`(select to_jsonb(s) from (select ${inner} from public.${ident(r.table)} ${sub} where ${sub}.${ident(r.refCol)} = ${alias}.${ident(r.localCol)}) s) as ${ident(it.alias)}`);
        } else {
          parts.push(`(select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (select ${inner} from public.${ident(r.table)} ${sub} where ${sub}.${ident(r.refCol)} = ${alias}.${ident(r.localCol)}) s) as ${ident(it.alias)}`);
        }
      }
    }
    return parts.join(", ");
  }

  /* ------------------------------ filtros -------------------------------- */
  function colExpr(alias, col) {
    if (col.includes("->")) {
      const [base, ...path] = col.split(/->>?/);
      const ops = col.match(/->>?/g);
      let expr = `${alias}.${ident(base)}`;
      path.forEach((k, i) => (expr += `${ops[i]}'${k.replace(/'/g, "''")}'`));
      return expr;
    }
    return `${alias}.${ident(col)}`;
  }

  function condition(alias, col, opRaw, value, params) {
    let negate = false, op = opRaw;
    if (op.startsWith("not.")) {
      negate = true;
      op = op.slice(4);
    }
    const c = colExpr(alias, col);
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    let sql;
    switch (op) {
      case "eq": sql = `${c} = ${push(unquote(value))}`; break;
      case "neq": sql = `${c} <> ${push(unquote(value))}`; break;
      case "gt": sql = `${c} > ${push(unquote(value))}`; break;
      case "gte": sql = `${c} >= ${push(unquote(value))}`; break;
      case "lt": sql = `${c} < ${push(unquote(value))}`; break;
      case "lte": sql = `${c} <= ${push(unquote(value))}`; break;
      case "like": sql = `${c}::text like ${push(unquote(value).replace(/\*/g, "%"))}`; break;
      case "ilike": sql = `${c}::text ilike ${push(unquote(value).replace(/\*/g, "%"))}`; break;
      case "is": {
        const v = value.toLowerCase();
        sql = v === "null" ? `${c} is null` : v === "true" ? `${c} is true` : v === "false" ? `${c} is false` : `${c} is ${v}`;
        break;
      }
      case "in": {
        const list = splitTop(value.replace(/^\(/, "").replace(/\)$/, "")).map((s) => unquote(s.trim()));
        if (list.length === 0) sql = "false";
        else sql = `${c} in (${list.map((v) => push(v)).join(", ")})`;
        break;
      }
      case "cs": sql = `${c} @> ${push(value)}`; break;
      case "cd": sql = `${c} <@ ${push(value)}`; break;
      case "ov": sql = `${c} && ${push(value)}`; break;
      case "fts": case "plfts": case "wfts": sql = `to_tsvector(${c}::text) @@ plainto_tsquery(${push(unquote(value))})`; break;
      default: throw httpError(400, "PGRST100", `operador desconhecido: ${opRaw}`);
    }
    return negate ? `not (${sql})` : sql;
  }

  function parseLogic(alias, body, params, joiner) {
    const inner = body.trim().replace(/^\(/, "").replace(/\)$/, "");
    const parts = splitTop(inner).map((p) => p.trim()).filter(Boolean);
    const sqls = parts.map((p) => {
      const m = p.match(/^(not\.)?(and|or)\((.*)\)$/s);
      if (m) {
        const inner2 = parseLogic(alias, `(${m[3]})`, params, m[2] === "and" ? " and " : " or ");
        return m[1] ? `not (${inner2})` : inner2;
      }
      // col.op.value  (value pode conter pontos)
      const first = p.indexOf(".");
      const col = p.slice(0, first);
      let rest = p.slice(first + 1);
      let op;
      if (rest.startsWith("not.")) {
        const r2 = rest.slice(4);
        const dot = r2.indexOf(".");
        op = "not." + r2.slice(0, dot);
        rest = r2.slice(dot + 1);
      } else {
        const dot = rest.indexOf(".");
        op = rest.slice(0, dot);
        rest = rest.slice(dot + 1);
      }
      return condition(alias, col, op, rest, params);
    });
    return sqls.length ? `(${sqls.join(joiner)})` : "true";
  }

  function whereClause(alias, searchParams, params) {
    const conds = [];
    for (const [key, value] of searchParams.entries()) {
      if (RESERVED.has(key)) continue;
      if (key === "or") { conds.push(parseLogic(alias, value, params, " or ")); continue; }
      if (key === "and") { conds.push(parseLogic(alias, value, params, " and ")); continue; }
      if (key.includes(".") && !key.includes("->")) continue; // filtros/ordem de embeds: ignorados
      const dot = value.indexOf(".");
      if (dot === -1) continue;
      let op = value.slice(0, dot), rest = value.slice(dot + 1);
      if (op === "not") {
        const d2 = rest.indexOf(".");
        op = "not." + rest.slice(0, d2);
        rest = rest.slice(d2 + 1);
      }
      conds.push(condition(alias, key, op, rest, params));
    }
    return conds.length ? conds.join(" and ") : "true";
  }

  function orderClause(alias, order) {
    if (!order) return "";
    const parts = splitTop(order).map((o) => {
      const [col, ...mods] = o.trim().split(".");
      if (col.includes(".")) return null;
      let s = `${colExpr(alias, col)} ${mods.includes("desc") ? "desc" : "asc"}`;
      if (mods.includes("nullsfirst")) s += " nulls first";
      if (mods.includes("nullslast")) s += " nulls last";
      return s;
    }).filter(Boolean);
    return parts.length ? ` order by ${parts.join(", ")}` : "";
  }

  /* ------------------------------ valores -------------------------------- */
  function pgValue(rel, col, v) {
    if (v === null || v === undefined) return null;
    const udt = meta.columns.get(rel)?.get(col) ?? "";
    if (udt.startsWith("_")) {
      if (Array.isArray(v)) return `{${v.map((x) => (x === null ? "NULL" : `"${String(x).replace(/(["\\])/g, "\\$1")}"`)).join(",")}}`;
      return v;
    }
    if (udt === "jsonb" || udt === "json") return JSON.stringify(v);
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }
  function pgArg(type, v) {
    if (v === null || v === undefined) return null;
    const t = type.toLowerCase();
    if (t.endsWith("[]")) return Array.isArray(v) ? `{${v.map((x) => (x === null ? "NULL" : `"${String(x).replace(/(["\\])/g, "\\$1")}"`)).join(",")}}` : v;
    if (t === "jsonb" || t === "json") return JSON.stringify(v);
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }

  /* ------------------------------ execução ------------------------------- */
  async function withRole(claims, fn) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const role = claims?.role === "service_role" ? "service_role" : claims?.role === "authenticated" ? "authenticated" : "anon";
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role })]);
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  function mapError(e) {
    if (e.isHttp) return { status: e.status, body: { code: e.code, message: e.message, details: e.details, hint: e.hint } };
    const code = e.code ?? "";
    const status = code === "42501" ? 403 : code === "23505" || code === "23503" ? 409 : code === "42P01" ? 404 : code === "28000" ? 401
      : code.startsWith("P0") || code.startsWith("22") || code.startsWith("23") || code.startsWith("42") ? 400 : 500;
    return { status, body: { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
  }

  async function readJson(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    if (!raw) return null;
    return JSON.parse(raw);
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD", "access-control-expose-headers": "content-range, content-type, x-total-count", ...headers });
    res.end(body ?? "");
  }

  /** handler: (req, res, pathname sem /rest/v1, URL) */
  return async function handle(req, res, path, url) {
    if (req.method === "OPTIONS") return send(res, 204, "");
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const claims = token ? verify(token) : null;
    if (token && !claims) return send(res, 401, JSON.stringify({ code: "PGRST301", message: "JWT inválido" }));
    const prefer = String(req.headers.prefer ?? "");
    const wantRepr = /return=representation/.test(prefer);
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object+json");
    const sp = url.searchParams;

    try {
      /* ---------- RPC ---------- */
      const rpcMatch = path.match(/^\/rpc\/([\w]+)$/);
      if (rpcMatch) {
        const name = rpcMatch[1];
        const fn = meta.fns.get(name);
        if (!fn) throw httpError(404, "PGRST202", `Could not find the function public.${name} in the schema cache`);
        const args = req.method === "POST" ? (await readJson(req)) ?? {} : Object.fromEntries(sp.entries());
        const params = [];
        const named = [];
        for (const [k, v] of Object.entries(args)) {
          const def = fn.args.find((a) => a.name === k);
          if (!def) throw httpError(404, "PGRST202", `Could not find the function public.${name}(${Object.keys(args).join(", ")}) in the schema cache`, null, `Argumento desconhecido: ${k}`);
          params.push(pgArg(def.type, v));
          named.push(`${ident(k)} := $${params.length}::${def.type}`);
        }
        const call = `public.${ident(name)}(${named.join(", ")})`;
        const body = await withRole(claims, async (client) => {
          if (fn.retset) {
            const r = await client.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as body from ${call} t`, params);
            return r.rows[0].body;
          }
          if (fn.rettype === "void") {
            await client.query(`select ${call}`, params);
            return "null";
          }
          const r = await client.query(`select to_jsonb(${call})::text as body`, params);
          return r.rows[0].body;
        });
        return send(res, 200, body);
      }

      /* ---------- tabelas/views ---------- */
      const m = path.match(/^\/([\w]+)$/);
      if (!m) throw httpError(404, "PGRST404", `rota desconhecida ${path}`);
      const rel = m[1];
      if (!meta.columns.has(rel)) throw httpError(404, "PGRST205", `Could not find the table 'public.${rel}' in the schema cache`);
      const alias = "a0";
      aliasSeq = 0;
      const selectItems = parseSelect(sp.get("select") ?? "*");
      const params = [];
      const where = whereClause(alias, sp, params);

      const finish = (rowsJson, count, offset) => {
        const rows = JSON.parse(rowsJson);
        if (single) {
          if (rows.length !== 1) {
            return send(res, 406, JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`, hint: null }));
          }
          return send(res, 200, JSON.stringify(rows[0]), { "content-range": `0-0/${count ?? "*"}` });
        }
        const range = rows.length ? `${offset}-${offset + rows.length - 1}` : "*";
        return send(res, req.method === "POST" ? 201 : 200, rowsJson, { "content-range": `${range}/${count ?? "*"}` });
      };

      if (req.method === "GET" || req.method === "HEAD") {
        const cols = buildColumns(rel, selectItems, alias);
        const limit = sp.get("limit") ? Number(sp.get("limit")) : null;
        const offset = sp.get("offset") ? Number(sp.get("offset")) : 0;
        const sql = `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as body from (select ${cols} from public.${ident(rel)} ${alias} where ${where}${orderClause(alias, sp.get("order"))}${limit !== null ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}) t`;
        const { body, count } = await withRole(claims, async (client) => {
          const r = await client.query(sql, params);
          let count = null;
          if (wantCount) {
            const c = await client.query(`select count(*)::int as n from public.${ident(rel)} ${alias} where ${where}`, params);
            count = c.rows[0].n;
          }
          return { body: r.rows[0].body, count };
        });
        if (req.method === "HEAD") {
          const rows = JSON.parse(body);
          const range = rows.length ? `${offset}-${offset + rows.length - 1}` : "*";
          return send(res, 200, "", { "content-range": `${range}/${count ?? "*"}` });
        }
        return finish(body, count, offset);
      }

      if (req.method === "POST") {
        const payload = await readJson(req);
        const rows = Array.isArray(payload) ? payload : [payload ?? {}];
        const colSet = [];
        for (const r of rows) for (const k of Object.keys(r)) if (!colSet.includes(k)) colSet.push(k);
        const cols = meta.columns.get(rel);
        for (const c of colSet) if (!cols.has(c)) throw httpError(400, "PGRST204", `Could not find the '${c}' column of '${rel}' in the schema cache`);
        const values = rows
          .map((r) => `(${colSet.map((c) => {
            if (!(c in r)) return "default";
            params.push(pgValue(rel, c, r[c]));
            return `$${params.length}`;
          }).join(", ")})`)
          .join(", ");
        let conflict = "";
        if (/resolution=merge-duplicates/.test(prefer)) {
          const target = (sp.get("on_conflict") ?? meta.pks.get(rel)?.join(",") ?? "id").split(",").map((c) => ident(c.trim())).join(", ");
          const updates = colSet.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
          conflict = ` on conflict (${target}) do update set ${updates}`;
        } else if (/resolution=ignore-duplicates/.test(prefer)) {
          conflict = " on conflict do nothing";
        }
        const insert = `insert into public.${ident(rel)} (${colSet.map(ident).join(", ")}) values ${values}${conflict} returning *`;
        const selCols = buildColumns(rel, selectItems, alias);
        const sql = wantRepr
          ? `with ins as (${insert}) select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as body from (select ${selCols} from ins ${alias}) t`
          : `with ins as (${insert}) select count(*)::int as n from ins`;
        const body = await withRole(claims, async (client) => (await client.query(sql, params)).rows[0]);
        if (!wantRepr) return send(res, 201, "", { "content-range": `*/*` });
        return finish(body.body, null, 0);
      }

      if (req.method === "PATCH") {
        const payload = (await readJson(req)) ?? {};
        const cols = meta.columns.get(rel);
        const sets = [];
        for (const [k, v] of Object.entries(payload)) {
          if (!cols.has(k)) throw httpError(400, "PGRST204", `Could not find the '${k}' column of '${rel}' in the schema cache`);
          params.push(pgValue(rel, k, v));
          sets.push(`${ident(k)} = $${params.length}`);
        }
        if (sets.length === 0) return send(res, 200, "[]", { "content-range": "*/*" });
        const update = `update public.${ident(rel)} as ${alias} set ${sets.join(", ")} where ${where} returning *`;
        const selCols = buildColumns(rel, selectItems, alias);
        const sql = `with upd as (${update}) select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as body from (select ${selCols} from upd ${alias}) t`;
        const body = await withRole(claims, async (client) => (await client.query(sql, params)).rows[0].body);
        if (!wantRepr) return send(res, 204, "", { "content-range": "*/*" });
        return finish(body, null, 0);
      }

      if (req.method === "DELETE") {
        const del = `delete from public.${ident(rel)} as ${alias} where ${where} returning *`;
        const selCols = buildColumns(rel, selectItems, alias);
        const sql = `with del as (${del}) select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as body from (select ${selCols} from del ${alias}) t`;
        const body = await withRole(claims, async (client) => (await client.query(sql, params)).rows[0].body);
        if (!wantRepr) return send(res, 204, "", { "content-range": "*/*" });
        return finish(body, null, 0);
      }
      throw httpError(405, "PGRST405", "método não suportado");
    } catch (e) {
      const { status, body } = mapError(e);
      if (status >= 500) console.error("[postgrest-lite]", e);
      return send(res, status, JSON.stringify(body));
    }
  };
}
