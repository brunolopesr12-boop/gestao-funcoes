-- =====================================================================
-- 0019 · Guardas de permissão (endurecimento)
--
-- 1) Ninguém concede uma permissão avulsa que não possui: quem tem apenas
--    "usuarios.gerenciar" (perfil personalizado) não consegue liberar para
--    si ou para outros, por exemplo, "configuracoes.editar". Administradores
--    possuem todas as permissões e continuam livres. Negar (granted = false)
--    nunca é bloqueado.
-- 2) O perfil (nome/telefone) de um administrador só é editado por ele
--    mesmo ou por outro administrador da mesma empresa.
--
-- Policies RESTRITIVAS: somam-se às permissivas de 0001. Idempotente.
-- =====================================================================

drop policy if exists membership_permissions_grant_guard on public.membership_permissions;
create policy membership_permissions_grant_guard on public.membership_permissions
  as restrictive for insert to authenticated
  with check (
    not granted
    or (select m.company_id from public.memberships m where m.id = membership_id)
       in (select public.ops_company_ids_with_permission(permission_code))
  );

drop policy if exists membership_permissions_grant_update_guard on public.membership_permissions;
create policy membership_permissions_grant_update_guard on public.membership_permissions
  as restrictive for update to authenticated
  with check (
    not granted
    or (select m.company_id from public.memberships m where m.id = membership_id)
       in (select public.ops_company_ids_with_permission(permission_code))
  );

drop policy if exists profiles_admin_update_guard on public.profiles;
create policy profiles_admin_update_guard on public.profiles
  as restrictive for update to authenticated
  using (
    id = auth.uid()
    or not exists (
      select 1
      from public.memberships m
      join public.access_roles r on r.id = m.access_role_id
      where m.user_id = profiles.id and m.active and r.code = 'admin'
        and not public.ops_is_admin(m.company_id)
    )
  );
