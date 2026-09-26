import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isServiceRoleConfigured, supabaseServer, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /api/ops/users — criação de usuário com senha e redefinição de senha.
 *
 * Exige a chave de serviço do Supabase (SUPABASE_SERVICE_ROLE_KEY) no servidor,
 * porque só ela pode criar usuários no Auth. Sem a chave, o app oferece o
 * convite por e-mail (a pessoa cria a própria conta em /login → "Fui convidado").
 *
 * GET   → { serviceRole: boolean }
 * POST  → cria (ou localiza) o usuário no Auth, garante o perfil e o vínculo
 *         com a empresa. Só quem tem `usuarios.gerenciar` na empresa.
 * PATCH → redefine a senha de um usuário que é membro de uma empresa onde o
 *         chamador tem `usuarios.gerenciar`.
 */

const NO_SERVICE_ROLE = "Criação de usuário com senha desativada: configure SUPABASE_SERVICE_ROLE_KEY na Vercel (Settings → Environment Variables) e faça o Redeploy, ou use o convite por e-mail.";

const CreateBody = z.object({
  company_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres.").max(72),
  full_name: z.string().trim().min(2, "Informe o nome da pessoa.").max(120),
  phone: z.string().trim().max(40).default(""),
  access_role_id: z.string().uuid(),
  all_stores: z.boolean().default(true),
  store_ids: z.array(z.string().uuid()).max(200).default([]),
});

const PatchBody = z.object({
  user_id: z.string().uuid(),
  password: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres.").max(72),
});

type Caller = { sb: SupabaseClient; user: User };

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Dados inválidos.";
}

/** Sessão do chamador (cookie). */
async function getCaller(): Promise<Caller | null> {
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    return data.user ? { sb, user: data.user } : null;
  } catch {
    return null;
  }
}

/** O chamador pode gerenciar usuários desta empresa? (checado no banco, com a sessão dele) */
async function canManage(caller: Caller, companyId: string): Promise<boolean> {
  const { data, error } = await caller.sb.rpc("ops_has_company_permission", { p_company: companyId, p_perm: "usuarios.gerenciar" });
  return !error && data === true;
}

/** O chamador é administrador desta empresa? (só admin cria/redefine senha de outro admin) */
async function isAdminOf(caller: Caller, companyId: string): Promise<boolean> {
  const { data, error } = await caller.sb.rpc("ops_is_admin", { p_company: companyId });
  return !error && data === true;
}

