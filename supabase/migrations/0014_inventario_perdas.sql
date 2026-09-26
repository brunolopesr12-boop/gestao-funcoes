-- =====================================================================
--  0012 · INVENTÁRIO / PERDAS — apoio à interface
--    · ops_losses_kpis : indicadores do período da tela /perdas, com os
--      MESMOS filtros da lista (motivo, produto, funcionário, busca):
--      total R$, quantidade, nº de registros, motivo que mais perdeu e o
--      total do período anterior (mesma duração) para comparação.
--      Exige perdas.ver na unidade. Idempotente.
-- =====================================================================
create or replace function public.ops_losses_kpis(
  p_store uuid, p_from date, p_to date,
  p_reason uuid default null, p_product uuid default null, p_user text default '', p_term text default ''
) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_days int; v_prev_from date; v_prev_to date;
  v_count bigint; v_cost numeric; v_qty numeric; v_prev_cost numeric; v_prev_count bigint;
  v_top_name text; v_top_cost numeric; v_top_count bigint;
  v_like text; v_user text;
begin
  perform public.ops_require(p_store, 'perdas.ver');
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Período inválido.';
  end if;
  v_days := (p_to - p_from) + 1;
  v_prev_to := p_from - 1;
  v_prev_from := v_prev_to - v_days + 1;
  v_like := case when coalesce(trim(p_term), '') = '' then null else '%' || regexp_replace(trim(p_term), '[%_]', ' ', 'g') || '%' end;
  v_user := case when coalesce(trim(p_user), '') = '' then null else '%' || regexp_replace(trim(p_user), '[%_]', ' ', 'g') || '%' end;

  -- período atual
  select count(*), coalesce(sum(x.total_cost), 0), coalesce(sum(x.quantity), 0)
    into v_count, v_cost, v_qty
  from public.v_losses x
  where x.store_id = p_store and x.created_at >= p_from and x.created_at < p_to + 1
    and (p_reason is null or x.loss_reason_id = p_reason)
    and (p_product is null or x.product_id = p_product)
    and (v_user is null or x.created_by_name ilike v_user)
    and (v_like is null or x.product_name ilike v_like or x.internal_code ilike v_like
         or coalesce(x.lot_code, '') ilike v_like or x.notes ilike v_like or x.reason_name ilike v_like);

  -- motivo que mais perdeu (em R$) no período, com os mesmos filtros
  select x.reason_name, round(sum(x.total_cost), 2), count(*)
    into v_top_name, v_top_cost, v_top_count
  from public.v_losses x
  where x.store_id = p_store and x.created_at >= p_from and x.created_at < p_to + 1
    and (p_reason is null or x.loss_reason_id = p_reason)
    and (p_product is null or x.product_id = p_product)
    and (v_user is null or x.created_by_name ilike v_user)
    and (v_like is null or x.product_name ilike v_like or x.internal_code ilike v_like
         or coalesce(x.lot_code, '') ilike v_like or x.notes ilike v_like or x.reason_name ilike v_like)
  group by x.reason_name
  order by sum(x.total_cost) desc, count(*) desc
  limit 1;

  -- período anterior (mesma duração), para variação
  select count(*), coalesce(sum(x.total_cost), 0)
    into v_prev_count, v_prev_cost
  from public.v_losses x
  where x.store_id = p_store and x.created_at >= v_prev_from and x.created_at < v_prev_to + 1
    and (p_reason is null or x.loss_reason_id = p_reason)
    and (p_product is null or x.product_id = p_product)
    and (v_user is null or x.created_by_name ilike v_user)
    and (v_like is null or x.product_name ilike v_like or x.internal_code ilike v_like
         or coalesce(x.lot_code, '') ilike v_like or x.notes ilike v_like or x.reason_name ilike v_like);

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_days,
    'count', v_count,
    'total_cost', round(v_cost, 2),
    'total_quantity', round(v_qty, 4),
    'prev_from', v_prev_from, 'prev_to', v_prev_to,
    'prev_count', v_prev_count,
    'prev_total_cost', round(v_prev_cost, 2),
    'top_reason', case when v_top_name is null then null
                       else jsonb_build_object('name', v_top_name, 'cost', v_top_cost, 'count', v_top_count) end
  );
end;
$fn$;

revoke execute on function public.ops_losses_kpis(uuid, date, date, uuid, uuid, text, text) from public, anon;
grant execute on function public.ops_losses_kpis(uuid, date, date, uuid, uuid, text, text) to authenticated, service_role;
