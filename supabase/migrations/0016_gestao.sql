-- =====================================================================
--  0012 · GESTÃO (alertas, painel, relatórios, auditoria) — apoio à interface
--    · ops_audit_filters          : entidades e ações existentes na auditoria da
--                                   empresa (para os selects da tela /auditoria).
--    · ops_report_price_variation : variação de preço de compra por produto a
--                                   partir de supplier_price_history (relatório
--                                   de custos / fornecedores).
--    · ops_report_suppliers       : resumo de recebimentos por fornecedor na
--                                   unidade e período (relatório de fornecedores).
--  Todas: security definer + ops_require(...). Idempotentes (create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Entidades e ações distintas na auditoria da empresa
-- ---------------------------------------------------------------------
create or replace function public.ops_audit_filters(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require_company(p_company, 'auditoria.ver');
  return jsonb_build_object(
    'entities', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select a.entity, count(*) as total from public.audit_logs a
        where a.company_id = p_company group by a.entity order by a.entity) t), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select a.action, count(*) as total from public.audit_logs a
        where a.company_id = p_company group by a.action order by count(*) desc, a.action) t), '[]'::jsonb)
  );
end;
$fn$;
revoke execute on function public.ops_audit_filters(uuid) from public, anon;
grant execute on function public.ops_audit_filters(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Variação de preço de compra por produto (histórico da empresa)
--   p_store: unidade usada para checar relatorios.ver; os preços são do
--   catálogo da empresa (um produto tem o mesmo preço de compra em qualquer
--   unidade), por isso não se filtra por unidade.
-- ---------------------------------------------------------------------
create or replace function public.ops_report_price_variation(
  p_store uuid, p_from date, p_to date, p_supplier uuid default null, p_product uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_company uuid;
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Período inválido.';
  end if;
  v_company := public.ops_store_company(p_store);
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      with h as (
        select * from public.supplier_price_history x
        where x.company_id = v_company
          and x.recorded_at >= p_from and x.recorded_at < p_to + 1
          and (p_supplier is null or x.supplier_id = p_supplier)
          and (p_product is null or x.product_id = p_product)
      ), agg as (
        select h.product_id,
               count(*) as purchases,
               min(h.price) as min_price, max(h.price) as max_price, round(avg(h.price), 4) as avg_price,
               round(sum(h.quantity), 4) as quantity,
               round(sum(h.price * h.quantity), 2) as spent,
               (array_agg(h.price order by h.recorded_at asc, h.id))[1] as first_price,
               (array_agg(h.price order by h.recorded_at desc, h.id))[1] as last_price,
               (array_agg(h.supplier_id order by h.recorded_at desc, h.id))[1] as last_supplier_id,
               min(h.recorded_at) as first_at, max(h.recorded_at) as last_at
        from h group by h.product_id
      )
      select a.product_id, p.name as product_name, p.internal_code, u.code as unit,
             a.first_price, a.last_price, a.min_price, a.max_price, a.avg_price,
             case when a.first_price > 0 then round((a.last_price - a.first_price) / a.first_price * 100, 2) else null end as variation_pct,
             a.purchases, a.quantity, a.spent, a.first_at, a.last_at,
             a.last_supplier_id, s.name as last_supplier_name,
             p.cost as current_cost
      from agg a
      join public.products p on p.id = a.product_id
      join public.units u on u.id = p.stock_unit_id
      left join public.suppliers s on s.id = a.last_supplier_id
      order by abs(coalesce(case when a.first_price > 0 then (a.last_price - a.first_price) / a.first_price end, 0)) desc, a.spent desc, p.name
    ) t), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.ops_report_price_variation(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.ops_report_price_variation(uuid, date, date, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Resumo por fornecedor: recebimentos finalizados na unidade no período
-- ---------------------------------------------------------------------
create or replace function public.ops_report_suppliers(p_store uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Período inválido.';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select r.supplier_id,
             coalesce(s.name, 'Sem fornecedor') as supplier_name,
             count(*) as receipts,
             round(sum(r.total), 2) as receipts_total,
             round(avg(r.total), 2) as avg_ticket,
             (select count(distinct ri.product_id) from public.receipt_items ri where ri.receipt_id in (select r2.id from public.receipts r2
                where r2.store_id = p_store and r2.status = 'finalizado' and r2.received_at >= p_from and r2.received_at < p_to + 1
                  and r2.supplier_id is not distinct from r.supplier_id)) as products,
             count(*) filter (where r.result in ('aprovado_ressalva','recusado')) as problems,
             (select count(*) from public.receipt_items ri join public.receipts r3 on r3.id = ri.receipt_id
               where r3.store_id = p_store and r3.status = 'finalizado' and r3.received_at >= p_from and r3.received_at < p_to + 1
                 and r3.supplier_id is not distinct from r.supplier_id and ri.result = 'recusado') as rejected_items,
             max(r.received_at) as last_receipt_at
      from public.receipts r
      left join public.suppliers s on s.id = r.supplier_id
      where r.store_id = p_store and r.status = 'finalizado'
        and r.received_at >= p_from and r.received_at < p_to + 1
      group by r.supplier_id, s.name
      order by receipts_total desc nulls last, supplier_name
    ) t), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.ops_report_suppliers(uuid, date, date) from public, anon;
grant execute on function public.ops_report_suppliers(uuid, date, date) to authenticated, service_role;