/** Procura um usuário do Auth pelo e-mail (paginando a lista). */
async function findAuthUserByEmail(svc: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

export async function GET() {
  return json(200, { serviceRole: isServiceRoleConfigured() });
}

export async function POST(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return json(401, { ok: false, erro: "Você precisa estar autenticado." });

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { ok: false, erro: firstIssue(parsed.error) });
  const body = parsed.data;

  if (!(await canManage(caller, body.company_id))) {
    return json(403, { ok: false, erro: "Você não tem permissão para gerenciar usuários desta empresa." });
  }
  if (!isServiceRoleConfigured()) return json(501, { ok: false, erro: NO_SERVICE_ROLE });

  const svc = supabaseService();

  // perfil de acesso: do sistema ou da própria empresa
  const { data: role } = await svc.from("access_roles").select("id, code, company_id").eq("id", body.access_role_id).maybeSingle();
  if (!role || (role.company_id !== null && role.company_id !== body.company_id)) {
    return json(400, { ok: false, erro: "Perfil de acesso inválido para esta empresa." });
  }
  // o perfil de administrador só pode ser concedido por outro administrador (o banco também bloqueia)
  if (role.company_id === null && role.code === "admin" && !(await isAdminOf(caller, body.company_id))) {
    return json(403, { ok: false, erro: "Só um administrador pode criar outro administrador." });
  }
  // unidades: todas da empresa
  let storeIds: string[] = [];
  if (!body.all_stores) {
    const { data: stores } = await svc.from("stores").select("id").eq("company_id", body.company_id).in("id", body.store_ids.length ? body.store_ids : ["00000000-0000-0000-0000-000000000000"]);
    storeIds = (stores ?? []).map((s) => s.id as string);
    if (storeIds.length === 0) return json(400, { ok: false, erro: "Escolha pelo menos uma unidade ou marque 'todas as unidades'." });
  }

  // 1) usuário no Auth (cria; se já existir, localiza)
  let userId: string | null = null;
  let createdUser = false;
  const created = await svc.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.full_name, phone: body.phone },
  });
  if (created.error) {
    const msg = created.error.message ?? "";
    const exists = created.error.code === "email_exists" || /already|exists|registered|duplicate/i.test(msg);
    if (!exists) return json(502, { ok: false, erro: `Não foi possível criar o usuário: ${msg}` });
    try {
      const existing = await findAuthUserByEmail(svc, body.email);
      if (!existing) return json(409, { ok: false, erro: "Este e-mail já está cadastrado, mas o usuário não foi encontrado. Tente o convite por e-mail." });
      userId = existing.id;
    } catch (e) {
      return json(502, { ok: false, erro: (e as Error).message });
    }
  } else {
    userId = created.data.user.id;
    createdUser = true;
  }

  // 2) perfil
  const prof = await svc.from("profiles").upsert(
    { id: userId, email: body.email, full_name: body.full_name, phone: body.phone },
    { onConflict: "id" },
  );
  if (prof.error) return json(502, { ok: false, erro: `Usuário criado, mas o perfil não foi salvo: ${prof.error.message}` });

  // 3) vínculo com a empresa (reaproveita convite pendente ou vínculo existente)
  const [{ data: byUser }, { data: byInvite }] = await Promise.all([
    svc.from("memberships").select("id").eq("company_id", body.company_id).eq("user_id", userId).limit(1),
    svc.from("memberships").select("id").eq("company_id", body.company_id).is("user_id", null).ilike("invited_email", body.email).limit(1),
  ]);
  const existingM = byUser?.[0] ?? byInvite?.[0] ?? null;

  let membershipId: string;
  if (existingM) {
    const upd = await svc
      .from("memberships")
      .update({ user_id: userId, invited_email: "", access_role_id: body.access_role_id, all_stores: body.all_stores, active: true })
      .eq("id", existingM.id)
      .select("id")
      .single();
    if (upd.error) return json(502, { ok: false, erro: `Não foi possível atualizar o vínculo: ${upd.error.message}` });
    membershipId = upd.data.id as string;
  } else {
    const ins = await svc
      .from("memberships")
      .insert({ user_id: userId, company_id: body.company_id, access_role_id: body.access_role_id, all_stores: body.all_stores, invited_email: "", created_by: caller.user.id })
      .select("id")
      .single();
    if (ins.error) {
      if (ins.error.code === "23505") return json(409, { ok: false, erro: "Esta pessoa já tem acesso a esta empresa." });
      return json(502, { ok: false, erro: `Usuário criado, mas o vínculo não foi salvo: ${ins.error.message}` });
    }
    membershipId = ins.data.id as string;
  }

  // 4) unidades liberadas
  const del = await svc.from("membership_stores").delete().eq("membership_id", membershipId);
  if (del.error) return json(502, { ok: false, erro: del.error.message });
  if (!body.all_stores && storeIds.length > 0) {
    const ms = await svc.from("membership_stores").insert(storeIds.map((store_id) => ({ membership_id: membershipId, store_id })));
    if (ms.error) return json(502, { ok: false, erro: `Vínculo criado, mas as unidades não foram salvas: ${ms.error.message}` });
  }

  return json(200, { ok: true, user_id: userId, membership_id: membershipId, created_user: createdUser });
}

export async function PATCH(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return json(401, { ok: false, erro: "Você precisa estar autenticado." });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { ok: false, erro: firstIssue(parsed.error) });
  const { user_id, password } = parsed.data;

  // empresas onde o chamador gerencia usuários (com a sessão dele)
  const { data: companies, error: ce } = await caller.sb.rpc("ops_company_ids_with_permission", { p_perm: "usuarios.gerenciar" });
  if (ce) return json(502, { ok: false, erro: ce.message });
  const allowed = ((companies ?? []) as unknown[]).map((c) => (typeof c === "string" ? c : ((c as { ops_company_ids_with_permission?: string }).ops_company_ids_with_permission ?? ""))).filter(Boolean);
  if (allowed.length === 0) return json(403, { ok: false, erro: "Você não tem permissão para gerenciar usuários." });

  if (!isServiceRoleConfigured()) return json(501, { ok: false, erro: NO_SERVICE_ROLE });
  const svc = supabaseService();

  // vínculos da pessoa nas empresas que o chamador gerencia; se ela for admin em alguma delas,
  // só outro admin dessa empresa pode redefinir a senha (um gerente não pode assumir a conta de um admin)
  const { data: members, error: me } = await svc
    .from("memberships")
    .select("id, company_id, access_roles(code)")
    .eq("user_id", user_id)
    .in("company_id", allowed);
  if (me) return json(502, { ok: false, erro: me.message });
  const rows = (members ?? []) as { id: string; company_id: string; access_roles: { code: string } | { code: string }[] | null }[];
  if (rows.length === 0) return json(403, { ok: false, erro: "Esta pessoa não é membro de uma empresa que você gerencia." });
  for (const m of rows) {
    const code = Array.isArray(m.access_roles) ? m.access_roles[0]?.code : m.access_roles?.code;
    if (code === "admin" && !(await isAdminOf(caller, m.company_id))) {
      return json(403, { ok: false, erro: "Só um administrador pode redefinir a senha de outro administrador." });
    }
  }

  const { error } = await svc.auth.admin.updateUserById(user_id, { password });
  if (error) return json(502, { ok: false, erro: `Não foi possível redefinir a senha: ${error.message}` });
  return json(200, { ok: true });
}
