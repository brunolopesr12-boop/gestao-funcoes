-- =====================================================================
--  KDS - SR. STROGONOFF
--  Tabelas da tela de cozinha e da integracao com o iFood.
--
--  Como usar:
--    Supabase > SQL Editor > New query > cole este arquivo inteiro > Run
--  E seguro rodar de novo (idempotente).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PEDIDOS
--    Uma linha = uma comanda. `ifood_order_id` e UNICO: e isso que impede
--    o mesmo pedido do iFood de virar duas comandas.
-- ---------------------------------------------------------------------
create table if not exists public.kds_orders (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies(id) on delete set null,
  source           text not null default 'ifood' check (source in ('ifood','teste')),
  ifood_order_id   text not null,
  merchant_id      text not null default '',
  display_id       text not null default '',
  customer_name    text not null default '',
  order_type       text not null default 'DELIVERY',
  stage            text not null default 'novo'
                     check (stage in ('novo','producao','pronto','despachado','cancelado')),
  ifood_status     text not null default '',
  placed_at        timestamptz not null default now(),
  total            numeric(12,2) not null default 0,
  payment_pending  numeric(12,2) not null default 0,
  payment_prepaid  numeric(12,2) not null default 0,
  change_for       numeric(12,2) not null default 0,
  is_test          boolean not null default false,
  -- Pedido normalizado (itens, pagamento, entrega, observacoes).
  payload          jsonb not null default '{}'::jsonb,
  -- Alertas ja calculados no servidor, para a tela so desenhar.
  alerts           jsonb not null default '[]'::jsonb,
  -- Conferencia
  checklist        jsonb not null default '[]'::jsonb,
  checked_at       timestamptz,
  checked_by       text not null default '',
  forced           boolean not null default false,
  -- Marcos do fluxo
  confirmed_at     timestamptz,
  ready_at         timestamptz,
  dispatched_at    timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text not null default '',
  dispatch_method  text not null default '',
  hidden_at        timestamptz,
  sync_error       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Idempotencia: o identificador unico do pedido no iFood.
create unique index if not exists kds_orders_ifood_uniq
  on public.kds_orders(ifood_order_id);
create index if not exists kds_orders_stage_idx
  on public.kds_orders(stage, placed_at desc);
create index if not exists kds_orders_placed_idx
  on public.kds_orders(placed_at desc);

alter table public.kds_orders replica identity full;

-- Colunas novas em bancos que ja rodaram uma versao anterior deste arquivo.
alter table public.kds_orders add column if not exists hidden_at timestamptz;
alter table public.kds_orders add column if not exists dispatch_method text not null default '';
alter table public.kds_orders add column if not exists forced boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. EVENTOS DO IFOOD
--    O id do evento e a chave primaria: evento repetido nao e reprocessado.
-- ---------------------------------------------------------------------
create table if not exists public.kds_ifood_events (
  id              text primary key,
  code            text not null default '',
  ifood_order_id  text not null default '',
  event_at        timestamptz,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);
create index if not exists kds_ifood_events_order_idx
  on public.kds_ifood_events(ifood_order_id);
create index if not exists kds_ifood_events_received_idx
  on public.kds_ifood_events(received_at desc);

-- ---------------------------------------------------------------------
-- 3. CONFIGURACAO (uma linha so)
-- ---------------------------------------------------------------------
create table if not exists public.kds_settings (
  id               text primary key default 'default',
  late_minutes     integer not null default 25,
  sound            boolean not null default true,
  auto_confirm     boolean not null default false,
  drink_keywords   text[] not null default '{}',
  sauce_keywords   text[] not null default '{}',
  last_poll_at     timestamptz,
  last_poll_ok     boolean not null default false,
  last_poll_error  text not null default '',
  updated_at       timestamptz not null default now()
);

insert into public.kds_settings (id) values ('default')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 4. LOG BASICO (erros da integracao e marcos do pedido)
-- ---------------------------------------------------------------------
create table if not exists public.kds_log (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.kds_orders(id) on delete set null,
  level       text not null default 'info' check (level in ('info','erro')),
  message     text not null default '',
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists kds_log_created_idx on public.kds_log(created_at desc);

-- ---------------------------------------------------------------------
-- Trigger de updated_at (a funcao vem do schema.sql principal)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists trg_kds_orders_updated_at on public.kds_orders;
create trigger trg_kds_orders_updated_at
  before update on public.kds_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
--   Mesmo modelo do resto do app: acesso pela chave anon.
--   As credenciais do iFood NAO ficam aqui - ficam em variavel de
--   ambiente do servidor (ver README).
-- ---------------------------------------------------------------------
do $blk$
declare t text;
begin
  foreach t in array array['kds_orders','kds_ifood_events','kds_settings','kds_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "acesso_total_app" on public.%I', t);
    execute format(
      'create policy "acesso_total_app" on public.%I
         for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $blk$;

-- ---------------------------------------------------------------------
-- REALTIME - a tela do KDS atualiza sozinha em todos os monitores
-- ---------------------------------------------------------------------
do $blk$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kds_orders'
  ) then
    alter publication supabase_realtime add table public.kds_orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kds_settings'
  ) then
    alter publication supabase_realtime add table public.kds_settings;
  end if;
end $blk$;

-- =====================================================================
-- FIM
-- =====================================================================
