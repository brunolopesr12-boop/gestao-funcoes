-- =====================================================================
--  0009 · VIEWS (security_invoker → respeitam RLS), PAINEL e RELATÓRIOS
-- =====================================================================

drop view if exists public.v_stock_balances cascade;
create view public.v_stock_balances with (security_invoker = true) as
select
  si.id,
  si.store_id,
  s.company_id,
  si.product_id,
  p.name            as product_name,
  p.internal_code,
  p.barcode,
  p.product_kind,
  p.category_id,
  c.name            as category_name,
  u.code            as unit,
  si.location_id,
  loc.name          as location_name,
  si.lot_id,
  l.lot_code,
  l.origin          as lot_origin,
  l.supplier_id,
  l.expires_at,
  case when l.expires_at is null then null else (l.expires_at - current_date) end as days_to_expire,
  case
    when l.expires_at is null then 'sem_validade'
    when l.expires_at < current_date then 'vencido'
    when l.expires_at = current_date then 'hoje'
    when l.expires_at <= current_date + 3 then '3dias'
    when l.expires_at <= current_date + 7 then '7dias'
    else 'ok' end   as expiry_status,
  l.status          as lot_status,
  l.produced_at, l.received_at, l.opened_at, l.frozen_at, l.thawed_at,
  si.quantity,
  l.unit_cost,
  round(si.quantity * l.unit_cost, 4) as total_value,
  si.updated_at
from public.stock_items si
join public.stock_lots l   on l.id = si.lot_id
join public.products p     on p.id = si.product_id
join public.units u        on u.id = p.stock_unit_id
join public.stores s       on s.id = si.store_id
join public.stock_locations loc on loc.id = si.location_id
left join public.categories c on c.id = p.category_id
where si.quantity <> 0;

drop view if exists public.v_stock_by_product cascade;
create view public.v_stock_by_product with (security_invoker = true) as
with bal as (
  select si.store_id, si.product_id,
         sum(si.quantity) filter (where l.status <> 'bloqueado' and (l.expires_at is null or l.expires_at >= current_date)) as quantity,
         sum(si.quantity * l.unit_cost) filter (where l.status <> 'bloqueado' and (l.expires_at is null or l.expires_at >= current_date)) as total_value,
         count(distinct si.lot_id) filter (where si.quantity > 0) as lots_count,
         min(l.expires_at) filter (where si.quantity > 0 and (l.expires_at is null or l.expires_at >= current_date)) as next_expiry,
         sum(si.quantity) filter (where l.expires_at < current_date) as expired_quantity,
         sum(si.quantity) filter (where l.status = 'bloqueado') as blocked_quantity
  from public.stock_items si join public.stock_lots l on l.id = si.lot_id
  where si.quantity <> 0
  group by si.store_id, si.product_id
)
select
  st.id as store_id, p.company_id, p.id as product_id, p.name as product_name, p.internal_code, p.barcode, p.product_kind,
  p.category_id, c.name as category_name, u.code as unit, p.cost, p.active,
  p.default_supplier_id, sup.name as default_supplier_name, p.purchase_unit_id, pu.code as purchase_unit, p.purchase_factor,
  coalesce(b.quantity, 0) as quantity,
  coalesce(b.total_value, 0) as total_value,
  coalesce(b.lots_count, 0) as lots_count,
  b.next_expiry,
  coalesce(b.expired_quantity, 0) as expired_quantity,
  coalesce(b.blocked_quantity, 0) as blocked_quantity,
  coalesce(pss.min_stock, p.min_stock) as min_stock,
  coalesce(pss.max_stock, p.max_stock) as max_stock,
  coalesce(pss.reorder_point, p.reorder_point) as reorder_point,
  coalesce(pss.ideal_stock, p.ideal_stock) as ideal_stock,
  public.ops_stock_level(coalesce(b.quantity, 0), coalesce(pss.min_stock, p.min_stock), coalesce(pss.reorder_point, p.reorder_point)) as level,
  case
    when coalesce(pss.max_stock, p.max_stock) > 0 then greatest(coalesce(pss.max_stock, p.max_stock) - coalesce(b.quantity, 0), 0)
    when coalesce(pss.ideal_stock, p.ideal_stock) > 0 then greatest(coalesce(pss.ideal_stock, p.ideal_stock) - coalesce(b.quantity, 0), 0)
    when coalesce(pss.min_stock, p.min_stock) > 0 then greatest(coalesce(pss.min_stock, p.min_stock) * 2 - coalesce(b.quantity, 0), 0)
    else 0 end as suggested_purchase
