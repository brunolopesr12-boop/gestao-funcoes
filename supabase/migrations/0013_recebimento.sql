-- =====================================================================
--  0012 · RECEBIMENTO / COMPRAS / REPOSIÇÃO — apoio à interface
--    · v_replenishment_ranked : v_replenishment + level_rank (ordenação
--      por gravidade do nível no banco, com paginação)
--    · ops_po_create_batch    : cria pedidos de compra (rascunho) em lote,
--      agrupando os itens por fornecedor, em uma única transação
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reposição ordenável por nível (0 = crítico … 3 = normal)
-- ---------------------------------------------------------------------
drop view if exists public.v_replenishment_ranked;
create view public.v_replenishment_ranked with (security_invoker = true) as
select v.*,
       case v.level when 'critico' then 0 when 'baixo' then 1 when 'atencao' then 2 else 3 end as level_rank
from public.v_replenishment v;
grant select on public.v_replenishment_ranked to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Pedidos de compra em lote a partir da reposição
--   p_items: [{ product_id, supplier_id?, quantity, unit_id?, estimated_price? }]
--   Agrupa por supplier_id (itens sem fornecedor viram um pedido sem fornecedor).
--   Devolve: [{ id, number, supplier_id, supplier_name, items }]
-- ---------------------------------------------------------------------
create or replace function public.ops_po_create_batch(p_store uuid, p_items jsonb, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid; v_sup uuid; v_po uuid; v_num text; v_sup_name text; v_pos int; v_count int;
  it jsonb; v_qty numeric; v_product uuid; v_result jsonb := '[]'::jsonb;
begin
  perform public.ops_require(p_store, 'compras.criar');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Selecione pelo menos um produto.';
  end if;
  v_company := public.ops_store_company(p_store);

  for v_sup in
    select distinct nullif(i->>'supplier_id', '')::uuid from jsonb_array_elements(p_items) i
  loop
    if v_sup is not null and not exists (select 1 from public.suppliers where id = v_sup and company_id = v_company) then
      raise exception 'Fornecedor inválido.';
    end if;

    insert into public.purchase_orders (company_id, store_id, supplier_id, notes)
    values (v_company, p_store, v_sup, coalesce(p_notes, ''))
    returning id, number into v_po, v_num;

    v_pos := 0; v_count := 0;
    for it in
      select i from jsonb_array_elements(p_items) i
      where nullif(i->>'supplier_id', '')::uuid is not distinct from v_sup
    loop
      v_product := nullif(it->>'product_id', '')::uuid;
      v_qty := coalesce(nullif(it->>'quantity', '')::numeric, 0);
      if v_product is null or v_qty <= 0 then continue; end if;
      if not exists (select 1 from public.products where id = v_product and company_id = v_company) then
        raise exception 'Produto inválido no pedido.';
      end if;
      insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_id, estimated_price, position)
      values (v_po, v_product, v_qty, nullif(it->>'unit_id', '')::uuid, coalesce(nullif(it->>'estimated_price', '')::numeric, 0), v_pos);
      v_pos := v_pos + 1; v_count := v_count + 1;
    end loop;

    if v_count = 0 then
      delete from public.purchase_orders where id = v_po;
      continue;
    end if;

    v_sup_name := null;
    if v_sup is not null then select name into v_sup_name from public.suppliers where id = v_sup; end if;
    v_result := v_result || jsonb_build_object('id', v_po, 'number', v_num, 'supplier_id', v_sup, 'supplier_name', coalesce(v_sup_name, ''), 'items', v_count);
  end loop;

  if jsonb_array_length(v_result) = 0 then
    raise exception 'Nenhum item válido para gerar pedido (quantidade precisa ser maior que zero).';
  end if;
  return v_result;
end;
$fn$;

grant execute on function public.ops_po_create_batch(uuid, jsonb, text) to authenticated, service_role;
