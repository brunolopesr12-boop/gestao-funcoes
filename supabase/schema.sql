-- =====================================================================
--  GESTAO DE FUNCOES, FUNCIONARIOS E TREINAMENTOS
--  Schema completo para Supabase (PostgreSQL)
--
--  Como usar:
--    Supabase > SQL Editor > New query > cole este arquivo inteiro > Run
--  E seguro rodar novamente (idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensoes
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Funcao utilitaria: atualiza updated_at automaticamente
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

-- =====================================================================
-- 1. EMPRESAS
-- =====================================================================
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  emoji       text not null default '🏢',
  color       text not null default '#2563eb',
  notes       text not null default '',
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- 2. FUNCOES (cargos / posicoes operacionais)
-- =====================================================================
create table if not exists public.roles (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  name             text not null,
  description      text not null default '',
  responsibilities text not null default '',   -- uma responsabilidade por linha
  emoji            text not null default '🧩',
  position         integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists roles_company_idx on public.roles(company_id);

-- Competencias necessarias para a funcao (conhecimento / atributo)
create table if not exists public.competencies (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references public.roles(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists competencies_role_idx on public.competencies(role_id);

-- Checklist da funcao (rotina do dia a dia)
create table if not exists public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references public.roles(id) on delete cascade,
  text        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists checklist_items_role_idx on public.checklist_items(role_id);

-- =====================================================================
-- 3. PROCESSOS (o que a pessoa precisa saber FAZER - unidade de treino)
-- =====================================================================
create table if not exists public.processes (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references public.roles(id) on delete cascade,
  name        text not null,
  description text not null default '',
  required    boolean not null default true,   -- obrigatorio para ficar APTO
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists processes_role_idx on public.processes(role_id);

-- =====================================================================
-- 4. FUNCIONARIOS
-- =====================================================================
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  status      text not null default 'ativo'
                check (status in ('ativo','afastado','inativo')),
  hired_on    date,
  phone       text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists employees_company_idx on public.employees(company_id);

-- Vinculo funcionario <-> funcao.
--   kind = 'atual'     -> funcao que ele exerce hoje (no maximo 1)
--   kind = 'treinando' -> funcao para a qual esta sendo treinado
create table if not exists public.employee_roles (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  role_id      uuid not null references public.roles(id) on delete cascade,
  kind         text not null default 'treinando' check (kind in ('atual','treinando')),
  created_at   timestamptz not null default now(),
  unique (employee_id, role_id)
);
create index if not exists employee_roles_employee_idx on public.employee_roles(employee_id);
create index if not exists employee_roles_role_idx on public.employee_roles(role_id);
create unique index if not exists employee_roles_one_current
  on public.employee_roles(employee_id) where kind = 'atual';

-- =====================================================================
-- 5. TREINAMENTO - estado atual das 4 etapas
--    A existencia da linha significa "etapa concluida".
-- =====================================================================
create table if not exists public.training_steps (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  process_id   uuid not null references public.processes(id) on delete cascade,
  step         text not null check (step in ('mostrei','fez','ensinou','certifiquei')),
  done_at      timestamptz not null default now(),
  trainer      text not null default '',
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  unique (employee_id, process_id, step)
);
create index if not exists training_steps_employee_idx on public.training_steps(employee_id);
create index if not exists training_steps_process_idx on public.training_steps(process_id);
alter table public.training_steps replica identity full;

-- =====================================================================
-- 6. HISTORICO DE TREINAMENTO (append-only, sobrevive a exclusoes)
-- =====================================================================
create table if not exists public.training_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete cascade,
  employee_id    uuid,
  process_id     uuid,
  employee_name  text not null default '',
  process_name   text not null default '',
  role_name      text not null default '',
  step           text not null default '',
  action         text not null default 'marcou',  -- marcou | desmarcou
  trainer        text not null default '',
  notes          text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists training_events_company_idx on public.training_events(company_id, created_at desc);
create index if not exists training_events_employee_idx on public.training_events(employee_id, created_at desc);

-- Historico de alteracoes de cadastro (empresas, funcoes, funcionarios, processos)
create table if not exists public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  entity       text not null default '',   -- empresa | funcao | funcionario | processo | ...
  entity_name  text not null default '',
  action       text not null default '',   -- criou | editou | excluiu
  detail       text not null default '',
  actor        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists activity_log_company_idx on public.activity_log(company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------
do $blk$
declare t text;
begin
  foreach t in array array['companies','roles','processes','employees'] loop
    execute format('drop trigger if exists trg_%s_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end $blk$;

-- =====================================================================
-- ROW LEVEL SECURITY
--   A v1 do app nao tem login: o acesso e feito com a chave anon.
--   As policies abaixo liberam leitura/escrita para anon e authenticated.
--   (Para restringir depois: troque `to anon, authenticated` por
--    `to authenticated` e ative o Supabase Auth no app.)
-- =====================================================================
do $blk$
declare t text;
begin
  foreach t in array array['companies','roles','competencies','checklist_items',
                           'processes','employees','employee_roles','training_steps',
                           'training_events','activity_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "acesso_total_app" on public.%I', t);
    execute format(
      'create policy "acesso_total_app" on public.%I
         for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $blk$;

-- =====================================================================
-- REALTIME - sincronizacao automatica entre computador, tablet e celular
-- =====================================================================
do $blk$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['companies','roles','competencies','checklist_items',
                           'processes','employees','employee_roles','training_steps',
                           'training_events','activity_log'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $blk$;

-- =====================================================================
-- DADOS INICIAIS
--   Apenas o que voce ja descreveu. Tudo e editavel pelo app.
-- =====================================================================

-- Empresas -------------------------------------------------------------
insert into public.companies (id, name, emoji, color, position) values
  ('11111111-1111-4111-8111-111111111111', 'Vila Rica',      '🏪', '#e11d48', 0),
  ('22222222-2222-4222-8222-222222222222', 'Sr. Strogonoff', '👨‍🍳', '#f59e0b', 1)
on conflict (id) do nothing;

-- Funcoes: Sr. Strogonoff ---------------------------------------------
insert into public.roles (id, company_id, name, emoji, position) values
  ('2a000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Montador de pedidos', '📦', 0),
  ('2a000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Cozinheiro',          '🍳', 1),
  ('2a000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Atendimento',         '🙋', 2),
  ('2a000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Caixa',               '💵', 3)
on conflict (id) do nothing;

-- Funcoes: Vila Rica ---------------------------------------------------
insert into public.roles (id, company_id, name, emoji, position) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Atendente',             '🙋', 0),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Caixa',                 '💵', 1),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Producao de salgados',  '🥟', 2),
  ('1a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Producao de pizza',     '🍕', 3),
  ('1a000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Producao de lanches',   '🍔', 4),
  ('1a000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Montador de pedidos',   '📦', 5)
on conflict (id) do nothing;

-- Processos do Montador de pedidos (Sr. Strogonoff) --------------------
insert into public.processes (id, role_id, name, position) values
  ('2b000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', 'Fazer arroz',                 0),
  ('2b000000-0000-4000-8000-000000000002', '2a000000-0000-4000-8000-000000000001', 'Fazer estrogonofe de frango', 1),
  ('2b000000-0000-4000-8000-000000000003', '2a000000-0000-4000-8000-000000000001', 'Fazer estrogonofe de carne',  2),
  ('2b000000-0000-4000-8000-000000000004', '2a000000-0000-4000-8000-000000000001', 'Fritar',                      3),
  ('2b000000-0000-4000-8000-000000000005', '2a000000-0000-4000-8000-000000000001', 'Montar pedido',               4),
  ('2b000000-0000-4000-8000-000000000006', '2a000000-0000-4000-8000-000000000001', 'Fazer checklist',             5),
  ('2b000000-0000-4000-8000-000000000007', '2a000000-0000-4000-8000-000000000001', 'Conferir pedido',             6)
on conflict (id) do nothing;

-- =====================================================================
-- FIM
-- =====================================================================
