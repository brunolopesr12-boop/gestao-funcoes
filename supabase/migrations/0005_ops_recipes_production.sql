-- =====================================================================
--  0005 · FICHAS TÉCNICAS e PRODUÇÃO
-- =====================================================================

create table if not exists public.recipes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,  -- o que a ficha produz
  name              text not null,
  version           integer not null default 1,
  yield_quantity    numeric(18,4) not null default 1 check (yield_quantity > 0),   -- rendimento (na unidade de estoque do produto)
  portion_quantity  numeric(18,4),                                                 -- tamanho de 1 porção (mesma unidade)
  prep_time_min     integer,
  shelf_life_days   integer,                                                       -- validade após produção (sobrepõe o produto)
  instructions      text not null default '',
  notes             text not null default '',
  active            boolean not null default true,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists recipes_company_idx on public.recipes(company_id);
create index if not exists recipes_product_idx on public.recipes(product_id);
do $$ begin perform public.ops_ensure_updated_at('recipes'); perform public.ops_ensure_audit('recipes'); end $$;

create table if not exists public.recipe_items (
  id                    uuid primary key default gen_random_uuid(),
  recipe_id             uuid not null references public.recipes(id) on delete cascade,
  ingredient_product_id uuid not null references public.products(id) on delete restrict,
  gross_quantity        numeric(18,4) not null check (gross_quantity > 0),   -- peso bruto (na unidade informada)
  unit_id               uuid references public.units(id) on delete set null,
  net_quantity          numeric(18,4),                                       -- peso líquido (mesma unidade)
  notes                 text not null default '',
  position              integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists recipe_items_recipe_idx on public.recipe_items(recipe_id);
create index if not exists recipe_items_ingredient_idx on public.recipe_items(ingredient_product_id);
do $$ begin perform public.ops_ensure_updated_at('recipe_items'); end $$;

-- ---------------------------------------------------------------------
-- Custo e rendimento da ficha
-- ---------------------------------------------------------------------
create or replace function public.ops_recipe_cost(p_recipe uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_r record; it record; v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_qty_stock numeric; v_cost numeric;
        v_gross_total numeric := 0; v_net_total numeric := 0; v_same_kind boolean := true; v_yield_kind text; v_yield_base numeric;
        v_line numeric; v_kind text; v_base numeric; v_gross_base numeric; v_net_base numeric;
begin
  select r.*, p.stock_unit_id, u.kind as unit_kind, u.base_factor as unit_base, u.code as unit_code, p.company_id as pc
    into v_r from public.recipes r join public.products p on p.id = r.product_id join public.units u on u.id = p.stock_unit_id where r.id = p_recipe;
  if v_r.id is null then return null; end if;
  if not public.ops_has_company_permission(v_r.company_id, 'fichas.ver') then
    raise exception 'Sem permissão para ver fichas técnicas.' using errcode = '42501';
  end if;
  v_yield_kind := v_r.unit_kind; v_yield_base := v_r.unit_base;

  for it in select ri.*, p.name, p.cost, p.stock_unit_id as ing_unit, su.code as ing_unit_code, u.code as unit_code, u.kind as u_kind, u.base_factor as u_base
            from public.recipe_items ri join public.products p on p.id = ri.ingredient_product_id
            join public.units su on su.id = p.stock_unit_id
            left join public.units u on u.id = ri.unit_id
            where ri.recipe_id = p_recipe order by ri.position loop
    v_qty_stock := public.ops_convert_qty(it.ingredient_product_id, it.gross_quantity, it.unit_id);
    v_line := round(v_qty_stock * coalesce(it.cost, 0), 4);
    v_total := v_total + v_line;
    -- soma bruto/líquido na base do tipo do rendimento, quando compatível
    v_kind := coalesce(it.u_kind, (select kind from public.units where id = it.ing_unit));
    v_base := coalesce(it.u_base, (select base_factor from public.units where id = it.ing_unit));
    if v_kind = v_yield_kind and v_base is not null and v_yield_base is not null then
      v_gross_base := it.gross_quantity * v_base;
      v_net_base := coalesce(it.net_quantity, it.gross_quantity) * v_base;
      v_gross_total := v_gross_total + v_gross_base;
      v_net_total := v_net_total + v_net_base;
    else
      v_same_kind := false;
    end if;
    v_items := v_items || jsonb_build_object(
      'id', it.id, 'product_id', it.ingredient_product_id, 'name', it.name,
      'gross_quantity', it.gross_quantity, 'net_quantity', it.net_quantity, 'unit', coalesce(it.unit_code, it.ing_unit_code),
      'quantity_stock', v_qty_stock, 'stock_unit', it.ing_unit_code, 'unit_cost', it.cost, 'total_cost', v_line,
      'loss_pct', case when it.net_quantity is not null and it.gross_quantity > 0 then round((it.gross_quantity - it.net_quantity) / it.gross_quantity * 100, 2) else 0 end,
      'correction_factor', case when it.net_quantity is not null and it.net_quantity > 0 then round(it.gross_quantity / it.net_quantity, 4) else 1 end);
  end loop;

  return jsonb_build_object(
    'recipe_id', p_recipe, 'yield_quantity', v_r.yield_quantity, 'yield_unit', v_r.unit_code,
    'portion_quantity', v_r.portion_quantity,
    'portions', case when v_r.portion_quantity > 0 then round(v_r.yield_quantity / v_r.portion_quantity, 2) end,
    'total_cost', round(v_total, 4),
    'cost_per_unit', case when v_r.yield_quantity > 0 then round(v_total / v_r.yield_quantity, 4) end,
    'cost_per_portion', case when v_r.portion_quantity > 0 then round(v_total / (v_r.yield_quantity / v_r.portion_quantity), 4) end,
    'gross_total', case when v_same_kind and v_yield_base > 0 then round(v_gross_total / v_yield_base, 4) end,
    'net_total', case when v_same_kind and v_yield_base > 0 then round(v_net_total / v_yield_base, 4) end,
    'yield_factor', case when v_same_kind and v_gross_total > 0 then round((v_r.yield_quantity * v_yield_base) / v_gross_total, 4) end,
    'loss_pct', case when v_same_kind and v_gross_total > 0 then round((1 - (v_r.yield_quantity * v_yield_base) / v_gross_total) * 100, 2) end,
    'items', v_items);
end;
$fn$;

-- ---------------------------------------------------------------------
-- PRODUÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.productions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  store_id          uuid not null references public.stores(id) on delete cascade,
  recipe_id         uuid references public.recipes(id) on delete set null,
  product_id        uuid not null references public.products(id) on delete restrict,
  number            text not null default '',
  status            text not null default 'planejada' check (status in ('planejada','em_andamento','concluida','cancelada')),
  planned_quantity  numeric(18,4) not null check (planned_quantity > 0),
  produced_quantity numeric(18,4),
  expected_yield    numeric(18,4),
  actual_yield_pct  numeric(8,2),
  lot_id            uuid references public.stock_lots(id) on delete set null,
  lot_code          text not null default '',
  expires_at        date,
  location_id       uuid references public.stock_locations(id) on delete set null,
  scheduled_for     date,
  started_at        timestamptz,
  finished_at       timestamptz,
  produced_by       uuid,
  produced_by_name  text not null default '',
  notes             text not null default '',
  total_cost        numeric(14,4) not null default 0,
  unit_cost         numeric(14,4) not null default 0,
  client_op_id      uuid,
  created_by        uuid,
  created_by_name   text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists productions_store_idx on public.productions(store_id, created_at desc);
create index if not exists productions_status_idx on public.productions(store_id, status);
create index if not exists productions_product_idx on public.productions(product_id, created_at desc);
create unique index if not exists productions_client_op_uidx on public.productions(client_op_id) where client_op_id is not null;
do $$ begin perform public.ops_ensure_updated_at('productions'); perform public.ops_ensure_guard_status('productions'); perform public.ops_ensure_audit('productions'); end $$;

create table if not exists public.production_items (
  id                uuid primary key default gen_random_uuid(),
  production_id     uuid not null references public.productions(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  lot_id            uuid references public.stock_lots(id) on delete set null,
  location_id       uuid references public.stock_locations(id) on delete set null,
  planned_quantity  numeric(18,4) not null default 0,
  consumed_quantity numeric(18,4) not null default 0,
  unit_cost         numeric(14,4) not null default 0,
  total_cost        numeric(14,4) not null default 0,
  movement_id       uuid references public.stock_movements(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists production_items_production_idx on public.production_items(production_id);
create index if not exists production_items_product_idx on public.production_items(product_id);

create or replace function public.ops_production_next_number(p_store uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'PR-' || to_char(now(), 'YYMM') || '-' || lpad((count(*) + 1)::text, 4, '0')
  from public.productions where store_id = p_store and date_trunc('month', created_at) = date_trunc('month', now())
$$;

create or replace function public.ops_production_before_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.number = '' then new.number := public.ops_production_next_number(new.store_id); end if;
  if new.company_id is null then new.company_id := public.ops_store_company(new.store_id); end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_by_name := coalesce(nullif(new.created_by_name, ''), public.ops_user_name());
  return new;
end;
$fn$;
drop trigger if exists trg_productions_before_insert on public.productions;
create trigger trg_productions_before_insert before insert on public.productions
  for each row execute function public.ops_production_before_insert();

-- ---------------------------------------------------------------------
-- Plano de produção: ingredientes escalados + disponibilidade + FEFO
-- ---------------------------------------------------------------------
create or replace function public.ops_production_plan(p_store uuid, p_recipe uuid, p_planned numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_r record; it record; v_scale numeric; v_needed numeric; v_avail numeric; v_items jsonb := '[]'::jsonb; v_lots jsonb;
        v_cost numeric := 0; v_short boolean := false;
begin
  perform public.ops_require(p_store, 'producao.ver');
  select r.*, p.name as product_name, u.code as unit_code, p.shelf_life_days as p_shelf into v_r
    from public.recipes r join public.products p on p.id = r.product_id join public.units u on u.id = p.stock_unit_id where r.id = p_recipe;
  if v_r.id is null then raise exception 'Ficha técnica não encontrada.'; end if;
  v_scale := coalesce(p_planned, v_r.yield_quantity) / v_r.yield_quantity;

  for it in select ri.*, p.name, p.cost, su.code as stock_unit
            from public.recipe_items ri join public.products p on p.id = ri.ingredient_product_id join public.units su on su.id = p.stock_unit_id
            where ri.recipe_id = p_recipe order by ri.position loop
    v_needed := public.ops_round_qty(public.ops_convert_qty(it.ingredient_product_id, it.gross_quantity, it.unit_id) * v_scale);
    select coalesce(sum(si.quantity), 0) into v_avail from public.stock_items si join public.stock_lots l on l.id = si.lot_id
      where si.store_id = p_store and si.product_id = it.ingredient_product_id and si.quantity > 0 and l.status = 'ativo';
    select coalesce(jsonb_agg(jsonb_build_object('lot_id', f.lot_id, 'location_id', f.location_id, 'lot_code', f.lot_code, 'expires_at', f.expires_at,
             'unit_cost', f.unit_cost, 'available', f.available, 'quantity', f.quantity)), '[]'::jsonb)
      into v_lots from public.ops_pick_fefo(p_store, it.ingredient_product_id, v_needed, null) f;
    if v_avail < v_needed then v_short := true; end if;
    v_cost := v_cost + v_needed * coalesce(it.cost, 0);
    v_items := v_items || jsonb_build_object('product_id', it.ingredient_product_id, 'name', it.name, 'stock_unit', it.stock_unit,
      'needed', v_needed, 'available', v_avail, 'shortage', greatest(v_needed - v_avail, 0), 'unit_cost', it.cost,
      'estimated_cost', round(v_needed * coalesce(it.cost, 0), 4), 'lots', v_lots);
  end loop;

  return jsonb_build_object('recipe_id', p_recipe, 'product_id', v_r.product_id, 'product_name', v_r.product_name, 'unit', v_r.unit_code,
    'planned', coalesce(p_planned, v_r.yield_quantity), 'scale', round(v_scale, 4), 'items', v_items, 'has_shortage', v_short,
    'estimated_cost', round(v_cost, 4),
    'estimated_unit_cost', case when coalesce(p_planned, v_r.yield_quantity) > 0 then round(v_cost / coalesce(p_planned, v_r.yield_quantity), 4) end,
    'shelf_life_days', coalesce(v_r.shelf_life_days, v_r.p_shelf),
    'suggested_expires_at', case when coalesce(v_r.shelf_life_days, v_r.p_shelf) is not null then current_date + coalesce(v_r.shelf_life_days, v_r.p_shelf) end);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Criar produção planejada / iniciar / cancelar
-- ---------------------------------------------------------------------
create or replace function public.ops_production_create(
  p_store uuid, p_recipe uuid, p_planned numeric, p_notes text default '', p_scheduled_for date default null, p_location uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_r record; v_id uuid;
begin
  perform public.ops_require(p_store, 'producao.criar');
  select * into v_r from public.recipes where id = p_recipe and active;
  if v_r.id is null then raise exception 'Ficha técnica não encontrada ou inativa.'; end if;
  if v_r.company_id <> public.ops_store_company(p_store) then raise exception 'Ficha de outra empresa.'; end if;
  insert into public.productions (company_id, store_id, recipe_id, product_id, status, planned_quantity, expected_yield, scheduled_for, location_id, notes)
  values (v_r.company_id, p_store, p_recipe, v_r.product_id, 'planejada', p_planned, p_planned, p_scheduled_for, p_location, coalesce(p_notes, ''))
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.ops_production_start(p_production uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_p record;
begin
  select * into v_p from public.productions where id = p_production;
  if v_p.id is null then raise exception 'Produção não encontrada.'; end if;
  perform public.ops_require(v_p.store_id, 'producao.criar');
  if v_p.status <> 'planejada' then raise exception 'Só uma produção planejada pode ser iniciada.'; end if;
  perform public.ops_internal_on();
  update public.productions set status = 'em_andamento', started_at = now(), produced_by = auth.uid(), produced_by_name = public.ops_user_name() where id = p_production;
  perform public.ops_internal_off();
end;
$fn$;

create or replace function public.ops_production_cancel(p_production uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $fn$
declare v_p record;
begin
  select * into v_p from public.productions where id = p_production;
  if v_p.id is null then raise exception 'Produção não encontrada.'; end if;
  perform public.ops_require(v_p.store_id, 'producao.criar');
  if v_p.status not in ('planejada','em_andamento') then raise exception 'Produção já %.', v_p.status; end if;
  perform public.ops_internal_on();
  update public.productions set status = 'cancelada', notes = case when p_reason <> '' then notes || E'\nCancelada: ' || p_reason else notes end where id = p_production;
  perform public.ops_internal_off();
end;
$fn$;

-- ---------------------------------------------------------------------
-- CONCLUIR PRODUÇÃO: baixa ingredientes, cria lote do produto, custo
--   p_items: [{product_id, lot_id?, location_id?, quantity}] em unidade de estoque
--            (null = escala a ficha pela quantidade planejada e usa FEFO)
-- ---------------------------------------------------------------------
create or replace function public.ops_production_finish(
  p_production uuid, p_produced numeric, p_location uuid default null,
  p_lot_code text default '', p_expires_at date default null, p_items jsonb default null,
  p_notes text default '', p_client_op_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_p record; v_r record; it record; v_loc uuid; v_scale numeric; v_needed numeric; v_total numeric := 0;
  v_lot uuid; v_code text; v_exp date; v_unit_cost numeric; v_mov uuid; r record; v_left numeric; v_items jsonb; v_consumed jsonb := '[]'::jsonb;
  v_item_loc uuid; v_lot_cost numeric; v_shelf int; v_produced numeric;
begin
  select * into v_p from public.productions where id = p_production;
  if v_p.id is null then raise exception 'Produção não encontrada.'; end if;
  perform public.ops_require(v_p.store_id, 'producao.finalizar');
  if v_p.status = 'concluida' then
    return jsonb_build_object('ok', true, 'duplicated', true, 'production_id', p_production, 'lot_id', v_p.lot_id);
  end if;
  if v_p.status = 'cancelada' then raise exception 'Produção cancelada.'; end if;
  v_produced := public.ops_round_qty(p_produced);
  if v_produced <= 0 then raise exception 'Informe a quantidade produzida.'; end if;

  select rc.*, p.shelf_life_days as p_shelf into v_r from public.recipes rc join public.products p on p.id = rc.product_id where rc.id = v_p.recipe_id;

  v_loc := coalesce(p_location, v_p.location_id);
  if v_loc is null then
    select coalesce(pss.default_location_id, null) into v_loc from public.product_store_settings pss where pss.product_id = v_p.product_id and pss.store_id = v_p.store_id;
  end if;
  if v_loc is null then
    select id into v_loc from public.stock_locations where store_id = v_p.store_id and active order by position limit 1;
  end if;
  if v_loc is null then raise exception 'Cadastre ao menos um local de estoque na unidade.'; end if;

  -- itens a consumir
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    if v_r.id is null then raise exception 'Produção sem ficha técnica: informe os ingredientes consumidos.'; end if;
    v_scale := v_p.planned_quantity / v_r.yield_quantity;
    v_items := '[]'::jsonb;
    for it in select ri.* from public.recipe_items ri where ri.recipe_id = v_r.id order by ri.position loop
      v_needed := public.ops_round_qty(public.ops_convert_qty(it.ingredient_product_id, it.gross_quantity, it.unit_id) * v_scale);
      v_items := v_items || jsonb_build_object('product_id', it.ingredient_product_id, 'quantity', v_needed);
    end loop;
  else
    v_items := p_items;
  end if;

  perform public.ops_internal_on();
  -- consome cada item (lote informado ou FEFO)
  for it in select (e ->> 'product_id')::uuid as product_id, nullif(e ->> 'lot_id', '')::uuid as lot_id,
                   nullif(e ->> 'location_id', '')::uuid as location_id, public.ops_round_qty((e ->> 'quantity')::numeric) as quantity
            from jsonb_array_elements(v_items) e loop
    if it.quantity <= 0 then continue; end if;
    if it.lot_id is not null then
      v_item_loc := it.location_id;
      if v_item_loc is null then
        select location_id into v_item_loc from public.stock_items where lot_id = it.lot_id and quantity > 0 order by quantity desc limit 1;
      end if;
      if v_item_loc is null then v_item_loc := v_loc; end if;
      select unit_cost into v_lot_cost from public.stock_lots where id = it.lot_id;
      v_mov := public.ops_move_stock(v_p.store_id, it.product_id, it.lot_id, v_item_loc, 'producao_consumo', -it.quantity, null,
                 'produção ' || v_p.number, 'production', p_production, '', null, null);
      insert into public.production_items (production_id, product_id, lot_id, location_id, planned_quantity, consumed_quantity, unit_cost, total_cost, movement_id)
      values (p_production, it.product_id, it.lot_id, v_item_loc, it.quantity, it.quantity, coalesce(v_lot_cost, 0), round(it.quantity * coalesce(v_lot_cost, 0), 4), v_mov);
      v_total := v_total + it.quantity * coalesce(v_lot_cost, 0);
      v_consumed := v_consumed || jsonb_build_object('product_id', it.product_id, 'lot_id', it.lot_id, 'quantity', it.quantity);
    else
      v_left := it.quantity;
      for r in select * from public.ops_pick_fefo(v_p.store_id, it.product_id, it.quantity, it.location_id) loop
        v_mov := public.ops_move_stock(v_p.store_id, it.product_id, r.lot_id, r.location_id, 'producao_consumo', -r.quantity, null,
                   'produção ' || v_p.number, 'production', p_production, '', null, null);
        insert into public.production_items (production_id, product_id, lot_id, location_id, planned_quantity, consumed_quantity, unit_cost, total_cost, movement_id)
        values (p_production, it.product_id, r.lot_id, r.location_id, r.quantity, r.quantity, coalesce(r.unit_cost, 0), round(r.quantity * coalesce(r.unit_cost, 0), 4), v_mov);
        v_total := v_total + r.quantity * coalesce(r.unit_cost, 0);
        v_consumed := v_consumed || jsonb_build_object('product_id', it.product_id, 'lot_id', r.lot_id, 'quantity', r.quantity);
        v_left := public.ops_round_qty(v_left - r.quantity);
      end loop;
      if v_left > 0 then
        raise exception 'Estoque insuficiente de % (faltam %). Registre a entrada ou ajuste o consumo.',
          (select name from public.products where id = it.product_id), v_left using errcode = 'P0002';
      end if;
    end if;
  end loop;

  -- lote do produto produzido
  v_shelf := coalesce(v_r.shelf_life_days, v_r.p_shelf, (select shelf_life_days from public.products where id = v_p.product_id));
  v_exp := coalesce(p_expires_at, case when v_shelf is not null then current_date + v_shelf end);
  v_code := coalesce(nullif(trim(p_lot_code), ''), nullif(v_p.lot_code, ''), public.ops_generate_lot_code(v_p.store_id, 'P'));
  v_unit_cost := case when v_produced > 0 then round(v_total / v_produced, 4) else 0 end;

  insert into public.stock_lots (company_id, store_id, product_id, lot_code, origin, production_id, produced_at, expires_at, original_expires_at,
    unit_cost, initial_quantity, notes, created_by)
  values (v_p.company_id, v_p.store_id, v_p.product_id, v_code, 'producao', p_production, now(), v_exp, v_exp, v_unit_cost, v_produced, coalesce(p_notes, ''), auth.uid())
  returning id into v_lot;

  perform public.ops_move_stock(v_p.store_id, v_p.product_id, v_lot, v_loc, 'producao_entrada', v_produced, v_unit_cost,
    'produção ' || v_p.number, 'production', p_production, coalesce(p_notes, ''), p_client_op_id, null);
  perform public.ops_update_product_cost(v_p.product_id, v_p.store_id, v_produced, v_unit_cost);

  update public.productions set
    status = 'concluida', produced_quantity = v_produced,
    actual_yield_pct = round(v_produced / v_p.planned_quantity * 100, 2),
    lot_id = v_lot, lot_code = v_code, expires_at = v_exp, location_id = v_loc,
    started_at = coalesce(started_at, now()), finished_at = now(),
    produced_by = coalesce(produced_by, auth.uid()), produced_by_name = coalesce(nullif(produced_by_name, ''), public.ops_user_name()),
    notes = case when coalesce(p_notes, '') <> '' then notes || case when notes <> '' then E'\n' else '' end || p_notes else notes end,
    total_cost = round(v_total, 4), unit_cost = v_unit_cost, client_op_id = coalesce(client_op_id, p_client_op_id)
  where id = p_production;
  perform public.ops_internal_off();

  -- resolve alerta de produção pendente, se houver
  update public.alerts set status = 'resolvido', resolved_at = now() where entity_type = 'production' and entity_id = p_production and status <> 'resolvido';

  perform public.ops_audit(v_p.company_id, v_p.store_id, 'concluiu_producao', 'productions', p_production, v_p.number, null,
    jsonb_build_object('planned', v_p.planned_quantity, 'produced', v_produced, 'lot_id', v_lot, 'lot_code', v_code, 'expires_at', v_exp,
                       'total_cost', round(v_total, 4), 'unit_cost', v_unit_cost, 'consumed', v_consumed));
  return jsonb_build_object('ok', true, 'production_id', p_production, 'lot_id', v_lot, 'lot_code', v_code, 'expires_at', v_exp,
    'produced', v_produced, 'total_cost', round(v_total, 4), 'unit_cost', v_unit_cost, 'consumed', v_consumed);
end;
$fn$;

-- Cria e conclui em um passo (fluxo rápido do celular)
create or replace function public.ops_produce_now(
  p_store uuid, p_recipe uuid, p_planned numeric, p_produced numeric,
  p_location uuid default null, p_lot_code text default '', p_expires_at date default null,
  p_items jsonb default null, p_notes text default '', p_client_op_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if p_client_op_id is not null then
    select id into v_id from public.productions where client_op_id = p_client_op_id;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'duplicated', true, 'production_id', v_id, 'lot_id', (select lot_id from public.productions where id = v_id));
    end if;
  end if;
  perform public.ops_require(p_store, 'producao.finalizar');
  v_id := public.ops_production_create(p_store, p_recipe, p_planned, '', current_date, p_location);
  return public.ops_production_finish(v_id, p_produced, p_location, p_lot_code, p_expires_at, p_items, p_notes, p_client_op_id);
end;
$fn$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.recipes          enable row level security;
alter table public.recipe_items     enable row level security;
alter table public.productions      enable row level security;
alter table public.production_items enable row level security;

drop policy if exists recipes_select on public.recipes;
create policy recipes_select on public.recipes for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('fichas.ver'))
      or company_id in (select public.ops_company_ids_with_permission('producao.ver')));
drop policy if exists recipes_write on public.recipes;
create policy recipes_write on public.recipes for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('fichas.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('fichas.editar')));

drop policy if exists recipe_items_select on public.recipe_items;
create policy recipe_items_select on public.recipe_items for select to authenticated
  using (recipe_id in (select id from public.recipes where company_id in (select public.ops_company_ids_with_permission('fichas.ver'))
                                                      or company_id in (select public.ops_company_ids_with_permission('producao.ver'))));
drop policy if exists recipe_items_write on public.recipe_items;
create policy recipe_items_write on public.recipe_items for all to authenticated
  using (recipe_id in (select id from public.recipes where company_id in (select public.ops_company_ids_with_permission('fichas.editar'))))
  with check (recipe_id in (select id from public.recipes where company_id in (select public.ops_company_ids_with_permission('fichas.editar'))));

drop policy if exists productions_select on public.productions;
create policy productions_select on public.productions for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('producao.ver')));
drop policy if exists productions_update on public.productions;
create policy productions_update on public.productions for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('producao.criar')) and status in ('planejada','em_andamento'))
  with check (store_id in (select public.ops_store_ids_with_permission('producao.criar')));
-- insert só pela função ops_production_create

drop policy if exists production_items_select on public.production_items;
create policy production_items_select on public.production_items for select to authenticated
  using (production_id in (select id from public.productions where store_id in (select public.ops_store_ids_with_permission('producao.ver'))));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

-- Duplicar ficha como nova versão (atômico): copia cabeçalho e ingredientes
create or replace function public.ops_recipe_duplicate(p_recipe uuid, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_r record; v_new uuid; v_version int;
begin
  select * into v_r from public.recipes where id = p_recipe;
  if v_r.id is null then raise exception 'Ficha técnica não encontrada.'; end if;
  perform public.ops_require_company(v_r.company_id, 'fichas.editar');
  select coalesce(max(version), 0) + 1 into v_version from public.recipes where product_id = v_r.product_id;
  insert into public.recipes (company_id, product_id, name, version, yield_quantity, portion_quantity, prep_time_min, shelf_life_days, instructions, notes, active, created_by)
  values (v_r.company_id, v_r.product_id, coalesce(nullif(trim(p_name), ''), v_r.name), v_version, v_r.yield_quantity, v_r.portion_quantity, v_r.prep_time_min,
          v_r.shelf_life_days, v_r.instructions, v_r.notes, true, auth.uid())
  returning id into v_new;
  insert into public.recipe_items (recipe_id, ingredient_product_id, gross_quantity, unit_id, net_quantity, notes, position)
  select v_new, ingredient_product_id, gross_quantity, unit_id, net_quantity, notes, position from public.recipe_items where recipe_id = p_recipe order by position;
  perform public.ops_audit(v_r.company_id, null, 'duplicou_ficha', 'recipes', v_new, v_r.name, null, jsonb_build_object('from', p_recipe, 'version', v_version));
  return jsonb_build_object('id', v_new, 'version', v_version);
end;
$fn$;
