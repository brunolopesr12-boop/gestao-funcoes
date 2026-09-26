-- =====================================================================
--  0001 · IDENTIDADE, UNIDADES, PERFIS DE ACESSO, PERMISSÕES, AUDITORIA
--  Sistema de gestão operacional de cozinha (Vila Rica)
--  Idempotente: pode ser aplicado várias vezes.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- Bloqueia UPDATE/DELETE em tabelas imutáveis (movimentos, auditoria...)
create or replace function public.ops_forbid_change()
returns trigger language plpgsql as $fn$
begin
  raise exception 'A tabela % é imutável: registros nunca são alterados ou apagados. Faça um novo registro de correção.', tg_table_name
    using errcode = 'P0001';
end;
$fn$;

-- Helper para (re)criar trigger de updated_at de forma idempotente
create or replace function public.ops_ensure_updated_at(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_updated_at on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()', p_table, p_table);
end;
$fn$;

create or replace function public.ops_ensure_immutable(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_immutable on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_immutable before update or delete on public.%I for each row execute function public.ops_forbid_change()', p_table, p_table);
end;
$fn$;

-- ---------------------------------------------------------------------
-- PROFILES (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key,
  email         text not null default '',
  full_name     text not null default '',
  phone         text not null default '',
  avatar_url    text not null default '',
  active        boolean not null default true,
  last_store_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'profiles_id_fkey') then
    alter table public.profiles
      add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;
select public.ops_ensure_updated_at('profiles');

-- ---------------------------------------------------------------------
-- STORES (unidades / lojas)
-- ---------------------------------------------------------------------
create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  code        text not null default '',
  address     text not null default '',
  phone       text not null default '',
  timezone    text not null default 'America/Sao_Paulo',
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stores_company_idx on public.stores(company_id);
select public.ops_ensure_updated_at('stores');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_last_store_fkey') then
    alter table public.profiles
      add constraint profiles_last_store_fkey foreign key (last_store_id) references public.stores(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES (catálogo) e PERFIS DE ACESSO
--   Obs.: a tabela `roles` já existe e significa FUNÇÃO OPERACIONAL (cargo).
--   Por isso os perfis de acesso ficam em `access_roles`.
-- ---------------------------------------------------------------------
create table if not exists public.permissions (
  code        text primary key,           -- modulo.acao
  module      text not null,
  name        text not null,
  description text not null default '',
  position    integer not null default 0
);

create table if not exists public.access_roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade, -- null = perfil padrão do sistema
  code        text not null,
  name        text not null,
  description text not null default '',
  system      boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists access_roles_system_code_uidx on public.access_roles(code) where company_id is null;
create unique index if not exists access_roles_company_code_uidx on public.access_roles(company_id, code) where company_id is not null;
select public.ops_ensure_updated_at('access_roles');

create table if not exists public.role_permissions (
  access_role_id  uuid not null references public.access_roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (access_role_id, permission_code)
);

-- ---------------------------------------------------------------------
-- MEMBERSHIPS (usuário × empresa) + unidades liberadas + ajustes finos
-- ---------------------------------------------------------------------
create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid,                                   -- null enquanto o convite não foi aceito
  invited_email   text not null default '',
  access_role_id  uuid not null references public.access_roles(id) on delete restrict,
  all_stores      boolean not null default true,
  active          boolean not null default true,
  employee_id     uuid references public.employees(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'memberships_user_fkey') then
    alter table public.memberships
      add constraint memberships_user_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;
create unique index if not exists memberships_company_user_uidx on public.memberships(company_id, user_id) where user_id is not null;
create unique index if not exists memberships_company_email_uidx on public.memberships(company_id, lower(invited_email)) where user_id is null and invited_email <> '';
create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists memberships_company_idx on public.memberships(company_id);
select public.ops_ensure_updated_at('memberships');

create table if not exists public.membership_stores (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  primary key (membership_id, store_id)
);
create index if not exists membership_stores_store_idx on public.membership_stores(store_id);

create table if not exists public.membership_permissions (
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted         boolean not null default true,
  primary key (membership_id, permission_code)
);

-- ---------------------------------------------------------------------
-- SETTINGS (empresa ou unidade) — chave/valor jsonb
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid references public.stores(id) on delete cascade,  -- null = empresa
  key         text not null,
  value       jsonb not null default 'null'::jsonb,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists settings_scope_key_uidx
  on public.settings(company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
select public.ops_ensure_updated_at('settings');

-- ---------------------------------------------------------------------
-- AUDIT LOGS (imutável)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid,
  store_id      uuid,
  user_id       uuid,
  user_name     text not null default '',
  action        text not null,             -- criou | editou | excluiu | recebeu | produziu | ...
  entity        text not null,             -- nome da tabela / entidade de negócio
  entity_id     uuid,
  entity_label  text not null default '',
  before        jsonb,
  after         jsonb,
  detail        text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);
create index if not exists audit_logs_store_created_idx on public.audit_logs(store_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity, entity_id);
create index if not exists audit_logs_user_idx on public.audit_logs(user_id, created_at desc);
select public.ops_ensure_immutable('audit_logs');

-- =====================================================================
-- FUNÇÕES DE IDENTIDADE E PERMISSÃO
--   Todas `security definer` + `search_path` fixo; leem só o necessário.
-- =====================================================================

create or replace function public.ops_uid()
returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function public.ops_user_name(p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(p.full_name, ''), nullif(p.email, ''), '') from public.profiles p where p.id = p_user), '')
$$;

-- empresas onde o usuário é membro ativo
create or replace function public.ops_member_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.company_id from public.memberships m
  where m.user_id = auth.uid() and m.active
$$;

create or replace function public.ops_is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.active and m.company_id = p_company)
$$;