from public.products p
join public.stores st on st.company_id = p.company_id and st.active
join public.units u on u.id = p.stock_unit_id
left join public.units pu on pu.id = p.purchase_unit_id
left join public.categories c on c.id = p.category_id
left join public.suppliers sup on sup.id = p.default_supplier_id
left join public.product_store_settings pss on pss.product_id = p.id and pss.store_id = st.id
left join bal b on b.store_id = st.id and b.product_id = p.id
where coalesce(pss.active, true);

drop view if exists public.v_replenishment cascade;
create view public.v_replenishment with (security_invoker = true) as
select v.*,
  case when v.purchase_factor > 0 and v.purchase_unit_id is not null then ceil(v.suggested_purchase / v.purchase_factor) else v.suggested_purchase end as suggested_purchase_units,
  round(v.suggested_purchase * v.cost, 2) as estimated_cost
from public.v_stock_by_product v
where v.active and (v.level <> 'normal' or (v.suggested_purchase > 0 and v.quantity <= v.reorder_point and v.reorder_point > 0));

drop view if exists public.v_expiring_lots cascade;
create view public.v_expiring_lots with (security_invoker = true) as
select l.id as lot_id, l.store_id, l.company_id, l.product_id, p.name as product_name, p.internal_code, c.name as category_name, u.code as unit,
       l.lot_code, l.origin, l.expires_at, (l.expires_at - current_date) as days_to_expire, l.status as lot_status, l.unit_cost,
       l.supplier_id, sup.name as supplier_name,
       coalesce(sum(si.quantity), 0) as quantity,
       round(coalesce(sum(si.quantity), 0) * l.unit_cost, 4) as total_value,
       string_agg(distinct loc.name, ', ') as locations,
       case
         when l.expires_at < current_date then 'vencido'
         when l.expires_at = current_date then 'hoje'
         when l.expires_at <= current_date + 3 then '3dias'
         when l.expires_at <= current_date + 7 then '7dias'
         else 'ok' end as expiry_status
from public.stock_lots l
join public.products p on p.id = l.product_id
join public.units u on u.id = p.stock_unit_id
left join public.categories c on c.id = p.category_id
left join public.suppliers sup on sup.id = l.supplier_id
join public.stock_items si on si.lot_id = l.id and si.quantity > 0
join public.stock_locations loc on loc.id = si.location_id
where l.expires_at is not null
group by l.id, p.name, p.internal_code, c.name, u.code, sup.name;

drop view if exists public.v_movements cascade;
create view public.v_movements with (security_invoker = true) as
select m.id, m.company_id, m.store_id, m.product_id, p.name as product_name, p.internal_code, c.name as category_name, u.code as unit,
       m.lot_id, l.lot_code, l.expires_at, m.location_id, loc.name as location_name,
       m.movement_type, m.quantity, m.unit_cost, m.total_cost, m.balance_after, m.reason, m.reference_type, m.reference_id, m.notes,
       m.created_by, m.created_by_name, m.created_at
from public.stock_movements m
join public.products p on p.id = m.product_id
join public.units u on u.id = p.stock_unit_id
left join public.categories c on c.id = p.category_id
join public.stock_lots l on l.id = m.lot_id
join public.stock_locations loc on loc.id = m.location_id;

drop view if exists public.v_losses cascade;
create view public.v_losses with (security_invoker = true) as
select x.id, x.company_id, x.store_id, x.product_id, p.name as product_name, p.internal_code, c.name as category_name, u.code as unit,
       x.lot_id, l.lot_code, x.location_id, loc.name as location_name, x.quantity, x.unit_cost, x.total_cost,
       x.loss_reason_id, coalesce(r.name, nullif(x.reason_text, ''), 'Sem motivo') as reason_name, x.notes, x.photo_url,
       x.created_by, x.created_by_name, x.created_at
