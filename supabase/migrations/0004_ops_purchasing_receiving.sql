-- =====================================================================
--  0004 · COMPRAS (pedidos) e RECEBIMENTO de mercadorias
-- =====================================================================

-- ---------------------------------------------------------------------
-- PEDIDOS DE COMPRA
-- ---------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  store_id         uuid not null references public.stores(id) on delete cascade,
  supplier_id      uuid references public.suppliers(id) on delete set null,
  number           text not null default '',
  status           text not null default 'rascunho'
                     check (status in ('rascunho','solicitado','aprovado','pedido','recebido','cancelado')),
  expected_at      date,
  notes            text not null default '',
  total            numeric(14,4) not null default 0,
  requested_by     uuid, requested_at timestamptz,
  approved_by      uuid, approved_at  timestamptz,
  ordered_by       uuid, ordered_at   timestamptz,
  received_at      timestamptz,
  cancelled_by     uuid, cancelled_at timestamptz, cancel_reason text not null default '',
  created_by       uuid,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists purchase_orders_store_idx on public.purchase_orders(store_id, created_at desc);
create index if not exists purchase_orders_status_idx on public.purchase_orders(store_id, status);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders(supplier_id);
do $$ begin perform public.ops_ensure_updated_at('purchase_orders'); perform public.ops_ensure_guard_status('purchase_orders'); perform public.ops_ensure_audit('purchase_orders'); end $$;

create table if not exists public.purchase_order_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity            numeric(18,4) not null check (quantity > 0),   -- na unidade informada
  unit_id             uuid references public.units(id) on delete set null,
  quantity_stock      numeric(18,4) not null default 0,               -- convertida p/ unidade de estoque
  estimated_price     numeric(14,4) not null default 0,               -- por unidade informada
  total               numeric(14,4) not null default 0,
  received_quantity   numeric(18,4) not null default 0,               -- em unidade de estoque
  notes               text not null default '',
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items(purchase_order_id);
create index if not exists purchase_order_items_product_idx on public.purchase_order_items(product_id);
do $$ begin perform public.ops_ensure_updated_at('purchase_order_items'); end $$;

-- mantém quantity_stock/total do item e o total do pedido
create or replace function public.ops_po_item_sync()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_po uuid; v_status text;
begin
  v_po := coalesce(new.purchase_order_id, old.purchase_order_id);
  select status into v_status from public.purchase_orders where id = v_po;
  if v_status not in ('rascunho','solicitado','aprovado') and not public.ops_is_internal() then
    raise exception 'Itens só podem ser alterados enquanto o pedido está em rascunho, solicitado ou aprovado.';
  end if;
  if tg_op <> 'DELETE' then
    new.quantity_stock := public.ops_round_qty(public.ops_convert_qty(new.product_id, new.quantity, new.unit_id));
    new.total := round(new.quantity * coalesce(new.estimated_price, 0), 4);
  end if;
  update public.purchase_orders po set total = (
    select coalesce(sum(i.total), 0) from public.purchase_order_items i
    where i.purchase_order_id = v_po and (tg_op <> 'DELETE' or i.id <> old.id)
  ) + case when tg_op = 'DELETE' then 0 else 0 end
  where po.id = v_po;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
drop trigger if exists trg_purchase_order_items_sync on public.purchase_order_items;
create trigger trg_purchase_order_items_sync before insert or update or delete on public.purchase_order_items
  for each row execute function public.ops_po_item_sync();

-- recalcula total após o BEFORE (garante que o novo valor do item entra na soma)
create or replace function public.ops_po_total_refresh()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_po uuid;
begin
  v_po := coalesce(new.purchase_order_id, old.purchase_order_id);
  update public.purchase_orders set total = (select coalesce(sum(total), 0) from public.purchase_order_items where purchase_order_id = v_po) where id = v_po;
  return null;