create or replace function public.ops_is_admin(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.access_roles r on r.id = m.access_role_id
    where m.user_id = auth.uid() and m.active and m.company_id = p_company and r.code = 'admin'
  )
$$;

create or replace function public.ops_store_company(p_store uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.company_id from public.stores s where s.id = p_store
$$;

-- empresas onde o usuário tem determinada permissão
create or replace function public.ops_company_ids_with_permission(p_perm text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.company_id
  from public.memberships m
  join public.access_roles r on r.id = m.access_role_id
  where m.user_id = auth.uid() and m.active
    and (
      r.code = 'admin'
      or coalesce(
        (select mp.granted from public.membership_permissions mp
          where mp.membership_id = m.id and mp.permission_code = p_perm),
        exists (select 1 from public.role_permissions rp
          where rp.access_role_id = r.id and rp.permission_code = p_perm)
      )
    )
$$;

-- unidades acessíveis ao usuário (independente de permissão)
create or replace function public.ops_accessible_store_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id
  from public.memberships m
  join public.stores s on s.company_id = m.company_id
  where m.user_id = auth.uid() and m.active and s.active
    and (m.all_stores
         or exists (select 1 from public.membership_stores ms where ms.membership_id = m.id and ms.store_id = s.id))
$$;

-- unidades onde o usuário tem determinada permissão
create or replace function public.ops_store_ids_with_permission(p_perm text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id
  from public.memberships m
  join public.access_roles r on r.id = m.access_role_id
  join public.stores s on s.company_id = m.company_id
  where m.user_id = auth.uid() and m.active
    and (m.all_stores or r.code = 'admin'
         or exists (select 1 from public.membership_stores ms where ms.membership_id = m.id and ms.store_id = s.id))
    and (
      r.code = 'admin'
      or coalesce(
        (select mp.granted from public.membership_permissions mp
          where mp.membership_id = m.id and mp.permission_code = p_perm),
        exists (select 1 from public.role_permissions rp
          where rp.access_role_id = r.id and rp.permission_code = p_perm)
      )
    )
$$;

create or replace function public.ops_has_permission(p_store uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_store in (select public.ops_store_ids_with_permission(p_perm))
$$;

create or replace function public.ops_has_company_permission(p_company uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_company in (select public.ops_company_ids_with_permission(p_perm))
$$;

-- lista todas as permissões efetivas do usuário por unidade (para a UI)
create or replace function public.ops_my_permissions()
returns table (store_id uuid, company_id uuid, permission_code text)
language sql stable security definer set search_path = public as $$
  select s.id, s.company_id, p.code
  from public.memberships m
  join public.access_roles r on r.id = m.access_role_id
  join public.stores s on s.company_id = m.company_id
  cross join public.permissions p
  where m.user_id = auth.uid() and m.active
    and (m.all_stores or r.code = 'admin'
         or exists (select 1 from public.membership_stores ms where ms.membership_id = m.id and ms.store_id = s.id))
    and (
      r.code = 'admin'
      or coalesce(
        (select mp.granted from public.membership_permissions mp
          where mp.membership_id = m.id and mp.permission_code = p.code),
        exists (select 1 from public.role_permissions rp
          where rp.access_role_id = r.id and rp.permission_code = p.code)
      )
    )
$$;

-- chamadas do servidor com a chave de serviço (cron, integrações)
create or replace function public.ops_is_service_role()
returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user = 'service_role'
$$;

-- exige permissão dentro das funções de negócio
create or replace function public.ops_require(p_store uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = public as $fn$
begin
  if public.ops_is_service_role() then return; end if;
  if auth.uid() is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if not public.ops_has_permission(p_store, p_perm) then
    raise exception 'Sem permissão: % (unidade %)', p_perm, p_store using errcode = '42501';
  end if;
end;
$fn$;

create or replace function public.ops_require_company(p_company uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = public as $fn$
begin
  if public.ops_is_service_role() then return; end if;
  if auth.uid() is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if not public.ops_has_company_permission(p_company, p_perm) then
    raise exception 'Sem permissão: % (empresa %)', p_perm, p_company using errcode = '42501';
  end if;
end;
$fn$;

-- Configuração efetiva: unidade > empresa > padrão
create or replace function public.ops_setting(p_store uuid, p_key text, p_default jsonb default 'null'::jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.value from public.settings s where s.store_id = p_store and s.key = p_key),
    (select s.value from public.settings s
       where s.company_id = public.ops_store_company(p_store) and s.store_id is null and s.key = p_key),
    p_default)
$$;

create or replace function public.ops_set_setting(p_company uuid, p_store uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform public.ops_require_company(p_company, 'configuracoes.editar');
  if p_store is not null and public.ops_store_company(p_store) <> p_company then
    raise exception 'Unidade não pertence à empresa.';
  end if;
  insert into public.settings (company_id, store_id, key, value, updated_by)
  values (p_company, p_store, p_key, p_value, auth.uid())
  on conflict (company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
end;
$fn$;

-- =====================================================================
-- AUDITORIA
-- =====================================================================
create or replace function public.ops_audit(
  p_company uuid, p_store uuid, p_action text, p_entity text, p_entity_id uuid,
  p_label text default '', p_before jsonb default null, p_after jsonb default null, p_detail text default ''
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into public.audit_logs (company_id, store_id, user_id, user_name, action, entity, entity_id, entity_label, before, after, detail)
  values (p_company, p_store, auth.uid(), public.ops_user_name(), p_action, p_entity, p_entity_id, coalesce(p_label, ''), p_before, p_after, coalesce(p_detail, ''))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Trigger genérico: grava antes/depois (só as chaves que mudaram no update)
create or replace function public.ops_audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_new jsonb; v_old jsonb; v_diff_new jsonb; v_diff_old jsonb;
  v_company uuid; v_store uuid; v_label text; v_action text; v_id uuid; k text;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new); v_action := 'criou';
  elsif tg_op = 'UPDATE' then v_new := to_jsonb(new); v_old := to_jsonb(old); v_action := 'editou';
  else v_old := to_jsonb(old); v_action := 'excluiu';
  end if;

  v_id := coalesce((coalesce(v_new, v_old) ->> 'id')::uuid, null);
  v_store := nullif(coalesce(v_new, v_old) ->> 'store_id', '')::uuid;
  v_company := nullif(coalesce(v_new, v_old) ->> 'company_id', '')::uuid;
  if v_company is null and v_store is not null then
    select company_id into v_company from public.stores where id = v_store;
  end if;
  v_label := coalesce(
    coalesce(v_new, v_old) ->> 'name',
    coalesce(v_new, v_old) ->> 'title',
    coalesce(v_new, v_old) ->> 'full_name',
    coalesce(v_new, v_old) ->> 'lot_code',
    coalesce(v_new, v_old) ->> 'invoice_number',
    coalesce(v_new, v_old) ->> 'code',
    '');

  if tg_op = 'UPDATE' then
    if v_new = v_old then return new; end if;
    v_diff_new := '{}'::jsonb; v_diff_old := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k in ('updated_at') then continue; end if;
      if (v_new -> k) is distinct from (v_old -> k) then
        v_diff_new := v_diff_new || jsonb_build_object(k, v_new -> k);
        v_diff_old := v_diff_old || jsonb_build_object(k, v_old -> k);
      end if;
    end loop;
    if v_diff_new = '{}'::jsonb then return new; end if;
    -- só o status mudou? registra a ação com o nome do status
    if v_diff_new ? 'status' and (select count(*) from jsonb_object_keys(v_diff_new)) <= 3 then
      v_action := 'status:' || (v_diff_new ->> 'status');
    end if;
    perform public.ops_audit(v_company, v_store, v_action, tg_table_name, v_id, v_label, v_diff_old, v_diff_new);
    return new;
  elsif tg_op = 'INSERT' then
    perform public.ops_audit(v_company, v_store, v_action, tg_table_name, v_id, v_label, null, v_new);
    return new;
  else
    perform public.ops_audit(v_company, v_store, v_action, tg_table_name, v_id, v_label, v_old, null);
    return old;
  end if;
end;
$fn$;

create or replace function public.ops_ensure_audit(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_audit on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function public.ops_audit_trigger()', p_table, p_table);
end;
$fn$;

-- =====================================================================
-- CADASTRO DE USUÁRIO: perfil automático + vínculo de convites por e-mail
-- =====================================================================
create or replace function public.ops_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;

  -- convites pendentes para este e-mail viram vínculos reais
  update public.memberships
     set user_id = new.id, invited_email = '', updated_at = now()
   where user_id is null and new.email is not null and lower(invited_email) = lower(new.email);
  return new;
end;
$fn$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists trg_ops_on_auth_user_created on auth.users;
    create trigger trg_ops_on_auth_user_created
      after insert on auth.users for each row execute function public.ops_handle_new_user();
  end if;
end $$;

-- Primeiro acesso: quando ainda não existe nenhum membro, o primeiro usuário
-- autenticado vira administrador das empresas existentes.
create or replace function public.ops_needs_bootstrap()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.memberships where user_id is not null)
$$;

create or replace function public.ops_bootstrap_admin()
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_role uuid; c record; v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if not public.ops_needs_bootstrap() then
    return false;
  end if;
  select id into v_role from public.access_roles where company_id is null and code = 'admin';
  insert into public.profiles (id, email) values (v_uid, '') on conflict (id) do nothing;
  for c in select id from public.companies loop
    insert into public.memberships (company_id, user_id, access_role_id, all_stores, created_by)
    values (c.id, v_uid, v_role, true, v_uid)
    on conflict do nothing;
    perform public.ops_audit(c.id, null, 'bootstrap_admin', 'memberships', null, public.ops_user_name(v_uid), null, null, 'Primeiro acesso: administrador inicial');
  end loop;
  return true;
end;
$fn$;

-- Um convite existe para este e-mail? (usado na tela de login para liberar o cadastro)
create or replace function public.ops_invite_exists(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where user_id is null and lower(invited_email) = lower(trim(p_email)))
$$;

-- =====================================================================
-- CATÁLOGO DE PERMISSÕES E PERFIS PADRÃO
-- =====================================================================
insert into public.permissions (code, module, name, description, position) values
  ('painel.ver',              'painel',        'Ver painel',                    'Dashboard e indicadores', 10),
  ('produtos.ver',            'produtos',      'Ver produtos',                  '', 20),
  ('produtos.editar',         'produtos',      'Cadastrar/editar produtos',     'Produtos, categorias, unidades de medida', 21),
  ('fornecedores.ver',        'fornecedores',  'Ver fornecedores',              '', 30),
  ('fornecedores.editar',     'fornecedores',  'Cadastrar/editar fornecedores', '', 31),
  ('estoque.ver',             'estoque',       'Ver estoque',                   'Saldos, lotes, validades e movimentações', 40),
  ('estoque.movimentar',      'estoque',       'Movimentar estoque',            'Consumir, transferir, abrir/congelar lotes', 41),
  ('estoque.ajustar',         'estoque',       'Ajustar estoque',               'Ajustes manuais e estoque inicial', 42),
  ('recebimento.ver',         'recebimento',   'Ver recebimentos',              '', 50),
  ('recebimento.criar',       'recebimento',   'Registrar recebimento',         '', 51),
  ('recebimento.finalizar',   'recebimento',   'Finalizar recebimento',         'Entrada no estoque', 52),
  ('producao.ver',            'producao',      'Ver produções',                 '', 60),
  ('producao.criar',          'producao',      'Planejar produção',             '', 61),
  ('producao.finalizar',      'producao',      'Concluir produção',             'Baixa de ingredientes e entrada do produto', 62),
  ('fichas.ver',              'fichas',        'Ver fichas técnicas',           '', 70),
  ('fichas.editar',           'fichas',        'Editar fichas técnicas',        '', 71),
  ('inventario.ver',          'inventario',    'Ver inventários',               '', 80),
  ('inventario.contar',       'inventario',    'Contar estoque',                '', 81),
  ('inventario.finalizar',    'inventario',    'Finalizar inventário',          'Gera os ajustes de estoque', 82),
  ('perdas.ver',              'perdas',        'Ver perdas',                    '', 90),
  ('perdas.registrar',        'perdas',        'Registrar perda',               '', 91),
  ('compras.ver',             'compras',       'Ver compras',                   '', 100),
  ('compras.criar',           'compras',       'Criar pedido de compra',        '', 101),
  ('compras.aprovar',         'compras',       'Aprovar pedido de compra',      '', 102),
  ('temperaturas.ver',        'temperaturas',  'Ver temperaturas',              '', 110),
  ('temperaturas.registrar',  'temperaturas',  'Registrar temperatura',         '', 111),
  ('temperaturas.editar',     'temperaturas',  'Cadastrar equipamentos',        '', 112),
  ('checklists.ver',          'checklists',    'Ver checklists',                '', 120),
  ('checklists.executar',     'checklists',    'Executar checklists',           '', 121),
  ('checklists.editar',       'checklists',    'Criar/editar checklists',       '', 122),
  ('tarefas.ver',             'tarefas',       'Ver tarefas',                   '', 130),
  ('tarefas.executar',        'tarefas',       'Executar tarefas',              '', 131),
  ('tarefas.editar',          'tarefas',       'Criar/atribuir tarefas',        '', 132),
  ('etiquetas.imprimir',      'etiquetas',     'Imprimir etiquetas',            '', 140),
  ('etiquetas.editar_modelos','etiquetas',     'Editar modelos de etiqueta',    '', 141),
  ('alertas.ver',             'alertas',       'Ver alertas',                   '', 150),
  ('alertas.resolver',        'alertas',       'Resolver alertas',              '', 151),
  ('relatorios.ver',          'relatorios',    'Ver relatórios',                '', 160),
  ('relatorios.exportar',     'relatorios',    'Exportar relatórios',           'CSV, Excel e PDF', 161),
  ('auditoria.ver',           'auditoria',     'Ver auditoria',                 '', 170),
  ('usuarios.gerenciar',      'usuarios',      'Gerenciar usuários',            'Criar, convidar e definir permissões', 180),
  ('configuracoes.editar',    'configuracoes', 'Editar configurações',          'Empresa, unidades, parâmetros', 190),
  ('treinamentos.ver',        'treinamentos',  'Ver funções e treinamentos',    'Módulo de funções/funcionários', 200),
  ('treinamentos.editar',     'treinamentos',  'Editar funções e treinamentos', '', 201)
on conflict (code) do update set module = excluded.module, name = excluded.name, description = excluded.description, position = excluded.position;

insert into public.access_roles (id, company_id, code, name, description, system, position) values
  ('a0000000-0000-4000-8000-000000000001', null, 'admin',       'Administrador', 'Acesso total a todas as unidades', true, 0),
  ('a0000000-0000-4000-8000-000000000002', null, 'gerente',     'Gerente',       'Gestão completa da(s) unidade(s) liberada(s)', true, 1),
  ('a0000000-0000-4000-8000-000000000003', null, 'estoquista',  'Estoquista',    'Recebimento, estoque, inventário e compras', true, 2),
  ('a0000000-0000-4000-8000-000000000004', null, 'cozinha',     'Cozinha',       'Produção, etiquetas, validade e temperaturas', true, 3),
  ('a0000000-0000-4000-8000-000000000005', null, 'auditor',     'Auditor',       'Somente visualização e relatórios', true, 4),
  ('a0000000-0000-4000-8000-000000000006', null, 'funcionario', 'Funcionário',   'Somente tarefas autorizadas', true, 5)
on conflict (id) do nothing;

-- Permissões padrão por perfil (recarregadas a cada instalação; ajustes por
-- usuário ficam em membership_permissions e não são afetados).
do $$
declare
  r_gerente uuid := 'a0000000-0000-4000-8000-000000000002';
  r_estoq   uuid := 'a0000000-0000-4000-8000-000000000003';
  r_coz     uuid := 'a0000000-0000-4000-8000-000000000004';
  r_aud     uuid := 'a0000000-0000-4000-8000-000000000005';
  r_func    uuid := 'a0000000-0000-4000-8000-000000000006';
begin
  delete from public.role_permissions where access_role_id in (r_gerente, r_estoq, r_coz, r_aud, r_func);

  -- gerente: tudo menos nada (admin é a única exceção: gerente respeita unidades)
  insert into public.role_permissions select r_gerente, code from public.permissions;

  insert into public.role_permissions (access_role_id, permission_code)
  select r_estoq, unnest(array[
    'painel.ver','produtos.ver','fornecedores.ver','estoque.ver','estoque.movimentar','estoque.ajustar',
    'recebimento.ver','recebimento.criar','recebimento.finalizar','inventario.ver','inventario.contar','inventario.finalizar',
    'perdas.ver','perdas.registrar','compras.ver','compras.criar','temperaturas.ver','temperaturas.registrar',
    'checklists.ver','checklists.executar','tarefas.ver','tarefas.executar','etiquetas.imprimir','alertas.ver','alertas.resolver',
    'treinamentos.ver']);

  insert into public.role_permissions (access_role_id, permission_code)
  select r_coz, unnest(array[
    'painel.ver','produtos.ver','estoque.ver','estoque.movimentar','producao.ver','producao.criar','producao.finalizar',
    'fichas.ver','inventario.contar','perdas.ver','perdas.registrar','temperaturas.ver','temperaturas.registrar',
    'checklists.ver','checklists.executar','tarefas.ver','tarefas.executar','etiquetas.imprimir','alertas.ver','alertas.resolver',
    'treinamentos.ver']);

  insert into public.role_permissions (access_role_id, permission_code)
  select r_aud, unnest(array[
    'painel.ver','produtos.ver','fornecedores.ver','estoque.ver','recebimento.ver','producao.ver','fichas.ver',
    'inventario.ver','perdas.ver','compras.ver','temperaturas.ver','checklists.ver','tarefas.ver','alertas.ver',
    'relatorios.ver','relatorios.exportar','auditoria.ver','treinamentos.ver']);

  insert into public.role_permissions (access_role_id, permission_code)
  select r_func, unnest(array[
    'painel.ver','produtos.ver','estoque.ver','inventario.contar','perdas.registrar','temperaturas.ver','temperaturas.registrar',
    'checklists.ver','checklists.executar','tarefas.ver','tarefas.executar','etiquetas.imprimir','alertas.ver','treinamentos.ver']);
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY — tabelas desta migration
-- =====================================================================
alter table public.profiles               enable row level security;
alter table public.stores                 enable row level security;
alter table public.permissions            enable row level security;
alter table public.access_roles           enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.memberships            enable row level security;
alter table public.membership_stores      enable row level security;
alter table public.membership_permissions enable row level security;
alter table public.settings               enable row level security;
alter table public.audit_logs             enable row level security;

-- profiles: eu mesmo + colegas das minhas empresas
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or id in (
    select m.user_id from public.memberships m where m.company_id in (select public.ops_member_company_ids())));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (id in (select m.user_id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- stores
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

-- permissions / access_roles / role_permissions
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated using (true);

drop policy if exists access_roles_select on public.access_roles;
create policy access_roles_select on public.access_roles for select to authenticated
  using (company_id is null or company_id in (select public.ops_member_company_ids()));
drop policy if exists access_roles_write on public.access_roles;
create policy access_roles_write on public.access_roles for all to authenticated
  using (company_id is not null and company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')))
  with check (company_id is not null and company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (access_role_id in (select r.id from public.access_roles r where r.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))))
  with check (access_role_id in (select r.id from public.access_roles r where r.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));

-- memberships: vejo os da minha empresa; gerencio com usuarios.gerenciar
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or company_id in (select public.ops_member_company_ids()));
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')))
  with check (company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')));

drop policy if exists membership_stores_select on public.membership_stores;
create policy membership_stores_select on public.membership_stores for select to authenticated
  using (membership_id in (select m.id from public.memberships m where m.user_id = auth.uid() or m.company_id in (select public.ops_member_company_ids())));
drop policy if exists membership_stores_write on public.membership_stores;
create policy membership_stores_write on public.membership_stores for all to authenticated
  using (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))))
  with check (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));

drop policy if exists membership_permissions_select on public.membership_permissions;
create policy membership_permissions_select on public.membership_permissions for select to authenticated
  using (membership_id in (select m.id from public.memberships m where m.user_id = auth.uid() or m.company_id in (select public.ops_member_company_ids())));
drop policy if exists membership_permissions_write on public.membership_permissions;
create policy membership_permissions_write on public.membership_permissions for all to authenticated
  using (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))))
  with check (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));

-- settings
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

-- audit_logs: leitura com auditoria.ver; escrita só pelas funções (security definer)
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('auditoria.ver')));