from public.losses x
join public.products p on p.id = x.product_id
join public.units u on u.id = p.stock_unit_id
left join public.categories c on c.id = p.category_id
left join public.stock_lots l on l.id = x.lot_id
left join public.stock_locations loc on loc.id = x.location_id
left join public.loss_reasons r on r.id = x.loss_reason_id;

drop view if exists public.v_audit_logs cascade;
create view public.v_audit_logs with (security_invoker = true) as
select a.*, s.name as store_name from public.audit_logs a left join public.stores s on s.id = a.store_id;

-- ---------------------------------------------------------------------
-- Relatórios agregados
-- ---------------------------------------------------------------------
create or replace function public.ops_report_consumption(p_store uuid, p_from date, p_to date, p_group text default 'produto')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select
        case p_group when 'categoria' then coalesce(c.name, 'Sem categoria') when 'dia' then to_char(m.created_at, 'YYYY-MM-DD') when 'tipo' then m.movement_type else p.name end as label,
        case p_group when 'categoria' then c.id when 'produto' then p.id end as id,
        u.code as unit,
        round(sum(-m.quantity), 4) as quantity,
        round(sum(-m.total_cost), 2) as cost,
        count(*) as movements
      from public.stock_movements m
      join public.products p on p.id = m.product_id join public.units u on u.id = p.stock_unit_id
      left join public.categories c on c.id = p.category_id
      where m.store_id = p_store and m.quantity < 0 and m.movement_type in ('consumo','producao_consumo','saida')
        and m.created_at >= p_from and m.created_at < p_to + 1
      group by 1, 2, 3 order by cost desc, quantity desc
    ) t), '[]'::jsonb);
end;
$fn$;

create or replace function public.ops_report_losses(p_store uuid, p_from date, p_to date, p_group text default 'motivo')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  -- painel de perdas: quem vê perdas também vê o resumo
  if not public.ops_has_permission(p_store, 'perdas.ver') then
    perform public.ops_require(p_store, 'relatorios.ver');
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select
        case p_group when 'produto' then x.product_name when 'usuario' then coalesce(nullif(x.created_by_name, ''), '—')
             when 'dia' then to_char(x.created_at, 'YYYY-MM-DD') when 'categoria' then coalesce(x.category_name, 'Sem categoria') else x.reason_name end as label,
        round(sum(x.quantity), 4) as quantity,
        round(sum(x.total_cost), 2) as cost,
        count(*) as occurrences
      from public.v_losses x
      where x.store_id = p_store and x.created_at >= p_from and x.created_at < p_to + 1
      group by 1 order by cost desc
    ) t), '[]'::jsonb);
end;
$fn$;

create or replace function public.ops_report_production(p_store uuid, p_from date, p_to date, p_group text default 'produto')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select
        case p_group when 'dia' then to_char(pr.finished_at, 'YYYY-MM-DD') when 'usuario' then coalesce(nullif(pr.produced_by_name, ''), '—') else p.name end as label,
        u.code as unit,
        count(*) as productions,
        round(sum(pr.planned_quantity), 4) as planned,
        round(sum(pr.produced_quantity), 4) as produced,
        round(avg(pr.actual_yield_pct), 2) as avg_yield_pct,
        round(sum(pr.total_cost), 2) as cost
      from public.productions pr join public.products p on p.id = pr.product_id join public.units u on u.id = p.stock_unit_id
      where pr.store_id = p_store and pr.status = 'concluida' and pr.finished_at >= p_from and pr.finished_at < p_to + 1
      group by 1, 2 order by produced desc
    ) t), '[]'::jsonb);
end;
$fn$;

create or replace function public.ops_report_stock_by_category(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'estoque.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select coalesce(c.name, 'Sem categoria') as label, c.id, count(distinct v.product_id) as products,
             round(sum(v.total_value), 2) as value
      from public.v_stock_balances v left join public.categories c on c.id = v.category_id
      where v.store_id = p_store and v.quantity > 0
      group by 1, 2 order by value desc
    ) t), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------
