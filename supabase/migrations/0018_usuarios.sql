-- =====================================================================
--  0012 · USUÁRIOS, PERMISSÕES E CONFIGURAÇÕES — apoio à interface
--    · v_memberships        : vínculos + dados do perfil + perfil de acesso +
--                             unidades liberadas (lista paginada com busca)
--    · ops_store_create     : cria a unidade e os 4 locais de estoque padrão
--                             em uma única transação (exige configuracoes.editar)
--    · ops_membership_guard : impede que a empresa fique sem administrador ativo
--    · policies restritivas : só administrador concede/altera/remove o perfil admin
--    · realtime             : tabelas observadas pelas telas deste módulo
--    · auditoria            : memberships, membership_stores, membership_permissions,
--                             access_roles, role_permissions, stores, stock_locations,
--                             settings, api_keys (quem mudou o que, e quando)
--  Idempotente: pode ser aplicado várias vezes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vínculos com perfil, perfil de acesso e unidades (security_invoker:
-- respeita as policies de memberships/profiles/access_roles/stores)
-- ---------------------------------------------------------------------
drop view if exists public.v_memberships;
create view public.v_memberships with (security_invoker = true) as
select m.id, m.company_id, m.user_id, m.invited_email, m.access_role_id, m.all_stores, m.active,
       m.employee_id, m.created_by, m.created_at, m.updated_at,
       coalesce(p.full_name, '')                         as full_name,
       coalesce(nullif(p.email, ''), m.invited_email)    as email,
       coalesce(p.phone, '')                             as phone,
       coalesce(p.active, true)                          as profile_active,
       r.code                                            as role_code,
       r.name                                            as role_name,
       r.system                                          as role_system,
       (select coalesce(array_agg(s.name order by s.position, s.name), '{}'::text[])
          from public.membership_stores ms join public.stores s on s.id = ms.store_id
         where ms.membership_id = m.id)                  as store_names,
       (select coalesce(array_agg(ms.store_id), '{}'::uuid[])
          from public.membership_stores ms where ms.membership_id = m.id) as store_ids,
       (select count(*) from public.membership_permissions mp where mp.membership_id = m.id)::int as overrides_count