-- =====================================================================
-- RLS DAS TABELAS JÁ EXISTENTES (funções / treinamentos / VILA GPT)
--   Antes: acesso total com a chave anon. Agora: só membros autenticados.
-- =====================================================================
do $blk$
declare t text;
begin
  foreach t in array array['companies','roles','competencies','checklist_items',
                           'processes','employees','employee_roles','training_steps',
                           'training_events','activity_log','kb_articles','gpt_questions','gpt_login_attempts'] loop
    execute format('drop policy if exists "acesso_total_app" on public.%I', t);
  end loop;
end $blk$;

-- companies
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (id in (select public.ops_member_company_ids()));
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated
  using (public.ops_is_admin(id));
-- insert: apenas pela função ops_create_company (abaixo)

-- roles (funções operacionais)
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.ver')));
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')));

-- tabelas ligadas por role_id
do $blk$
declare t text;
begin
  foreach t in array array['competencies','checklist_items','processes'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (role_id in (select r.id from public.roles r where r.company_id in (select public.ops_company_ids_with_permission('treinamentos.ver'))))$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (role_id in (select r.id from public.roles r where r.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))
      with check (role_id in (select r.id from public.roles r where r.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))$p$, t, t);
  end loop;
end $blk$;

-- employees
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.ver')));
drop policy if exists employees_write on public.employees;
create policy employees_write on public.employees for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')));

