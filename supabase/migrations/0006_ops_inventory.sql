-- =====================================================================
--  0006 · INVENTÁRIO / CONTAGEM
-- =====================================================================
create table if not exists public.inventory_counts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  store_id         uuid not null references public.stores(id) on delete cascade,
  location_id      uuid references public.stock_locations(id) on delete set null,   -- null = toda a unidade
  category_id      uuid references public.categories(id) on delete set null,        -- opcional: só uma categoria
  number           text not null default '',
  kind             text not null default 'rapida' check (kind in ('rapida','completa')),
  status           text not null default 'aberta' check (status in ('aberta','finalizada','cancelada')),
  notes            text not null default '',
  items_count      integer not null default 0,
  differences      integer not null default 0,
  difference_value numeric(14,4) not null default 0,
  started_by       uuid, started_by_name text not null default '',
  finished_by      uuid, finished_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists inventory_counts_store_idx on public.inventory_counts(store_id, created_at desc);
create index if not exists inventory_counts_status_idx on public.inventory_counts(store_id, status);
do $$ begin perform public.ops_ensure_updated_at('inventory_counts'); perform public.ops_ensure_guard_status('inventory_counts'); perform public.ops_ensure_audit('inventory_counts'); end $$;

create table if not exists public.inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  count_id              uuid not null references public.inventory_counts(id) on delete cascade,
  product_id            uuid not null references public.products(id) on delete restrict,
  lot_id                uuid references public.stock_lots(id) on delete set null,
  location_id           uuid not null references public.stock_locations(id) on delete restrict,
  theoretical_quantity  numeric(18,4) not null default 0,
  counted_quantity      numeric(18,4),
  difference            numeric(18,4),
  unit_cost             numeric(14,4) not null default 0,
  reason                text not null default '',
  notes                 text not null default '',
  counted_by            uuid, counted_by_name text not null default '',
  counted_at            timestamptz,
  movement_id           uuid references public.stock_movements(id) on delete set null,
  client_op_id          uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists inventory_items_count_idx on public.inventory_items(count_id);
create index if not exists inventory_items_product_idx on public.inventory_items(product_id);
create unique index if not exists inventory_items_key_uidx on public.inventory_items(count_id, product_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));
do $$ begin perform public.ops_ensure_updated_at('inventory_items'); end $$;

