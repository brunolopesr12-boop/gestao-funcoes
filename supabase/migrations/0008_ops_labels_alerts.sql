-- =====================================================================
--  0008 · ETIQUETAS, ALERTAS (regras), INTEGRAÇÕES (outbox)
-- =====================================================================

-- ---------------------------------------------------------------------
-- MODELOS DE ETIQUETA
--   layout jsonb: { fields: [{key, x, y, w, h, font, bold, align, label}], qr: {x,y,size}, barcode: {...}, logo: {...} }
-- ---------------------------------------------------------------------
create table if not exists public.label_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  kind        text not null default 'producao'
                check (kind in ('producao','abertura','congelamento','descongelamento','fracionamento','armazenamento','recebimento','generica')),
  width_mm    numeric(6,1) not null default 60,
  height_mm   numeric(6,1) not null default 40,
  layout      jsonb not null default '{}'::jsonb,
  is_default  boolean not null default false,
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists label_templates_company_idx on public.label_templates(company_id);
do $$ begin perform public.ops_ensure_updated_at('label_templates'); perform public.ops_ensure_audit('label_templates'); end $$;

-- etiquetas emitidas (histórico imutável)
create table if not exists public.labels (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  template_id   uuid references public.label_templates(id) on delete set null,
  product_id    uuid references public.products(id) on delete set null,
  lot_id        uuid references public.stock_lots(id) on delete set null,
  kind          text not null default 'producao',
  copies        integer not null default 1,
  payload       jsonb not null default '{}'::jsonb,
  printed_by    uuid, printed_by_name text not null default '',
  printed_at    timestamptz not null default now()
);
create index if not exists labels_store_idx on public.labels(store_id, printed_at desc);
create index if not exists labels_lot_idx on public.labels(lot_id);
do $$ begin perform public.ops_ensure_immutable('labels'); end $$;

create or replace function public.ops_label_before_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.company_id := coalesce(new.company_id, public.ops_store_company(new.store_id));
  new.printed_by := coalesce(new.printed_by, auth.uid());
  new.printed_by_name := coalesce(nullif(new.printed_by_name, ''), public.ops_user_name());
  return new;
end;
$fn$;
drop trigger if exists trg_labels_before_insert on public.labels;
create trigger trg_labels_before_insert before insert on public.labels for each row execute function public.ops_label_before_insert();

