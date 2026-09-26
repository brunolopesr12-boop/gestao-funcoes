-- =====================================================================
--  0003 · ESTOQUE: lotes, saldos, movimentações (imutáveis), FEFO,
--         consumo, perdas, ajustes, transferências, eventos de lote
-- =====================================================================

-- ---------------------------------------------------------------------
-- LOTES
-- ---------------------------------------------------------------------
create table if not exists public.stock_lots (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  store_id         uuid not null references public.stores(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete restrict,
  lot_code         text not null default '',
  origin           text not null default 'recebimento'
                     check (origin in ('recebimento','producao','ajuste','transferencia','inicial','devolucao')),
  supplier_id      uuid references public.suppliers(id) on delete set null,
  receipt_id       uuid,
  production_id    uuid,
  origin_lot_id    uuid references public.stock_lots(id) on delete set null,
  produced_at      timestamptz,
  received_at      timestamptz,
  opened_at        timestamptz,
  frozen_at        timestamptz,
  thawed_at        timestamptz,
  expires_at       date,
  original_expires_at date,
  unit_cost        numeric(14,4) not null default 0,
  initial_quantity numeric(18,4) not null default 0,
  status           text not null default 'ativo' check (status in ('ativo','esgotado','bloqueado','vencido')),
  notes            text not null default '',
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists stock_lots_store_product_idx on public.stock_lots(store_id, product_id);
create index if not exists stock_lots_store_expires_idx on public.stock_lots(store_id, expires_at) where status in ('ativo','vencido');
create index if not exists stock_lots_product_idx on public.stock_lots(product_id);
create index if not exists stock_lots_code_idx on public.stock_lots(store_id, lot_code);
create index if not exists stock_lots_receipt_idx on public.stock_lots(receipt_id);
create index if not exists stock_lots_production_idx on public.stock_lots(production_id);
do $$ begin perform public.ops_ensure_updated_at('stock_lots'); end $$;

-- ---------------------------------------------------------------------
-- SALDOS (cache consistente; escrito SÓ pelas funções)
-- ---------------------------------------------------------------------
create table if not exists public.stock_items (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  product_id  uuid not null references public.products(id) on delete restrict,
  lot_id      uuid not null references public.stock_lots(id) on delete restrict,
  quantity    numeric(18,4) not null default 0,
  updated_at  timestamptz not null default now(),
  unique (store_id, location_id, product_id, lot_id)
);
create index if not exists stock_items_store_product_idx on public.stock_items(store_id, product_id) where quantity <> 0;
create index if not exists stock_items_lot_idx on public.stock_items(lot_id);
create index if not exists stock_items_location_idx on public.stock_items(location_id) where quantity <> 0;

-- ---------------------------------------------------------------------
-- MOVIMENTAÇÕES (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  lot_id          uuid not null references public.stock_lots(id) on delete restrict,
  location_id     uuid not null references public.stock_locations(id) on delete restrict,
  movement_type   text not null check (movement_type in
                    ('entrada','saida','producao_consumo','producao_entrada','consumo','transferencia',
                     'perda','ajuste','devolucao','inventario','inicial')),
  quantity        numeric(18,4) not null,          -- positivo = entra, negativo = sai (na unidade de estoque)
  unit_cost       numeric(14,4) not null default 0,
  total_cost      numeric(14,4) not null default 0,
  balance_after   numeric(18,4) not null default 0, -- saldo do lote no local após o movimento
  reason          text not null default '',
  reference_type  text,                             -- receipt | production | inventory_count | loss | transfer | label | ...
  reference_id    uuid,
  notes           text not null default '',
  created_by      uuid,
  created_by_name text not null default '',
  client_op_id    uuid,                             -- idempotência (fila offline)
  created_at      timestamptz not null default now()
);
create index if not exists stock_movements_store_created_idx on public.stock_movements(store_id, created_at desc);
create index if not exists stock_movements_product_created_idx on public.stock_movements(product_id, created_at desc);
create index if not exists stock_movements_lot_idx on public.stock_movements(lot_id, created_at desc);
create index if not exists stock_movements_type_idx on public.stock_movements(store_id, movement_type, created_at desc);
create index if not exists stock_movements_reference_idx on public.stock_movements(reference_type, reference_id);
create unique index if not exists stock_movements_client_op_uidx on public.stock_movements(client_op_id) where client_op_id is not null;
do $$ begin perform public.ops_ensure_immutable('stock_movements'); end $$;

-- ---------------------------------------------------------------------
-- PERDAS
-- ---------------------------------------------------------------------
create table if not exists public.loss_reasons (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  code           text not null,
  name           text not null,
  requires_photo boolean not null default false,
  active         boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.losses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  lot_id          uuid references public.stock_lots(id) on delete set null,
  location_id     uuid references public.stock_locations(id) on delete set null,
  quantity        numeric(18,4) not null,
  unit_cost       numeric(14,4) not null default 0,
  total_cost      numeric(14,4) not null default 0,
  loss_reason_id  uuid references public.loss_reasons(id) on delete set null,
  reason_text     text not null default '',
  notes           text not null default '',
  photo_url       text not null default '',
  movement_id     uuid references public.stock_movements(id) on delete set null,
  created_by      uuid,
  created_by_name text not null default '',
  client_op_id    uuid,
  created_at      timestamptz not null default now()
);
create index if not exists losses_store_created_idx on public.losses(store_id, created_at desc);
create index if not exists losses_product_idx on public.losses(product_id, created_at desc);
create index if not exists losses_reason_idx on public.losses(loss_reason_id);
create unique index if not exists losses_client_op_uidx on public.losses(client_op_id) where client_op_id is not null;

-- ---------------------------------------------------------------------
-- TRANSFERÊNCIAS (registro; a movimentação real fica em stock_movements)
-- ---------------------------------------------------------------------
create table if not exists public.transfers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  from_store_id    uuid not null references public.stores(id) on delete cascade,
  to_store_id      uuid not null references public.stores(id) on delete cascade,
  from_location_id uuid references public.stock_locations(id) on delete set null,
  to_location_id   uuid references public.stock_locations(id) on delete set null,
  status           text not null default 'recebido' check (status in ('enviado','recebido','cancelado')),
  notes            text not null default '',
  created_by       uuid,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists transfers_from_idx on public.transfers(from_store_id, created_at desc);
create index if not exists transfers_to_idx on public.transfers(to_store_id, created_at desc);

create table if not exists public.transfer_items (
  id             uuid primary key default gen_random_uuid(),
  transfer_id    uuid not null references public.transfers(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete restrict,
  from_lot_id    uuid references public.stock_lots(id) on delete set null,
  to_lot_id      uuid references public.stock_lots(id) on delete set null,
  quantity       numeric(18,4) not null,
  unit_cost      numeric(14,4) not null default 0,
  out_movement_id uuid references public.stock_movements(id) on delete set null,
  in_movement_id  uuid references public.stock_movements(id) on delete set null
);
create index if not exists transfer_items_transfer_idx on public.transfer_items(transfer_id);

-- =====================================================================
-- FUNÇÕES AUXILIARES
-- =====================================================================
create or replace function public.ops_round_qty(p numeric) returns numeric
language sql immutable as $$ select round(coalesce(p, 0), 4) $$;

create or replace function public.ops_generate_lot_code(p_store uuid, p_prefix text default '')
returns text language plpgsql stable security definer set search_path = public as $fn$
declare v_n int; v_prefix text := coalesce(nullif(upper(p_prefix), ''), 'L');
begin
  select count(*) + 1 into v_n from public.stock_lots
   where store_id = p_store and created_at::date = current_date;
  return v_prefix || to_char(now(), 'YYMMDD') || '-' || lpad(v_n::text, 3, '0');
end;
$fn$;

create or replace function public.ops_lot_balance(p_lot uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(quantity), 0) from public.stock_items where lot_id = p_lot
$$;

-- Marca o lote como esgotado/ativo conforme saldo; vencido conforme data
create or replace function public.ops_refresh_lot_status(p_lot uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_bal numeric; v_status text; v_exp date;
begin
  select status, expires_at into v_status, v_exp from public.stock_lots where id = p_lot;
  if v_status = 'bloqueado' then return; end if;
  v_bal := public.ops_lot_balance(p_lot);
  if v_bal <= 0.00005 then
    update public.stock_lots set status = 'esgotado' where id = p_lot and status <> 'esgotado';
  elsif v_exp is not null and v_exp < current_date then
    update public.stock_lots set status = 'vencido' where id = p_lot and status <> 'vencido';
  else
    update public.stock_lots set status = 'ativo' where id = p_lot and status <> 'ativo';
  end if;
end;
$fn$;

create or replace function public.ops_lot_is_expired(p_lot uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select expires_at < current_date from public.stock_lots where id = p_lot), false)
$$;

-- =====================================================================
-- MOVIMENTAÇÃO CENTRAL
--   Toda alteração de saldo passa aqui. Nunca é chamada diretamente pela
--   interface para tipos de produção/recebimento — as funções de negócio
--   fazem a checagem de permissão e chamam com p_require = null.
-- =====================================================================
create or replace function public.ops_move_stock(
  p_store uuid, p_product uuid, p_lot uuid, p_location uuid,
  p_type text, p_quantity numeric,
  p_unit_cost numeric default null, p_reason text default '',
  p_reference_type text default null, p_reference_id uuid default null,
  p_notes text default '', p_client_op_id uuid default null,
  p_require text default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_existing uuid; v_company uuid; v_lot record; v_loc_store uuid;
  v_bal numeric; v_new numeric; v_cost numeric; v_qty numeric; v_id uuid;
  v_allow_negative boolean; v_allow_expired boolean;
begin
  if p_client_op_id is not null then
    select id into v_existing from public.stock_movements where client_op_id = p_client_op_id;
    if v_existing is not null then return v_existing; end if;
  end if;
  if p_require is not null then
    perform public.ops_require(p_store, p_require);
  elsif auth.uid() is null and current_user not in ('postgres','service_role') then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;

  v_qty := public.ops_round_qty(p_quantity);
  if v_qty = 0 then
    raise exception 'Quantidade deve ser diferente de zero.';
  end if;

  select company_id into v_company from public.stores where id = p_store;
  if v_company is null then raise exception 'Unidade não encontrada.'; end if;

  select * into v_lot from public.stock_lots where id = p_lot;
  if v_lot.id is null then raise exception 'Lote não encontrado.'; end if;
  if v_lot.product_id <> p_product then raise exception 'O lote não pertence a este produto.'; end if;
  if v_lot.store_id <> p_store then raise exception 'O lote pertence a outra unidade.'; end if;

  select store_id into v_loc_store from public.stock_locations where id = p_location;
  if v_loc_store is null or v_loc_store <> p_store then raise exception 'Local de estoque inválido para esta unidade.'; end if;

  if v_qty < 0 then
    if v_lot.status = 'bloqueado' and p_type not in ('perda','ajuste','inventario') then
      raise exception 'Lote bloqueado: só é possível registrar perda ou ajuste.';
    end if;
    if p_type in ('consumo','producao_consumo','saida','transferencia') and v_lot.expires_at is not null and v_lot.expires_at < current_date then
      v_allow_expired := coalesce((public.ops_setting(p_store, 'estoque.permitir_consumo_vencido', 'false'::jsonb))::text::boolean, false);
      if not v_allow_expired then
        raise exception 'Lote % vencido em %: não pode ser consumido. Registre como perda.', v_lot.lot_code, to_char(v_lot.expires_at, 'DD/MM/YYYY');
      end if;
    end if;
  end if;

  -- trava o saldo do lote no local
  select quantity into v_bal from public.stock_items
   where store_id = p_store and location_id = p_location and product_id = p_product and lot_id = p_lot
   for update;
  if not found then
    insert into public.stock_items (store_id, location_id, product_id, lot_id, quantity)
    values (p_store, p_location, p_product, p_lot, 0)
    on conflict (store_id, location_id, product_id, lot_id) do nothing;
    select quantity into v_bal from public.stock_items
     where store_id = p_store and location_id = p_location and product_id = p_product and lot_id = p_lot
     for update;
  end if;
  v_new := public.ops_round_qty(v_bal + v_qty);
  if v_new < 0 then
    v_allow_negative := coalesce((public.ops_setting(p_store, 'estoque.permitir_negativo', 'false'::jsonb))::text::boolean, false);
    if not v_allow_negative then
      raise exception 'Estoque insuficiente no lote % (saldo % , pedido %).', v_lot.lot_code, v_bal, abs(v_qty)
        using errcode = 'P0002';
    end if;
  end if;

  v_cost := coalesce(p_unit_cost, nullif(v_lot.unit_cost, 0), (select cost from public.products where id = p_product), 0);

  insert into public.stock_movements (
    company_id, store_id, product_id, lot_id, location_id, movement_type, quantity,
    unit_cost, total_cost, balance_after, reason, reference_type, reference_id, notes,
    created_by, created_by_name, client_op_id)
  values (
    v_company, p_store, p_product, p_lot, p_location, p_type, v_qty,
    v_cost, round(v_cost * v_qty, 4), v_new, coalesce(p_reason, ''), p_reference_type, p_reference_id, coalesce(p_notes, ''),
    auth.uid(), public.ops_user_name(), p_client_op_id)
  returning id into v_id;

  update public.stock_items set quantity = v_new, updated_at = now()
   where store_id = p_store and location_id = p_location and product_id = p_product and lot_id = p_lot;

  perform public.ops_refresh_lot_status(p_lot);
  return v_id;
end;
$fn$;

-- =====================================================================
-- FEFO: escolhe lotes por menor validade (nulos por último), depois mais antigos
-- =====================================================================
create or replace function public.ops_pick_fefo(
  p_store uuid, p_product uuid, p_quantity numeric, p_location uuid default null
) returns table (lot_id uuid, location_id uuid, lot_code text, expires_at date, unit_cost numeric, available numeric, quantity numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare r record; v_left numeric := public.ops_round_qty(p_quantity); v_take numeric;
begin
  for r in
    select si.lot_id, si.location_id, l.lot_code, l.expires_at, l.unit_cost, si.quantity as available
    from public.stock_items si
    join public.stock_lots l on l.id = si.lot_id
    where si.store_id = p_store and si.product_id = p_product and si.quantity > 0
      and l.status in ('ativo')
      and (p_location is null or si.location_id = p_location)
    order by l.expires_at asc nulls last, coalesce(l.received_at, l.produced_at, l.created_at) asc, si.quantity desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.available);
    lot_id := r.lot_id; location_id := r.location_id; lot_code := r.lot_code; expires_at := r.expires_at;
    unit_cost := r.unit_cost; available := r.available; quantity := v_take;
    v_left := public.ops_round_qty(v_left - v_take);
    return next;
  end loop;
  return;
end;
$fn$;

-- Lote que DEVERIA sair primeiro (para avisar a UI)
create or replace function public.ops_fefo_first_lot(p_store uuid, p_product uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select si.lot_id
  from public.stock_items si join public.stock_lots l on l.id = si.lot_id
  where si.store_id = p_store and si.product_id = p_product and si.quantity > 0 and l.status = 'ativo'
  order by l.expires_at asc nulls last, coalesce(l.received_at, l.produced_at, l.created_at) asc
  limit 1
$$;

-- =====================================================================
-- CONSUMO (baixa) — por lote escolhido ou FEFO automático
-- =====================================================================
create or replace function public.ops_consume(
  p_store uuid, p_product uuid, p_quantity numeric,
  p_lot uuid default null, p_location uuid default null,
  p_reason text default 'consumo', p_notes text default '',
  p_client_op_id uuid default null, p_unit uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_qty numeric; r record; v_mov uuid; v_movs jsonb := '[]'::jsonb; v_fefo uuid; v_warn boolean := false;
  v_loc uuid; v_left numeric; v_n int := 0;
begin
  perform public.ops_require(p_store, 'estoque.movimentar');
  v_qty := public.ops_round_qty(public.ops_convert_qty(p_product, p_quantity, p_unit));
  if v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;

  if p_client_op_id is not null and exists (select 1 from public.stock_movements where client_op_id = p_client_op_id) then
    return jsonb_build_object('ok', true, 'duplicated', true);
  end if;

  v_fefo := public.ops_fefo_first_lot(p_store, p_product);

  if p_lot is not null then
    v_warn := (v_fefo is not null and v_fefo <> p_lot);
    -- local: informado ou o(s) local(is) onde o lote tem saldo
    v_left := v_qty;
    for r in
      select si.location_id, si.quantity from public.stock_items si
      where si.store_id = p_store and si.lot_id = p_lot and si.quantity > 0
        and (p_location is null or si.location_id = p_location)
      order by si.quantity desc
    loop
      exit when v_left <= 0;
      v_mov := public.ops_move_stock(p_store, p_product, p_lot, r.location_id, 'consumo', -least(v_left, r.quantity),
                 null, p_reason, 'consumo', null, p_notes, case when v_n = 0 then p_client_op_id else null end, null);
      v_movs := v_movs || jsonb_build_object('movement_id', v_mov, 'lot_id', p_lot, 'location_id', r.location_id, 'quantity', least(v_left, r.quantity));
      v_left := public.ops_round_qty(v_left - least(v_left, r.quantity));
      v_n := v_n + 1;
    end loop;
    if v_left > 0 then
      -- permite negativo se a configuração deixar; senão erro claro
      v_loc := coalesce(p_location, (select location_id from public.stock_items where lot_id = p_lot order by quantity desc limit 1),
                        (select id from public.stock_locations where store_id = p_store and active order by position limit 1));
      v_mov := public.ops_move_stock(p_store, p_product, p_lot, v_loc, 'consumo', -v_left, null, p_reason, 'consumo', null, p_notes,
                 case when v_n = 0 then p_client_op_id else null end, null);
      v_movs := v_movs || jsonb_build_object('movement_id', v_mov, 'lot_id', p_lot, 'location_id', v_loc, 'quantity', v_left);
    end if;
  else
    v_left := v_qty;
    for r in select * from public.ops_pick_fefo(p_store, p_product, v_qty, p_location) loop
      v_mov := public.ops_move_stock(p_store, p_product, r.lot_id, r.location_id, 'consumo', -r.quantity,
                 null, p_reason, 'consumo', null, p_notes, case when v_n = 0 then p_client_op_id else null end, null);
      v_movs := v_movs || jsonb_build_object('movement_id', v_mov, 'lot_id', r.lot_id, 'location_id', r.location_id, 'quantity', r.quantity);
      v_left := public.ops_round_qty(v_left - r.quantity);
      v_n := v_n + 1;
    end loop;
    if v_left > 0 then
      raise exception 'Estoque insuficiente: faltam % na unidade de estoque do produto.', v_left using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'quantity', v_qty, 'movements', v_movs, 'fefo_warning', v_warn, 'fefo_lot_id', v_fefo);
end;
$fn$;

-- =====================================================================
-- PERDA
-- =====================================================================
create or replace function public.ops_register_loss(
  p_store uuid, p_product uuid, p_quantity numeric,
  p_loss_reason uuid default null, p_lot uuid default null, p_location uuid default null,
  p_notes text default '', p_photo_url text default '', p_client_op_id uuid default null,
  p_unit uuid default null, p_reason_text text default ''
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid; v_qty numeric; v_lot uuid := p_lot; v_loc uuid := p_location; v_cost numeric; v_mov uuid; v_id uuid;
  v_reason record; r record; v_left numeric; v_total numeric := 0; v_first uuid;
begin
  perform public.ops_require(p_store, 'perdas.registrar');
  if p_client_op_id is not null then
    select id into v_id from public.losses where client_op_id = p_client_op_id;
    if v_id is not null then return v_id; end if;
  end if;
  select company_id into v_company from public.stores where id = p_store;
  v_qty := public.ops_round_qty(public.ops_convert_qty(p_product, p_quantity, p_unit));
  if v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;

  if p_loss_reason is not null then
    select * into v_reason from public.loss_reasons where id = p_loss_reason and company_id = v_company;
    if v_reason.id is null then raise exception 'Motivo de perda inválido.'; end if;
    if v_reason.requires_photo and coalesce(p_photo_url, '') = '' then
      raise exception 'Este motivo exige foto.';
    end if;
  end if;

  if v_lot is null then
    -- FEFO: perde primeiro o que vence primeiro (inclui vencidos)
    v_left := v_qty;
    for r in
      select si.lot_id, si.location_id, si.quantity, l.unit_cost
      from public.stock_items si join public.stock_lots l on l.id = si.lot_id
      where si.store_id = p_store and si.product_id = p_product and si.quantity > 0
        and (p_location is null or si.location_id = p_location)
      order by l.expires_at asc nulls last, l.created_at asc
    loop
      exit when v_left <= 0;
      v_mov := public.ops_move_stock(p_store, p_product, r.lot_id, r.location_id, 'perda', -least(v_left, r.quantity), null,
                 coalesce(v_reason.name, p_reason_text, 'perda'), 'loss', null, p_notes, null, null);
      if v_first is null then v_first := v_mov; v_lot := r.lot_id; v_loc := r.location_id; end if;
      v_total := v_total + least(v_left, r.quantity) * r.unit_cost;
      v_left := public.ops_round_qty(v_left - least(v_left, r.quantity));
    end loop;
    if v_left > 0 then
      raise exception 'Estoque insuficiente para registrar a perda (faltam %).', v_left using errcode = 'P0002';
    end if;
    v_cost := case when v_qty > 0 then v_total / v_qty else 0 end;
  else
    if v_loc is null then
      select location_id into v_loc from public.stock_items where lot_id = v_lot and quantity > 0 order by quantity desc limit 1;
      if v_loc is null then
        select location_id into v_loc from public.stock_items where lot_id = v_lot order by updated_at desc limit 1;
      end if;
      if v_loc is null then
        select id into v_loc from public.stock_locations where store_id = p_store and active order by position limit 1;
      end if;
    end if;
    select unit_cost into v_cost from public.stock_lots where id = v_lot;
    v_first := public.ops_move_stock(p_store, p_product, v_lot, v_loc, 'perda', -v_qty, null,
                 coalesce(v_reason.name, p_reason_text, 'perda'), 'loss', null, p_notes, null, null);
    v_total := v_qty * coalesce(v_cost, 0);
  end if;

  insert into public.losses (company_id, store_id, product_id, lot_id, location_id, quantity, unit_cost, total_cost,
    loss_reason_id, reason_text, notes, photo_url, movement_id, created_by, created_by_name, client_op_id)
  values (v_company, p_store, p_product, v_lot, v_loc, v_qty, coalesce(v_cost, 0), round(v_total, 4),
    p_loss_reason, coalesce(p_reason_text, ''), coalesce(p_notes, ''), coalesce(p_photo_url, ''), v_first, auth.uid(), public.ops_user_name(), p_client_op_id)
  returning id into v_id;

  -- liga o(s) movimento(s) à perda
  perform public.ops_audit(v_company, p_store, 'registrou_perda', 'losses', v_id,
    (select name from public.products where id = p_product), null,
    jsonb_build_object('quantity', v_qty, 'total_cost', round(v_total, 4), 'reason', coalesce(v_reason.name, p_reason_text)), coalesce(p_notes, ''));
  return v_id;
end;
$fn$;

-- =====================================================================
-- AJUSTE MANUAL (define o novo saldo do lote no local)
-- =====================================================================
create or replace function public.ops_adjust(
  p_store uuid, p_product uuid, p_lot uuid, p_location uuid,
  p_new_quantity numeric, p_reason text default 'ajuste', p_notes text default '',
  p_client_op_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_bal numeric; v_delta numeric;
begin
  perform public.ops_require(p_store, 'estoque.ajustar');
  select coalesce(quantity, 0) into v_bal from public.stock_items
   where store_id = p_store and product_id = p_product and lot_id = p_lot and location_id = p_location;
  v_delta := public.ops_round_qty(coalesce(p_new_quantity, 0) - coalesce(v_bal, 0));
  if v_delta = 0 then return null; end if;
  return public.ops_move_stock(p_store, p_product, p_lot, p_location, 'ajuste', v_delta, null, p_reason, 'adjustment', null, p_notes, p_client_op_id, null);
end;
$fn$;

-- =====================================================================
-- ENTRADA MANUAL / ESTOQUE INICIAL (cria lote + entrada)
-- =====================================================================
create or replace function public.ops_create_lot(
  p_store uuid, p_product uuid, p_location uuid, p_quantity numeric,
  p_lot_code text default '', p_expires_at date default null, p_unit_cost numeric default null,
  p_origin text default 'inicial', p_notes text default '', p_unit uuid default null,
  p_supplier uuid default null, p_client_op_id uuid default null, p_produced_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_lot uuid; v_qty numeric; v_cost numeric; v_code text; v_type text;
begin
  perform public.ops_require(p_store, 'estoque.ajustar');
  if p_client_op_id is not null then
    select lot_id into v_lot from public.stock_movements where client_op_id = p_client_op_id;
    if v_lot is not null then return v_lot; end if;
  end if;
  select company_id into v_company from public.stores where id = p_store;
  v_qty := public.ops_round_qty(public.ops_convert_qty(p_product, p_quantity, p_unit));
  if v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  v_cost := coalesce(p_unit_cost, (select cost from public.products where id = p_product), 0);
  v_code := coalesce(nullif(trim(p_lot_code), ''), public.ops_generate_lot_code(p_store, 'E'));
  v_type := case when p_origin = 'devolucao' then 'devolucao' when p_origin = 'inicial' then 'inicial' else 'entrada' end;

  insert into public.stock_lots (company_id, store_id, product_id, lot_code, origin, supplier_id, received_at, produced_at,
    expires_at, original_expires_at, unit_cost, initial_quantity, notes, created_by)
  values (v_company, p_store, p_product, v_code, coalesce(nullif(p_origin, ''), 'inicial'), p_supplier, now(), p_produced_at,
    p_expires_at, p_expires_at, v_cost, v_qty, coalesce(p_notes, ''), auth.uid())
  returning id into v_lot;

  perform public.ops_move_stock(p_store, p_product, v_lot, p_location, v_type, v_qty, v_cost,
    case when p_origin = 'inicial' then 'estoque inicial' else coalesce(nullif(p_origin, ''), 'entrada') end,
    'lot', v_lot, p_notes, p_client_op_id, null);
  return v_lot;
end;
$fn$;

-- =====================================================================
-- TRANSFERÊNCIA INTERNA (entre locais da mesma unidade, mesmo lote)
-- =====================================================================
create or replace function public.ops_transfer_internal(
  p_store uuid, p_product uuid, p_lot uuid, p_from_location uuid, p_to_location uuid,
  p_quantity numeric, p_notes text default '', p_client_op_id uuid default null, p_unit uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_qty numeric; v_out uuid; v_in uuid; v_t uuid; v_cost numeric;
begin
  perform public.ops_require(p_store, 'estoque.movimentar');
  if p_from_location = p_to_location then raise exception 'Origem e destino são o mesmo local.'; end if;
  if p_client_op_id is not null then
    select t.id into v_t from public.transfers t join public.transfer_items ti on ti.transfer_id = t.id
      join public.stock_movements m on m.id = ti.out_movement_id where m.client_op_id = p_client_op_id;
    if v_t is not null then return v_t; end if;
  end if;
  select company_id into v_company from public.stores where id = p_store;
  v_qty := public.ops_round_qty(public.ops_convert_qty(p_product, p_quantity, p_unit));
  if v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  select unit_cost into v_cost from public.stock_lots where id = p_lot;

  insert into public.transfers (company_id, from_store_id, to_store_id, from_location_id, to_location_id, status, notes, created_by, created_by_name)
  values (v_company, p_store, p_store, p_from_location, p_to_location, 'recebido', coalesce(p_notes, ''), auth.uid(), public.ops_user_name())
  returning id into v_t;

  v_out := public.ops_move_stock(p_store, p_product, p_lot, p_from_location, 'transferencia', -v_qty, null, 'transferência interna', 'transfer', v_t, p_notes, p_client_op_id, null);
  v_in  := public.ops_move_stock(p_store, p_product, p_lot, p_to_location,   'transferencia',  v_qty, null, 'transferência interna', 'transfer', v_t, p_notes, null, null);

  insert into public.transfer_items (transfer_id, product_id, from_lot_id, to_lot_id, quantity, unit_cost, out_movement_id, in_movement_id)
  values (v_t, p_product, p_lot, p_lot, v_qty, coalesce(v_cost, 0), v_out, v_in);
  return v_t;
end;
$fn$;

-- =====================================================================
-- TRANSFERÊNCIA ENTRE UNIDADES (cria lote espelho no destino)
-- =====================================================================
create or replace function public.ops_transfer_between_stores(
  p_from_store uuid, p_to_store uuid, p_product uuid, p_lot uuid,
  p_from_location uuid, p_to_location uuid, p_quantity numeric,
  p_notes text default '', p_client_op_id uuid default null, p_unit uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_qty numeric; v_src record; v_new_lot uuid; v_out uuid; v_in uuid; v_t uuid;
begin
  perform public.ops_require(p_from_store, 'estoque.movimentar');
  perform public.ops_require(p_to_store, 'estoque.movimentar');
  if p_from_store = p_to_store then raise exception 'Use a transferência interna para o mesmo local/unidade.'; end if;
  if public.ops_store_company(p_from_store) <> public.ops_store_company(p_to_store) then
    raise exception 'As unidades pertencem a empresas diferentes.';
  end if;
  if p_client_op_id is not null then
    select t.id into v_t from public.transfers t join public.transfer_items ti on ti.transfer_id = t.id
      join public.stock_movements m on m.id = ti.out_movement_id where m.client_op_id = p_client_op_id;
    if v_t is not null then return v_t; end if;
  end if;
  v_company := public.ops_store_company(p_from_store);
  v_qty := public.ops_round_qty(public.ops_convert_qty(p_product, p_quantity, p_unit));
  if v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  select * into v_src from public.stock_lots where id = p_lot;

  insert into public.transfers (company_id, from_store_id, to_store_id, from_location_id, to_location_id, status, notes, created_by, created_by_name)
  values (v_company, p_from_store, p_to_store, p_from_location, p_to_location, 'recebido', coalesce(p_notes, ''), auth.uid(), public.ops_user_name())
  returning id into v_t;

  -- lote espelho no destino (mesma validade, custo e código)
  select id into v_new_lot from public.stock_lots where store_id = p_to_store and origin_lot_id = p_lot;
  if v_new_lot is null then
    insert into public.stock_lots (company_id, store_id, product_id, lot_code, origin, supplier_id, origin_lot_id,
      produced_at, received_at, opened_at, frozen_at, thawed_at, expires_at, original_expires_at, unit_cost, initial_quantity, notes, created_by)
    values (v_company, p_to_store, p_product, v_src.lot_code, 'transferencia', v_src.supplier_id, p_lot,
      v_src.produced_at, now(), v_src.opened_at, v_src.frozen_at, v_src.thawed_at, v_src.expires_at, v_src.original_expires_at, v_src.unit_cost, v_qty,
      'Transferido da unidade ' || (select name from public.stores where id = p_from_store), auth.uid())
    returning id into v_new_lot;
  end if;

  v_out := public.ops_move_stock(p_from_store, p_product, p_lot, p_from_location, 'transferencia', -v_qty, null,
             'transferência para ' || (select name from public.stores where id = p_to_store), 'transfer', v_t, p_notes, p_client_op_id, null);
  v_in  := public.ops_move_stock(p_to_store, p_product, v_new_lot, p_to_location, 'transferencia', v_qty, v_src.unit_cost,
             'transferência de ' || (select name from public.stores where id = p_from_store), 'transfer', v_t, p_notes, null, null);

  insert into public.transfer_items (transfer_id, product_id, from_lot_id, to_lot_id, quantity, unit_cost, out_movement_id, in_movement_id)
  values (v_t, p_product, p_lot, v_new_lot, v_qty, coalesce(v_src.unit_cost, 0), v_out, v_in);
  return v_t;
end;
$fn$;

-- =====================================================================
-- EVENTOS DO LOTE: abertura, congelamento, descongelamento, bloqueio
--   Recalcula a validade a partir dos prazos do produto.
-- =====================================================================
create or replace function public.ops_lot_event(p_lot uuid, p_event text, p_at timestamptz default now(), p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_lot record; v_prod record; v_new_exp date; v_days int; v_before jsonb;
begin
  select * into v_lot from public.stock_lots where id = p_lot;
  if v_lot.id is null then raise exception 'Lote não encontrado.'; end if;
  perform public.ops_require(v_lot.store_id, case when p_event in ('bloqueio','desbloqueio') then 'estoque.ajustar' else 'estoque.movimentar' end);
  select * into v_prod from public.products where id = v_lot.product_id;
  v_before := jsonb_build_object('expires_at', v_lot.expires_at, 'status', v_lot.status,
                                 'opened_at', v_lot.opened_at, 'frozen_at', v_lot.frozen_at, 'thawed_at', v_lot.thawed_at);

  if p_event = 'abertura' then
    v_days := v_prod.shelf_life_open_days;
    v_new_exp := case when v_days is not null then least(coalesce(v_lot.expires_at, (p_at::date + v_days)), p_at::date + v_days) else v_lot.expires_at end;
    update public.stock_lots set opened_at = p_at, expires_at = v_new_exp, notes = case when p_notes <> '' then notes || E'\n' || p_notes else notes end where id = p_lot;
  elsif p_event = 'congelamento' then
    v_days := v_prod.shelf_life_frozen_days;
    v_new_exp := case when v_days is not null then p_at::date + v_days else v_lot.expires_at end;
    update public.stock_lots set frozen_at = p_at, thawed_at = null, expires_at = v_new_exp where id = p_lot;
  elsif p_event = 'descongelamento' then
    v_days := v_prod.shelf_life_thawed_days;
    v_new_exp := case when v_days is not null then least(coalesce(v_lot.original_expires_at, p_at::date + v_days), p_at::date + v_days) else v_lot.expires_at end;
    update public.stock_lots set thawed_at = p_at, expires_at = v_new_exp where id = p_lot;
  elsif p_event = 'bloqueio' then
    update public.stock_lots set status = 'bloqueado', notes = case when p_notes <> '' then notes || E'\nBloqueado: ' || p_notes else notes end where id = p_lot;
  elsif p_event = 'desbloqueio' then
    update public.stock_lots set status = 'ativo' where id = p_lot;
    perform public.ops_refresh_lot_status(p_lot);
  else
    raise exception 'Evento de lote desconhecido: %', p_event;
  end if;

  perform public.ops_refresh_lot_status(p_lot);
  perform public.ops_audit(v_lot.company_id, v_lot.store_id, 'lote_' || p_event, 'stock_lots', p_lot, v_lot.lot_code, v_before,
    (select jsonb_build_object('expires_at', expires_at, 'status', status, 'opened_at', opened_at, 'frozen_at', frozen_at, 'thawed_at', thawed_at)
       from public.stock_lots where id = p_lot), coalesce(p_notes, ''));
  return (select jsonb_build_object('lot_id', id, 'expires_at', expires_at, 'status', status) from public.stock_lots where id = p_lot);
end;
$fn$;

-- =====================================================================
-- RESUMO DO LOTE (ficha do QR Code)
-- =====================================================================
create or replace function public.ops_lot_summary(p_lot uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_lot record; v_out jsonb;
begin
  select * into v_lot from public.stock_lots where id = p_lot;
  if v_lot.id is null then return null; end if;
  if not public.ops_has_permission(v_lot.store_id, 'estoque.ver') then
    raise exception 'Sem permissão para ver este lote.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'lot', to_jsonb(v_lot),
    'product', (select jsonb_build_object('id', p.id, 'name', p.name, 'internal_code', p.internal_code, 'photo_url', p.photo_url,
                  'unit', u.code, 'unit_name', u.name, 'storage_type', p.storage_type, 'category', c.name, 'cost', p.cost)
                from public.products p join public.units u on u.id = p.stock_unit_id
                left join public.categories c on c.id = p.category_id where p.id = v_lot.product_id),
    'store', (select jsonb_build_object('id', s.id, 'name', s.name) from public.stores s where s.id = v_lot.store_id),
    'supplier', (select jsonb_build_object('id', s.id, 'name', s.name) from public.suppliers s where s.id = v_lot.supplier_id),
    'balance', public.ops_lot_balance(p_lot),
    'balances', coalesce((select jsonb_agg(jsonb_build_object('location_id', si.location_id, 'location', l.name, 'quantity', si.quantity) order by l.name)
                  from public.stock_items si join public.stock_locations l on l.id = si.location_id where si.lot_id = p_lot and si.quantity <> 0), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'type', m.movement_type, 'quantity', m.quantity, 'created_at', m.created_at,
                     'user', m.created_by_name, 'reason', m.reason, 'notes', m.notes, 'location', l.name, 'balance_after', m.balance_after) order by m.created_at desc)
                   from (select * from public.stock_movements where lot_id = p_lot order by created_at desc limit 100) m
                   join public.stock_locations l on l.id = m.location_id), '[]'::jsonb),
    'created_by_name', public.ops_user_name(v_lot.created_by),
    'days_to_expire', case when v_lot.expires_at is null then null else (v_lot.expires_at - current_date) end,
    'fefo_first', public.ops_fefo_first_lot(v_lot.store_id, v_lot.product_id) = p_lot
  ) into v_out;
  return v_out;
end;
$fn$;

-- =====================================================================
-- SEED: motivos de perda padrão por empresa (chamado no onboarding)
-- =====================================================================
create or replace function public.ops_seed_loss_reasons(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.loss_reasons (company_id, code, name, requires_photo, position) values
    (p_company, 'vencimento',       'Vencimento',                false, 0),
    (p_company, 'producao_excedente','Produção excedente',       false, 1),
    (p_company, 'erro_producao',    'Erro de produção',          false, 2),
    (p_company, 'armazenamento',    'Armazenamento inadequado',  false, 3),
    (p_company, 'quebra',           'Quebra',                    false, 4),
    (p_company, 'contaminacao',     'Contaminação',              true,  5),
    (p_company, 'sobra',            'Sobra',                     false, 6),
    (p_company, 'danificado',       'Produto danificado',        false, 7),
    (p_company, 'erro_humano',      'Erro humano',               false, 8),
    (p_company, 'outro',            'Outro',                     false, 9)
  on conflict (company_id, code) do nothing;
end;
$fn$;

create or replace function public.ops_seed_store_locations(p_store uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.stock_locations where store_id = p_store) then return; end if;
  insert into public.stock_locations (store_id, name, kind, storage_type, position) values
    (p_store, 'Estoque seco', 'estoque_seco', 'ambiente',   0),
    (p_store, 'Geladeira',    'geladeira',    'refrigerado', 1),
    (p_store, 'Freezer',      'freezer',      'congelado',   2),
    (p_store, 'Cozinha',      'cozinha',      'ambiente',    3);
end;
$fn$;

-- =====================================================================
-- AUDITORIA + RLS
-- =====================================================================
do $$ begin perform public.ops_ensure_audit('loss_reasons'); end $$;

alter table public.stock_lots     enable row level security;
alter table public.stock_items    enable row level security;
alter table public.stock_movements enable row level security;
alter table public.loss_reasons   enable row level security;
alter table public.losses         enable row level security;
alter table public.transfers      enable row level security;
alter table public.transfer_items enable row level security;

drop policy if exists stock_lots_select on public.stock_lots;
create policy stock_lots_select on public.stock_lots for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('estoque.ver')));
drop policy if exists stock_lots_update on public.stock_lots;
create policy stock_lots_update on public.stock_lots for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('estoque.ajustar')))
  with check (store_id in (select public.ops_store_ids_with_permission('estoque.ajustar')));

drop policy if exists stock_items_select on public.stock_items;
create policy stock_items_select on public.stock_items for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('estoque.ver')));

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('estoque.ver')));

drop policy if exists loss_reasons_select on public.loss_reasons;
create policy loss_reasons_select on public.loss_reasons for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists loss_reasons_write on public.loss_reasons;
create policy loss_reasons_write on public.loss_reasons for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

drop policy if exists losses_select on public.losses;
create policy losses_select on public.losses for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('perdas.ver')) or created_by = auth.uid());

drop policy if exists transfers_select on public.transfers;
create policy transfers_select on public.transfers for select to authenticated
  using (from_store_id in (select public.ops_store_ids_with_permission('estoque.ver'))
      or to_store_id in (select public.ops_store_ids_with_permission('estoque.ver')));
drop policy if exists transfer_items_select on public.transfer_items;
create policy transfer_items_select on public.transfer_items for select to authenticated
  using (transfer_id in (select t.id from public.transfers t
          where t.from_store_id in (select public.ops_store_ids_with_permission('estoque.ver'))
             or t.to_store_id in (select public.ops_store_ids_with_permission('estoque.ver'))));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

-- funções internas: só via funções de negócio
revoke execute on function public.ops_move_stock(uuid, uuid, uuid, uuid, text, numeric, numeric, text, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.ops_refresh_lot_status(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_loss_reasons(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_store_locations(uuid) from public, anon, authenticated;