-- PAINEL
-- ---------------------------------------------------------------------
create or replace function public.ops_dashboard(p_store uuid, p_from date default (current_date - 30), p_to date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_cards jsonb; v_series jsonb; v_company uuid;
begin
  perform public.ops_require(p_store, 'painel.ver');
  v_company := public.ops_store_company(p_store);

  select jsonb_build_object(
    'stock_value',      (select round(coalesce(sum(total_value), 0), 2) from public.v_stock_balances where store_id = p_store and quantity > 0),
    'stock_products',   (select count(distinct product_id) from public.v_stock_balances where store_id = p_store and quantity > 0),
    'stock_lots',       (select count(distinct lot_id) from public.v_stock_balances where store_id = p_store and quantity > 0),
    'expired',          (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status = 'vencido'),
    'expired_value',    (select round(coalesce(sum(total_value), 0), 2) from public.v_expiring_lots where store_id = p_store and expiry_status = 'vencido'),
    'expiring_today',   (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status = 'hoje'),
    'expiring_3d',      (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status in ('hoje','3dias')),
    'expiring_7d',      (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status in ('hoje','3dias','7dias')),
    'below_min',        (select count(*) from public.v_stock_by_product where store_id = p_store and active and level in ('baixo','critico')),
    'near_min',         (select count(*) from public.v_stock_by_product where store_id = p_store and active and level = 'atencao'),
    'critical',         (select count(*) from public.v_stock_by_product where store_id = p_store and active and level = 'critico'),
    'pending_productions', (select count(*) from public.productions where store_id = p_store and status in ('planejada','em_andamento')),
    'pending_receipts', (select count(*) from public.receipts where store_id = p_store and status = 'rascunho'),
    'pending_orders',   (select count(*) from public.purchase_orders where store_id = p_store and status in ('solicitado','aprovado','pedido')),
    'pending_tasks',    (select count(*) from public.tasks where store_id = p_store and status in ('pendente','em_andamento','atrasada')),
    'late_tasks',       (select count(*) from public.tasks where store_id = p_store and status = 'atrasada'),
    'pending_checklists', (select count(*) from public.checklist_executions where store_id = p_store and due_date = current_date and status in ('pendente','em_andamento','atrasado')),
    'late_checklists',  (select count(*) from public.checklist_executions where store_id = p_store and status = 'atrasado'),
    'open_counts',      (select count(*) from public.inventory_counts where store_id = p_store and status = 'aberta'),
    'losses_value',     (select round(coalesce(sum(total_cost), 0), 2) from public.losses where store_id = p_store and created_at >= p_from and created_at < p_to + 1),
    'losses_count',     (select count(*) from public.losses where store_id = p_store and created_at >= p_from and created_at < p_to + 1),
    'open_alerts',      (select count(*) from public.alerts where store_id = p_store and status = 'aberto'),
    'critical_alerts',  (select count(*) from public.alerts where store_id = p_store and status <> 'resolvido' and severity = 'critico'),
    'temp_out_of_range', (select count(*) from public.alerts where store_id = p_store and status <> 'resolvido' and kind = 'temperatura'),
    'receipts_period_value', (select round(coalesce(sum(total), 0), 2) from public.receipts where store_id = p_store and status = 'finalizado' and received_at >= p_from and received_at < p_to + 1),
    'productions_period', (select count(*) from public.productions where store_id = p_store and status = 'concluida' and finished_at >= p_from and finished_at < p_to + 1),
    'consumption_period_value', (select round(coalesce(sum(-total_cost), 0), 2) from public.stock_movements where store_id = p_store and movement_type in ('consumo','producao_consumo','saida') and created_at >= p_from and created_at < p_to + 1)
  ) into v_cards;

  select jsonb_build_object(
    'losses_by_day', coalesce((select jsonb_agg(row_to_json(t)) from (
        select to_char(created_at, 'YYYY-MM-DD') as day, round(sum(total_cost), 2) as value, round(sum(quantity), 3) as quantity
        from public.losses where store_id = p_store and created_at >= p_from and created_at < p_to + 1 group by 1 order by 1) t), '[]'::jsonb),
    'losses_by_reason', public.ops_report_losses_internal(p_store, p_from, p_to, 'motivo'),
    'losses_by_product', (select jsonb_agg(e) from (select e from jsonb_array_elements(public.ops_report_losses_internal(p_store, p_from, p_to, 'produto')) e limit 10) x),
    'consumption_by_category', public.ops_report_consumption_internal(p_store, p_from, p_to, 'categoria'),
    'top_consumed', (select jsonb_agg(e) from (select e from jsonb_array_elements(public.ops_report_consumption_internal(p_store, p_from, p_to, 'produto')) e limit 10) x),
    'production_by_day', coalesce((select jsonb_agg(row_to_json(t)) from (
        select to_char(finished_at, 'YYYY-MM-DD') as day, count(*) as productions, round(sum(produced_quantity), 3) as quantity, round(sum(total_cost), 2) as cost
        from public.productions where store_id = p_store and status = 'concluida' and finished_at >= p_from and finished_at < p_to + 1 group by 1 order by 1) t), '[]'::jsonb),
    'stock_by_category', public.ops_report_stock_by_category(p_store),
    'expiring_products', coalesce((select jsonb_agg(row_to_json(t)) from (
        select lot_id, product_name, lot_code, expires_at, days_to_expire, quantity, unit, expiry_status, locations
        from public.v_expiring_lots where store_id = p_store and expiry_status <> 'ok' order by expires_at limit 15) t), '[]'::jsonb),
    'replenishment', coalesce((select jsonb_agg(row_to_json(t)) from (
        select product_id, product_name, unit, quantity, min_stock, max_stock, level, suggested_purchase
        from public.v_replenishment where store_id = p_store order by case level when 'critico' then 0 when 'baixo' then 1 else 2 end, product_name limit 15) t), '[]'::jsonb)
  ) into v_series;

  return jsonb_build_object('store_id', p_store, 'from', p_from, 'to', p_to, 'cards', v_cards, 'series', v_series, 'generated_at', now());
end;
$fn$;

-- versões internas (sem checagem de relatorios.ver) para o painel
create or replace function public.ops_report_losses_internal(p_store uuid, p_from date, p_to date, p_group text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select case p_group when 'produto' then x.product_name when 'usuario' then coalesce(nullif(x.created_by_name, ''), '—')
                  when 'dia' then to_char(x.created_at, 'YYYY-MM-DD') else x.reason_name end as label,
             round(sum(x.quantity), 4) as quantity, round(sum(x.total_cost), 2) as cost, count(*) as occurrences
      from public.v_losses x where x.store_id = p_store and x.created_at >= p_from and x.created_at < p_to + 1
      group by 1 order by cost desc) t), '[]'::jsonb)