-- tabelas ligadas por employee_id
do $blk$
declare t text;
begin
  foreach t in array array['employee_roles','training_steps'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (employee_id in (select e.id from public.employees e where e.company_id in (select public.ops_company_ids_with_permission('treinamentos.ver'))))$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (employee_id in (select e.id from public.employees e where e.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))
      with check (employee_id in (select e.id from public.employees e where e.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))$p$, t, t);
  end loop;
end $blk$;

-- históricos do módulo de treinamentos (company_id pode ser null em exclusões de empresa)
do $blk$
declare t text;
begin
  foreach t in array array['training_events','activity_log'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (company_id is null or company_id in (select public.ops_company_ids_with_permission('treinamentos.ver')))$p$, t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format($p$create policy %I_insert on public.%I for insert to authenticated
      with check (company_id is null or company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')))$p$, t, t);
  end loop;
end $blk$;

-- VILA GPT: base de conhecimento (global = company_id null) e histórico
drop policy if exists kb_articles_select on public.kb_articles;
create policy kb_articles_select on public.kb_articles for select to authenticated
  using (company_id is null or company_id in (select public.ops_member_company_ids()));
-- escrita da base: pelo servidor (service role) ou por quem pode editar configurações
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kb_articles' and policyname='escrita_servidor') then
    drop policy if exists kb_articles_write on public.kb_articles;
    create policy kb_articles_write on public.kb_articles for all to authenticated
      using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
      with check (company_id is null or company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
  end if;
end $$;

drop policy if exists gpt_questions_select on public.gpt_questions;
create policy gpt_questions_select on public.gpt_questions for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')) or employee_id = auth.uid());
drop policy if exists gpt_questions_insert on public.gpt_questions;
create policy gpt_questions_insert on public.gpt_questions for insert to authenticated
  with check (company_id is null or company_id in (select public.ops_member_company_ids()));
drop policy if exists gpt_questions_update_own on public.gpt_questions;
create policy gpt_questions_update_own on public.gpt_questions for update to authenticated
  using (employee_id = auth.uid()) with check (employee_id = auth.uid());
-- gpt_login_attempts: só o servidor (service role) — nenhuma policy para authenticated

-- =====================================================================
-- CRIAÇÃO DE EMPRESA (onboarding) — quem cria vira admin
-- =====================================================================
create or replace function public.ops_create_company(
  p_name text, p_emoji text default '🏪', p_color text default '#e11d48',
  p_store_name text default 'Matriz', p_notes text default ''
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_store uuid; v_role uuid; v_uid uuid := auth.uid(); v_pos int;
begin
  if v_uid is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Informe o nome da empresa.';
  end if;
  select coalesce(max(position), -1) + 1 into v_pos from public.companies;
  insert into public.companies (name, emoji, color, notes, position)
  values (trim(p_name), coalesce(nullif(p_emoji, ''), '🏪'), coalesce(nullif(p_color, ''), '#e11d48'), coalesce(p_notes, ''), v_pos)
  returning id into v_company;

  select id into v_role from public.access_roles where company_id is null and code = 'admin';
  insert into public.profiles (id, email) values (v_uid, '') on conflict (id) do nothing;
  insert into public.memberships (company_id, user_id, access_role_id, all_stores, created_by)
  values (v_company, v_uid, v_role, true, v_uid);

  insert into public.stores (company_id, name, code, position)
  values (v_company, coalesce(nullif(trim(p_store_name), ''), 'Matriz'), 'U1', 0)
  returning id into v_store;

  perform public.ops_seed_company_defaults(v_company);
  perform public.ops_audit(v_company, v_store, 'criou', 'companies', v_company, trim(p_name), null, null, 'Empresa criada pelo assistente inicial');
  return v_company;
end;
$fn$;

-- placeholder: preenchido nas migrations seguintes (unidades de medida, motivos de perda...)
create or replace function public.ops_seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  return;
end;
$fn$;

-- Garante uma unidade para cada empresa já existente (sem apagar nada)
insert into public.stores (company_id, name, code, position)
select c.id, 'Matriz', 'U1', 0
from public.companies c
where not exists (select 1 from public.stores s where s.company_id = c.id);

-- =====================================================================
-- GRANTS (o Supabase já concede por padrão; explícito para segurança)
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function public.ops_needs_bootstrap() to anon, authenticated;
grant execute on function public.ops_invite_exists(text) to anon, authenticated;
-- anon não lê tabela alguma do app (login obrigatório)
revoke all on all tables in schema public from anon;

-- =====================================================================
-- ALERTAS (tabela base; regras de geração nas migrations seguintes)
-- =====================================================================
create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete cascade,
  kind         text not null check (kind in
                 ('vencido','vencendo','estoque_minimo','estoque_proximo_minimo','estoque_critico','temperatura',
                  'checklist_atrasado','producao_pendente','recebimento_problema','tarefa_atrasada','sincronizacao','outro')),
  severity     text not null default 'atencao' check (severity in ('info','atencao','critico')),
  title        text not null,
  message      text not null default '',
  entity_type  text,
  entity_id    uuid,
  dedupe_key   text,
  status       text not null default 'aberto' check (status in ('aberto','lido','resolvido')),
  read_by      uuid,
  read_at      timestamptz,
  resolved_by  uuid,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists alerts_store_status_idx on public.alerts(store_id, status, created_at desc);
create index if not exists alerts_company_status_idx on public.alerts(company_id, status, created_at desc);
create unique index if not exists alerts_dedupe_open_uidx on public.alerts(dedupe_key) where dedupe_key is not null and status <> 'resolvido';
create index if not exists alerts_entity_idx on public.alerts(entity_type, entity_id);
do $$ begin perform public.ops_ensure_updated_at('alerts'); end $$;

-- cria (ou atualiza) um alerta aberto com a mesma chave
create or replace function public.ops_alert_upsert(
  p_company uuid, p_store uuid, p_kind text, p_severity text, p_title text, p_message text,
  p_entity_type text default null, p_entity_id uuid default null, p_dedupe_key text default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if p_dedupe_key is not null then
    select id into v_id from public.alerts where dedupe_key = p_dedupe_key and status <> 'resolvido';
    if v_id is not null then
      update public.alerts set severity = p_severity, title = p_title, message = p_message, updated_at = now() where id = v_id;
      return v_id;
    end if;
  end if;
  insert into public.alerts (company_id, store_id, kind, severity, title, message, entity_type, entity_id, dedupe_key)
  values (p_company, p_store, p_kind, p_severity, p_title, coalesce(p_message, ''), p_entity_type, p_entity_id, p_dedupe_key)
  returning id into v_id;
  return v_id;
end;
$fn$;

alter table public.alerts enable row level security;
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('alertas.ver'))
      or (store_id is null and company_id in (select public.ops_company_ids_with_permission('alertas.ver'))));
drop policy if exists alerts_update on public.alerts;
create policy alerts_update on public.alerts for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('alertas.ver'))
      or (store_id is null and company_id in (select public.ops_company_ids_with_permission('alertas.ver'))))
  with check (store_id in (select public.ops_store_ids_with_permission('alertas.ver'))
      or (store_id is null and company_id in (select public.ops_company_ids_with_permission('alertas.ver'))));

-- Flag de sessão que identifica execução por função de negócio
create or replace function public.ops_internal_on() returns void language sql as $$ select set_config('ops.internal', 'on', true) $$;
create or replace function public.ops_internal_off() returns void language sql as $$ select set_config('ops.internal', 'off', true) $$;
create or replace function public.ops_is_internal() returns boolean language sql stable as $$ select coalesce(current_setting('ops.internal', true), '') = 'on' $$;

-- Trigger genérico: status só muda pelas funções de negócio; registros
-- finalizados/cancelados não são editados diretamente.
create or replace function public.ops_guard_status()
returns trigger language plpgsql as $fn$
begin
  if public.ops_is_internal() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('rascunho','planejada','aberta','pendente') then
      raise exception 'O status inicial deve ser rascunho/planejada/aberta. Use as ações do sistema para avançar.';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'O status de % só muda pelas ações do sistema (finalizar, aprovar, cancelar...).', tg_table_name;
  end if;
  if old.status in ('finalizado','concluida','cancelado','cancelada','finalizada','recebido') then
    raise exception 'Registro % já foi finalizado e não pode ser alterado. Faça um novo registro de correção.', tg_table_name;
  end if;
  return new;
end;
$fn$;

create or replace function public.ops_ensure_guard_status(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_guard_status on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_guard_status before insert or update on public.%I for each row execute function public.ops_guard_status()', p_table, p_table);
end;
$fn$;

-- funções internas: não podem ser chamadas diretamente pela API
revoke execute on function public.ops_audit(uuid, uuid, text, text, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.ops_alert_upsert(uuid, uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.ops_handle_new_user() from public, anon, authenticated;
revoke execute on function public.ops_seed_company_defaults(uuid) from public, anon, authenticated;
revoke execute on function public.ops_internal_on() from public, anon, authenticated;
revoke execute on function public.ops_internal_off() from public, anon, authenticated;