end;
$fn$;
drop trigger if exists trg_purchase_order_items_total on public.purchase_order_items;
create trigger trg_purchase_order_items_total after insert or update or delete on public.purchase_order_items
  for each row execute function public.ops_po_total_refresh();

create or replace function public.ops_po_next_number(p_store uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'PC-' || to_char(now(), 'YYMM') || '-' || lpad((count(*) + 1)::text, 4, '0')
  from public.purchase_orders where store_id = p_store and date_trunc('month', created_at) = date_trunc('month', now())
$$;

-- número automático + autor
create or replace function public.ops_po_before_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.number = '' then new.number := public.ops_po_next_number(new.store_id); end if;
  if new.company_id is null then new.company_id := public.ops_store_company(new.store_id); end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_by_name := coalesce(nullif(new.created_by_name, ''), public.ops_user_name());
  return new;
end;
$fn$;
drop trigger if exists trg_purchase_orders_before_insert on public.purchase_orders;
create trigger trg_purchase_orders_before_insert before insert on public.purchase_orders
  for each row execute function public.ops_po_before_insert();

-- Transições de status
create or replace function public.ops_po_set_status(p_po uuid, p_status text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $fn$
declare v_po record; v_perm text;
begin
  select * into v_po from public.purchase_orders where id = p_po;
  if v_po.id is null then raise exception 'Pedido não encontrado.'; end if;
  v_perm := case p_status
    when 'solicitado' then 'compras.criar'
    when 'aprovado'   then 'compras.aprovar'
    when 'pedido'     then 'compras.criar'
    when 'cancelado'  then 'compras.criar'
    when 'rascunho'   then 'compras.criar'
    else null end;
  if v_perm is null then raise exception 'Status inválido: %', p_status; end if;
  perform public.ops_require(v_po.store_id, v_perm);

  if v_po.status in ('recebido','cancelado') then
    raise exception 'Pedido já %; não pode mudar.', v_po.status;
  end if;
  if p_status = 'solicitado' and v_po.status <> 'rascunho' then raise exception 'Só um rascunho pode ser solicitado.'; end if;
  if p_status = 'aprovado' and v_po.status not in ('solicitado','rascunho') then raise exception 'Só um pedido solicitado pode ser aprovado.'; end if;
  if p_status = 'pedido' and v_po.status <> 'aprovado' then raise exception 'Só um pedido aprovado pode ser enviado ao fornecedor.'; end if;
  if p_status = 'rascunho' and v_po.status <> 'solicitado' then raise exception 'Só um pedido solicitado pode voltar a rascunho.'; end if;
  if p_status = 'solicitado' and not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po) then
    raise exception 'Adicione pelo menos um item antes de solicitar.';
  end if;

  perform public.ops_internal_on();
  update public.purchase_orders set
    status = p_status,
    requested_by = case when p_status = 'solicitado' then auth.uid() else requested_by end,
    requested_at = case when p_status = 'solicitado' then now() else requested_at end,
    approved_by  = case when p_status = 'aprovado' then auth.uid() else approved_by end,
    approved_at  = case when p_status = 'aprovado' then now() else approved_at end,
    ordered_by   = case when p_status = 'pedido' then auth.uid() else ordered_by end,
    ordered_at   = case when p_status = 'pedido' then now() else ordered_at end,
    cancelled_by = case when p_status = 'cancelado' then auth.uid() else cancelled_by end,
    cancelled_at = case when p_status = 'cancelado' then now() else cancelled_at end,
    cancel_reason = case when p_status = 'cancelado' then coalesce(p_reason, '') else cancel_reason end
  where id = p_po;
  perform public.ops_internal_off();
  perform public.ops_audit(v_po.company_id, v_po.store_id, 'status:' || p_status, 'purchase_orders', p_po, v_po.number,
    jsonb_build_object('status', v_po.status), jsonb_build_object('status', p_status), coalesce(p_reason, ''));
end;
$fn$;

-- ---------------------------------------------------------------------
-- RECEBIMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.receipts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  store_id           uuid not null references public.stores(id) on delete cascade,
  supplier_id        uuid references public.suppliers(id) on delete set null,
  purchase_order_id  uuid references public.purchase_orders(id) on delete set null,
  number             text not null default '',
  invoice_number     text not null default '',
  invoice_date       date,
  received_at        timestamptz not null default now(),
  status             text not null default 'rascunho' check (status in ('rascunho','finalizado','cancelado')),
  result             text check (result in ('aprovado','aprovado_ressalva','recusado')),
  notes              text not null default '',
  total              numeric(14,4) not null default 0,
  received_by        uuid,
  received_by_name   text not null default '',
  finalized_by       uuid,
  finalized_at       timestamptz,
  client_op_id       uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists receipts_store_idx on public.receipts(store_id, received_at desc);
create index if not exists receipts_status_idx on public.receipts(store_id, status);
create index if not exists receipts_supplier_idx on public.receipts(supplier_id, received_at desc);
create index if not exists receipts_po_idx on public.receipts(purchase_order_id);
create unique index if not exists receipts_client_op_uidx on public.receipts(client_op_id) where client_op_id is not null;
do $$ begin perform public.ops_ensure_updated_at('receipts'); perform public.ops_ensure_guard_status('receipts'); perform public.ops_ensure_audit('receipts'); end $$;

create table if not exists public.receipt_items (
  id                     uuid primary key default gen_random_uuid(),
  receipt_id             uuid not null references public.receipts(id) on delete cascade,
  product_id             uuid not null references public.products(id) on delete restrict,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  quantity               numeric(18,4) not null check (quantity > 0),   -- na unidade informada
  unit_id                uuid references public.units(id) on delete set null,
  quantity_stock         numeric(18,4) not null default 0,               -- convertida
  weight                 numeric(18,4),                                  -- peso conferido (opcional)
  lot_code               text not null default '',
  expires_at             date,
  unit_price             numeric(14,4) not null default 0,               -- por unidade informada
  total_price            numeric(14,4) not null default 0,
  temperature            numeric(6,2),
  package_condition      text not null default 'ok' check (package_condition in ('ok','danificada','molhada','amassada','aberta','outro')),
  result                 text not null default 'aprovado' check (result in ('aprovado','ressalva','recusado')),
  rejection_reason       text not null default ''
                           check (rejection_reason in ('','embalagem_danificada','validade_inadequada','temperatura_inadequada',
                                                       'quantidade_incorreta','produto_diferente','qualidade_inadequada','outro')),
  location_id            uuid references public.stock_locations(id) on delete set null,
  notes                  text not null default '',
  lot_id                 uuid references public.stock_lots(id) on delete set null,
  position               integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists receipt_items_receipt_idx on public.receipt_items(receipt_id);
create index if not exists receipt_items_product_idx on public.receipt_items(product_id);
do $$ begin perform public.ops_ensure_updated_at('receipt_items'); end $$;

create or replace function public.ops_receipt_next_number(p_store uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'RC-' || to_char(now(), 'YYMM') || '-' || lpad((count(*) + 1)::text, 4, '0')
  from public.receipts where store_id = p_store and date_trunc('month', created_at) = date_trunc('month', now())
$$;

create or replace function public.ops_receipt_before_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.number = '' then new.number := public.ops_receipt_next_number(new.store_id); end if;
  if new.company_id is null then new.company_id := public.ops_store_company(new.store_id); end if;
  new.received_by := coalesce(new.received_by, auth.uid());
  new.received_by_name := coalesce(nullif(new.received_by_name, ''), public.ops_user_name());
  return new;
end;
$fn$;
drop trigger if exists trg_receipts_before_insert on public.receipts;
create trigger trg_receipts_before_insert before insert on public.receipts
  for each row execute function public.ops_receipt_before_insert();

-- itens: converte, calcula total, trava após finalização
create or replace function public.ops_receipt_item_sync()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_status text; v_receipt uuid;
begin
  v_receipt := coalesce(new.receipt_id, old.receipt_id);
  select status into v_status from public.receipts where id = v_receipt;
  if v_status <> 'rascunho' and not public.ops_is_internal() then
    raise exception 'O recebimento já foi finalizado; os itens não podem ser alterados.';
  end if;
  if tg_op <> 'DELETE' then
    new.quantity_stock := public.ops_round_qty(public.ops_convert_qty(new.product_id, new.quantity, new.unit_id));
    new.total_price := round(new.quantity * coalesce(new.unit_price, 0), 4);
    if new.result = 'recusado' and new.rejection_reason = '' then new.rejection_reason := 'outro'; end if;
    if new.result <> 'recusado' then new.rejection_reason := ''; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
drop trigger if exists trg_receipt_items_sync on public.receipt_items;
create trigger trg_receipt_items_sync before insert or update or delete on public.receipt_items
  for each row execute function public.ops_receipt_item_sync();

create or replace function public.ops_receipt_total_refresh()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_receipt uuid;
begin
  v_receipt := coalesce(new.receipt_id, old.receipt_id);
  update public.receipts set total = (select coalesce(sum(total_price), 0) from public.receipt_items where receipt_id = v_receipt and result <> 'recusado') where id = v_receipt;
  return null;
end;
$fn$;
drop trigger if exists trg_receipt_items_total on public.receipt_items;
create trigger trg_receipt_items_total after insert or update or delete on public.receipt_items
  for each row execute function public.ops_receipt_total_refresh();

-- Cria um recebimento (rascunho) a partir de um pedido de compra
create or replace function public.ops_receipt_from_po(p_po uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_po record; v_receipt uuid; r record; v_loc uuid;
begin
  select * into v_po from public.purchase_orders where id = p_po;
  if v_po.id is null then raise exception 'Pedido não encontrado.'; end if;
  perform public.ops_require(v_po.store_id, 'recebimento.criar');
  if v_po.status not in ('aprovado','pedido') then
    raise exception 'O pedido precisa estar aprovado ou enviado ao fornecedor para ser recebido.';
  end if;
  select id into v_receipt from public.receipts where purchase_order_id = p_po and status = 'rascunho' limit 1;
  if v_receipt is not null then return v_receipt; end if;

  insert into public.receipts (company_id, store_id, supplier_id, purchase_order_id, notes)
  values (v_po.company_id, v_po.store_id, v_po.supplier_id, p_po, 'Pedido ' || v_po.number)
  returning id into v_receipt;

  for r in select i.*, p.stock_unit_id from public.purchase_order_items i join public.products p on p.id = i.product_id
           where i.purchase_order_id = p_po order by i.position loop
    if r.quantity_stock - r.received_quantity <= 0 then continue; end if;
    select coalesce(pss.default_location_id, (select id from public.stock_locations where store_id = v_po.store_id and active order by position limit 1))
      into v_loc from public.product_store_settings pss where pss.product_id = r.product_id and pss.store_id = v_po.store_id;
    if v_loc is null then
      select id into v_loc from public.stock_locations where store_id = v_po.store_id and active order by position limit 1;
    end if;
    insert into public.receipt_items (receipt_id, product_id, purchase_order_item_id, quantity, unit_id, unit_price, location_id, position)
    values (v_receipt, r.product_id, r.id,
      case when r.unit_id = r.stock_unit_id or r.unit_id is null then r.quantity_stock - r.received_quantity
           else public.ops_round_qty((r.quantity_stock - r.received_quantity) * r.quantity / nullif(r.quantity_stock, 0)) end,
      r.unit_id, r.estimated_price, v_loc, r.position);
  end loop;
  return v_receipt;
end;
$fn$;

-- Atualiza o custo do produto conforme a configuração (ultimo | medio)
create or replace function public.ops_update_product_cost(p_product uuid, p_store uuid, p_qty numeric, p_unit_cost numeric)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_method text; v_qty_now numeric; v_cost_now numeric; v_new numeric; v_company uuid;
begin
  if p_unit_cost is null or p_unit_cost <= 0 or p_qty <= 0 then return; end if;
  v_method := coalesce(public.ops_setting(p_store, 'estoque.metodo_custo', '"medio"'::jsonb) #>> '{}', 'medio');
  select cost, company_id into v_cost_now, v_company from public.products where id = p_product;
  if v_method = 'ultimo' or coalesce(v_cost_now, 0) <= 0 then
    v_new := p_unit_cost;
  else
    select coalesce(sum(si.quantity), 0) into v_qty_now
      from public.stock_items si join public.stores s on s.id = si.store_id join public.stock_lots l on l.id = si.lot_id
     where si.product_id = p_product and s.company_id = v_company and si.quantity > 0
       and l.status <> 'bloqueado' and (l.expires_at is null or l.expires_at >= current_date);
    -- o lote novo já pode estar somado no saldo: desconta
    v_qty_now := greatest(v_qty_now - p_qty, 0);
    v_new := (v_qty_now * v_cost_now + p_qty * p_unit_cost) / nullif(v_qty_now + p_qty, 0);
  end if;
  update public.products set cost = round(coalesce(v_new, p_unit_cost), 4), last_purchase_price = round(p_unit_cost, 4) where id = p_product;
end;
$fn$;

-- =====================================================================
-- FINALIZAR RECEBIMENTO → lotes, movimentos, custos, histórico, alertas
-- =====================================================================
create or replace function public.ops_receive(p_receipt uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_r record; it record; v_lot uuid; v_cost numeric; v_code text; v_loc uuid; v_result text;
  v_n_ok int := 0; v_n_ressalva int := 0; v_n_recusado int := 0; v_lots jsonb := '[]'::jsonb; v_po_done boolean;
begin
  select * into v_r from public.receipts where id = p_receipt;
  if v_r.id is null then raise exception 'Recebimento não encontrado.'; end if;
  perform public.ops_require(v_r.store_id, 'recebimento.finalizar');
  if v_r.status <> 'rascunho' then raise exception 'Este recebimento já foi %.', v_r.status; end if;
  if not exists (select 1 from public.receipt_items where receipt_id = p_receipt) then
    raise exception 'Adicione pelo menos um item antes de finalizar.';
  end if;

  perform public.ops_internal_on();
  for it in select ri.*, p.name as product_name, p.shelf_life_days
            from public.receipt_items ri join public.products p on p.id = ri.product_id
            where ri.receipt_id = p_receipt order by ri.position, ri.created_at loop
    if it.result = 'recusado' then
      v_n_recusado := v_n_recusado + 1;
      perform public.ops_alert_upsert(v_r.company_id, v_r.store_id, 'recebimento_problema', 'critico',
        'Item recusado no recebimento ' || v_r.number,
        it.product_name || ' — motivo: ' || replace(it.rejection_reason, '_', ' ') || case when it.notes <> '' then ' (' || it.notes || ')' else '' end,
        'receipt', p_receipt, 'recebimento:' || p_receipt || ':' || it.id);
      continue;
    end if;
    if it.result = 'ressalva' then v_n_ressalva := v_n_ressalva + 1; else v_n_ok := v_n_ok + 1; end if;

    v_loc := it.location_id;
    if v_loc is null then
      select id into v_loc from public.stock_locations where store_id = v_r.store_id and active order by position limit 1;
      if v_loc is null then raise exception 'Cadastre ao menos um local de estoque na unidade.'; end if;
    end if;
    v_cost := case when it.quantity_stock > 0 then round(it.total_price / it.quantity_stock, 4) else 0 end;
    v_code := coalesce(nullif(trim(it.lot_code), ''), public.ops_generate_lot_code(v_r.store_id, 'R'));

    insert into public.stock_lots (company_id, store_id, product_id, lot_code, origin, supplier_id, receipt_id, received_at,
      expires_at, original_expires_at, unit_cost, initial_quantity, notes, created_by)
    values (v_r.company_id, v_r.store_id, it.product_id, v_code, 'recebimento', v_r.supplier_id, p_receipt, v_r.received_at,
      coalesce(it.expires_at, case when it.shelf_life_days is not null then (v_r.received_at::date + it.shelf_life_days) end),
      it.expires_at, v_cost, it.quantity_stock,
      case when it.result = 'ressalva' then 'Recebido com ressalva: ' || it.notes else '' end, auth.uid())
    returning id into v_lot;

    perform public.ops_move_stock(v_r.store_id, it.product_id, v_lot, v_loc, 'entrada', it.quantity_stock, v_cost,
      'recebimento ' || v_r.number || case when v_r.invoice_number <> '' then ' NF ' || v_r.invoice_number else '' end,
      'receipt', p_receipt, it.notes, null, null);

    update public.receipt_items set lot_id = v_lot, location_id = v_loc where id = it.id;
    perform public.ops_update_product_cost(it.product_id, v_r.store_id, it.quantity_stock, v_cost);

    if v_r.supplier_id is not null then
      insert into public.supplier_products (supplier_id, product_id, unit_id, last_price, last_purchase_at)
      values (v_r.supplier_id, it.product_id, it.unit_id, v_cost, v_r.received_at)
      on conflict (supplier_id, product_id) do update set last_price = excluded.last_price, last_purchase_at = excluded.last_purchase_at, unit_id = coalesce(excluded.unit_id, public.supplier_products.unit_id), updated_at = now();
    end if;
    insert into public.supplier_price_history (company_id, store_id, supplier_id, product_id, price, quantity, unit_id, receipt_id, recorded_by, recorded_at)
    values (v_r.company_id, v_r.store_id, v_r.supplier_id, it.product_id, v_cost, it.quantity_stock, it.unit_id, p_receipt, auth.uid(), v_r.received_at);

    if it.purchase_order_item_id is not null then
      update public.purchase_order_items set received_quantity = received_quantity + it.quantity_stock where id = it.purchase_order_item_id;
    end if;
    v_lots := v_lots || jsonb_build_object('lot_id', v_lot, 'lot_code', v_code, 'product_id', it.product_id, 'quantity', it.quantity_stock, 'item_id', it.id);
  end loop;

  v_result := case
    when v_n_ok + v_n_ressalva = 0 then 'recusado'
    when v_n_ressalva = 0 and v_n_recusado = 0 then 'aprovado'
    else 'aprovado_ressalva' end;
  if v_n_ressalva > 0 and v_n_recusado = 0 then
    perform public.ops_alert_upsert(v_r.company_id, v_r.store_id, 'recebimento_problema', 'atencao',
      'Recebimento ' || v_r.number || ' aprovado com ressalva', v_n_ressalva || ' item(ns) com ressalva', 'receipt', p_receipt, 'recebimento:' || p_receipt || ':ressalva');
  end if;

  update public.receipts set status = 'finalizado', result = v_result, finalized_by = auth.uid(), finalized_at = now() where id = p_receipt;

  if v_r.purchase_order_id is not null then
    select bool_and(received_quantity >= quantity_stock - 0.0001) into v_po_done from public.purchase_order_items where purchase_order_id = v_r.purchase_order_id;
    if coalesce(v_po_done, false) then
      update public.purchase_orders set status = 'recebido', received_at = now() where id = v_r.purchase_order_id;
    elsif exists (select 1 from public.purchase_orders where id = v_r.purchase_order_id and status = 'aprovado') then
      update public.purchase_orders set status = 'pedido', ordered_at = coalesce(ordered_at, now()) where id = v_r.purchase_order_id;
    end if;
  end if;
  perform public.ops_internal_off();

  perform public.ops_audit(v_r.company_id, v_r.store_id, 'finalizou_recebimento', 'receipts', p_receipt, v_r.number, null,
    jsonb_build_object('result', v_result, 'aprovados', v_n_ok, 'ressalvas', v_n_ressalva, 'recusados', v_n_recusado, 'lots', v_lots));
  return jsonb_build_object('ok', true, 'result', v_result, 'lots', v_lots, 'approved', v_n_ok, 'with_issues', v_n_ressalva, 'rejected', v_n_recusado);
end;
$fn$;

create or replace function public.ops_receipt_cancel(p_receipt uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $fn$
declare v_r record;
begin
  select * into v_r from public.receipts where id = p_receipt;
  if v_r.id is null then raise exception 'Recebimento não encontrado.'; end if;
  perform public.ops_require(v_r.store_id, 'recebimento.criar');
  if v_r.status <> 'rascunho' then raise exception 'Só rascunhos podem ser cancelados. Para desfazer um recebimento finalizado, registre ajuste/perda.'; end if;
  perform public.ops_internal_on();
  update public.receipts set status = 'cancelado', notes = case when p_reason <> '' then notes || E'\nCancelado: ' || p_reason else notes end where id = p_receipt;
  perform public.ops_internal_off();
end;
$fn$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.receipts             enable row level security;
alter table public.receipt_items        enable row level security;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('compras.ver')));
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check (store_id in (select public.ops_store_ids_with_permission('compras.criar')));
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('compras.criar')))
  with check (store_id in (select public.ops_store_ids_with_permission('compras.criar')));
drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete on public.purchase_orders for delete to authenticated
  using (status = 'rascunho' and store_id in (select public.ops_store_ids_with_permission('compras.criar')));

drop policy if exists purchase_order_items_select on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using (purchase_order_id in (select id from public.purchase_orders where store_id in (select public.ops_store_ids_with_permission('compras.ver'))));
drop policy if exists purchase_order_items_write on public.purchase_order_items;
create policy purchase_order_items_write on public.purchase_order_items for all to authenticated
  using (purchase_order_id in (select id from public.purchase_orders where store_id in (select public.ops_store_ids_with_permission('compras.criar'))))
  with check (purchase_order_id in (select id from public.purchase_orders where store_id in (select public.ops_store_ids_with_permission('compras.criar'))));

drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('recebimento.ver')));
drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert on public.receipts for insert to authenticated
  with check (store_id in (select public.ops_store_ids_with_permission('recebimento.criar')));
drop policy if exists receipts_update on public.receipts;
create policy receipts_update on public.receipts for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('recebimento.criar')))
  with check (store_id in (select public.ops_store_ids_with_permission('recebimento.criar')));
drop policy if exists receipts_delete on public.receipts;
create policy receipts_delete on public.receipts for delete to authenticated
  using (status = 'rascunho' and store_id in (select public.ops_store_ids_with_permission('recebimento.criar')));

drop policy if exists receipt_items_select on public.receipt_items;
create policy receipt_items_select on public.receipt_items for select to authenticated
  using (receipt_id in (select id from public.receipts where store_id in (select public.ops_store_ids_with_permission('recebimento.ver'))));
drop policy if exists receipt_items_write on public.receipt_items;
create policy receipt_items_write on public.receipt_items for all to authenticated
  using (receipt_id in (select id from public.receipts where store_id in (select public.ops_store_ids_with_permission('recebimento.criar'))))
  with check (receipt_id in (select id from public.receipts where store_id in (select public.ops_store_ids_with_permission('recebimento.criar'))));

revoke execute on function public.ops_update_product_cost(uuid, uuid, numeric, numeric) from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