from public.memberships m
left join public.profiles p on p.id = m.user_id
join public.access_roles r on r.id = m.access_role_id;
grant select on public.v_memberships to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Criar unidade + locais de estoque padrão (atômico)
-- ---------------------------------------------------------------------
create or replace function public.ops_store_create(
  p_company uuid, p_name text, p_code text default '', p_address text default '', p_phone text default '',
  p_timezone text default 'America/Sao_Paulo'
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_store uuid; v_pos int;
begin
  perform public.ops_require_company(p_company, 'configuracoes.editar');
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Informe o nome da unidade.';
  end if;
  select coalesce(max(position), -1) + 1 into v_pos from public.stores where company_id = p_company;
  insert into public.stores (company_id, name, code, address, phone, timezone, position)
  values (p_company, trim(p_name), coalesce(trim(p_code), ''), coalesce(trim(p_address), ''), coalesce(trim(p_phone), ''),
          coalesce(nullif(trim(p_timezone), ''), 'America/Sao_Paulo'), v_pos)
  returning id into v_store;
  perform public.ops_seed_store_locations(v_store);
  return v_store;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Guarda: a empresa nunca fica sem administrador ativo
-- ---------------------------------------------------------------------
create or replace function public.ops_membership_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_admin uuid; v_was_admin boolean; v_is_admin boolean; v_others int;
begin
  if public.ops_is_service_role() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select id into v_admin from public.access_roles where company_id is null and code = 'admin';
  v_was_admin := old.user_id is not null and old.active and old.access_role_id = v_admin;
  if tg_op = 'DELETE' then
    v_is_admin := false;
  else
    v_is_admin := new.user_id is not null and new.active and new.access_role_id = v_admin and new.company_id = old.company_id;
  end if;
  if v_was_admin and not v_is_admin then
    select count(*) into v_others from public.memberships m
     where m.company_id = old.company_id and m.id <> old.id and m.user_id is not null and m.active and m.access_role_id = v_admin;
    if v_others = 0 then
      raise exception 'A empresa precisa ter pelo menos um administrador ativo. Promova outra pessoa antes de alterar este acesso.'
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
drop trigger if exists trg_memberships_guard on public.memberships;
create trigger trg_memberships_guard before update or delete on public.memberships
  for each row execute function public.ops_membership_guard();

-- ---------------------------------------------------------------------
-- Só administradores concedem, alteram ou removem o perfil de administrador.
-- Policies RESTRITIVAS: somam-se às permissivas de 0001 (memberships_write),
-- então um gerente com usuarios.gerenciar continua cuidando dos demais
-- perfis, mas não promove ninguém (nem a si mesmo) a admin nem mexe no
-- vínculo de um admin. As funções security definer (bootstrap, criação de
-- empresa, aceite de convite) rodam como dono da tabela e não passam por RLS.
-- ---------------------------------------------------------------------
create or replace function public.ops_admin_role_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.access_roles where company_id is null and code = 'admin'
$$;

drop policy if exists memberships_admin_insert_guard on public.memberships;
create policy memberships_admin_insert_guard on public.memberships as restrictive for insert to authenticated
  with check (access_role_id <> public.ops_admin_role_id() or public.ops_is_admin(company_id));
drop policy if exists memberships_admin_update_guard on public.memberships;
create policy memberships_admin_update_guard on public.memberships as restrictive for update to authenticated
  using (access_role_id <> public.ops_admin_role_id() or public.ops_is_admin(company_id))
  with check (access_role_id <> public.ops_admin_role_id() or public.ops_is_admin(company_id));
drop policy if exists memberships_admin_delete_guard on public.memberships;
create policy memberships_admin_delete_guard on public.memberships as restrictive for delete to authenticated
  using (access_role_id <> public.ops_admin_role_id() or public.ops_is_admin(company_id));

-- ---------------------------------------------------------------------
-- Auditoria de acessos e configurações
-- ---------------------------------------------------------------------
-- memberships: rótulo = nome/e-mail da pessoa; detalhe = perfil e escopo
create or replace function public.ops_audit_membership()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record; v_action text; v_label text; v_detail text;
begin
  if tg_op = 'DELETE' then
    r := old; v_action := 'excluiu';
  elsif tg_op = 'INSERT' then
    r := new; v_action := 'criou';
  else
    if to_jsonb(new) = to_jsonb(old) then return null; end if;
    r := new; v_action := 'editou';
  end if;
  v_label := coalesce(nullif(public.ops_user_name(r.user_id), ''), nullif(r.invited_email, ''), '');
  v_detail := 'Perfil: ' || coalesce((select name from public.access_roles where id = r.access_role_id), '')
              || case when r.all_stores then ' · todas as unidades' else ' · unidades selecionadas' end
              || case when tg_op = 'UPDATE' and old.active and not new.active then ' · acesso desativado'
                      when tg_op = 'UPDATE' and not old.active and new.active then ' · acesso reativado'
                      when r.user_id is null then ' · convite pendente' else '' end;
  perform public.ops_audit(r.company_id, null, v_action, 'memberships', r.id, v_label,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end, v_detail);
  return null;
end;
$fn$;
drop trigger if exists trg_memberships_audit on public.memberships;
create trigger trg_memberships_audit after insert or update or delete on public.memberships
  for each row execute function public.ops_audit_membership();

-- membership_stores / membership_permissions: a empresa vem do vínculo
create or replace function public.ops_audit_membership_child()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record; m record; v_action text; v_detail text;
begin
  if tg_op = 'DELETE' then r := old; v_action := 'excluiu';
  elsif tg_op = 'INSERT' then r := new; v_action := 'criou';
  else r := new; v_action := 'editou';
  end if;
  select mm.company_id, mm.user_id, mm.invited_email into m from public.memberships mm where mm.id = r.membership_id;
  if m.company_id is null then return null; end if; -- vínculo já apagado (cascata)
  if tg_table_name = 'membership_stores' then
    v_detail := 'Unidade ' || coalesce((select name from public.stores where id = r.store_id), '')
                || case when tg_op = 'DELETE' then ': acesso removido' else ': acesso liberado' end;
  else
    v_detail := 'Permissão ' || r.permission_code
                || case when tg_op = 'DELETE' then ': volta ao padrão do perfil' when r.granted then ': permitida' else ': negada' end;
  end if;
  perform public.ops_audit(m.company_id, null, v_action, tg_table_name, r.membership_id,
    coalesce(nullif(public.ops_user_name(m.user_id), ''), nullif(m.invited_email, ''), ''),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end, v_detail);
  return null;
end;
$fn$;
drop trigger if exists trg_membership_stores_audit on public.membership_stores;
create trigger trg_membership_stores_audit after insert or update or delete on public.membership_stores
  for each row execute function public.ops_audit_membership_child();
drop trigger if exists trg_membership_permissions_audit on public.membership_permissions;
create trigger trg_membership_permissions_audit after insert or update or delete on public.membership_permissions
  for each row execute function public.ops_audit_membership_child();

-- role_permissions: só perfis da empresa (perfis do sistema mudam por migration)
create or replace function public.ops_audit_role_permission()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record; v_role record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select company_id, name into v_role from public.access_roles where id = r.access_role_id;
  if v_role.company_id is null then return null; end if;
  perform public.ops_audit(v_role.company_id, null, case when tg_op = 'DELETE' then 'excluiu' else 'criou' end,
    'role_permissions', r.access_role_id, v_role.name, null, null,
    'Permissão ' || r.permission_code || case when tg_op = 'DELETE' then ' removida do perfil' else ' adicionada ao perfil' end);
  return null;
end;
$fn$;
drop trigger if exists trg_role_permissions_audit on public.role_permissions;
create trigger trg_role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function public.ops_audit_role_permission();

-- settings: rótulo = chave; detalhe = valor
create or replace function public.ops_audit_setting()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if tg_op = 'DELETE' then r := old;
  elsif tg_op = 'UPDATE' then
    if new.value = old.value then return null; end if;
    r := new;
  else r := new;
  end if;
  perform public.ops_audit(r.company_id, r.store_id,
    case when tg_op = 'DELETE' then 'excluiu' when tg_op = 'INSERT' then 'criou' else 'editou' end,
    'settings', r.id, r.key,
    case when tg_op <> 'INSERT' then jsonb_build_object('value', old.value) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('value', new.value) end,
    case when tg_op = 'DELETE' then 'Configuração removida (volta ao padrão)' else 'Valor: ' || left(r.value::text, 200) end);
  return null;
end;
$fn$;
drop trigger if exists trg_settings_audit on public.settings;
create trigger trg_settings_audit after insert or update or delete on public.settings
  for each row execute function public.ops_audit_setting();

-- api_keys: nunca grava o hash da chave na auditoria
create or replace function public.ops_audit_api_key()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r record; v_action text;
begin
  if tg_op = 'DELETE' then r := old; v_action := 'excluiu';
  elsif tg_op = 'INSERT' then r := new; v_action := 'criou';
  else
    r := new; v_action := 'editou';
    if old.active and not new.active then v_action := 'revogou'; end if;
  end if;
  perform public.ops_audit(r.company_id, null, v_action, 'api_keys', r.id, r.name, null, null,
    'Chave de API · escopos: ' || array_to_string(r.scopes, ', ') || case when r.active then '' else ' · revogada' end);
  return null;
end;
$fn$;
drop trigger if exists trg_api_keys_audit on public.api_keys;
create trigger trg_api_keys_audit after insert or update or delete on public.api_keys
  for each row execute function public.ops_audit_api_key();

-- cadastros com nome: trigger genérico (antes/depois)
do $$ begin
  perform public.ops_ensure_audit('access_roles');
  perform public.ops_ensure_audit('stores');
  perform public.ops_ensure_audit('stock_locations');
end $$;

-- ---------------------------------------------------------------------
-- Realtime: tabelas que as telas de usuários/configurações observam
-- (mesmo padrão da migration 0010; ignorado se o Realtime não existir)
-- ---------------------------------------------------------------------
do $blk$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['membership_stores','membership_permissions','access_roles','role_permissions','profiles',
                             'loss_reasons','api_keys','integration_events'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
exception when others then
  raise notice 'Realtime não configurado: %', sqlerrm;
end $blk$;