-- Modelos padrão por empresa
create or replace function public.ops_seed_label_templates(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_layout jsonb;
begin
  if exists (select 1 from public.label_templates where company_id = p_company) then return; end if;
  v_layout := jsonb_build_object(
    'fields', jsonb_build_array(
      jsonb_build_object('key','company_name','x',2,'y',1.5,'w',36,'h',4,'font',7,'bold',true),
      jsonb_build_object('key','product_name','x',2,'y',6,'w',40,'h',9,'font',11,'bold',true),
      jsonb_build_object('key','produced_at','label','Produção','x',2,'y',16,'w',20,'h',4,'font',7),
      jsonb_build_object('key','expires_at','label','Validade','x',22,'y',16,'w',20,'h',4,'font',7,'bold',true),
      jsonb_build_object('key','lot_code','label','Lote','x',2,'y',21,'w',20,'h',4,'font',7),
      jsonb_build_object('key','quantity','label','Qtd','x',22,'y',21,'w',20,'h',4,'font',7),
      jsonb_build_object('key','responsible','label','Resp.','x',2,'y',26,'w',40,'h',4,'font',7),
      jsonb_build_object('key','location','label','Local','x',2,'y',31,'w',40,'h',4,'font',7)
    ),
    'qr', jsonb_build_object('x',43,'y',20,'size',16),
    'barcode', jsonb_build_object('enabled', false, 'x', 2, 'y', 35, 'w', 40, 'h', 4),
    'logo', jsonb_build_object('enabled', true, 'x', 43, 'y', 2, 'w', 15, 'h', 15));
  insert into public.label_templates (company_id, name, kind, width_mm, height_mm, layout, is_default, position) values
    (p_company, 'Produção 60×40',        'producao',        60, 40, v_layout, true, 0),
    (p_company, 'Abertura 60×40',        'abertura',        60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','opened_at','label','Abertura','x',2,'y',16,'w',20,'h',4,'font',7)), true, 1),
    (p_company, 'Congelamento 60×40',    'congelamento',    60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','frozen_at','label','Congelado','x',2,'y',16,'w',20,'h',4,'font',7)), true, 2),
    (p_company, 'Descongelamento 60×40', 'descongelamento', 60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','thawed_at','label','Descongel.','x',2,'y',16,'w',20,'h',4,'font',7)), true, 3),
    (p_company, 'Fracionamento 60×40',   'fracionamento',   60, 40, v_layout, true, 4),
    (p_company, 'Armazenamento 60×40',   'armazenamento',   60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','received_at','label','Recebido','x',2,'y',16,'w',20,'h',4,'font',7)), true, 5),
    (p_company, 'Recebimento 60×40',     'recebimento',     60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','received_at','label','Recebido','x',2,'y',16,'w',20,'h',4,'font',7)), true, 6),
    (p_company, 'Pequena 50×30',         'generica',        50, 30, jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','product_name','x',1.5,'y',1.5,'w',32,'h',8,'font',9,'bold',true),
        jsonb_build_object('key','expires_at','label','Val.','x',1.5,'y',11,'w',32,'h',4,'font',7,'bold',true),
        jsonb_build_object('key','lot_code','label','Lote','x',1.5,'y',16,'w',32,'h',4,'font',6),
        jsonb_build_object('key','responsible','label','Resp.','x',1.5,'y',21,'w',32,'h',4,'font',6)),
      'qr', jsonb_build_object('x',35,'y',8,'size',13), 'barcode', jsonb_build_object('enabled', false), 'logo', jsonb_build_object('enabled', false)), true, 7);
end;
$fn$;

-- ---------------------------------------------------------------------
-- ALERTAS: leitura/resolução e varredura
-- ---------------------------------------------------------------------
create or replace function public.ops_alert_mark(p_alert uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_a record;
begin
  select * into v_a from public.alerts where id = p_alert;
  if v_a.id is null then raise exception 'Alerta não encontrado.'; end if;
  if p_status = 'resolvido' then
    if v_a.store_id is not null then perform public.ops_require(v_a.store_id, 'alertas.resolver');
    else perform public.ops_require_company(v_a.company_id, 'alertas.resolver'); end if;
    update public.alerts set status = 'resolvido', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  elsif p_status = 'lido' then
    if v_a.store_id is not null then perform public.ops_require(v_a.store_id, 'alertas.ver');
    else perform public.ops_require_company(v_a.company_id, 'alertas.ver'); end if;
    update public.alerts set status = 'lido', read_by = auth.uid(), read_at = now() where id = p_alert and status = 'aberto';
  else
    raise exception 'Status inválido.';
  end if;
end;
$fn$;

create or replace function public.ops_alerts_mark_all_read(p_store uuid)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  perform public.ops_require(p_store, 'alertas.ver');
  update public.alerts set status = 'lido', read_by = auth.uid(), read_at = now() where store_id = p_store and status = 'aberto';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- Varredura: validade, estoque mínimo, checklists atrasados, produção pendente, tarefas atrasadas.
-- Chamada ao abrir o painel (cliente) e pelo cron diário (servidor).
create or replace function public.ops_refresh_alerts(p_store uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; r record; v_days_warn int; v_n int := 0; v_key text; v_level text; v_sev text; v_unit text;
begin
  if not public.ops_has_permission(p_store, 'alertas.ver') and current_user not in ('postgres') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  v_company := public.ops_store_company(p_store);
  v_days_warn := coalesce((public.ops_setting(p_store, 'validade.dias_alerta', '7'::jsonb))::text::int, 7);

  -- 1) lotes vencidos / vencendo
  for r in
    select l.id, l.lot_code, l.expires_at, p.name, u.code as unit, sum(si.quantity) as qty
    from public.stock_lots l join public.products p on p.id = l.product_id join public.units u on u.id = p.stock_unit_id
    join public.stock_items si on si.lot_id = l.id
    where l.store_id = p_store and l.status in ('ativo','vencido') and l.expires_at is not null and l.expires_at <= current_date + v_days_warn
    group by l.id, l.lot_code, l.expires_at, p.name, u.code having sum(si.quantity) > 0
  loop
    if r.expires_at < current_date then
      perform public.ops_refresh_lot_status(r.id);
      perform public.ops_alert_upsert(v_company, p_store, 'vencido', 'critico', 'Vencido: ' || r.name,
        format('Lote %s venceu em %s — %s %s em estoque. Registre a perda ou bloqueie o lote.', r.lot_code, to_char(r.expires_at, 'DD/MM/YYYY'), r.qty, r.unit),
        'stock_lot', r.id, 'vencido:' || r.id);
    else
      v_sev := case when r.expires_at <= current_date + 1 then 'critico' when r.expires_at <= current_date + 3 then 'atencao' else 'info' end;
      perform public.ops_alert_upsert(v_company, p_store, 'vencendo', v_sev, 'Vencendo: ' || r.name,
        format('Lote %s vence em %s (%s dia(s)) — %s %s em estoque. Use primeiro (FEFO).', r.lot_code, to_char(r.expires_at, 'DD/MM/YYYY'), r.expires_at - current_date, r.qty, r.unit),
        'stock_lot', r.id, 'vencendo:' || r.id);
    end if;
    v_n := v_n + 1;
  end loop;
  -- resolve alertas de validade de lotes que não têm mais saldo
  update public.alerts a set status = 'resolvido', resolved_at = now()
  where a.store_id = p_store and a.kind in ('vencido','vencendo') and a.status <> 'resolvido'
    and public.ops_lot_balance(a.entity_id) <= 0;

  -- 2) estoque mínimo
  for r in
    select p.id, p.name, u.code as unit,
           coalesce(pss.min_stock, p.min_stock) as min_stock, coalesce(pss.reorder_point, p.reorder_point) as reorder_point,
           coalesce((select sum(si.quantity) from public.stock_items si join public.stock_lots l on l.id = si.lot_id
                     where si.store_id = p_store and si.product_id = p.id and l.status <> 'bloqueado'
                       and (l.expires_at is null or l.expires_at >= current_date)), 0) as qty
    from public.products p left join public.product_store_settings pss on pss.product_id = p.id and pss.store_id = p_store
    join public.units u on u.id = p.stock_unit_id
    where p.company_id = v_company and p.active and coalesce(pss.active, true)
      and (coalesce(pss.min_stock, p.min_stock) > 0 or coalesce(pss.reorder_point, p.reorder_point) > 0)
  loop
    v_level := public.ops_stock_level(r.qty, r.min_stock, r.reorder_point);
    if v_level = 'critico' then
      perform public.ops_alert_upsert(v_company, p_store, 'estoque_critico', 'critico', 'Estoque crítico: ' || r.name,
        format('%s %s em estoque (mínimo %s %s). Compre com urgência.', r.qty, r.unit, r.min_stock, r.unit), 'product', r.id, 'estoque:' || p_store || ':' || r.id);
      v_n := v_n + 1;
    elsif v_level = 'baixo' then
      perform public.ops_alert_upsert(v_company, p_store, 'estoque_minimo', 'atencao', 'Abaixo do mínimo: ' || r.name,
        format('%s %s em estoque (mínimo %s %s).', r.qty, r.unit, r.min_stock, r.unit), 'product', r.id, 'estoque:' || p_store || ':' || r.id);
      v_n := v_n + 1;
    elsif v_level = 'atencao' then
      perform public.ops_alert_upsert(v_company, p_store, 'estoque_proximo_minimo', 'info', 'Próximo do mínimo: ' || r.name,
        format('%s %s em estoque (mínimo %s %s).', r.qty, r.unit, r.min_stock, r.unit), 'product', r.id, 'estoque:' || p_store || ':' || r.id);
      v_n := v_n + 1;
    else
      update public.alerts set status = 'resolvido', resolved_at = now() where dedupe_key = 'estoque:' || p_store || ':' || r.id and status <> 'resolvido';
    end if;
  end loop;

  -- 3) checklists atrasados (dia anterior sem concluir, ou horário passado)
  update public.checklist_executions e set status = 'atrasado'
  where e.store_id = p_store and e.status in ('pendente','em_andamento')
    and (e.due_date < current_date or (e.due_date = current_date and e.due_time is not null and (current_date + e.due_time + interval '2 hours') < now()));
  for r in select e.id, e.due_date, c.name from public.checklist_executions e join public.checklists c on c.id = e.checklist_id
           where e.store_id = p_store and e.status = 'atrasado' loop
    perform public.ops_alert_upsert(v_company, p_store, 'checklist_atrasado', 'critico', 'Checklist atrasado: ' || r.name,
      'Previsto para ' || to_char(r.due_date, 'DD/MM/YYYY') || ' e ainda não concluído.', 'checklist_execution', r.id, 'checklist:' || r.id);
    v_n := v_n + 1;
  end loop;

  -- 4) produções planejadas para hoje ou atrasadas
  for r in select p.id, p.number, p.scheduled_for, pr.name from public.productions p join public.products pr on pr.id = p.product_id
           where p.store_id = p_store and p.status in ('planejada','em_andamento') and coalesce(p.scheduled_for, p.created_at::date) <= current_date loop
    perform public.ops_alert_upsert(v_company, p_store, 'producao_pendente', case when r.scheduled_for < current_date then 'atencao' else 'info' end,
      'Produção pendente: ' || r.name, 'Produção ' || r.number || ' prevista para ' || to_char(coalesce(r.scheduled_for, current_date), 'DD/MM/YYYY') || '.',
      'production', r.id, 'producao:' || r.id);
    v_n := v_n + 1;
  end loop;

  -- 5) tarefas atrasadas
  update public.tasks set status = 'atrasada' where store_id = p_store and status in ('pendente','em_andamento') and due_at is not null and due_at < now();
  for r in select id, title from public.tasks where store_id = p_store and status = 'atrasada' loop
    perform public.ops_alert_upsert(v_company, p_store, 'tarefa_atrasada', 'atencao', 'Tarefa atrasada: ' || r.title, '', 'task', r.id, 'tarefa:' || r.id);
    v_n := v_n + 1;
  end loop;
  update public.alerts a set status = 'resolvido', resolved_at = now()
  where a.store_id = p_store and a.kind = 'tarefa_atrasada' and a.status <> 'resolvido'
    and not exists (select 1 from public.tasks t where t.id = a.entity_id and t.status = 'atrasada');

  return jsonb_build_object('ok', true, 'touched', v_n);
end;
$fn$;

-- ---------------------------------------------------------------------
-- OUTBOX DE INTEGRAÇÕES (PDV, iFood, ERP, balança...) — sem implementação externa
-- ---------------------------------------------------------------------
create table if not exists public.integration_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  store_id      uuid references public.stores(id) on delete cascade,
  direction     text not null default 'out' check (direction in ('in','out')),
  provider      text not null default '',       -- pdv | ifood | whatsapp | erp | fiscal | balanca | impressora | bi | outro
  kind          text not null,                  -- ex.: stock.updated, production.finished, order.received
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pendente' check (status in ('pendente','processado','erro','ignorado')),
  attempts      integer not null default 0,
  last_error    text not null default '',
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists integration_events_status_idx on public.integration_events(status, created_at);
create index if not exists integration_events_company_idx on public.integration_events(company_id, created_at desc);

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  key_hash    text not null unique,      -- sha256 da chave; a chave só é mostrada na criação
  scopes      text[] not null default '{}',
  active      boolean not null default true,
  last_used_at timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists api_keys_company_idx on public.api_keys(company_id);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.label_templates    enable row level security;
alter table public.labels             enable row level security;
alter table public.integration_events enable row level security;
alter table public.api_keys           enable row level security;

drop policy if exists label_templates_select on public.label_templates;
create policy label_templates_select on public.label_templates for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists label_templates_write on public.label_templates;
create policy label_templates_write on public.label_templates for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('etiquetas.editar_modelos')))
  with check (company_id in (select public.ops_company_ids_with_permission('etiquetas.editar_modelos')));

drop policy if exists labels_select on public.labels;
create policy labels_select on public.labels for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('etiquetas.imprimir'))
      or store_id in (select public.ops_store_ids_with_permission('estoque.ver')));
drop policy if exists labels_insert on public.labels;
create policy labels_insert on public.labels for insert to authenticated
  with check (store_id in (select public.ops_store_ids_with_permission('etiquetas.imprimir')));

drop policy if exists integration_events_select on public.integration_events;
create policy integration_events_select on public.integration_events for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
drop policy if exists api_keys_write on public.api_keys;
create policy api_keys_write on public.api_keys for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

revoke execute on function public.ops_seed_label_templates(uuid) from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