$$;
create or replace function public.ops_report_consumption_internal(p_store uuid, p_from date, p_to date, p_group text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select case p_group when 'categoria' then coalesce(c.name, 'Sem categoria') when 'dia' then to_char(m.created_at, 'YYYY-MM-DD') else p.name end as label,
             u.code as unit, round(sum(-m.quantity), 4) as quantity, round(sum(-m.total_cost), 2) as cost, count(*) as movements
      from public.stock_movements m join public.products p on p.id = m.product_id join public.units u on u.id = p.stock_unit_id
      left join public.categories c on c.id = p.category_id
      where m.store_id = p_store and m.quantity < 0 and m.movement_type in ('consumo','producao_consumo','saida')
        and m.created_at >= p_from and m.created_at < p_to + 1
      group by 1, 2 order by cost desc, quantity desc) t), '[]'::jsonb)
$$;
revoke execute on function public.ops_report_losses_internal(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.ops_report_consumption_internal(uuid, date, date, text) from public, anon, authenticated;

-- Comparação de preços entre fornecedores para um produto
create or replace function public.ops_supplier_price_comparison(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_company uuid;
begin
  select company_id into v_company from public.products where id = p_product;
  perform public.ops_require_company(v_company, 'fornecedores.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select s.id as supplier_id, s.name as supplier_name, sp.last_price, sp.last_purchase_at, sp.preferred, sp.supplier_code,
             (select round(avg(h.price), 4) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product and h.recorded_at >= now() - interval '180 days') as avg_price_180d,
             (select count(*) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product) as purchases,
             (select min(h.price) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product) as min_price,
             (select max(h.price) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product) as max_price
      from public.supplier_products sp join public.suppliers s on s.id = sp.supplier_id
      where sp.product_id = p_product and s.active
      order by sp.last_price asc nulls last) t), '[]'::jsonb);
end;
$fn$;

grant select on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
