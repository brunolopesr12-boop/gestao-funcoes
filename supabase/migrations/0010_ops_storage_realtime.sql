-- =====================================================================
--  0010 · STORAGE (fotos) e REALTIME — guardado para rodar também fora do Supabase
-- =====================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets não existe (ambiente sem Supabase Storage): pulando bucket ops-fotos.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ops-fotos', 'ops-fotos', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif','image/heic'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- leitura pública (URLs com uuid); escrita só por membros na pasta da própria empresa
  execute 'drop policy if exists "ops_fotos_select" on storage.objects';
  execute $p$create policy "ops_fotos_select" on storage.objects for select to public using (bucket_id = 'ops-fotos')$p$;
  execute 'drop policy if exists "ops_fotos_insert" on storage.objects';
  execute $p$create policy "ops_fotos_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'ops-fotos' and (storage.foldername(name))[1] in (select id::text from public.companies where id in (select public.ops_member_company_ids())))$p$;
  execute 'drop policy if exists "ops_fotos_update" on storage.objects';
  execute $p$create policy "ops_fotos_update" on storage.objects for update to authenticated
    using (bucket_id = 'ops-fotos' and (storage.foldername(name))[1] in (select id::text from public.companies where id in (select public.ops_member_company_ids())))$p$;
  execute 'drop policy if exists "ops_fotos_delete" on storage.objects';
  execute $p$create policy "ops_fotos_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'ops-fotos' and (storage.foldername(name))[1] in (select id::text from public.companies where id in (select public.ops_company_ids_with_permission('configuracoes.editar'))))$p$;
exception when others then
  raise notice 'Não foi possível configurar o Storage: % (configure o bucket ops-fotos manualmente no painel)', sqlerrm;
end $$;

-- Realtime: tabelas que a interface acompanha ao vivo
do $blk$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['alerts','tasks','stock_items','stock_lots','productions','receipts','receipt_items','checklist_executions',
                           'checklist_execution_items','inventory_items','inventory_counts','temperature_logs','purchase_orders','purchase_order_items',
                           'products','categories','units','suppliers','supplier_products','stock_locations','temperature_equipment',
                           'recipes','recipe_items','checklists','checklist_tasks','memberships','losses','labels','label_templates','settings','stores',
                           'supplier_price_history','transfers','stock_movements'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when others then
  raise notice 'Realtime não configurado: %', sqlerrm;
end $blk$;

-- replica identity full para que o DELETE traga o registro antigo
do $$
declare t text;
begin
  foreach t in array array['alerts','tasks','stock_items','checklist_execution_items','inventory_items'] loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
