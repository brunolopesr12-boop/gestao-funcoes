-- =====================================================================
--  0002 · CATÁLOGO: unidades de medida, categorias, produtos, conversões,
--         fornecedores, equipamentos de temperatura, locais de estoque
-- =====================================================================

-- ---------------------------------------------------------------------
-- UNIDADES DE MEDIDA
--   kind: massa (base g) · volume (base ml) · contagem (base un)
--         embalagem (caixa, pacote, fardo... fator definido por produto)
-- ---------------------------------------------------------------------
create table if not exists public.units (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,  -- null = padrão do sistema
  code        text not null,
  name        text not null,
  kind        text not null check (kind in ('massa','volume','contagem','embalagem')),
  base_factor numeric(18,6),          -- quantas unidades-base cabem em 1 (null para embalagem)
  decimals    smallint not null default 3,
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists units_system_code_uidx on public.units(code) where company_id is null;
create unique index if not exists units_company_code_uidx on public.units(company_id, code) where company_id is not null;
do $$ begin perform public.ops_ensure_updated_at('units'); end $$;

insert into public.units (id, company_id, code, name, kind, base_factor, decimals, position) values
  ('b0000000-0000-4000-8000-000000000001', null, 'kg',  'Quilograma', 'massa',     1000,  3, 0),
  ('b0000000-0000-4000-8000-000000000002', null, 'g',   'Grama',      'massa',     1,     0, 1),
  ('b0000000-0000-4000-8000-000000000003', null, 'L',   'Litro',      'volume',    1000,  3, 2),
  ('b0000000-0000-4000-8000-000000000004', null, 'ml',  'Mililitro',  'volume',    1,     0, 3),
  ('b0000000-0000-4000-8000-000000000005', null, 'un',  'Unidade',    'contagem',  1,     0, 4),
  ('b0000000-0000-4000-8000-000000000006', null, 'dz',  'Dúzia',      'contagem',  12,    0, 5),
  ('b0000000-0000-4000-8000-000000000007', null, 'cx',  'Caixa',      'embalagem', null,  0, 6),
  ('b0000000-0000-4000-8000-000000000008', null, 'pct', 'Pacote',     'embalagem', null,  0, 7),
  ('b0000000-0000-4000-8000-000000000009', null, 'bdj', 'Bandeja',    'embalagem', null,  0, 8),
  ('b0000000-0000-4000-8000-000000000010', null, 'fd',  'Fardo',      'embalagem', null,  0, 9),
  ('b0000000-0000-4000-8000-000000000011', null, 'sc',  'Saco',       'embalagem', null,  0, 10),
  ('b0000000-0000-4000-8000-000000000012', null, 'gl',  'Galão',      'embalagem', null,  0, 11),
  ('b0000000-0000-4000-8000-000000000013', null, 'lt',  'Lata',       'embalagem', null,  0, 12),
  ('b0000000-0000-4000-8000-000000000014', null, 'pc',  'Peça',       'contagem',  1,     0, 13),
  ('b0000000-0000-4000-8000-000000000015', null, 'porc','Porção',     'contagem',  1,     0, 14)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- CATEGORIAS (com subcategoria via parent_id)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  parent_id   uuid references public.categories(id) on delete set null,
  name        text not null,
  emoji       text not null default '📦',
  color       text not null default '#64748b',
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists categories_company_idx on public.categories(company_id);
create index if not exists categories_parent_idx on public.categories(parent_id);
do $$ begin perform public.ops_ensure_updated_at('categories'); end $$;

-- ---------------------------------------------------------------------
-- FORNECEDORES
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  trade_name     text not null default '',
  cnpj           text not null default '',
  contact_name   text not null default '',
  phone          text not null default '',
  whatsapp       text not null default '',
  email          text not null default '',
  address        text not null default '',
  payment_terms  text not null default '',
  lead_time_days integer not null default 0,
  notes          text not null default '',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists suppliers_company_idx on public.suppliers(company_id);
create index if not exists suppliers_name_idx on public.suppliers(company_id, lower(name));
do $$ begin perform public.ops_ensure_updated_at('suppliers'); end $$;

-- ---------------------------------------------------------------------
-- EQUIPAMENTOS DE TEMPERATURA (criados aqui porque locais os referenciam)
-- ---------------------------------------------------------------------
create table if not exists public.temperature_equipment (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id) on delete cascade,
  name               text not null,
  kind               text not null default 'geladeira'
                       check (kind in ('geladeira','freezer','camara_fria','balcao_refrigerado','estufa','outro')),
  location_text      text not null default '',
  min_temp           numeric(6,2) not null default 0,
  max_temp           numeric(6,2) not null default 5,
  check_interval_min integer not null default 240,   -- de quanto em quanto tempo medir
  active             boolean not null default true,
  position           integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists temperature_equipment_store_idx on public.temperature_equipment(store_id);
do $$ begin perform public.ops_ensure_updated_at('temperature_equipment'); end $$;

-- ---------------------------------------------------------------------
-- LOCAIS DE ESTOQUE (por unidade)
-- ---------------------------------------------------------------------
create table if not exists public.stock_locations (
  id                       uuid primary key default gen_random_uuid(),
  store_id                 uuid not null references public.stores(id) on delete cascade,
  name                     text not null,
  kind                     text not null default 'estoque_seco'
                             check (kind in ('estoque_seco','camara_fria','freezer','geladeira','cozinha','producao','bar','outro')),
  temperature_equipment_id uuid references public.temperature_equipment(id) on delete set null,
  storage_type             text not null default 'ambiente' check (storage_type in ('ambiente','refrigerado','congelado')),
  active                   boolean not null default true,
  position                 integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists stock_locations_store_idx on public.stock_locations(store_id);
do $$ begin perform public.ops_ensure_updated_at('stock_locations'); end $$;

-- ---------------------------------------------------------------------
-- PRODUTOS
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  name                   text not null,
  internal_code          text not null default '',
  sku                    text not null default '',
  barcode                text not null default '',
  category_id            uuid references public.categories(id) on delete set null,
  product_kind           text not null default 'materia_prima'
                           check (product_kind in ('materia_prima','semipronto','produzido','final','descartavel','outro')),
  stock_unit_id          uuid not null references public.units(id) on delete restrict,
  purchase_unit_id       uuid references public.units(id) on delete set null,
  purchase_factor        numeric(18,6) not null default 1,     -- 1 unidade de compra = N unidades de estoque
  cost                   numeric(14,4) not null default 0,     -- custo atual por unidade de estoque
  last_purchase_price    numeric(14,4) not null default 0,     -- último preço por unidade de estoque
  min_stock              numeric(18,4) not null default 0,
  max_stock              numeric(18,4) not null default 0,
  reorder_point          numeric(18,4) not null default 0,
  ideal_stock            numeric(18,4) not null default 0,
  shelf_life_days        integer,          -- validade após produção (dias)
  shelf_life_open_days   integer,          -- validade após abertura
  shelf_life_frozen_days integer,          -- validade após congelamento
  shelf_life_thawed_days integer,          -- validade após descongelamento
  storage_type           text not null default 'ambiente' check (storage_type in ('ambiente','refrigerado','congelado')),
  storage_temp_min       numeric(6,2),
  storage_temp_max       numeric(6,2),
  default_location_kind  text not null default '',
  default_supplier_id    uuid references public.suppliers(id) on delete set null,
  photo_url              text not null default '',
  notes                  text not null default '',
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists products_company_idx on public.products(company_id);
create index if not exists products_company_name_idx on public.products(company_id, lower(name));
create index if not exists products_category_idx on public.products(category_id);
create unique index if not exists products_company_code_uidx on public.products(company_id, internal_code) where internal_code <> '';
create index if not exists products_barcode_idx on public.products(company_id, barcode) where barcode <> '';
create index if not exists products_active_idx on public.products(company_id, active);
do $$ begin perform public.ops_ensure_updated_at('products'); end $$;

-- conversões específicas do produto: 1 <unit> = factor <unidade de estoque>
create table if not exists public.product_units (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  unit_id     uuid not null references public.units(id) on delete cascade,
  factor      numeric(18,6) not null check (factor > 0),
  label       text not null default '',
  created_at  timestamptz not null default now(),
  unique (product_id, unit_id)
);
create index if not exists product_units_product_idx on public.product_units(product_id);

-- parâmetros por unidade (loja)
create table if not exists public.product_store_settings (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products(id) on delete cascade,
  store_id             uuid not null references public.stores(id) on delete cascade,
  min_stock            numeric(18,4),
  max_stock            numeric(18,4),
  reorder_point        numeric(18,4),
  ideal_stock          numeric(18,4),
  default_location_id  uuid references public.stock_locations(id) on delete set null,
  active               boolean not null default true,
  updated_at           timestamptz not null default now(),
  unique (product_id, store_id)
);
create index if not exists product_store_settings_store_idx on public.product_store_settings(store_id);
do $$ begin perform public.ops_ensure_updated_at('product_store_settings'); end $$;

-- fornecedor × produto
create table if not exists public.supplier_products (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid not null references public.suppliers(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  supplier_code    text not null default '',
  unit_id          uuid references public.units(id) on delete set null,   -- unidade em que o fornecedor vende
  last_price       numeric(14,4) not null default 0,                       -- por unidade de estoque
  last_purchase_at timestamptz,
  preferred        boolean not null default false,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (supplier_id, product_id)
);
create index if not exists supplier_products_product_idx on public.supplier_products(product_id);
do $$ begin perform public.ops_ensure_updated_at('supplier_products'); end $$;

-- histórico de preços (imutável)
create table if not exists public.supplier_price_history (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete set null,
  supplier_id  uuid references public.suppliers(id) on delete set null,
  product_id   uuid not null references public.products(id) on delete cascade,
  price        numeric(14,4) not null,        -- por unidade de estoque
  quantity     numeric(18,4) not null default 0,
  unit_id      uuid references public.units(id) on delete set null,
  receipt_id   uuid,
  recorded_by  uuid,
  recorded_at  timestamptz not null default now()
);
create index if not exists supplier_price_history_product_idx on public.supplier_price_history(product_id, recorded_at desc);
create index if not exists supplier_price_history_supplier_idx on public.supplier_price_history(supplier_id, recorded_at desc);
do $$ begin perform public.ops_ensure_immutable('supplier_price_history'); end $$;

-- =====================================================================
-- FUNÇÕES DE CONVERSÃO
-- =====================================================================
-- Converte uma quantidade em <p_from_unit> para a unidade de estoque do produto.
create or replace function public.ops_convert_qty(p_product uuid, p_qty numeric, p_from_unit uuid)
returns numeric language plpgsql stable security definer set search_path = public as $fn$
declare
  v_stock_unit uuid; v_purchase_unit uuid; v_purchase_factor numeric; v_factor numeric;
  v_from record; v_to record;
begin
  select stock_unit_id, purchase_unit_id, purchase_factor
    into v_stock_unit, v_purchase_unit, v_purchase_factor
    from public.products where id = p_product;
  if v_stock_unit is null then
    raise exception 'Produto não encontrado.';
  end if;
  if p_from_unit is null or p_from_unit = v_stock_unit then
    return p_qty;
  end if;
  select factor into v_factor from public.product_units where product_id = p_product and unit_id = p_from_unit;
  if v_factor is not null then
    return p_qty * v_factor;
  end if;
  if v_purchase_unit = p_from_unit and v_purchase_factor > 0 then
    return p_qty * v_purchase_factor;
  end if;
  select kind, base_factor into v_from from public.units where id = p_from_unit;
  select kind, base_factor into v_to from public.units where id = v_stock_unit;
  if v_from.kind = v_to.kind and v_from.base_factor is not null and v_to.base_factor is not null then
    return p_qty * v_from.base_factor / v_to.base_factor;
  end if;
  raise exception 'Não sei converter da unidade informada para a unidade de estoque deste produto. Cadastre a conversão no produto.';
end;
$fn$;

-- Próximo código interno (numérico, por empresa)
create or replace function public.ops_next_internal_code(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select lpad((coalesce(max(nullif(regexp_replace(internal_code, '\D', '', 'g'), '')::bigint), 0) + 1)::text, 5, '0')
  from public.products where company_id = p_company
$$;

-- Nível de estoque: normal | atencao | baixo | critico
create or replace function public.ops_stock_level(p_qty numeric, p_min numeric, p_reorder numeric)
returns text language sql immutable as $$
  select case
    when coalesce(p_min, 0) <= 0 and coalesce(p_reorder, 0) <= 0 then 'normal'
    when p_qty <= 0 then 'critico'
    when p_qty < coalesce(nullif(p_min, 0), p_reorder) * 0.5 then 'critico'
    when p_qty < coalesce(nullif(p_min, 0), p_reorder) then 'baixo'
    when p_qty < greatest(coalesce(p_reorder, 0), coalesce(p_min, 0) * 1.25) then 'atencao'
    else 'normal' end
$$;

-- =====================================================================
-- AUDITORIA
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['units','categories','suppliers','temperature_equipment','stock_locations','products','product_store_settings','supplier_products'] loop
    perform public.ops_ensure_audit(t);
  end loop;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.units                  enable row level security;
alter table public.categories             enable row level security;
alter table public.suppliers              enable row level security;
alter table public.temperature_equipment  enable row level security;
alter table public.stock_locations        enable row level security;
alter table public.products               enable row level security;
alter table public.product_units          enable row level security;
alter table public.product_store_settings enable row level security;
alter table public.supplier_products      enable row level security;
alter table public.supplier_price_history enable row level security;

-- units: sistema (null) visível a todos; da empresa, com permissão
drop policy if exists units_select on public.units;
create policy units_select on public.units for select to authenticated
  using (company_id is null or company_id in (select public.ops_member_company_ids()));
drop policy if exists units_write on public.units;
create policy units_write on public.units for all to authenticated
  using (company_id is not null and company_id in (select public.ops_company_ids_with_permission('produtos.editar')))
  with check (company_id is not null and company_id in (select public.ops_company_ids_with_permission('produtos.editar')));

-- categorias
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('produtos.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('produtos.editar')));

-- produtos (todo membro vê; edição com produtos.editar)
drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists products_write on public.products;
create policy products_write on public.products for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('produtos.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('produtos.editar')));

drop policy if exists product_units_select on public.product_units;
create policy product_units_select on public.product_units for select to authenticated
  using (product_id in (select p.id from public.products p where p.company_id in (select public.ops_member_company_ids())));
drop policy if exists product_units_write on public.product_units;
create policy product_units_write on public.product_units for all to authenticated
  using (product_id in (select p.id from public.products p where p.company_id in (select public.ops_company_ids_with_permission('produtos.editar'))))
  with check (product_id in (select p.id from public.products p where p.company_id in (select public.ops_company_ids_with_permission('produtos.editar'))));

drop policy if exists product_store_settings_select on public.product_store_settings;
create policy product_store_settings_select on public.product_store_settings for select to authenticated
  using (store_id in (select public.ops_accessible_store_ids()));
drop policy if exists product_store_settings_write on public.product_store_settings;
create policy product_store_settings_write on public.product_store_settings for all to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('produtos.editar')))
  with check (store_id in (select public.ops_store_ids_with_permission('produtos.editar')));

-- fornecedores
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('fornecedores.ver'))
         or company_id in (select public.ops_company_ids_with_permission('recebimento.ver'))
         or company_id in (select public.ops_company_ids_with_permission('compras.ver')));
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('fornecedores.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('fornecedores.editar')));

drop policy if exists supplier_products_select on public.supplier_products;
create policy supplier_products_select on public.supplier_products for select to authenticated
  using (supplier_id in (select s.id from public.suppliers s where s.company_id in (select public.ops_member_company_ids())));
drop policy if exists supplier_products_write on public.supplier_products;
create policy supplier_products_write on public.supplier_products for all to authenticated
  using (supplier_id in (select s.id from public.suppliers s where s.company_id in (select public.ops_company_ids_with_permission('fornecedores.editar'))))
  with check (supplier_id in (select s.id from public.suppliers s where s.company_id in (select public.ops_company_ids_with_permission('fornecedores.editar'))));

drop policy if exists supplier_price_history_select on public.supplier_price_history;
create policy supplier_price_history_select on public.supplier_price_history for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('fornecedores.ver'))
         or company_id in (select public.ops_company_ids_with_permission('compras.ver')));
-- inserção só pelas funções (security definer)

-- equipamentos de temperatura
drop policy if exists temperature_equipment_select on public.temperature_equipment;
create policy temperature_equipment_select on public.temperature_equipment for select to authenticated
  using (store_id in (select public.ops_accessible_store_ids()));
drop policy if exists temperature_equipment_write on public.temperature_equipment;
create policy temperature_equipment_write on public.temperature_equipment for all to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('temperaturas.editar')))
  with check (store_id in (select public.ops_store_ids_with_permission('temperaturas.editar')));

-- locais de estoque
drop policy if exists stock_locations_select on public.stock_locations;
create policy stock_locations_select on public.stock_locations for select to authenticated
  using (store_id in (select public.ops_accessible_store_ids()));
drop policy if exists stock_locations_write on public.stock_locations;
create policy stock_locations_write on public.stock_locations for all to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('configuracoes.editar')))
  with check (store_id in (select public.ops_store_ids_with_permission('configuracoes.editar')));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
