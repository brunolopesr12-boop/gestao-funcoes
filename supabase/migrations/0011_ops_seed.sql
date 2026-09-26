-- =====================================================================
--  0011 · PADRÕES POR EMPRESA (categorias, motivos de perda, etiquetas,
--         locais, checklists modelo, configurações) + dados da Vila Rica
--  Nenhum produto, ficha técnica ou saldo é inventado.
-- =====================================================================

create or replace function public.ops_seed_categories(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.categories where company_id = p_company) then return; end if;
  insert into public.categories (company_id, name, emoji, color, position) values
    (p_company, 'Carnes e frios',          '🥩', '#ef4444', 0),
    (p_company, 'Laticínios',              '🧀', '#f59e0b', 1),
    (p_company, 'Massas e farinhas',       '🌾', '#d97706', 2),
    (p_company, 'Molhos e temperos',       '🧂', '#84cc16', 3),
    (p_company, 'Hortifruti',              '🥬', '#22c55e', 4),
    (p_company, 'Bebidas',                 '🥤', '#3b82f6', 5),
    (p_company, 'Embalagens e descartáveis','📦', '#64748b', 6),
    (p_company, 'Limpeza',                 '🧴', '#06b6d4', 7),
    (p_company, 'Produção interna',        '🍳', '#a855f7', 8),
    (p_company, 'Salgados',                '🥟', '#f97316', 9),
    (p_company, 'Pizzas',                  '🍕', '#e11d48', 10),
    (p_company, 'Lanches',                 '🍔', '#eab308', 11),
    (p_company, 'Sobremesas',              '🍩', '#ec4899', 12);
end;
$fn$;

create or replace function public.ops_seed_checklists(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if exists (select 1 from public.checklists where company_id = p_company) then return; end if;

  insert into public.checklists (company_id, name, kind, frequency, scheduled_time, mandatory, position, description)
  values (p_company, 'Abertura da cozinha', 'abertura', 'diaria', '07:00', true, 0, 'Modelo inicial — ajuste as tarefas conforme a rotina da unidade.')
  returning id into v_id;
  insert into public.checklist_tasks (checklist_id, text, critical, position) values
    (v_id, 'Conferir temperatura das geladeiras e freezers', true, 0),
    (v_id, 'Verificar produtos vencidos ou vencendo hoje', true, 1),
    (v_id, 'Higienizar bancadas e utensílios', false, 2),
    (v_id, 'Conferir estoque mínimo dos itens do dia', false, 3),
    (v_id, 'Ligar e conferir equipamentos (fornos, fritadeiras, estufas)', false, 4);

  insert into public.checklists (company_id, name, kind, frequency, scheduled_time, mandatory, position, description)
  values (p_company, 'Fechamento da cozinha', 'fechamento', 'diaria', '22:00', true, 1, 'Modelo inicial — ajuste as tarefas conforme a rotina da unidade.')
  returning id into v_id;
  insert into public.checklist_tasks (checklist_id, text, critical, position) values
    (v_id, 'Etiquetar e armazenar sobras e produtos abertos', true, 0),
    (v_id, 'Registrar perdas do dia', false, 1),
    (v_id, 'Limpar chapas, fornos e fritadeiras', false, 2),
    (v_id, 'Retirar o lixo e higienizar lixeiras', false, 3),
    (v_id, 'Conferir portas de câmaras/freezers fechadas e temperatura', true, 4),
    (v_id, 'Desligar equipamentos e conferir gás', true, 5);

  insert into public.checklists (company_id, name, kind, frequency, scheduled_time, mandatory, position, description)
  values (p_company, 'Limpeza semanal', 'limpeza', 'semanal', '15:00', true, 2, 'Modelo inicial (segunda-feira).')
  returning id into v_id;
  update public.checklists set weekdays = '{1}' where id = v_id;
  insert into public.checklist_tasks (checklist_id, text, critical, requires_photo, position) values
    (v_id, 'Limpeza interna de geladeiras', true, true, 0),
    (v_id, 'Limpeza interna de freezers', true, true, 1),
    (v_id, 'Limpeza de coifas e exaustores', false, false, 2),
    (v_id, 'Organização e limpeza do estoque seco', false, false, 3),
    (v_id, 'Descarte de itens vencidos', true, false, 4);
end;
$fn$;

create or replace function public.ops_seed_settings(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.settings (company_id, store_id, key, value) values
    (p_company, null, 'estoque.metodo_custo',            '"medio"'::jsonb),
    (p_company, null, 'estoque.permitir_negativo',       'false'::jsonb),
    (p_company, null, 'estoque.permitir_consumo_vencido','false'::jsonb),
    (p_company, null, 'validade.dias_alerta',            '7'::jsonb),
    (p_company, null, 'validade.dias_critico',           '1'::jsonb),
    (p_company, null, 'etiquetas.impressora',            '{"tipo":"navegador","largura_mm":60,"altura_mm":40}'::jsonb),
    (p_company, null, 'temperaturas.intervalo_min',      '240'::jsonb),
    (p_company, null, 'alertas.email',                   'false'::jsonb),
    (p_company, null, 'inventario.nao_contado_zera',     'false'::jsonb),
    (p_company, null, 'producao.consumo_por',            '"planejado"'::jsonb)
  on conflict (company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;
end;
$fn$;

-- Função final de padrões (substitui o placeholder da migration 0001)
create or replace function public.ops_seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record;
begin
  perform public.ops_seed_categories(p_company);
  perform public.ops_seed_loss_reasons(p_company);
  perform public.ops_seed_label_templates(p_company);
  perform public.ops_seed_checklists(p_company);
  perform public.ops_seed_settings(p_company);
  for s in select id from public.stores where company_id = p_company loop
    perform public.ops_seed_store_locations(s.id);
  end loop;
end;
$fn$;

revoke execute on function public.ops_seed_categories(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_checklists(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_settings(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_company_defaults(uuid) from public, anon, authenticated;

-- Aplica os padrões a todas as empresas já cadastradas (Vila Rica e demais)
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform public.ops_seed_company_defaults(c.id);
  end loop;
end $$;

-- Vila Rica: unidade principal com nome amigável (sem apagar nada)
update public.stores set name = 'Vila Rica — Matriz'
 where company_id = '11111111-1111-4111-8111-111111111111' and name = 'Matriz' and code = 'U1';