create or replace function public.ops_count_next_number(p_store uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'IN-' || to_char(now(), 'YYMM') || '-' || lpad((count(*) + 1)::text, 4, '0')
  from public.inventory_counts where store_id = p_store and date_trunc('month', created_at) = date_trunc('month', now())
$$;

-- Abre uma contagem. kind=completa: já carrega todos os itens com saldo (teórico congelado).
create or replace function public.ops_count_open(
  p_store uuid, p_kind text default 'rapida', p_location uuid default null, p_category uuid default null, p_notes text default ''
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_id uuid; v_n int := 0;
begin
  perform public.ops_require(p_store, 'inventario.contar');
  v_company := public.ops_store_company(p_store);
  insert into public.inventory_counts (company_id, store_id, location_id, category_id, number, kind, status, notes, started_by, started_by_name)
  values (v_company, p_store, p_location, p_category, public.ops_count_next_number(p_store), coalesce(p_kind, 'rapida'), 'aberta', coalesce(p_notes, ''), auth.uid(), public.ops_user_name())
  returning id into v_id;

  if p_kind = 'completa' then
    insert into public.inventory_items (count_id, product_id, lot_id, location_id, theoretical_quantity, unit_cost)
    select v_id, si.product_id, si.lot_id, si.location_id, si.quantity, l.unit_cost
    from public.stock_items si join public.stock_lots l on l.id = si.lot_id join public.products p on p.id = si.product_id
    where si.store_id = p_store and si.quantity <> 0
      and (p_location is null or si.location_id = p_location)
      and (p_category is null or p.category_id = p_category);
    get diagnostics v_n = row_count;
    update public.inventory_counts set items_count = v_n where id = v_id;
  end if;
  return v_id;
end;
$fn$;

-- Registra (ou atualiza) a contagem de um item. Congela o teórico no primeiro toque.
create or replace function public.ops_count_set_item(
  p_count uuid, p_product uuid, p_location uuid, p_counted numeric,
  p_lot uuid default null, p_reason text default '', p_notes text default '', p_client_op_id uuid default null, p_unit uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_c record; v_theo numeric; v_cost numeric; v_id uuid; v_counted numeric; v_lot uuid := p_lot;
begin
  select * into v_c from public.inventory_counts where id = p_count;
  if v_c.id is null then raise exception 'Contagem não encontrada.'; end if;
  perform public.ops_require(v_c.store_id, 'inventario.contar');
  if v_c.status <> 'aberta' then raise exception 'Contagem já %.', v_c.status; end if;
  if p_client_op_id is not null then
    select id into v_id from public.inventory_items where client_op_id = p_client_op_id;
    if v_id is not null then return v_id; end if;
  end if;
  if (select store_id from public.stock_locations where id = p_location) <> v_c.store_id then
    raise exception 'Local não pertence à unidade da contagem.';
  end if;
  v_counted := public.ops_round_qty(public.ops_convert_qty(p_product, p_counted, p_unit));

  -- sem lote informado: se o produto tem exatamente um lote com saldo no local, usa-o
  if v_lot is null then
    select lot_id into v_lot from public.stock_items where store_id = v_c.store_id and product_id = p_product and location_id = p_location and quantity <> 0
    group by lot_id having count(*) = 1 limit 1;
    if (select count(distinct lot_id) from public.stock_items where store_id = v_c.store_id and product_id = p_product and location_id = p_location and quantity <> 0) = 1 then
      select lot_id into v_lot from public.stock_items where store_id = v_c.store_id and product_id = p_product and location_id = p_location and quantity <> 0 limit 1;
    else
      v_lot := null;
    end if;
  end if;

  if v_lot is not null then
    select coalesce(quantity, 0), (select unit_cost from public.stock_lots where id = v_lot) into v_theo, v_cost
      from public.stock_items where store_id = v_c.store_id and product_id = p_product and location_id = p_location and lot_id = v_lot;
    v_theo := coalesce(v_theo, 0);
  else
    select coalesce(sum(quantity), 0) into v_theo from public.stock_items where store_id = v_c.store_id and product_id = p_product and location_id = p_location;
    select cost into v_cost from public.products where id = p_product;
  end if;

  insert into public.inventory_items (count_id, product_id, lot_id, location_id, theoretical_quantity, counted_quantity, difference, unit_cost,
    reason, notes, counted_by, counted_by_name, counted_at, client_op_id)
  values (p_count, p_product, v_lot, p_location, v_theo, v_counted, public.ops_round_qty(v_counted - v_theo), coalesce(v_cost, 0),
    coalesce(p_reason, ''), coalesce(p_notes, ''), auth.uid(), public.ops_user_name(), now(), p_client_op_id)
  on conflict (count_id, product_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set counted_quantity = excluded.counted_quantity,
                difference = public.ops_round_qty(excluded.counted_quantity - public.inventory_items.theoretical_quantity),
                reason = case when excluded.reason <> '' then excluded.reason else public.inventory_items.reason end,
                notes = case when excluded.notes <> '' then excluded.notes else public.inventory_items.notes end,
                counted_by = auth.uid(), counted_by_name = public.ops_user_name(), counted_at = now(),
                client_op_id = coalesce(public.inventory_items.client_op_id, excluded.client_op_id), updated_at = now()
  returning id into v_id;

  update public.inventory_counts c set
    items_count = (select count(*) from public.inventory_items where count_id = p_count),
    differences = (select count(*) from public.inventory_items where count_id = p_count and coalesce(difference, 0) <> 0),
    difference_value = (select coalesce(sum(difference * unit_cost), 0) from public.inventory_items where count_id = p_count and counted_quantity is not null)
  where c.id = p_count;
  return v_id;
end;
$fn$;

-- Finaliza: gera movimento de inventário para cada diferença.
--   p_uncounted_as_zero: itens carregados (contagem completa) e não contados viram zero.
create or replace function public.ops_finalize_count(p_count uuid, p_uncounted_as_zero boolean default false, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_c record; it record; v_mov uuid; v_n int := 0; v_value numeric := 0; v_lot uuid; r record; v_left numeric; v_target numeric;
        v_diff numeric; v_new_lot uuid; v_qty_sum numeric;
begin
  select * into v_c from public.inventory_counts where id = p_count;
  if v_c.id is null then raise exception 'Contagem não encontrada.'; end if;
  perform public.ops_require(v_c.store_id, 'inventario.finalizar');
  if v_c.status <> 'aberta' then raise exception 'Contagem já %.', v_c.status; end if;

  perform public.ops_internal_on();
  if p_uncounted_as_zero then
    update public.inventory_items set counted_quantity = 0, difference = -theoretical_quantity, counted_by = auth.uid(), counted_by_name = public.ops_user_name(), counted_at = now(),
      reason = case when reason = '' then 'não contado' else reason end
    where count_id = p_count and counted_quantity is null;
  end if;

  for it in select * from public.inventory_items where count_id = p_count and counted_quantity is not null and coalesce(difference, 0) <> 0 order by created_at loop
    if it.lot_id is not null then
      v_mov := public.ops_move_stock(v_c.store_id, it.product_id, it.lot_id, it.location_id, 'inventario', it.difference, null,
                 coalesce(nullif(it.reason, ''), 'inventário ' || v_c.number), 'inventory_count', p_count, it.notes, null, null);
      update public.inventory_items set movement_id = v_mov where id = it.id;
      v_n := v_n + 1; v_value := v_value + it.difference * it.unit_cost;
    else
      -- produto sem lote específico: distribui a diferença nos lotes do local (FEFO para baixas; lote mais novo para sobras)
      v_diff := it.difference;
      if v_diff < 0 then
        v_left := -v_diff;
        for r in select si.lot_id, si.quantity from public.stock_items si join public.stock_lots l on l.id = si.lot_id
                 where si.store_id = v_c.store_id and si.product_id = it.product_id and si.location_id = it.location_id and si.quantity > 0
                 order by l.expires_at asc nulls last, l.created_at asc loop
          exit when v_left <= 0;
          v_mov := public.ops_move_stock(v_c.store_id, it.product_id, r.lot_id, it.location_id, 'inventario', -least(v_left, r.quantity), null,
                     coalesce(nullif(it.reason, ''), 'inventário ' || v_c.number), 'inventory_count', p_count, it.notes, null, null);
          v_left := public.ops_round_qty(v_left - least(v_left, r.quantity));
        end loop;
        if v_left > 0 then
          -- teórico já era menor que o esperado (saldo negativo permitido?) — usa lote mais recente
          select lot_id into v_lot from public.stock_items where store_id = v_c.store_id and product_id = it.product_id and location_id = it.location_id order by updated_at desc limit 1;
          if v_lot is not null then
            v_mov := public.ops_move_stock(v_c.store_id, it.product_id, v_lot, it.location_id, 'inventario', -v_left, null, 'inventário ' || v_c.number, 'inventory_count', p_count, it.notes, null, null);
          end if;
        end if;
      else
        select lot_id into v_lot from public.stock_items si join public.stock_lots l on l.id = si.lot_id
         where si.store_id = v_c.store_id and si.product_id = it.product_id and si.location_id = it.location_id and l.status <> 'bloqueado'
         order by si.quantity desc, l.created_at desc limit 1;
        if v_lot is null then
          select id into v_lot from public.stock_lots where store_id = v_c.store_id and product_id = it.product_id and status <> 'bloqueado' order by created_at desc limit 1;
        end if;
        if v_lot is null then
          insert into public.stock_lots (company_id, store_id, product_id, lot_code, origin, received_at, unit_cost, initial_quantity, notes, created_by)
          values (v_c.company_id, v_c.store_id, it.product_id, public.ops_generate_lot_code(v_c.store_id, 'I'), 'ajuste', now(), it.unit_cost, v_diff, 'Criado no inventário ' || v_c.number, auth.uid())
          returning id into v_lot;
        end if;
        v_mov := public.ops_move_stock(v_c.store_id, it.product_id, v_lot, it.location_id, 'inventario', v_diff, null,
                   coalesce(nullif(it.reason, ''), 'inventário ' || v_c.number), 'inventory_count', p_count, it.notes, null, null);
      end if;
      update public.inventory_items set movement_id = v_mov where id = it.id;
      v_n := v_n + 1; v_value := v_value + it.difference * it.unit_cost;
    end if;
  end loop;

  update public.inventory_counts set status = 'finalizada', finished_by = auth.uid(), finished_at = now(),
    differences = v_n, difference_value = round(v_value, 4),
    notes = case when coalesce(p_notes, '') <> '' then notes || case when notes <> '' then E'\n' else '' end || p_notes else notes end
  where id = p_count;
  perform public.ops_internal_off();
  perform public.ops_audit(v_c.company_id, v_c.store_id, 'finalizou_inventario', 'inventory_counts', p_count, v_c.number, null,
    jsonb_build_object('adjustments', v_n, 'difference_value', round(v_value, 4)), coalesce(p_notes, ''));
  return jsonb_build_object('ok', true, 'adjustments', v_n, 'difference_value', round(v_value, 4));
end;
$fn$;

create or replace function public.ops_count_cancel(p_count uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $fn$
declare v_c record;
begin
  select * into v_c from public.inventory_counts where id = p_count;
  if v_c.id is null then raise exception 'Contagem não encontrada.'; end if;
  perform public.ops_require(v_c.store_id, 'inventario.contar');
  if v_c.status <> 'aberta' then raise exception 'Contagem já %.', v_c.status; end if;
  perform public.ops_internal_on();
  update public.inventory_counts set status = 'cancelada', notes = case when p_reason <> '' then notes || E'\nCancelada: ' || p_reason else notes end where id = p_count;
  perform public.ops_internal_off();
end;
$fn$;

alter table public.inventory_counts enable row level security;
alter table public.inventory_items  enable row level security;

drop policy if exists inventory_counts_select on public.inventory_counts;
create policy inventory_counts_select on public.inventory_counts for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('inventario.ver'))
      or store_id in (select public.ops_store_ids_with_permission('inventario.contar')));
drop policy if exists inventory_counts_update on public.inventory_counts;
create policy inventory_counts_update on public.inventory_counts for update to authenticated
  using (status = 'aberta' and store_id in (select public.ops_store_ids_with_permission('inventario.contar')))
  with check (store_id in (select public.ops_store_ids_with_permission('inventario.contar')));

drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items for select to authenticated
  using (count_id in (select id from public.inventory_counts where store_id in (select public.ops_store_ids_with_permission('inventario.ver'))
                                                                or store_id in (select public.ops_store_ids_with_permission('inventario.contar'))));
drop policy if exists inventory_items_update on public.inventory_items;
create policy inventory_items_update on public.inventory_items for update to authenticated
  using (count_id in (select id from public.inventory_counts where status = 'aberta' and store_id in (select public.ops_store_ids_with_permission('inventario.contar'))))
  with check (count_id in (select id from public.inventory_counts where status = 'aberta' and store_id in (select public.ops_store_ids_with_permission('inventario.contar'))));
drop policy if exists inventory_items_delete on public.inventory_items;
create policy inventory_items_delete on public.inventory_items for delete to authenticated
  using (count_id in (select id from public.inventory_counts where status = 'aberta' and store_id in (select public.ops_store_ids_with_permission('inventario.contar'))));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
