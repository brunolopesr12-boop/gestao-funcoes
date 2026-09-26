-- =====================================================================
--  VILA RICA · GESTÃO OPERACIONAL DE COZINHA + FUNÇÕES/TREINAMENTOS + VILA GPT
--  Arquivo único de instalação, gerado por: npm run db:bundle
--
--  Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
--  É seguro rodar de novo (idempotente). Nunca apaga dados.
-- =====================================================================

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
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Produção de salgados',  '🥟', 2),
  ('1a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Produção de pizza',     '🍕', 3),
  ('1a000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Produção de lanches',   '🍔', 4),
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
-- VILA GPT - assistente interno / manual vivo da empresa
--   kb_articles   : base de conhecimento oficial (procedimentos, regras,
--                   perguntas e respostas, fichas tecnicas, cardapios...)
--   gpt_questions : historico de perguntas dos funcionarios
-- =====================================================================
create table if not exists public.kb_articles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade, -- null = vale para todas
  kind        text not null default 'procedimento'
                check (kind in ('procedimento','pergunta','regra','treinamento',
                                'ficha_tecnica','cardapio','produto','documento',
                                'sistema','outro')),
  category    text not null default '',      -- Caixa, Cozinha, Delivery, Atendimento...
  title       text not null,
  question    text not null default '',      -- como o funcionario perguntaria (opcional)
  content     text not null default '',      -- resposta / passo a passo (um passo por linha)
  keywords    text not null default '',      -- sinonimos e termos de busca, separados por virgula
  official    boolean not null default true, -- so o que e oficial entra nas respostas
  position    integer not null default 0,
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists kb_articles_company_idx on public.kb_articles(company_id);
create index if not exists kb_articles_kind_idx on public.kb_articles(kind);

create table if not exists public.gpt_questions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete set null,
  employee_id    uuid,                          -- sem FK: o historico sobrevive a exclusoes
  employee_name  text not null default '',
  question       text not null,
  answer         text not null default '',
  sources        jsonb not null default '[]'::jsonb, -- [{id, title, label, href}]
  found          boolean not null default false,     -- achou resposta na base oficial?
  topic          text not null default '',           -- chave para agrupar duvidas parecidas
  topic_label    text not null default '',
  mode           text not null default 'ia',         -- ia | busca | sem_resposta
  helpful        boolean,                            -- feedback do funcionario
  model          text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists gpt_questions_company_idx on public.gpt_questions(company_id, created_at desc);
create index if not exists gpt_questions_topic_idx on public.gpt_questions(topic);
create index if not exists gpt_questions_mode_idx on public.gpt_questions(mode, created_at desc);

-- Tentativas de login na administracao (trava contra forca bruta,
-- compartilhada entre todas as instancias do servidor)
create table if not exists public.gpt_login_attempts (
  id          uuid primary key default gen_random_uuid(),
  ip          text not null default '',
  ok          boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists gpt_login_attempts_idx on public.gpt_login_attempts(created_at desc);

drop trigger if exists trg_kb_articles_updated_at on public.kb_articles;
create trigger trg_kb_articles_updated_at before update on public.kb_articles
  for each row execute function public.set_updated_at();

-- RLS: por padrao a mesma politica das outras tabelas (o app usa a chave
-- anon). Se a trava de supabase/vila-gpt-lock.sql ja tiver sido aplicada
-- (politica "escrita_servidor" presente), este bloco NAO reabre o acesso.
do $blk$
declare t text;
begin
  foreach t in array array['kb_articles','gpt_questions','gpt_login_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'escrita_servidor'
    ) then
      execute format('drop policy if exists "acesso_total_app" on public.%I', t);
      execute format(
        'create policy "acesso_total_app" on public.%I
           for all to anon, authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $blk$;

-- Realtime: so a base de conhecimento (o historico de perguntas e as
-- tentativas de login nao devem ser transmitidos aos navegadores).
do $blk$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kb_articles'
  ) then
    alter publication supabase_realtime add table public.kb_articles;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gpt_questions'
  ) then
    alter publication supabase_realtime drop table public.gpt_questions;
  end if;
end $blk$;

-- Conteudo inicial: apenas informacoes do proprio sistema (nada operacional
-- e inventado - os procedimentos da empresa sao cadastrados pela administracao).
insert into public.kb_articles (id, company_id, kind, category, title, question, content, keywords, official, position) values
  ('3c000000-0000-4000-8000-000000000001', null, 'sistema', 'Sistema',
   'Como usar o VILA GPT',
   'Como funciona o VILA GPT? Como faço uma pergunta?',
   E'1. Abra o VILA GPT e informe seu nome.\n2. Escreva sua dúvida de forma simples, por exemplo: "Como faço o fechamento do caixa?".\n3. Toque em Enviar. A resposta vem da base oficial da empresa e mostra a fonte usada.\n4. Se aparecer "Não encontrei esse procedimento na base oficial da empresa", procure um gerente ou responsável.\n5. Na aba Manual você pode consultar todos os procedimentos oficiais cadastrados.',
   'vila gpt, assistente, ajuda, dúvida, manual, perguntar', true, 0),
  ('3c000000-0000-4000-8000-000000000002', null, 'sistema', 'Sistema',
   'Como funciona a certificação de treinamento (4 etapas)',
   'Como um funcionário fica apto? O que são as etapas Mostrei, Fez, Ensinou e Certifiquei?',
   E'Cada processo da função passa por 4 etapas obrigatórias:\n1. Mostrei — o treinador mostrou como fazer.\n2. Fez — o funcionário fez enquanto o treinador acompanhou.\n3. Ensinou — o funcionário conseguiu explicar como se faz.\n4. Certifiquei — o treinador viu o funcionário fazendo sozinho e confirmou.\nA etapa Certifiquei só libera depois das três primeiras.\nO funcionário fica APTO na função quando todos os processos obrigatórios estão certificados. Com qualquer etapa pendente ele fica Em treinamento.\nCada etapa marcada grava data, hora, quem treinou e observação, e entra no histórico.',
   'apto, certificação, treinamento, etapas, mostrei, fez, ensinou, certifiquei, em treinamento', true, 1)
on conflict (id) do nothing;

-- =====================================================================
-- FIM
-- =====================================================================



-- ===================================================================
-- migration: 0001_ops_identity_permissions.sql
-- ===================================================================

-- =====================================================================
--  0001 · IDENTIDADE, UNIDADES, PERFIS DE ACESSO, PERMISSÕES, AUDITORIA
--  Sistema de gestão operacional de cozinha (Vila Rica)
--  Idempotente: pode ser aplicado várias vezes.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- Bloqueia UPDATE/DELETE em tabelas imutáveis (movimentos, auditoria...)
create or replace function public.ops_forbid_change()
returns trigger language plpgsql as $fn$
begin
  raise exception 'A tabela % é imutável: registros nunca são alterados ou apagados. Faça um novo registro de correção.', tg_table_name
    using errcode = 'P0001';
end;
$fn$;

-- Helper para (re)criar trigger de updated_at de forma idempotente
create or replace function public.ops_ensure_updated_at(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_updated_at on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()', p_table, p_table);
end;
$fn$;

create or replace function public.ops_ensure_immutable(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_immutable on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_immutable before update or delete on public.%I for each row execute function public.ops_forbid_change()', p_table, p_table);
end;
$fn$;

-- ---------------------------------------------------------------------
-- PROFILES (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key,
  email         text not null default '',
  full_name     text not null default '',
  phone         text not null default '',
  avatar_url    text not null default '',
  active        boolean not null default true,
  last_store_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'profiles_id_fkey') then
    alter table public.profiles
      add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;
select public.ops_ensure_updated_at('profiles');

-- ---------------------------------------------------------------------
-- STORES (unidades / lojas)
-- ---------------------------------------------------------------------
create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  code        text not null default '',
  address     text not null default '',
  phone       text not null default '',
  timezone    text not null default 'America/Sao_Paulo',
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stores_company_idx on public.stores(company_id);
select public.ops_ensure_updated_at('stores');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_last_store_fkey') then
    alter table public.profiles
      add constraint profiles_last_store_fkey foreign key (last_store_id) references public.stores(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES (catálogo) e PERFIS DE ACESSO
--   Obs.: a tabela `roles` já existe e significa FUNÇÃO OPERACIONAL (cargo).
--   Por isso os perfis de acesso ficam em `access_roles`.
-- ---------------------------------------------------------------------
create table if not exists public.permissions (
  code        text primary key,           -- modulo.acao
  module      text not null,
  name        text not null,
  description text not null default '',
  position    integer not null default 0
);

create table if not exists public.access_roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade, -- null = perfil padrão do sistema
  code        text not null,
  name        text not null,
  description text not null default '',
  system      boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists access_roles_system_code_uidx on public.access_roles(code) where company_id is null;
create unique index if not exists access_roles_company_code_uidx on public.access_roles(company_id, code) where company_id is not null;
select public.ops_ensure_updated_at('access_roles');

create table if not exists public.role_permissions (
  access_role_id  uuid not null references public.access_roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (access_role_id, permission_code)
);

-- ---------------------------------------------------------------------
-- MEMBERSHIPS (usuário × empresa) + unidades liberadas + ajustes finos
-- ---------------------------------------------------------------------
create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid,                                   -- null enquanto o convite não foi aceito
  invited_email   text not null default '',
  access_role_id  uuid not null references public.access_roles(id) on delete restrict,
  all_stores      boolean not null default true,
  active          boolean not null default true,
  employee_id     uuid references public.employees(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'memberships_user_fkey') then
    alter table public.memberships
      add constraint memberships_user_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;
create unique index if not exists memberships_company_user_uidx on public.memberships(company_id, user_id) where user_id is not null;
create unique index if not exists memberships_company_email_uidx on public.memberships(company_id, lower(invited_email)) where user_id is null and invited_email <> '';
create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists memberships_company_idx on public.memberships(company_id);
select public.ops_ensure_updated_at('memberships');

create table if not exists public.membership_stores (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  primary key (membership_id, store_id)
);
create index if not exists membership_stores_store_idx on public.membership_stores(store_id);

create table if not exists public.membership_permissions (
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted         boolean not null default true,
  primary key (membership_id, permission_code)
);

-- ---------------------------------------------------------------------
-- SETTINGS (empresa ou unidade) — chave/valor jsonb
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid references public.stores(id) on delete cascade,  -- null = empresa
  key         text not null,
  value       jsonb not null default 'null'::jsonb,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists settings_scope_key_uidx
  on public.settings(company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
select public.ops_ensure_updated_at('settings');

-- ---------------------------------------------------------------------
-- AUDIT LOGS (imutável)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid,
  store_id      uuid,
  user_id       uuid,
  user_name     text not null default '',
  action        text not null,             -- criou | editou | excluiu | recebeu | produziu | ...
  entity        text not null,             -- nome da tabela / entidade de negócio
  entity_id     uuid,
  entity_label  text not null default '',
  before        jsonb,
  after         jsonb,
  detail        text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);
create index if not exists audit_logs_store_created_idx on public.audit_logs(store_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity, entity_id);
create index if not exists audit_logs_user_idx on public.audit_logs(user_id, created_at desc);
select public.ops_ensure_immutable('audit_logs');

-- =====================================================================
-- FUNÇÕES DE IDENTIDADE E PERMISSÃO
--   Todas `security definer` + `search_path` fixo; leem só o necessário.
-- =====================================================================

create or replace function public.ops_uid()
returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function public.ops_user_name(p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(p.full_name, ''), nullif(p.email, ''), '') from public.profiles p where p.id = p_user), '')
$$;

-- empresas onde o usuário é membro ativo
create or replace function public.ops_member_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.company_id from public.memberships m
  where m.user_id = auth.uid() and m.active
$$;

create or replace function public.ops_is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.active and m.company_id = p_company)
$$;

create or replace function public.ops_is_admin(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.access_roles r on r.id = m.access_role_id
    where m.user_id = auth.uid() and m.active and m.company_id = p_company and r.code = 'admin'
  )
$$;

create or replace function public.ops_store_company(p_store uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.company_id from public.stores s where s.id = p_store
$$;

-- empresas onde o usuário tem determinada permissão
create or replace function public.ops_company_ids_with_permission(p_perm text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.company_id
  from public.memberships m
  join public.access_roles r on r.id = m.access_role_id
  where m.user_id = auth.uid() and m.active
    and (
      r.code = 'admin'
      or coalesce(
        (select mp.granted from public.membership_permissions mp
          where mp.membership_id = m.id and mp.permission_code = p_perm),
        exists (select 1 from public.role_permissions rp
          where rp.access_role_id = r.id and rp.permission_code = p_perm)
      )
    )
$$;

-- unidades acessíveis ao usuário (independente de permissão)
create or replace function public.ops_accessible_store_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id
  from public.memberships m
  join public.stores s on s.company_id = m.company_id
  where m.user_id = auth.uid() and m.active and s.active
    and (m.all_stores
         or exists (select 1 from public.membership_stores ms where ms.membership_id = m.id and ms.store_id = s.id))
$$;

-- unidades onde o usuário tem determinada permissão
create or replace function public.ops_store_ids_with_permission(p_perm text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id
  from public.memberships m
  join public.access_roles r on r.id = m.access_role_id
  join public.stores s on s.company_id = m.company_id
  where m.user_id = auth.uid() and m.active
    and (m.all_stores or r.code = 'admin'
         or exists (select 1 from public.membership_stores ms where ms.membership_id = m.id and ms.store_id = s.id))
    and (
      r.code = 'admin'
      or coalesce(
        (select mp.granted from public.membership_permissions mp
          where mp.membership_id = m.id and mp.permission_code = p_perm),
        exists (select 1 from public.role_permissions rp
          where rp.access_role_id = r.id and rp.permission_code = p_perm)
      )
    )
$$;

create or replace function public.ops_has_permission(p_store uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_store in (select public.ops_store_ids_with_permission(p_perm))
$$;

create or replace function public.ops_has_company_permission(p_company uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_company in (select public.ops_company_ids_with_permission(p_perm))
$$;

-- lista todas as permissões efetivas do usuário por unidade (para a UI)
create or replace function public.ops_my_permissions()
returns table (store_id uuid, company_id uuid, permission_code text)
language sql stable security definer set search_path = public as $$
  select s.id, s.company_id, p.code
  from public.memberships m
  join public.access_roles r on r.id = m.access_role_id
  join public.stores s on s.company_id = m.company_id
  cross join public.permissions p
  where m.user_id = auth.uid() and m.active
    and (m.all_stores or r.code = 'admin'
         or exists (select 1 from public.membership_stores ms where ms.membership_id = m.id and ms.store_id = s.id))
    and (
      r.code = 'admin'
      or coalesce(
        (select mp.granted from public.membership_permissions mp
          where mp.membership_id = m.id and mp.permission_code = p.code),
        exists (select 1 from public.role_permissions rp
          where rp.access_role_id = r.id and rp.permission_code = p.code)
      )
    )
$$;

-- chamadas do servidor com a chave de serviço (cron, integrações)
create or replace function public.ops_is_service_role()
returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user = 'service_role'
$$;

-- exige permissão dentro das funções de negócio
create or replace function public.ops_require(p_store uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = public as $fn$
begin
  if public.ops_is_service_role() then return; end if;
  if auth.uid() is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if not public.ops_has_permission(p_store, p_perm) then
    raise exception 'Sem permissão: % (unidade %)', p_perm, p_store using errcode = '42501';
  end if;
end;
$fn$;

create or replace function public.ops_require_company(p_company uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = public as $fn$
begin
  if public.ops_is_service_role() then return; end if;
  if auth.uid() is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if not public.ops_has_company_permission(p_company, p_perm) then
    raise exception 'Sem permissão: % (empresa %)', p_perm, p_company using errcode = '42501';
  end if;
end;
$fn$;

-- Configuração efetiva: unidade > empresa > padrão
create or replace function public.ops_setting(p_store uuid, p_key text, p_default jsonb default 'null'::jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.value from public.settings s where s.store_id = p_store and s.key = p_key),
    (select s.value from public.settings s
       where s.company_id = public.ops_store_company(p_store) and s.store_id is null and s.key = p_key),
    p_default)
$$;

create or replace function public.ops_set_setting(p_company uuid, p_store uuid, p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform public.ops_require_company(p_company, 'configuracoes.editar');
  if p_store is not null and public.ops_store_company(p_store) <> p_company then
    raise exception 'Unidade não pertence à empresa.';
  end if;
  insert into public.settings (company_id, store_id, key, value, updated_by)
  values (p_company, p_store, p_key, p_value, auth.uid())
  on conflict (company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
end;
$fn$;

-- =====================================================================
-- AUDITORIA
-- =====================================================================
create or replace function public.ops_audit(
  p_company uuid, p_store uuid, p_action text, p_entity text, p_entity_id uuid,
  p_label text default '', p_before jsonb default null, p_after jsonb default null, p_detail text default ''
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into public.audit_logs (company_id, store_id, user_id, user_name, action, entity, entity_id, entity_label, before, after, detail)
  values (p_company, p_store, auth.uid(), public.ops_user_name(), p_action, p_entity, p_entity_id, coalesce(p_label, ''), p_before, p_after, coalesce(p_detail, ''))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Trigger genérico: grava antes/depois (só as chaves que mudaram no update)
create or replace function public.ops_audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_new jsonb; v_old jsonb; v_diff_new jsonb; v_diff_old jsonb;
  v_company uuid; v_store uuid; v_label text; v_action text; v_id uuid; k text;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new); v_action := 'criou';
  elsif tg_op = 'UPDATE' then v_new := to_jsonb(new); v_old := to_jsonb(old); v_action := 'editou';
  else v_old := to_jsonb(old); v_action := 'excluiu';
  end if;

  v_id := coalesce((coalesce(v_new, v_old) ->> 'id')::uuid, null);
  v_store := nullif(coalesce(v_new, v_old) ->> 'store_id', '')::uuid;
  v_company := nullif(coalesce(v_new, v_old) ->> 'company_id', '')::uuid;
  if v_company is null and v_store is not null then
    select company_id into v_company from public.stores where id = v_store;
  end if;
  v_label := coalesce(
    coalesce(v_new, v_old) ->> 'name',
    coalesce(v_new, v_old) ->> 'title',
    coalesce(v_new, v_old) ->> 'full_name',
    coalesce(v_new, v_old) ->> 'lot_code',
    coalesce(v_new, v_old) ->> 'invoice_number',
    coalesce(v_new, v_old) ->> 'code',
    '');

  if tg_op = 'UPDATE' then
    if v_new = v_old then return new; end if;
    v_diff_new := '{}'::jsonb; v_diff_old := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k in ('updated_at') then continue; end if;
      if (v_new -> k) is distinct from (v_old -> k) then
        v_diff_new := v_diff_new || jsonb_build_object(k, v_new -> k);
        v_diff_old := v_diff_old || jsonb_build_object(k, v_old -> k);
      end if;
    end loop;
    if v_diff_new = '{}'::jsonb then return new; end if;
    -- só o status mudou? registra a ação com o nome do status
    if v_diff_new ? 'status' and (select count(*) from jsonb_object_keys(v_diff_new)) <= 3 then
      v_action := 'status:' || (v_diff_new ->> 'status');
    end if;
    perform public.ops_audit(v_company, v_store, v_action, tg_table_name, v_id, v_label, v_diff_old, v_diff_new);
    return new;
  elsif tg_op = 'INSERT' then
    perform public.ops_audit(v_company, v_store, v_action, tg_table_name, v_id, v_label, null, v_new);
    return new;
  else
    perform public.ops_audit(v_company, v_store, v_action, tg_table_name, v_id, v_label, v_old, null);
    return old;
  end if;
end;
$fn$;

create or replace function public.ops_ensure_audit(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_audit on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function public.ops_audit_trigger()', p_table, p_table);
end;
$fn$;

-- =====================================================================
-- CADASTRO DE USUÁRIO: perfil automático + vínculo de convites por e-mail
-- =====================================================================
create or replace function public.ops_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;

  -- convites pendentes para este e-mail viram vínculos reais
  update public.memberships
     set user_id = new.id, invited_email = '', updated_at = now()
   where user_id is null and new.email is not null and lower(invited_email) = lower(new.email);
  return new;
end;
$fn$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists trg_ops_on_auth_user_created on auth.users;
    create trigger trg_ops_on_auth_user_created
      after insert on auth.users for each row execute function public.ops_handle_new_user();
  end if;
end $$;

-- Primeiro acesso: quando ainda não existe nenhum membro, o primeiro usuário
-- autenticado vira administrador das empresas existentes.
create or replace function public.ops_needs_bootstrap()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.memberships where user_id is not null)
$$;

create or replace function public.ops_bootstrap_admin()
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_role uuid; c record; v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if not public.ops_needs_bootstrap() then
    return false;
  end if;
  select id into v_role from public.access_roles where company_id is null and code = 'admin';
  insert into public.profiles (id, email) values (v_uid, '') on conflict (id) do nothing;
  for c in select id from public.companies loop
    insert into public.memberships (company_id, user_id, access_role_id, all_stores, created_by)
    values (c.id, v_uid, v_role, true, v_uid)
    on conflict do nothing;
    perform public.ops_audit(c.id, null, 'bootstrap_admin', 'memberships', null, public.ops_user_name(v_uid), null, null, 'Primeiro acesso: administrador inicial');
  end loop;
  return true;
end;
$fn$;

-- Um convite existe para este e-mail? (usado na tela de login para liberar o cadastro)
create or replace function public.ops_invite_exists(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where user_id is null and lower(invited_email) = lower(trim(p_email)))
$$;

-- =====================================================================
-- CATÁLOGO DE PERMISSÕES E PERFIS PADRÃO
-- =====================================================================
insert into public.permissions (code, module, name, description, position) values
  ('painel.ver',              'painel',        'Ver painel',                    'Dashboard e indicadores', 10),
  ('produtos.ver',            'produtos',      'Ver produtos',                  '', 20),
  ('produtos.editar',         'produtos',      'Cadastrar/editar produtos',     'Produtos, categorias, unidades de medida', 21),
  ('fornecedores.ver',        'fornecedores',  'Ver fornecedores',              '', 30),
  ('fornecedores.editar',     'fornecedores',  'Cadastrar/editar fornecedores', '', 31),
  ('estoque.ver',             'estoque',       'Ver estoque',                   'Saldos, lotes, validades e movimentações', 40),
  ('estoque.movimentar',      'estoque',       'Movimentar estoque',            'Consumir, transferir, abrir/congelar lotes', 41),
  ('estoque.ajustar',         'estoque',       'Ajustar estoque',               'Ajustes manuais e estoque inicial', 42),
  ('recebimento.ver',         'recebimento',   'Ver recebimentos',              '', 50),
  ('recebimento.criar',       'recebimento',   'Registrar recebimento',         '', 51),
  ('recebimento.finalizar',   'recebimento',   'Finalizar recebimento',         'Entrada no estoque', 52),
  ('producao.ver',            'producao',      'Ver produções',                 '', 60),
  ('producao.criar',          'producao',      'Planejar produção',             '', 61),
  ('producao.finalizar',      'producao',      'Concluir produção',             'Baixa de ingredientes e entrada do produto', 62),
  ('fichas.ver',              'fichas',        'Ver fichas técnicas',           '', 70),
  ('fichas.editar',           'fichas',        'Editar fichas técnicas',        '', 71),
  ('inventario.ver',          'inventario',    'Ver inventários',               '', 80),
  ('inventario.contar',       'inventario',    'Contar estoque',                '', 81),
  ('inventario.finalizar',    'inventario',    'Finalizar inventário',          'Gera os ajustes de estoque', 82),
  ('perdas.ver',              'perdas',        'Ver perdas',                    '', 90),
  ('perdas.registrar',        'perdas',        'Registrar perda',               '', 91),
  ('compras.ver',             'compras',       'Ver compras',                   '', 100),
  ('compras.criar',           'compras',       'Criar pedido de compra',        '', 101),
  ('compras.aprovar',         'compras',       'Aprovar pedido de compra',      '', 102),
  ('temperaturas.ver',        'temperaturas',  'Ver temperaturas',              '', 110),
  ('temperaturas.registrar',  'temperaturas',  'Registrar temperatura',         '', 111),
  ('temperaturas.editar',     'temperaturas',  'Cadastrar equipamentos',        '', 112),
  ('checklists.ver',          'checklists',    'Ver checklists',                '', 120),
  ('checklists.executar',     'checklists',    'Executar checklists',           '', 121),
  ('checklists.editar',       'checklists',    'Criar/editar checklists',       '', 122),
  ('tarefas.ver',             'tarefas',       'Ver tarefas',                   '', 130),
  ('tarefas.executar',        'tarefas',       'Executar tarefas',              '', 131),
  ('tarefas.editar',          'tarefas',       'Criar/atribuir tarefas',        '', 132),
  ('etiquetas.imprimir',      'etiquetas',     'Imprimir etiquetas',            '', 140),
  ('etiquetas.editar_modelos','etiquetas',     'Editar modelos de etiqueta',    '', 141),
  ('alertas.ver',             'alertas',       'Ver alertas',                   '', 150),
  ('alertas.resolver',        'alertas',       'Resolver alertas',              '', 151),
  ('relatorios.ver',          'relatorios',    'Ver relatórios',                '', 160),
  ('relatorios.exportar',     'relatorios',    'Exportar relatórios',           'CSV, Excel e PDF', 161),
  ('auditoria.ver',           'auditoria',     'Ver auditoria',                 '', 170),
  ('usuarios.gerenciar',      'usuarios',      'Gerenciar usuários',            'Criar, convidar e definir permissões', 180),
  ('configuracoes.editar',    'configuracoes', 'Editar configurações',          'Empresa, unidades, parâmetros', 190),
  ('treinamentos.ver',        'treinamentos',  'Ver funções e treinamentos',    'Módulo de funções/funcionários', 200),
  ('treinamentos.editar',     'treinamentos',  'Editar funções e treinamentos', '', 201)
on conflict (code) do update set module = excluded.module, name = excluded.name, description = excluded.description, position = excluded.position;

insert into public.access_roles (id, company_id, code, name, description, system, position) values
  ('a0000000-0000-4000-8000-000000000001', null, 'admin',       'Administrador', 'Acesso total a todas as unidades', true, 0),
  ('a0000000-0000-4000-8000-000000000002', null, 'gerente',     'Gerente',       'Gestão completa da(s) unidade(s) liberada(s)', true, 1),
  ('a0000000-0000-4000-8000-000000000003', null, 'estoquista',  'Estoquista',    'Recebimento, estoque, inventário e compras', true, 2),
  ('a0000000-0000-4000-8000-000000000004', null, 'cozinha',     'Cozinha',       'Produção, etiquetas, validade e temperaturas', true, 3),
  ('a0000000-0000-4000-8000-000000000005', null, 'auditor',     'Auditor',       'Somente visualização e relatórios', true, 4),
  ('a0000000-0000-4000-8000-000000000006', null, 'funcionario', 'Funcionário',   'Somente tarefas autorizadas', true, 5)
on conflict (id) do nothing;

-- Permissões padrão por perfil (recarregadas a cada instalação; ajustes por
-- usuário ficam em membership_permissions e não são afetados).
do $$
declare
  r_gerente uuid := 'a0000000-0000-4000-8000-000000000002';
  r_estoq   uuid := 'a0000000-0000-4000-8000-000000000003';
  r_coz     uuid := 'a0000000-0000-4000-8000-000000000004';
  r_aud     uuid := 'a0000000-0000-4000-8000-000000000005';
  r_func    uuid := 'a0000000-0000-4000-8000-000000000006';
begin
  delete from public.role_permissions where access_role_id in (r_gerente, r_estoq, r_coz, r_aud, r_func);

  -- gerente: tudo menos nada (admin é a única exceção: gerente respeita unidades)
  insert into public.role_permissions select r_gerente, code from public.permissions;

  insert into public.role_permissions (access_role_id, permission_code)
  select r_estoq, unnest(array[
    'painel.ver','produtos.ver','fornecedores.ver','estoque.ver','estoque.movimentar','estoque.ajustar',
    'recebimento.ver','recebimento.criar','recebimento.finalizar','inventario.ver','inventario.contar','inventario.finalizar',
    'perdas.ver','perdas.registrar','compras.ver','compras.criar','temperaturas.ver','temperaturas.registrar',
    'checklists.ver','checklists.executar','tarefas.ver','tarefas.executar','etiquetas.imprimir','alertas.ver','alertas.resolver',
    'treinamentos.ver']);

  insert into public.role_permissions (access_role_id, permission_code)
  select r_coz, unnest(array[
    'painel.ver','produtos.ver','estoque.ver','estoque.movimentar','producao.ver','producao.criar','producao.finalizar',
    'fichas.ver','inventario.contar','perdas.ver','perdas.registrar','temperaturas.ver','temperaturas.registrar',
    'checklists.ver','checklists.executar','tarefas.ver','tarefas.executar','etiquetas.imprimir','alertas.ver','alertas.resolver',
    'treinamentos.ver']);

  insert into public.role_permissions (access_role_id, permission_code)
  select r_aud, unnest(array[
    'painel.ver','produtos.ver','fornecedores.ver','estoque.ver','recebimento.ver','producao.ver','fichas.ver',
    'inventario.ver','perdas.ver','compras.ver','temperaturas.ver','checklists.ver','tarefas.ver','alertas.ver',
    'relatorios.ver','relatorios.exportar','auditoria.ver','treinamentos.ver']);

  insert into public.role_permissions (access_role_id, permission_code)
  select r_func, unnest(array[
    'painel.ver','produtos.ver','estoque.ver','inventario.contar','perdas.registrar','temperaturas.ver','temperaturas.registrar',
    'checklists.ver','checklists.executar','tarefas.ver','tarefas.executar','etiquetas.imprimir','alertas.ver','treinamentos.ver']);
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY — tabelas desta migration
-- =====================================================================
alter table public.profiles               enable row level security;
alter table public.stores                 enable row level security;
alter table public.permissions            enable row level security;
alter table public.access_roles           enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.memberships            enable row level security;
alter table public.membership_stores      enable row level security;
alter table public.membership_permissions enable row level security;
alter table public.settings               enable row level security;
alter table public.audit_logs             enable row level security;

-- profiles: eu mesmo + colegas das minhas empresas
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or id in (
    select m.user_id from public.memberships m where m.company_id in (select public.ops_member_company_ids())));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (id in (select m.user_id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- stores
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

-- permissions / access_roles / role_permissions
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated using (true);

drop policy if exists access_roles_select on public.access_roles;
create policy access_roles_select on public.access_roles for select to authenticated
  using (company_id is null or company_id in (select public.ops_member_company_ids()));
drop policy if exists access_roles_write on public.access_roles;
create policy access_roles_write on public.access_roles for all to authenticated
  using (company_id is not null and company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')))
  with check (company_id is not null and company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (access_role_id in (select r.id from public.access_roles r where r.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))))
  with check (access_role_id in (select r.id from public.access_roles r where r.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));

-- memberships: vejo os da minha empresa; gerencio com usuarios.gerenciar
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or company_id in (select public.ops_member_company_ids()));
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')))
  with check (company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar')));

drop policy if exists membership_stores_select on public.membership_stores;
create policy membership_stores_select on public.membership_stores for select to authenticated
  using (membership_id in (select m.id from public.memberships m where m.user_id = auth.uid() or m.company_id in (select public.ops_member_company_ids())));
drop policy if exists membership_stores_write on public.membership_stores;
create policy membership_stores_write on public.membership_stores for all to authenticated
  using (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))))
  with check (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));

drop policy if exists membership_permissions_select on public.membership_permissions;
create policy membership_permissions_select on public.membership_permissions for select to authenticated
  using (membership_id in (select m.id from public.memberships m where m.user_id = auth.uid() or m.company_id in (select public.ops_member_company_ids())));
drop policy if exists membership_permissions_write on public.membership_permissions;
create policy membership_permissions_write on public.membership_permissions for all to authenticated
  using (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))))
  with check (membership_id in (select m.id from public.memberships m where m.company_id in (select public.ops_company_ids_with_permission('usuarios.gerenciar'))));

-- settings
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

-- audit_logs: leitura com auditoria.ver; escrita só pelas funções (security definer)
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('auditoria.ver')));

-- =====================================================================
-- RLS DAS TABELAS JÁ EXISTENTES (funções / treinamentos / VILA GPT)
--   Antes: acesso total com a chave anon. Agora: só membros autenticados.
-- =====================================================================
do $blk$
declare t text;
begin
  foreach t in array array['companies','roles','competencies','checklist_items',
                           'processes','employees','employee_roles','training_steps',
                           'training_events','activity_log','kb_articles','gpt_questions','gpt_login_attempts'] loop
    execute format('drop policy if exists "acesso_total_app" on public.%I', t);
  end loop;
end $blk$;

-- companies
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (id in (select public.ops_member_company_ids()));
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated
  using (public.ops_is_admin(id));
-- insert: apenas pela função ops_create_company (abaixo)

-- roles (funções operacionais)
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.ver')));
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')));

-- tabelas ligadas por role_id
do $blk$
declare t text;
begin
  foreach t in array array['competencies','checklist_items','processes'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (role_id in (select r.id from public.roles r where r.company_id in (select public.ops_company_ids_with_permission('treinamentos.ver'))))$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (role_id in (select r.id from public.roles r where r.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))
      with check (role_id in (select r.id from public.roles r where r.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))$p$, t, t);
  end loop;
end $blk$;

-- employees
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.ver')));
drop policy if exists employees_write on public.employees;
create policy employees_write on public.employees for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')));

-- tabelas ligadas por employee_id
do $blk$
declare t text;
begin
  foreach t in array array['employee_roles','training_steps'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (employee_id in (select e.id from public.employees e where e.company_id in (select public.ops_company_ids_with_permission('treinamentos.ver'))))$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
      using (employee_id in (select e.id from public.employees e where e.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))
      with check (employee_id in (select e.id from public.employees e where e.company_id in (select public.ops_company_ids_with_permission('treinamentos.editar'))))$p$, t, t);
  end loop;
end $blk$;

-- históricos do módulo de treinamentos (company_id pode ser null em exclusões de empresa)
do $blk$
declare t text;
begin
  foreach t in array array['training_events','activity_log'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (company_id is null or company_id in (select public.ops_company_ids_with_permission('treinamentos.ver')))$p$, t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format($p$create policy %I_insert on public.%I for insert to authenticated
      with check (company_id is null or company_id in (select public.ops_company_ids_with_permission('treinamentos.editar')))$p$, t, t);
  end loop;
end $blk$;

-- VILA GPT: base de conhecimento (global = company_id null) e histórico
drop policy if exists kb_articles_select on public.kb_articles;
create policy kb_articles_select on public.kb_articles for select to authenticated
  using (company_id is null or company_id in (select public.ops_member_company_ids()));
-- escrita da base: pelo servidor (service role) ou por quem pode editar configurações
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kb_articles' and policyname='escrita_servidor') then
    drop policy if exists kb_articles_write on public.kb_articles;
    create policy kb_articles_write on public.kb_articles for all to authenticated
      using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
      with check (company_id is null or company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
  end if;
end $$;

drop policy if exists gpt_questions_select on public.gpt_questions;
create policy gpt_questions_select on public.gpt_questions for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')) or employee_id = auth.uid());
drop policy if exists gpt_questions_insert on public.gpt_questions;
create policy gpt_questions_insert on public.gpt_questions for insert to authenticated
  with check (company_id is null or company_id in (select public.ops_member_company_ids()));
drop policy if exists gpt_questions_update_own on public.gpt_questions;
create policy gpt_questions_update_own on public.gpt_questions for update to authenticated
  using (employee_id = auth.uid()) with check (employee_id = auth.uid());
-- gpt_login_attempts: só o servidor (service role) — nenhuma policy para authenticated

-- =====================================================================
-- CRIAÇÃO DE EMPRESA (onboarding) — quem cria vira admin
-- =====================================================================
create or replace function public.ops_create_company(
  p_name text, p_emoji text default '🏪', p_color text default '#e11d48',
  p_store_name text default 'Matriz', p_notes text default ''
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_store uuid; v_role uuid; v_uid uuid := auth.uid(); v_pos int;
begin
  if v_uid is null then
    raise exception 'Você precisa estar autenticado.' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Informe o nome da empresa.';
  end if;
  select coalesce(max(position), -1) + 1 into v_pos from public.companies;
  insert into public.companies (name, emoji, color, notes, position)
  values (trim(p_name), coalesce(nullif(p_emoji, ''), '🏪'), coalesce(nullif(p_color, ''), '#e11d48'), coalesce(p_notes, ''), v_pos)
  returning id into v_company;

  select id into v_role from public.access_roles where company_id is null and code = 'admin';
  insert into public.profiles (id, email) values (v_uid, '') on conflict (id) do nothing;
  insert into public.memberships (company_id, user_id, access_role_id, all_stores, created_by)
  values (v_company, v_uid, v_role, true, v_uid);

  insert into public.stores (company_id, name, code, position)
  values (v_company, coalesce(nullif(trim(p_store_name), ''), 'Matriz'), 'U1', 0)
  returning id into v_store;

  perform public.ops_seed_company_defaults(v_company);
  perform public.ops_audit(v_company, v_store, 'criou', 'companies', v_company, trim(p_name), null, null, 'Empresa criada pelo assistente inicial');
  return v_company;
end;
$fn$;

-- placeholder: preenchido nas migrations seguintes (unidades de medida, motivos de perda...)
create or replace function public.ops_seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  return;
end;
$fn$;

-- Garante uma unidade para cada empresa já existente (sem apagar nada)
insert into public.stores (company_id, name, code, position)
select c.id, 'Matriz', 'U1', 0
from public.companies c
where not exists (select 1 from public.stores s where s.company_id = c.id);

-- =====================================================================
-- GRANTS (o Supabase já concede por padrão; explícito para segurança)
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function public.ops_needs_bootstrap() to anon, authenticated;
grant execute on function public.ops_invite_exists(text) to anon, authenticated;
-- anon não lê tabela alguma do app (login obrigatório)
revoke all on all tables in schema public from anon;

-- =====================================================================
-- ALERTAS (tabela base; regras de geração nas migrations seguintes)
-- =====================================================================
create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete cascade,
  kind         text not null check (kind in
                 ('vencido','vencendo','estoque_minimo','estoque_proximo_minimo','estoque_critico','temperatura',
                  'checklist_atrasado','producao_pendente','recebimento_problema','tarefa_atrasada','sincronizacao','outro')),
  severity     text not null default 'atencao' check (severity in ('info','atencao','critico')),
  title        text not null,
  message      text not null default '',
  entity_type  text,
  entity_id    uuid,
  dedupe_key   text,
  status       text not null default 'aberto' check (status in ('aberto','lido','resolvido')),
  read_by      uuid,
  read_at      timestamptz,
  resolved_by  uuid,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists alerts_store_status_idx on public.alerts(store_id, status, created_at desc);
create index if not exists alerts_company_status_idx on public.alerts(company_id, status, created_at desc);
create unique index if not exists alerts_dedupe_open_uidx on public.alerts(dedupe_key) where dedupe_key is not null and status <> 'resolvido';
create index if not exists alerts_entity_idx on public.alerts(entity_type, entity_id);
do $$ begin perform public.ops_ensure_updated_at('alerts'); end $$;

-- cria (ou atualiza) um alerta aberto com a mesma chave
create or replace function public.ops_alert_upsert(
  p_company uuid, p_store uuid, p_kind text, p_severity text, p_title text, p_message text,
  p_entity_type text default null, p_entity_id uuid default null, p_dedupe_key text default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if p_dedupe_key is not null then
    select id into v_id from public.alerts where dedupe_key = p_dedupe_key and status <> 'resolvido';
    if v_id is not null then
      update public.alerts set severity = p_severity, title = p_title, message = p_message, updated_at = now() where id = v_id;
      return v_id;
    end if;
  end if;
  insert into public.alerts (company_id, store_id, kind, severity, title, message, entity_type, entity_id, dedupe_key)
  values (p_company, p_store, p_kind, p_severity, p_title, coalesce(p_message, ''), p_entity_type, p_entity_id, p_dedupe_key)
  returning id into v_id;
  return v_id;
end;
$fn$;

alter table public.alerts enable row level security;
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('alertas.ver'))
      or (store_id is null and company_id in (select public.ops_company_ids_with_permission('alertas.ver'))));
drop policy if exists alerts_update on public.alerts;
create policy alerts_update on public.alerts for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('alertas.ver'))
      or (store_id is null and company_id in (select public.ops_company_ids_with_permission('alertas.ver'))))
  with check (store_id in (select public.ops_store_ids_with_permission('alertas.ver'))
      or (store_id is null and company_id in (select public.ops_company_ids_with_permission('alertas.ver'))));

-- Flag de sessão que identifica execução por função de negócio
create or replace function public.ops_internal_on() returns void language sql as $$ select set_config('ops.internal', 'on', true) $$;
create or replace function public.ops_internal_off() returns void language sql as $$ select set_config('ops.internal', 'off', true) $$;
create or replace function public.ops_is_internal() returns boolean language sql stable as $$ select coalesce(current_setting('ops.internal', true), '') = 'on' $$;

-- Trigger genérico: status só muda pelas funções de negócio; registros
-- finalizados/cancelados não são editados diretamente.
create or replace function public.ops_guard_status()
returns trigger language plpgsql as $fn$
begin
  if public.ops_is_internal() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('rascunho','planejada','aberta','pendente') then
      raise exception 'O status inicial deve ser rascunho/planejada/aberta. Use as ações do sistema para avançar.';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'O status de % só muda pelas ações do sistema (finalizar, aprovar, cancelar...).', tg_table_name;
  end if;
  if old.status in ('finalizado','concluida','cancelado','cancelada','finalizada','recebido') then
    raise exception 'Registro % já foi finalizado e não pode ser alterado. Faça um novo registro de correção.', tg_table_name;
  end if;
  return new;
end;
$fn$;

create or replace function public.ops_ensure_guard_status(p_table text)
returns void language plpgsql as $fn$
begin
  execute format('drop trigger if exists trg_%s_guard_status on public.%I', p_table, p_table);
  execute format('create trigger trg_%s_guard_status before insert or update on public.%I for each row execute function public.ops_guard_status()', p_table, p_table);
end;
$fn$;

-- funções internas: não podem ser chamadas diretamente pela API
revoke execute on function public.ops_audit(uuid, uuid, text, text, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.ops_alert_upsert(uuid, uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.ops_handle_new_user() from public, anon, authenticated;
revoke execute on function public.ops_seed_company_defaults(uuid) from public, anon, authenticated;
revoke execute on function public.ops_internal_on() from public, anon, authenticated;
revoke execute on function public.ops_internal_off() from public, anon, authenticated;

-- Chaves estrangeiras para perfis (permitem "embeds" memberships→profiles e
-- tasks→profiles no PostgREST; o perfil é criado antes do vínculo pelos triggers/funções)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_user_profile_fkey') then
    alter table public.memberships
      add constraint memberships_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;



-- ===================================================================
-- migration: 0002_ops_catalog.sql
-- ===================================================================

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



-- ===================================================================
-- migration: 0003_ops_stock.sql
-- ===================================================================

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



-- ===================================================================
-- migration: 0004_ops_purchasing_receiving.sql
-- ===================================================================

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



-- ===================================================================
-- migration: 0005_ops_recipes_production.sql
-- ===================================================================

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



-- ===================================================================
-- migration: 0006_ops_inventory.sql
-- ===================================================================

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



-- ===================================================================
-- migration: 0007_ops_temperature_checklists_tasks.sql
-- ===================================================================

-- =====================================================================
--  0007 · TEMPERATURAS, CHECKLISTS e TAREFAS
-- =====================================================================

-- ---------------------------------------------------------------------
-- REGISTROS DE TEMPERATURA
-- ---------------------------------------------------------------------
create table if not exists public.temperature_logs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  store_id           uuid not null references public.stores(id) on delete cascade,
  equipment_id       uuid not null references public.temperature_equipment(id) on delete cascade,
  temperature        numeric(6,2) not null,
  in_range           boolean not null default true,
  min_temp           numeric(6,2), max_temp numeric(6,2),          -- faixa no momento do registro
  measured_at        timestamptz not null default now(),
  measured_by        uuid, measured_by_name text not null default '',
  corrective_action  text not null default ''
                       check (corrective_action in ('','ajuste_equipamento','transferencia_produtos','manutencao','descarte','outro')),
  notes              text not null default '',
  alert_id           uuid references public.alerts(id) on delete set null,
  client_op_id       uuid,
  created_at         timestamptz not null default now()
);
create index if not exists temperature_logs_equipment_idx on public.temperature_logs(equipment_id, measured_at desc);
create index if not exists temperature_logs_store_idx on public.temperature_logs(store_id, measured_at desc);
create unique index if not exists temperature_logs_client_op_uidx on public.temperature_logs(client_op_id) where client_op_id is not null;

create or replace function public.ops_temperature_log_before_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_eq record;
begin
  select * into v_eq from public.temperature_equipment where id = new.equipment_id;
  if v_eq.id is null then raise exception 'Equipamento não encontrado.'; end if;
  new.store_id := v_eq.store_id;
  new.company_id := public.ops_store_company(v_eq.store_id);
  new.min_temp := v_eq.min_temp; new.max_temp := v_eq.max_temp;
  new.in_range := new.temperature between v_eq.min_temp and v_eq.max_temp;
  new.measured_by := coalesce(new.measured_by, auth.uid());
  new.measured_by_name := coalesce(nullif(new.measured_by_name, ''), public.ops_user_name());
  if not new.in_range and new.corrective_action = '' and coalesce(new.notes, '') = '' then
    raise exception 'Temperatura fora da faixa (% a % °C): informe a ação corretiva ou uma observação.', v_eq.min_temp, v_eq.max_temp;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_temperature_logs_before_insert on public.temperature_logs;
create trigger trg_temperature_logs_before_insert before insert on public.temperature_logs
  for each row execute function public.ops_temperature_log_before_insert();

create or replace function public.ops_temperature_log_after_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_eq record; v_alert uuid;
begin
  select * into v_eq from public.temperature_equipment where id = new.equipment_id;
  if not new.in_range then
    v_alert := public.ops_alert_upsert(new.company_id, new.store_id, 'temperatura', 'critico',
      'Temperatura fora da faixa: ' || v_eq.name,
      format('%s °C registrado por %s (faixa %s a %s °C). Ação: %s. %s', new.temperature, new.measured_by_name, v_eq.min_temp, v_eq.max_temp,
             coalesce(nullif(replace(new.corrective_action, '_', ' '), ''), 'não informada'), new.notes),
      'temperature_log', new.id, null);
    update public.temperature_logs set alert_id = v_alert where id = new.id;
  else
    -- volta à faixa: resolve alertas abertos deste equipamento
    update public.alerts a set status = 'resolvido', resolved_at = now()
    where a.kind = 'temperatura' and a.status <> 'resolvido' and a.entity_type = 'temperature_log'
      and a.entity_id in (select id from public.temperature_logs where equipment_id = new.equipment_id and measured_at < new.measured_at);
  end if;
  return null;
end;
$fn$;
drop trigger if exists trg_temperature_logs_after_insert on public.temperature_logs;
create trigger trg_temperature_logs_after_insert after insert on public.temperature_logs
  for each row execute function public.ops_temperature_log_after_insert();

-- Registro rápido (idempotente para a fila offline)
create or replace function public.ops_temperature_register(
  p_equipment uuid, p_temperature numeric, p_corrective_action text default '', p_notes text default '',
  p_measured_at timestamptz default now(), p_client_op_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_store uuid; v_id uuid; v_row record;
begin
  select store_id into v_store from public.temperature_equipment where id = p_equipment;
  if v_store is null then raise exception 'Equipamento não encontrado.'; end if;
  perform public.ops_require(v_store, 'temperaturas.registrar');
  if p_client_op_id is not null then
    select id into v_id from public.temperature_logs where client_op_id = p_client_op_id;
    if v_id is not null then return jsonb_build_object('ok', true, 'duplicated', true, 'id', v_id); end if;
  end if;
  insert into public.temperature_logs (company_id, store_id, equipment_id, temperature, corrective_action, notes, measured_at, client_op_id)
  values (public.ops_store_company(v_store), v_store, p_equipment, p_temperature, coalesce(p_corrective_action, ''), coalesce(p_notes, ''), coalesce(p_measured_at, now()), p_client_op_id)
  returning id into v_id;
  select * into v_row from public.temperature_logs where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'in_range', v_row.in_range, 'alert_id', v_row.alert_id, 'min', v_row.min_temp, 'max', v_row.max_temp);
end;
$fn$;

-- ---------------------------------------------------------------------
-- CHECKLISTS (modelos)
-- ---------------------------------------------------------------------
create table if not exists public.checklists (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  store_id        uuid references public.stores(id) on delete cascade,    -- null = todas as unidades
  name            text not null,
  kind            text not null default 'outro'
                    check (kind in ('abertura','fechamento','limpeza','geladeira','freezer','cozinha','estoque','seguranca_alimentar','outro')),
  description     text not null default '',
  frequency       text not null default 'diaria' check (frequency in ('diaria','semanal','mensal','por_turno','sob_demanda')),
  scheduled_time  time,                          -- horário previsto
  weekdays        smallint[] not null default '{0,1,2,3,4,5,6}',   -- 0=domingo
  month_day       smallint,                      -- para mensal
  assigned_role_id uuid references public.access_roles(id) on delete set null,
  assigned_to     uuid,                          -- usuário responsável padrão
  mandatory       boolean not null default true,
  requires_evidence boolean not null default false,
  active          boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists checklists_company_idx on public.checklists(company_id);
create index if not exists checklists_store_idx on public.checklists(store_id);
do $$ begin perform public.ops_ensure_updated_at('checklists'); perform public.ops_ensure_audit('checklists'); end $$;

create table if not exists public.checklist_tasks (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.checklists(id) on delete cascade,
  text           text not null,
  description    text not null default '',
  critical       boolean not null default false,     -- exige foto ou observação
  requires_photo boolean not null default false,
  position       integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists checklist_tasks_checklist_idx on public.checklist_tasks(checklist_id);
do $$ begin perform public.ops_ensure_updated_at('checklist_tasks'); end $$;

-- ---------------------------------------------------------------------
-- EXECUÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.checklist_executions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  store_id       uuid not null references public.stores(id) on delete cascade,
  checklist_id   uuid not null references public.checklists(id) on delete cascade,
  due_date       date not null default current_date,
  due_time       time,
  shift          text not null default '',
  status         text not null default 'pendente' check (status in ('pendente','em_andamento','concluido','atrasado','cancelado')),
  total_items    integer not null default 0,
  done_items     integer not null default 0,
  assigned_to    uuid,
  started_by     uuid, started_at timestamptz,
  finished_by    uuid, finished_by_name text not null default '', finished_at timestamptz,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists checklist_executions_store_date_idx on public.checklist_executions(store_id, due_date desc);
create index if not exists checklist_executions_status_idx on public.checklist_executions(store_id, status);
create unique index if not exists checklist_executions_daily_uidx on public.checklist_executions(checklist_id, store_id, due_date, shift);
do $$ begin perform public.ops_ensure_updated_at('checklist_executions'); end $$;

create table if not exists public.checklist_execution_items (
  id             uuid primary key default gen_random_uuid(),
  execution_id   uuid not null references public.checklist_executions(id) on delete cascade,
  task_id        uuid references public.checklist_tasks(id) on delete set null,
  text           text not null,
  critical       boolean not null default false,
  requires_photo boolean not null default false,
  done           boolean not null default false,
  done_by        uuid, done_by_name text not null default '', done_at timestamptz,
  notes          text not null default '',
  photo_url      text not null default '',
  position       integer not null default 0,
  client_op_id   uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists checklist_execution_items_exec_idx on public.checklist_execution_items(execution_id);
create unique index if not exists checklist_execution_items_client_op_uidx on public.checklist_execution_items(client_op_id) where client_op_id is not null;
do $$ begin perform public.ops_ensure_updated_at('checklist_execution_items'); end $$;

-- Gera as execuções previstas de uma unidade para uma data (idempotente)
create or replace function public.ops_generate_checklists(p_store uuid, p_date date default current_date)
returns integer language plpgsql security definer set search_path = public as $fn$
declare c record; v_company uuid; v_n int := 0; v_exec uuid; v_dow int; v_shifts text[]; s text;
begin
  perform public.ops_require(p_store, 'checklists.ver');
  v_company := public.ops_store_company(p_store);
  v_dow := extract(dow from p_date)::int;
  for c in select * from public.checklists where company_id = v_company and active and (store_id is null or store_id = p_store) loop
    if c.frequency = 'sob_demanda' then continue; end if;
    if c.frequency in ('diaria','por_turno','semanal') and not (v_dow = any(c.weekdays)) then continue; end if;
    if c.frequency = 'mensal' and coalesce(c.month_day, 1) <> extract(day from p_date)::int then continue; end if;
    v_shifts := case when c.frequency = 'por_turno' then array['manhã','tarde','noite'] else array[''] end;
    foreach s in array v_shifts loop
      if exists (select 1 from public.checklist_executions where checklist_id = c.id and store_id = p_store and due_date = p_date and shift = s) then continue; end if;
      insert into public.checklist_executions (company_id, store_id, checklist_id, due_date, due_time, shift, status, assigned_to, total_items)
      values (v_company, p_store, c.id, p_date, c.scheduled_time, s, 'pendente', c.assigned_to,
              (select count(*) from public.checklist_tasks t where t.checklist_id = c.id and t.active))
      returning id into v_exec;
      insert into public.checklist_execution_items (execution_id, task_id, text, critical, requires_photo, position)
      select v_exec, t.id, t.text, t.critical, t.requires_photo, t.position from public.checklist_tasks t where t.checklist_id = c.id and t.active order by t.position;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$fn$;

-- Abre uma execução avulsa (sob demanda)
create or replace function public.ops_checklist_start(p_checklist uuid, p_store uuid, p_date date default current_date, p_shift text default '')
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_exec uuid; c record;
begin
  perform public.ops_require(p_store, 'checklists.executar');
  select * into c from public.checklists where id = p_checklist;
  if c.id is null then raise exception 'Checklist não encontrado.'; end if;
  select id into v_exec from public.checklist_executions where checklist_id = p_checklist and store_id = p_store and due_date = p_date and shift = coalesce(p_shift, '');
  if v_exec is not null then return v_exec; end if;
  insert into public.checklist_executions (company_id, store_id, checklist_id, due_date, due_time, shift, status, assigned_to, total_items, started_by, started_at)
  values (c.company_id, p_store, p_checklist, p_date, c.scheduled_time, coalesce(p_shift, ''), 'em_andamento', auth.uid(),
          (select count(*) from public.checklist_tasks t where t.checklist_id = c.id and t.active), auth.uid(), now())
  returning id into v_exec;
  insert into public.checklist_execution_items (execution_id, task_id, text, critical, requires_photo, position)
  select v_exec, t.id, t.text, t.critical, t.requires_photo, t.position from public.checklist_tasks t where t.checklist_id = c.id and t.active order by t.position;
  return v_exec;
end;
$fn$;

-- Marca/desmarca um item (tarefa crítica exige foto ou observação)
create or replace function public.ops_checklist_item_set(p_item uuid, p_done boolean, p_notes text default '', p_photo_url text default '', p_client_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_it record; v_ex record; v_done int; v_total int;
begin
  select * into v_it from public.checklist_execution_items where id = p_item;
  if v_it.id is null then raise exception 'Item não encontrado.'; end if;
  select * into v_ex from public.checklist_executions where id = v_it.execution_id;
  perform public.ops_require(v_ex.store_id, 'checklists.executar');
  if v_ex.status in ('concluido','cancelado') then raise exception 'Checklist já %.', v_ex.status; end if;
  if p_done then
    if v_it.requires_photo and coalesce(nullif(p_photo_url, ''), nullif(v_it.photo_url, '')) is null then
      raise exception 'Esta tarefa exige foto.';
    end if;
    if v_it.critical and coalesce(nullif(p_photo_url, ''), nullif(v_it.photo_url, ''), nullif(p_notes, ''), nullif(v_it.notes, '')) is null then
      raise exception 'Tarefa crítica: informe uma observação ou foto.';
    end if;
  end if;
  update public.checklist_execution_items set
    done = p_done, done_by = case when p_done then auth.uid() end, done_by_name = case when p_done then public.ops_user_name() else '' end,
    done_at = case when p_done then now() end,
    notes = case when p_notes <> '' then p_notes else notes end,
    photo_url = case when p_photo_url <> '' then p_photo_url else photo_url end,
    client_op_id = coalesce(client_op_id, p_client_op_id)
  where id = p_item;
  select count(*) filter (where done), count(*) into v_done, v_total from public.checklist_execution_items where execution_id = v_ex.id;
  update public.checklist_executions set done_items = v_done, total_items = v_total,
    status = case when status = 'pendente' or status = 'atrasado' then 'em_andamento' else status end,
    started_by = coalesce(started_by, auth.uid()), started_at = coalesce(started_at, now())
  where id = v_ex.id;
  perform public.ops_audit(v_ex.company_id, v_ex.store_id, case when p_done then 'marcou_item' else 'desmarcou_item' end, 'checklist_execution_items', p_item, v_it.text, null,
    jsonb_build_object('done', p_done, 'notes', p_notes, 'photo', p_photo_url <> ''));
  return jsonb_build_object('ok', true, 'done_items', v_done, 'total_items', v_total);
end;
$fn$;

create or replace function public.ops_checklist_finish(p_execution uuid, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ex record; v_pending int;
begin
  select * into v_ex from public.checklist_executions where id = p_execution;
  if v_ex.id is null then raise exception 'Execução não encontrada.'; end if;
  perform public.ops_require(v_ex.store_id, 'checklists.executar');
  if v_ex.status in ('concluido','cancelado') then raise exception 'Checklist já %.', v_ex.status; end if;
  select count(*) into v_pending from public.checklist_execution_items where execution_id = p_execution and not done;
  if v_pending > 0 and (select mandatory from public.checklists where id = v_ex.checklist_id) then
    raise exception 'Ainda há % tarefa(s) pendente(s). Conclua todas antes de finalizar.', v_pending;
  end if;
  update public.checklist_executions set status = 'concluido', finished_by = auth.uid(), finished_by_name = public.ops_user_name(), finished_at = now(),
    notes = case when p_notes <> '' then p_notes else notes end,
    done_items = (select count(*) from public.checklist_execution_items where execution_id = p_execution and done)
  where id = p_execution;
  update public.alerts set status = 'resolvido', resolved_at = now() where entity_type = 'checklist_execution' and entity_id = p_execution and status <> 'resolvido';
  perform public.ops_audit(v_ex.company_id, v_ex.store_id, 'concluiu_checklist', 'checklist_executions', p_execution,
    (select name from public.checklists where id = v_ex.checklist_id), null, jsonb_build_object('pending', v_pending));
  return jsonb_build_object('ok', true, 'pending', v_pending);
end;
$fn$;

-- ---------------------------------------------------------------------
-- TAREFAS
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  store_id       uuid not null references public.stores(id) on delete cascade,
  title          text not null,
  description    text not null default '',
  assigned_to    uuid,
  assigned_name  text not null default '',
  priority       text not null default 'media' check (priority in ('baixa','media','alta','urgente')),
  status         text not null default 'pendente' check (status in ('pendente','em_andamento','concluida','atrasada','cancelada')),
  due_at         timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  completed_by   uuid,
  source_type    text,            -- alert | checklist | production | receipt | manual
  source_id      uuid,
  notes          text not null default '',
  created_by     uuid, created_by_name text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists tasks_store_status_idx on public.tasks(store_id, status, due_at);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to, status);
do $$ begin perform public.ops_ensure_updated_at('tasks'); perform public.ops_ensure_audit('tasks'); end $$;

create or replace function public.ops_task_before_write()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    new.company_id := coalesce(new.company_id, public.ops_store_company(new.store_id));
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(nullif(new.created_by_name, ''), public.ops_user_name());
  end if;
  if new.assigned_to is not null and (new.assigned_name = '' or new.assigned_to is distinct from (case when tg_op = 'UPDATE' then old.assigned_to end)) then
    new.assigned_name := public.ops_user_name(new.assigned_to);
  end if;
  if new.status = 'concluida' and new.completed_at is null then
    new.completed_at := now(); new.completed_by := coalesce(new.completed_by, auth.uid());
  end if;
  if new.status = 'em_andamento' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('pendente','em_andamento') and new.due_at is not null and new.due_at < now() then new.status := 'atrasada'; end if;
  if new.status = 'atrasada' and (new.due_at is null or new.due_at >= now()) then new.status := 'pendente'; end if;
  return new;
end;
$fn$;
drop trigger if exists trg_tasks_before_write on public.tasks;
create trigger trg_tasks_before_write before insert or update on public.tasks
  for each row execute function public.ops_task_before_write();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.temperature_logs          enable row level security;
alter table public.checklists                enable row level security;
alter table public.checklist_tasks           enable row level security;
alter table public.checklist_executions      enable row level security;
alter table public.checklist_execution_items enable row level security;
alter table public.tasks                     enable row level security;

drop policy if exists temperature_logs_select on public.temperature_logs;
create policy temperature_logs_select on public.temperature_logs for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('temperaturas.ver')));
drop policy if exists temperature_logs_insert on public.temperature_logs;
create policy temperature_logs_insert on public.temperature_logs for insert to authenticated
  with check (equipment_id in (select e.id from public.temperature_equipment e where e.store_id in (select public.ops_store_ids_with_permission('temperaturas.registrar'))));
drop policy if exists temperature_logs_update on public.temperature_logs;
create policy temperature_logs_update on public.temperature_logs for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('temperaturas.registrar')))
  with check (store_id in (select public.ops_store_ids_with_permission('temperaturas.registrar')));

drop policy if exists checklists_select on public.checklists;
create policy checklists_select on public.checklists for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('checklists.ver')));
drop policy if exists checklists_write on public.checklists;
create policy checklists_write on public.checklists for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('checklists.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('checklists.editar')));

drop policy if exists checklist_tasks_select on public.checklist_tasks;
create policy checklist_tasks_select on public.checklist_tasks for select to authenticated
  using (checklist_id in (select id from public.checklists where company_id in (select public.ops_company_ids_with_permission('checklists.ver'))));
drop policy if exists checklist_tasks_write on public.checklist_tasks;
create policy checklist_tasks_write on public.checklist_tasks for all to authenticated
  using (checklist_id in (select id from public.checklists where company_id in (select public.ops_company_ids_with_permission('checklists.editar'))))
  with check (checklist_id in (select id from public.checklists where company_id in (select public.ops_company_ids_with_permission('checklists.editar'))));

drop policy if exists checklist_executions_select on public.checklist_executions;
create policy checklist_executions_select on public.checklist_executions for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('checklists.ver')));
drop policy if exists checklist_executions_update on public.checklist_executions;
create policy checklist_executions_update on public.checklist_executions for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('checklists.editar')))
  with check (store_id in (select public.ops_store_ids_with_permission('checklists.editar')));

drop policy if exists checklist_execution_items_select on public.checklist_execution_items;
create policy checklist_execution_items_select on public.checklist_execution_items for select to authenticated
  using (execution_id in (select id from public.checklist_executions where store_id in (select public.ops_store_ids_with_permission('checklists.ver'))));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('tarefas.ver')) or assigned_to = auth.uid());
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (store_id in (select public.ops_store_ids_with_permission('tarefas.editar')));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('tarefas.editar'))
      or (assigned_to = auth.uid() and store_id in (select public.ops_store_ids_with_permission('tarefas.executar'))))
  with check (store_id in (select public.ops_store_ids_with_permission('tarefas.editar'))
      or (assigned_to = auth.uid() and store_id in (select public.ops_store_ids_with_permission('tarefas.executar'))));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('tarefas.editar')));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_assigned_profile_fkey') then
    alter table public.tasks
      add constraint tasks_assigned_profile_fkey foreign key (assigned_to) references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_assigned_profile_fkey') then
    alter table public.checklist_executions
      add constraint checklist_executions_assigned_profile_fkey foreign key (assigned_to) references public.profiles(id) on delete set null;
  end if;
end $$;



-- ===================================================================
-- migration: 0008_ops_labels_alerts.sql
-- ===================================================================

-- =====================================================================
--  0008 · ETIQUETAS, ALERTAS (regras), INTEGRAÇÕES (outbox)
-- =====================================================================

-- ---------------------------------------------------------------------
-- MODELOS DE ETIQUETA
--   layout jsonb: { fields: [{key, x, y, w, h, font, bold, align, label}], qr: {x,y,size}, barcode: {...}, logo: {...} }
-- ---------------------------------------------------------------------
create table if not exists public.label_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  kind        text not null default 'producao'
                check (kind in ('producao','abertura','congelamento','descongelamento','fracionamento','armazenamento','recebimento','generica')),
  width_mm    numeric(6,1) not null default 60,
  height_mm   numeric(6,1) not null default 40,
  layout      jsonb not null default '{}'::jsonb,
  is_default  boolean not null default false,
  active      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists label_templates_company_idx on public.label_templates(company_id);
do $$ begin perform public.ops_ensure_updated_at('label_templates'); perform public.ops_ensure_audit('label_templates'); end $$;

-- etiquetas emitidas (histórico imutável)
create table if not exists public.labels (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  template_id   uuid references public.label_templates(id) on delete set null,
  product_id    uuid references public.products(id) on delete set null,
  lot_id        uuid references public.stock_lots(id) on delete set null,
  kind          text not null default 'producao',
  copies        integer not null default 1,
  payload       jsonb not null default '{}'::jsonb,
  printed_by    uuid, printed_by_name text not null default '',
  printed_at    timestamptz not null default now()
);
create index if not exists labels_store_idx on public.labels(store_id, printed_at desc);
create index if not exists labels_lot_idx on public.labels(lot_id);
do $$ begin perform public.ops_ensure_immutable('labels'); end $$;

create or replace function public.ops_label_before_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.company_id := coalesce(new.company_id, public.ops_store_company(new.store_id));
  new.printed_by := coalesce(new.printed_by, auth.uid());
  new.printed_by_name := coalesce(nullif(new.printed_by_name, ''), public.ops_user_name());
  return new;
end;
$fn$;
drop trigger if exists trg_labels_before_insert on public.labels;
create trigger trg_labels_before_insert before insert on public.labels for each row execute function public.ops_label_before_insert();

-- Modelos padrão por empresa
create or replace function public.ops_seed_label_templates(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_layout jsonb;
begin
  if exists (select 1 from public.label_templates where company_id = p_company) then return; end if;
  v_layout := jsonb_build_object(
    'fields', jsonb_build_array(
      jsonb_build_object('key','company_name','x',2,'y',1.5,'w',36,'h',4,'font',7,'bold',true),
      jsonb_build_object('key','product_name','x',2,'y',6,'w',40,'h',9,'font',11,'bold',true),
      jsonb_build_object('key','produced_at','label','Produção','x',2,'y',16,'w',20,'h',4,'font',7),
      jsonb_build_object('key','expires_at','label','Validade','x',22,'y',16,'w',20,'h',4,'font',7,'bold',true),
      jsonb_build_object('key','lot_code','label','Lote','x',2,'y',21,'w',20,'h',4,'font',7),
      jsonb_build_object('key','quantity','label','Qtd','x',22,'y',21,'w',20,'h',4,'font',7),
      jsonb_build_object('key','responsible','label','Resp.','x',2,'y',26,'w',40,'h',4,'font',7),
      jsonb_build_object('key','location','label','Local','x',2,'y',31,'w',40,'h',4,'font',7)
    ),
    'qr', jsonb_build_object('x',43,'y',20,'size',16),
    'barcode', jsonb_build_object('enabled', false, 'x', 2, 'y', 35, 'w', 40, 'h', 4),
    'logo', jsonb_build_object('enabled', true, 'x', 43, 'y', 2, 'w', 15, 'h', 15));
  insert into public.label_templates (company_id, name, kind, width_mm, height_mm, layout, is_default, position) values
    (p_company, 'Produção 60×40',        'producao',        60, 40, v_layout, true, 0),
    (p_company, 'Abertura 60×40',        'abertura',        60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','opened_at','label','Abertura','x',2,'y',16,'w',20,'h',4,'font',7)), true, 1),
    (p_company, 'Congelamento 60×40',    'congelamento',    60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','frozen_at','label','Congelado','x',2,'y',16,'w',20,'h',4,'font',7)), true, 2),
    (p_company, 'Descongelamento 60×40', 'descongelamento', 60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','thawed_at','label','Descongel.','x',2,'y',16,'w',20,'h',4,'font',7)), true, 3),
    (p_company, 'Fracionamento 60×40',   'fracionamento',   60, 40, v_layout, true, 4),
    (p_company, 'Armazenamento 60×40',   'armazenamento',   60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','received_at','label','Recebido','x',2,'y',16,'w',20,'h',4,'font',7)), true, 5),
    (p_company, 'Recebimento 60×40',     'recebimento',     60, 40, jsonb_set(v_layout, '{fields,2}', jsonb_build_object('key','received_at','label','Recebido','x',2,'y',16,'w',20,'h',4,'font',7)), true, 6),
    (p_company, 'Pequena 50×30',         'generica',        50, 30, jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','product_name','x',1.5,'y',1.5,'w',32,'h',8,'font',9,'bold',true),
        jsonb_build_object('key','expires_at','label','Val.','x',1.5,'y',11,'w',32,'h',4,'font',7,'bold',true),
        jsonb_build_object('key','lot_code','label','Lote','x',1.5,'y',16,'w',32,'h',4,'font',6),
        jsonb_build_object('key','responsible','label','Resp.','x',1.5,'y',21,'w',32,'h',4,'font',6)),
      'qr', jsonb_build_object('x',35,'y',8,'size',13), 'barcode', jsonb_build_object('enabled', false), 'logo', jsonb_build_object('enabled', false)), true, 7);
end;
$fn$;

-- ---------------------------------------------------------------------
-- ALERTAS: leitura/resolução e varredura
-- ---------------------------------------------------------------------
create or replace function public.ops_alert_mark(p_alert uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_a record;
begin
  select * into v_a from public.alerts where id = p_alert;
  if v_a.id is null then raise exception 'Alerta não encontrado.'; end if;
  if p_status = 'resolvido' then
    if v_a.store_id is not null then perform public.ops_require(v_a.store_id, 'alertas.resolver');
    else perform public.ops_require_company(v_a.company_id, 'alertas.resolver'); end if;
    update public.alerts set status = 'resolvido', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  elsif p_status = 'lido' then
    if v_a.store_id is not null then perform public.ops_require(v_a.store_id, 'alertas.ver');
    else perform public.ops_require_company(v_a.company_id, 'alertas.ver'); end if;
    update public.alerts set status = 'lido', read_by = auth.uid(), read_at = now() where id = p_alert and status = 'aberto';
  else
    raise exception 'Status inválido.';
  end if;
end;
$fn$;

create or replace function public.ops_alerts_mark_all_read(p_store uuid)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  perform public.ops_require(p_store, 'alertas.ver');
  update public.alerts set status = 'lido', read_by = auth.uid(), read_at = now() where store_id = p_store and status = 'aberto';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- Varredura: validade, estoque mínimo, checklists atrasados, produção pendente, tarefas atrasadas.
-- Chamada ao abrir o painel (cliente) e pelo cron diário (servidor).
create or replace function public.ops_refresh_alerts(p_store uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; r record; v_days_warn int; v_n int := 0; v_key text; v_level text; v_sev text; v_unit text;
begin
  if not public.ops_has_permission(p_store, 'alertas.ver') and not public.ops_is_service_role() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  v_company := public.ops_store_company(p_store);
  v_days_warn := coalesce((public.ops_setting(p_store, 'validade.dias_alerta', '7'::jsonb))::text::int, 7);

  -- 1) lotes vencidos / vencendo
  for r in
    select l.id, l.lot_code, l.expires_at, p.name, u.code as unit, sum(si.quantity) as qty
    from public.stock_lots l join public.products p on p.id = l.product_id join public.units u on u.id = p.stock_unit_id
    join public.stock_items si on si.lot_id = l.id
    where l.store_id = p_store and l.status in ('ativo','vencido') and l.expires_at is not null and l.expires_at <= current_date + v_days_warn
    group by l.id, l.lot_code, l.expires_at, p.name, u.code having sum(si.quantity) > 0
  loop
    if r.expires_at < current_date then
      perform public.ops_refresh_lot_status(r.id);
      perform public.ops_alert_upsert(v_company, p_store, 'vencido', 'critico', 'Vencido: ' || r.name,
        format('Lote %s venceu em %s — %s %s em estoque. Registre a perda ou bloqueie o lote.', r.lot_code, to_char(r.expires_at, 'DD/MM/YYYY'), r.qty, r.unit),
        'stock_lot', r.id, 'vencido:' || r.id);
    else
      v_sev := case when r.expires_at <= current_date + 1 then 'critico' when r.expires_at <= current_date + 3 then 'atencao' else 'info' end;
      perform public.ops_alert_upsert(v_company, p_store, 'vencendo', v_sev, 'Vencendo: ' || r.name,
        format('Lote %s vence em %s (%s dia(s)) — %s %s em estoque. Use primeiro (FEFO).', r.lot_code, to_char(r.expires_at, 'DD/MM/YYYY'), r.expires_at - current_date, r.qty, r.unit),
        'stock_lot', r.id, 'vencendo:' || r.id);
    end if;
    v_n := v_n + 1;
  end loop;
  -- resolve alertas de validade de lotes que não têm mais saldo
  update public.alerts a set status = 'resolvido', resolved_at = now()
  where a.store_id = p_store and a.kind in ('vencido','vencendo') and a.status <> 'resolvido'
    and public.ops_lot_balance(a.entity_id) <= 0;

  -- 2) estoque mínimo
  for r in
    select p.id, p.name, u.code as unit,
           coalesce(pss.min_stock, p.min_stock) as min_stock, coalesce(pss.reorder_point, p.reorder_point) as reorder_point,
           coalesce((select sum(si.quantity) from public.stock_items si join public.stock_lots l on l.id = si.lot_id
                     where si.store_id = p_store and si.product_id = p.id and l.status <> 'bloqueado'
                       and (l.expires_at is null or l.expires_at >= current_date)), 0) as qty
    from public.products p left join public.product_store_settings pss on pss.product_id = p.id and pss.store_id = p_store
    join public.units u on u.id = p.stock_unit_id
    where p.company_id = v_company and p.active and coalesce(pss.active, true)
      and (coalesce(pss.min_stock, p.min_stock) > 0 or coalesce(pss.reorder_point, p.reorder_point) > 0)
  loop
    v_level := public.ops_stock_level(r.qty, r.min_stock, r.reorder_point);
    if v_level = 'critico' then
      perform public.ops_alert_upsert(v_company, p_store, 'estoque_critico', 'critico', 'Estoque crítico: ' || r.name,
        format('%s %s em estoque (mínimo %s %s). Compre com urgência.', r.qty, r.unit, r.min_stock, r.unit), 'product', r.id, 'estoque:' || p_store || ':' || r.id);
      v_n := v_n + 1;
    elsif v_level = 'baixo' then
      perform public.ops_alert_upsert(v_company, p_store, 'estoque_minimo', 'atencao', 'Abaixo do mínimo: ' || r.name,
        format('%s %s em estoque (mínimo %s %s).', r.qty, r.unit, r.min_stock, r.unit), 'product', r.id, 'estoque:' || p_store || ':' || r.id);
      v_n := v_n + 1;
    elsif v_level = 'atencao' then
      perform public.ops_alert_upsert(v_company, p_store, 'estoque_proximo_minimo', 'info', 'Próximo do mínimo: ' || r.name,
        format('%s %s em estoque (mínimo %s %s).', r.qty, r.unit, r.min_stock, r.unit), 'product', r.id, 'estoque:' || p_store || ':' || r.id);
      v_n := v_n + 1;
    else
      update public.alerts set status = 'resolvido', resolved_at = now() where dedupe_key = 'estoque:' || p_store || ':' || r.id and status <> 'resolvido';
    end if;
  end loop;

  -- 3) checklists atrasados (dia anterior sem concluir, ou horário passado)
  update public.checklist_executions e set status = 'atrasado'
  where e.store_id = p_store and e.status in ('pendente','em_andamento')
    and (e.due_date < current_date or (e.due_date = current_date and e.due_time is not null and (current_date + e.due_time + interval '2 hours') < now()));
  for r in select e.id, e.due_date, c.name from public.checklist_executions e join public.checklists c on c.id = e.checklist_id
           where e.store_id = p_store and e.status = 'atrasado' loop
    perform public.ops_alert_upsert(v_company, p_store, 'checklist_atrasado', 'critico', 'Checklist atrasado: ' || r.name,
      'Previsto para ' || to_char(r.due_date, 'DD/MM/YYYY') || ' e ainda não concluído.', 'checklist_execution', r.id, 'checklist:' || r.id);
    v_n := v_n + 1;
  end loop;

  -- 4) produções planejadas para hoje ou atrasadas
  for r in select p.id, p.number, p.scheduled_for, pr.name from public.productions p join public.products pr on pr.id = p.product_id
           where p.store_id = p_store and p.status in ('planejada','em_andamento') and coalesce(p.scheduled_for, p.created_at::date) <= current_date loop
    perform public.ops_alert_upsert(v_company, p_store, 'producao_pendente', case when r.scheduled_for < current_date then 'atencao' else 'info' end,
      'Produção pendente: ' || r.name, 'Produção ' || r.number || ' prevista para ' || to_char(coalesce(r.scheduled_for, current_date), 'DD/MM/YYYY') || '.',
      'production', r.id, 'producao:' || r.id);
    v_n := v_n + 1;
  end loop;

  -- 5) tarefas atrasadas
  update public.tasks set status = 'atrasada' where store_id = p_store and status in ('pendente','em_andamento') and due_at is not null and due_at < now();
  for r in select id, title from public.tasks where store_id = p_store and status = 'atrasada' loop
    perform public.ops_alert_upsert(v_company, p_store, 'tarefa_atrasada', 'atencao', 'Tarefa atrasada: ' || r.title, '', 'task', r.id, 'tarefa:' || r.id);
    v_n := v_n + 1;
  end loop;
  update public.alerts a set status = 'resolvido', resolved_at = now()
  where a.store_id = p_store and a.kind = 'tarefa_atrasada' and a.status <> 'resolvido'
    and not exists (select 1 from public.tasks t where t.id = a.entity_id and t.status = 'atrasada');

  return jsonb_build_object('ok', true, 'touched', v_n);
end;
$fn$;

-- ---------------------------------------------------------------------
-- OUTBOX DE INTEGRAÇÕES (PDV, iFood, ERP, balança...) — sem implementação externa
-- ---------------------------------------------------------------------
create table if not exists public.integration_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  store_id      uuid references public.stores(id) on delete cascade,
  direction     text not null default 'out' check (direction in ('in','out')),
  provider      text not null default '',       -- pdv | ifood | whatsapp | erp | fiscal | balanca | impressora | bi | outro
  kind          text not null,                  -- ex.: stock.updated, production.finished, order.received
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pendente' check (status in ('pendente','processado','erro','ignorado')),
  attempts      integer not null default 0,
  last_error    text not null default '',
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists integration_events_status_idx on public.integration_events(status, created_at);
create index if not exists integration_events_company_idx on public.integration_events(company_id, created_at desc);

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  key_hash    text not null unique,      -- sha256 da chave; a chave só é mostrada na criação
  scopes      text[] not null default '{}',
  active      boolean not null default true,
  last_used_at timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists api_keys_company_idx on public.api_keys(company_id);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.label_templates    enable row level security;
alter table public.labels             enable row level security;
alter table public.integration_events enable row level security;
alter table public.api_keys           enable row level security;

drop policy if exists label_templates_select on public.label_templates;
create policy label_templates_select on public.label_templates for select to authenticated
  using (company_id in (select public.ops_member_company_ids()));
drop policy if exists label_templates_write on public.label_templates;
create policy label_templates_write on public.label_templates for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('etiquetas.editar_modelos')))
  with check (company_id in (select public.ops_company_ids_with_permission('etiquetas.editar_modelos')));

drop policy if exists labels_select on public.labels;
create policy labels_select on public.labels for select to authenticated
  using (store_id in (select public.ops_store_ids_with_permission('etiquetas.imprimir'))
      or store_id in (select public.ops_store_ids_with_permission('estoque.ver')));
drop policy if exists labels_insert on public.labels;
create policy labels_insert on public.labels for insert to authenticated
  with check (store_id in (select public.ops_store_ids_with_permission('etiquetas.imprimir')));

drop policy if exists integration_events_select on public.integration_events;
create policy integration_events_select on public.integration_events for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys for select to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));
drop policy if exists api_keys_write on public.api_keys;
create policy api_keys_write on public.api_keys for all to authenticated
  using (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')))
  with check (company_id in (select public.ops_company_ids_with_permission('configuracoes.editar')));

revoke execute on function public.ops_seed_label_templates(uuid) from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;



-- ===================================================================
-- migration: 0009_ops_views_reports.sql
-- ===================================================================

-- =====================================================================
--  0009 · VIEWS (security_invoker → respeitam RLS), PAINEL e RELATÓRIOS
-- =====================================================================

drop view if exists public.v_stock_balances cascade;
create view public.v_stock_balances with (security_invoker = true) as
select
  si.id,
  si.store_id,
  s.company_id,
  si.product_id,
  p.name            as product_name,
  p.internal_code,
  p.barcode,
  p.product_kind,
  p.category_id,
  c.name            as category_name,
  u.code            as unit,
  si.location_id,
  loc.name          as location_name,
  si.lot_id,
  l.lot_code,
  l.origin          as lot_origin,
  l.supplier_id,
  l.expires_at,
  case when l.expires_at is null then null else (l.expires_at - current_date) end as days_to_expire,
  case
    when l.expires_at is null then 'sem_validade'
    when l.expires_at < current_date then 'vencido'
    when l.expires_at = current_date then 'hoje'
    when l.expires_at <= current_date + 3 then '3dias'
    when l.expires_at <= current_date + 7 then '7dias'
    else 'ok' end   as expiry_status,
  l.status          as lot_status,
  l.produced_at, l.received_at, l.opened_at, l.frozen_at, l.thawed_at,
  si.quantity,
  l.unit_cost,
  round(si.quantity * l.unit_cost, 4) as total_value,
  si.updated_at
from public.stock_items si
join public.stock_lots l   on l.id = si.lot_id
join public.products p     on p.id = si.product_id
join public.units u        on u.id = p.stock_unit_id
join public.stores s       on s.id = si.store_id
join public.stock_locations loc on loc.id = si.location_id
left join public.categories c on c.id = p.category_id
where si.quantity <> 0;

drop view if exists public.v_stock_by_product cascade;
create view public.v_stock_by_product with (security_invoker = true) as
with bal as (
  select si.store_id, si.product_id,
         sum(si.quantity) filter (where l.status <> 'bloqueado' and (l.expires_at is null or l.expires_at >= current_date)) as quantity,
         sum(si.quantity * l.unit_cost) filter (where l.status <> 'bloqueado' and (l.expires_at is null or l.expires_at >= current_date)) as total_value,
         count(distinct si.lot_id) filter (where si.quantity > 0) as lots_count,
         min(l.expires_at) filter (where si.quantity > 0 and (l.expires_at is null or l.expires_at >= current_date)) as next_expiry,
         sum(si.quantity) filter (where l.expires_at < current_date) as expired_quantity,
         sum(si.quantity) filter (where l.status = 'bloqueado') as blocked_quantity
  from public.stock_items si join public.stock_lots l on l.id = si.lot_id
  where si.quantity <> 0
  group by si.store_id, si.product_id
)
select
  st.id as store_id, p.company_id, p.id as product_id, p.name as product_name, p.internal_code, p.barcode, p.product_kind,
  p.category_id, c.name as category_name, u.code as unit, p.cost, p.active,
  p.default_supplier_id, sup.name as default_supplier_name, p.purchase_unit_id, pu.code as purchase_unit, p.purchase_factor,
  coalesce(b.quantity, 0) as quantity,
  coalesce(b.total_value, 0) as total_value,
  coalesce(b.lots_count, 0) as lots_count,
  b.next_expiry,
  coalesce(b.expired_quantity, 0) as expired_quantity,
  coalesce(b.blocked_quantity, 0) as blocked_quantity,
  coalesce(pss.min_stock, p.min_stock) as min_stock,
  coalesce(pss.max_stock, p.max_stock) as max_stock,
  coalesce(pss.reorder_point, p.reorder_point) as reorder_point,
  coalesce(pss.ideal_stock, p.ideal_stock) as ideal_stock,
  public.ops_stock_level(coalesce(b.quantity, 0), coalesce(pss.min_stock, p.min_stock), coalesce(pss.reorder_point, p.reorder_point)) as level,
  case
    when coalesce(pss.max_stock, p.max_stock) > 0 then greatest(coalesce(pss.max_stock, p.max_stock) - coalesce(b.quantity, 0), 0)
    when coalesce(pss.ideal_stock, p.ideal_stock) > 0 then greatest(coalesce(pss.ideal_stock, p.ideal_stock) - coalesce(b.quantity, 0), 0)
    when coalesce(pss.min_stock, p.min_stock) > 0 then greatest(coalesce(pss.min_stock, p.min_stock) * 2 - coalesce(b.quantity, 0), 0)
    else 0 end as suggested_purchase
from public.products p
join public.stores st on st.company_id = p.company_id and st.active
join public.units u on u.id = p.stock_unit_id
left join public.units pu on pu.id = p.purchase_unit_id
left join public.categories c on c.id = p.category_id
left join public.suppliers sup on sup.id = p.default_supplier_id
left join public.product_store_settings pss on pss.product_id = p.id and pss.store_id = st.id
left join bal b on b.store_id = st.id and b.product_id = p.id
where coalesce(pss.active, true);

drop view if exists public.v_replenishment cascade;
create view public.v_replenishment with (security_invoker = true) as
select v.*,
  case when v.purchase_factor > 0 and v.purchase_unit_id is not null then ceil(v.suggested_purchase / v.purchase_factor) else v.suggested_purchase end as suggested_purchase_units,
  round(v.suggested_purchase * v.cost, 2) as estimated_cost
from public.v_stock_by_product v
where v.active and (v.level <> 'normal' or (v.suggested_purchase > 0 and v.quantity <= v.reorder_point and v.reorder_point > 0));

drop view if exists public.v_expiring_lots cascade;
create view public.v_expiring_lots with (security_invoker = true) as
select l.id as lot_id, l.store_id, l.company_id, l.product_id, p.name as product_name, p.internal_code, c.name as category_name, u.code as unit,
       l.lot_code, l.origin, l.expires_at, (l.expires_at - current_date) as days_to_expire, l.status as lot_status, l.unit_cost,
       l.supplier_id, sup.name as supplier_name,
       coalesce(sum(si.quantity), 0) as quantity,
       round(coalesce(sum(si.quantity), 0) * l.unit_cost, 4) as total_value,
       string_agg(distinct loc.name, ', ') as locations,
       case
         when l.expires_at < current_date then 'vencido'
         when l.expires_at = current_date then 'hoje'
         when l.expires_at <= current_date + 3 then '3dias'
         when l.expires_at <= current_date + 7 then '7dias'
         else 'ok' end as expiry_status
from public.stock_lots l
join public.products p on p.id = l.product_id
join public.units u on u.id = p.stock_unit_id
left join public.categories c on c.id = p.category_id
left join public.suppliers sup on sup.id = l.supplier_id
join public.stock_items si on si.lot_id = l.id and si.quantity > 0
join public.stock_locations loc on loc.id = si.location_id
where l.expires_at is not null
group by l.id, p.name, p.internal_code, c.name, u.code, sup.name;

drop view if exists public.v_movements cascade;
create view public.v_movements with (security_invoker = true) as
select m.id, m.company_id, m.store_id, m.product_id, p.name as product_name, p.internal_code, c.name as category_name, u.code as unit,
       m.lot_id, l.lot_code, l.expires_at, m.location_id, loc.name as location_name,
       m.movement_type, m.quantity, m.unit_cost, m.total_cost, m.balance_after, m.reason, m.reference_type, m.reference_id, m.notes,
       m.created_by, m.created_by_name, m.created_at
from public.stock_movements m
join public.products p on p.id = m.product_id
join public.units u on u.id = p.stock_unit_id
left join public.categories c on c.id = p.category_id
join public.stock_lots l on l.id = m.lot_id
join public.stock_locations loc on loc.id = m.location_id;

drop view if exists public.v_losses cascade;
create view public.v_losses with (security_invoker = true) as
select x.id, x.company_id, x.store_id, x.product_id, p.name as product_name, p.internal_code, c.name as category_name, u.code as unit,
       x.lot_id, l.lot_code, x.location_id, loc.name as location_name, x.quantity, x.unit_cost, x.total_cost,
       x.loss_reason_id, coalesce(r.name, nullif(x.reason_text, ''), 'Sem motivo') as reason_name, x.notes, x.photo_url,
       x.created_by, x.created_by_name, x.created_at
from public.losses x
join public.products p on p.id = x.product_id
join public.units u on u.id = p.stock_unit_id
left join public.categories c on c.id = p.category_id
left join public.stock_lots l on l.id = x.lot_id
left join public.stock_locations loc on loc.id = x.location_id
left join public.loss_reasons r on r.id = x.loss_reason_id;

drop view if exists public.v_audit_logs cascade;
create view public.v_audit_logs with (security_invoker = true) as
select a.*, s.name as store_name from public.audit_logs a left join public.stores s on s.id = a.store_id;

-- ---------------------------------------------------------------------
-- Relatórios agregados
-- ---------------------------------------------------------------------
create or replace function public.ops_report_consumption(p_store uuid, p_from date, p_to date, p_group text default 'produto')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select
        case p_group when 'categoria' then coalesce(c.name, 'Sem categoria') when 'dia' then to_char(m.created_at, 'YYYY-MM-DD') when 'tipo' then m.movement_type else p.name end as label,
        case p_group when 'categoria' then c.id when 'produto' then p.id end as id,
        u.code as unit,
        round(sum(-m.quantity), 4) as quantity,
        round(sum(-m.total_cost), 2) as cost,
        count(*) as movements
      from public.stock_movements m
      join public.products p on p.id = m.product_id join public.units u on u.id = p.stock_unit_id
      left join public.categories c on c.id = p.category_id
      where m.store_id = p_store and m.quantity < 0 and m.movement_type in ('consumo','producao_consumo','saida')
        and m.created_at >= p_from and m.created_at < p_to + 1
      group by 1, 2, 3 order by cost desc, quantity desc
    ) t), '[]'::jsonb);
end;
$fn$;

create or replace function public.ops_report_losses(p_store uuid, p_from date, p_to date, p_group text default 'motivo')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select
        case p_group when 'produto' then x.product_name when 'usuario' then coalesce(nullif(x.created_by_name, ''), '—')
             when 'dia' then to_char(x.created_at, 'YYYY-MM-DD') when 'categoria' then coalesce(x.category_name, 'Sem categoria') else x.reason_name end as label,
        round(sum(x.quantity), 4) as quantity,
        round(sum(x.total_cost), 2) as cost,
        count(*) as occurrences
      from public.v_losses x
      where x.store_id = p_store and x.created_at >= p_from and x.created_at < p_to + 1
      group by 1 order by cost desc
    ) t), '[]'::jsonb);
end;
$fn$;

create or replace function public.ops_report_production(p_store uuid, p_from date, p_to date, p_group text default 'produto')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'relatorios.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select
        case p_group when 'dia' then to_char(pr.finished_at, 'YYYY-MM-DD') when 'usuario' then coalesce(nullif(pr.produced_by_name, ''), '—') else p.name end as label,
        u.code as unit,
        count(*) as productions,
        round(sum(pr.planned_quantity), 4) as planned,
        round(sum(pr.produced_quantity), 4) as produced,
        round(avg(pr.actual_yield_pct), 2) as avg_yield_pct,
        round(sum(pr.total_cost), 2) as cost
      from public.productions pr join public.products p on p.id = pr.product_id join public.units u on u.id = p.stock_unit_id
      where pr.store_id = p_store and pr.status = 'concluida' and pr.finished_at >= p_from and pr.finished_at < p_to + 1
      group by 1, 2 order by produced desc
    ) t), '[]'::jsonb);
end;
$fn$;

create or replace function public.ops_report_stock_by_category(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.ops_require(p_store, 'estoque.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select coalesce(c.name, 'Sem categoria') as label, c.id, count(distinct v.product_id) as products,
             round(sum(v.total_value), 2) as value
      from public.v_stock_balances v left join public.categories c on c.id = v.category_id
      where v.store_id = p_store and v.quantity > 0
      group by 1, 2 order by value desc
    ) t), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------
-- PAINEL
-- ---------------------------------------------------------------------
create or replace function public.ops_dashboard(p_store uuid, p_from date default (current_date - 30), p_to date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_cards jsonb; v_series jsonb; v_company uuid;
begin
  perform public.ops_require(p_store, 'painel.ver');
  v_company := public.ops_store_company(p_store);

  select jsonb_build_object(
    'stock_value',      (select round(coalesce(sum(total_value), 0), 2) from public.v_stock_balances where store_id = p_store and quantity > 0),
    'stock_products',   (select count(distinct product_id) from public.v_stock_balances where store_id = p_store and quantity > 0),
    'stock_lots',       (select count(distinct lot_id) from public.v_stock_balances where store_id = p_store and quantity > 0),
    'expired',          (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status = 'vencido'),
    'expired_value',    (select round(coalesce(sum(total_value), 0), 2) from public.v_expiring_lots where store_id = p_store and expiry_status = 'vencido'),
    'expiring_today',   (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status = 'hoje'),
    'expiring_3d',      (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status in ('hoje','3dias')),
    'expiring_7d',      (select count(*) from public.v_expiring_lots where store_id = p_store and expiry_status in ('hoje','3dias','7dias')),
    'below_min',        (select count(*) from public.v_stock_by_product where store_id = p_store and active and level in ('baixo','critico')),
    'near_min',         (select count(*) from public.v_stock_by_product where store_id = p_store and active and level = 'atencao'),
    'critical',         (select count(*) from public.v_stock_by_product where store_id = p_store and active and level = 'critico'),
    'pending_productions', (select count(*) from public.productions where store_id = p_store and status in ('planejada','em_andamento')),
    'pending_receipts', (select count(*) from public.receipts where store_id = p_store and status = 'rascunho'),
    'pending_orders',   (select count(*) from public.purchase_orders where store_id = p_store and status in ('solicitado','aprovado','pedido')),
    'pending_tasks',    (select count(*) from public.tasks where store_id = p_store and status in ('pendente','em_andamento','atrasada')),
    'late_tasks',       (select count(*) from public.tasks where store_id = p_store and status = 'atrasada'),
    'pending_checklists', (select count(*) from public.checklist_executions where store_id = p_store and due_date = current_date and status in ('pendente','em_andamento','atrasado')),
    'late_checklists',  (select count(*) from public.checklist_executions where store_id = p_store and status = 'atrasado'),
    'open_counts',      (select count(*) from public.inventory_counts where store_id = p_store and status = 'aberta'),
    'losses_value',     (select round(coalesce(sum(total_cost), 0), 2) from public.losses where store_id = p_store and created_at >= p_from and created_at < p_to + 1),
    'losses_count',     (select count(*) from public.losses where store_id = p_store and created_at >= p_from and created_at < p_to + 1),
    'open_alerts',      (select count(*) from public.alerts where store_id = p_store and status = 'aberto'),
    'critical_alerts',  (select count(*) from public.alerts where store_id = p_store and status <> 'resolvido' and severity = 'critico'),
    'temp_out_of_range', (select count(*) from public.alerts where store_id = p_store and status <> 'resolvido' and kind = 'temperatura'),
    'receipts_period_value', (select round(coalesce(sum(total), 0), 2) from public.receipts where store_id = p_store and status = 'finalizado' and received_at >= p_from and received_at < p_to + 1),
    'productions_period', (select count(*) from public.productions where store_id = p_store and status = 'concluida' and finished_at >= p_from and finished_at < p_to + 1),
    'consumption_period_value', (select round(coalesce(sum(-total_cost), 0), 2) from public.stock_movements where store_id = p_store and movement_type in ('consumo','producao_consumo','saida') and created_at >= p_from and created_at < p_to + 1)
  ) into v_cards;

  select jsonb_build_object(
    'losses_by_day', coalesce((select jsonb_agg(row_to_json(t)) from (
        select to_char(created_at, 'YYYY-MM-DD') as day, round(sum(total_cost), 2) as value, round(sum(quantity), 3) as quantity
        from public.losses where store_id = p_store and created_at >= p_from and created_at < p_to + 1 group by 1 order by 1) t), '[]'::jsonb),
    'losses_by_reason', public.ops_report_losses_internal(p_store, p_from, p_to, 'motivo'),
    'losses_by_product', (select jsonb_agg(e) from (select e from jsonb_array_elements(public.ops_report_losses_internal(p_store, p_from, p_to, 'produto')) e limit 10) x),
    'consumption_by_category', public.ops_report_consumption_internal(p_store, p_from, p_to, 'categoria'),
    'top_consumed', (select jsonb_agg(e) from (select e from jsonb_array_elements(public.ops_report_consumption_internal(p_store, p_from, p_to, 'produto')) e limit 10) x),
    'production_by_day', coalesce((select jsonb_agg(row_to_json(t)) from (
        select to_char(finished_at, 'YYYY-MM-DD') as day, count(*) as productions, round(sum(produced_quantity), 3) as quantity, round(sum(total_cost), 2) as cost
        from public.productions where store_id = p_store and status = 'concluida' and finished_at >= p_from and finished_at < p_to + 1 group by 1 order by 1) t), '[]'::jsonb),
    'stock_by_category', public.ops_report_stock_by_category(p_store),
    'expiring_products', coalesce((select jsonb_agg(row_to_json(t)) from (
        select lot_id, product_name, lot_code, expires_at, days_to_expire, quantity, unit, expiry_status, locations
        from public.v_expiring_lots where store_id = p_store and expiry_status <> 'ok' order by expires_at limit 15) t), '[]'::jsonb),
    'replenishment', coalesce((select jsonb_agg(row_to_json(t)) from (
        select product_id, product_name, unit, quantity, min_stock, max_stock, level, suggested_purchase
        from public.v_replenishment where store_id = p_store order by case level when 'critico' then 0 when 'baixo' then 1 else 2 end, product_name limit 15) t), '[]'::jsonb)
  ) into v_series;

  return jsonb_build_object('store_id', p_store, 'from', p_from, 'to', p_to, 'cards', v_cards, 'series', v_series, 'generated_at', now());
end;
$fn$;

-- versões internas (sem checagem de relatorios.ver) para o painel
create or replace function public.ops_report_losses_internal(p_store uuid, p_from date, p_to date, p_group text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select case p_group when 'produto' then x.product_name when 'usuario' then coalesce(nullif(x.created_by_name, ''), '—')
                  when 'dia' then to_char(x.created_at, 'YYYY-MM-DD') else x.reason_name end as label,
             round(sum(x.quantity), 4) as quantity, round(sum(x.total_cost), 2) as cost, count(*) as occurrences
      from public.v_losses x where x.store_id = p_store and x.created_at >= p_from and x.created_at < p_to + 1
      group by 1 order by cost desc) t), '[]'::jsonb)
$$;
create or replace function public.ops_report_consumption_internal(p_store uuid, p_from date, p_to date, p_group text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select case p_group when 'categoria' then coalesce(c.name, 'Sem categoria') when 'dia' then to_char(m.created_at, 'YYYY-MM-DD') else p.name end as label,
             u.code as unit, round(sum(-m.quantity), 4) as quantity, round(sum(-m.total_cost), 2) as cost, count(*) as movements
      from public.stock_movements m join public.products p on p.id = m.product_id join public.units u on u.id = p.stock_unit_id
      left join public.categories c on c.id = p.category_id
      where m.store_id = p_store and m.quantity < 0 and m.movement_type in ('consumo','producao_consumo','saida')
        and m.created_at >= p_from and m.created_at < p_to + 1
      group by 1, 2 order by cost desc, quantity desc) t), '[]'::jsonb)
$$;
revoke execute on function public.ops_report_losses_internal(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.ops_report_consumption_internal(uuid, date, date, text) from public, anon, authenticated;

-- Comparação de preços entre fornecedores para um produto
create or replace function public.ops_supplier_price_comparison(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_company uuid;
begin
  select company_id into v_company from public.products where id = p_product;
  perform public.ops_require_company(v_company, 'fornecedores.ver');
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select s.id as supplier_id, s.name as supplier_name, sp.last_price, sp.last_purchase_at, sp.preferred, sp.supplier_code,
             (select round(avg(h.price), 4) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product and h.recorded_at >= now() - interval '180 days') as avg_price_180d,
             (select count(*) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product) as purchases,
             (select min(h.price) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product) as min_price,
             (select max(h.price) from public.supplier_price_history h where h.supplier_id = s.id and h.product_id = p_product) as max_price
      from public.supplier_products sp join public.suppliers s on s.id = sp.supplier_id
      where sp.product_id = p_product and s.active
      order by sp.last_price asc nulls last) t), '[]'::jsonb);
end;
$fn$;

grant select on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;



-- ===================================================================
-- migration: 0010_ops_storage_realtime.sql
-- ===================================================================

-- =====================================================================
--  0010 · STORAGE (fotos) e REALTIME — guardado para rodar também fora do Supabase
-- =====================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets não existe (ambiente sem Supabase Storage): pulando bucket ops-fotos.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ops-fotos', 'ops-fotos', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif','image/heic'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- leitura pública (URLs com uuid); escrita só por membros na pasta da própria empresa
  execute 'drop policy if exists "ops_fotos_select" on storage.objects';
  execute $p$create policy "ops_fotos_select" on storage.objects for select to public using (bucket_id = 'ops-fotos')$p$;
  execute 'drop policy if exists "ops_fotos_insert" on storage.objects';
  execute $p$create policy "ops_fotos_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'ops-fotos' and (storage.foldername(name))[1] in (select id::text from public.companies where id in (select public.ops_member_company_ids())))$p$;
  execute 'drop policy if exists "ops_fotos_update" on storage.objects';
  execute $p$create policy "ops_fotos_update" on storage.objects for update to authenticated
    using (bucket_id = 'ops-fotos' and (storage.foldername(name))[1] in (select id::text from public.companies where id in (select public.ops_member_company_ids())))$p$;
  execute 'drop policy if exists "ops_fotos_delete" on storage.objects';
  execute $p$create policy "ops_fotos_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'ops-fotos' and (storage.foldername(name))[1] in (select id::text from public.companies where id in (select public.ops_company_ids_with_permission('configuracoes.editar'))))$p$;
exception when others then
  raise notice 'Não foi possível configurar o Storage: % (configure o bucket ops-fotos manualmente no painel)', sqlerrm;
end $$;

-- Realtime: tabelas que a interface acompanha ao vivo
do $blk$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['alerts','tasks','stock_items','productions','receipts','checklist_executions',
                           'checklist_execution_items','inventory_items','inventory_counts','temperature_logs','purchase_orders'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when others then
  raise notice 'Realtime não configurado: %', sqlerrm;
end $blk$;

-- replica identity full para que o DELETE traga o registro antigo
do $$
declare t text;
begin
  foreach t in array array['alerts','tasks','stock_items','checklist_execution_items','inventory_items'] loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;



-- ===================================================================
-- migration: 0011_ops_seed.sql
-- ===================================================================

-- =====================================================================
--  0011 · PADRÕES POR EMPRESA (categorias, motivos de perda, etiquetas,
--         locais, checklists modelo, configurações) + dados da Vila Rica
--  Nenhum produto, ficha técnica ou saldo é inventado.
-- =====================================================================

create or replace function public.ops_seed_categories(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.categories where company_id = p_company) then return; end if;
  insert into public.categories (company_id, name, emoji, color, position) values
    (p_company, 'Carnes e frios',          '🥩', '#ef4444', 0),
    (p_company, 'Laticínios',              '🧀', '#f59e0b', 1),
    (p_company, 'Massas e farinhas',       '🌾', '#d97706', 2),
    (p_company, 'Molhos e temperos',       '🧂', '#84cc16', 3),
    (p_company, 'Hortifruti',              '🥬', '#22c55e', 4),
    (p_company, 'Bebidas',                 '🥤', '#3b82f6', 5),
    (p_company, 'Embalagens e descartáveis','📦', '#64748b', 6),
    (p_company, 'Limpeza',                 '🧴', '#06b6d4', 7),
    (p_company, 'Produção interna',        '🍳', '#a855f7', 8),
    (p_company, 'Salgados',                '🥟', '#f97316', 9),
    (p_company, 'Pizzas',                  '🍕', '#e11d48', 10),
    (p_company, 'Lanches',                 '🍔', '#eab308', 11),
    (p_company, 'Sobremesas',              '🍩', '#ec4899', 12);
end;
$fn$;

create or replace function public.ops_seed_checklists(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if exists (select 1 from public.checklists where company_id = p_company) then return; end if;

  insert into public.checklists (company_id, name, kind, frequency, scheduled_time, mandatory, position, description)
  values (p_company, 'Abertura da cozinha', 'abertura', 'diaria', '07:00', true, 0, 'Modelo inicial — ajuste as tarefas conforme a rotina da unidade.')
  returning id into v_id;
  insert into public.checklist_tasks (checklist_id, text, critical, position) values
    (v_id, 'Conferir temperatura das geladeiras e freezers', true, 0),
    (v_id, 'Verificar produtos vencidos ou vencendo hoje', true, 1),
    (v_id, 'Higienizar bancadas e utensílios', false, 2),
    (v_id, 'Conferir estoque mínimo dos itens do dia', false, 3),
    (v_id, 'Ligar e conferir equipamentos (fornos, fritadeiras, estufas)', false, 4);

  insert into public.checklists (company_id, name, kind, frequency, scheduled_time, mandatory, position, description)
  values (p_company, 'Fechamento da cozinha', 'fechamento', 'diaria', '22:00', true, 1, 'Modelo inicial — ajuste as tarefas conforme a rotina da unidade.')
  returning id into v_id;
  insert into public.checklist_tasks (checklist_id, text, critical, position) values
    (v_id, 'Etiquetar e armazenar sobras e produtos abertos', true, 0),
    (v_id, 'Registrar perdas do dia', false, 1),
    (v_id, 'Limpar chapas, fornos e fritadeiras', false, 2),
    (v_id, 'Retirar o lixo e higienizar lixeiras', false, 3),
    (v_id, 'Conferir portas de câmaras/freezers fechadas e temperatura', true, 4),
    (v_id, 'Desligar equipamentos e conferir gás', true, 5);

  insert into public.checklists (company_id, name, kind, frequency, scheduled_time, mandatory, position, description)
  values (p_company, 'Limpeza semanal', 'limpeza', 'semanal', '15:00', true, 2, 'Modelo inicial (segunda-feira).')
  returning id into v_id;
  update public.checklists set weekdays = '{1}' where id = v_id;
  insert into public.checklist_tasks (checklist_id, text, critical, requires_photo, position) values
    (v_id, 'Limpeza interna de geladeiras', true, true, 0),
    (v_id, 'Limpeza interna de freezers', true, true, 1),
    (v_id, 'Limpeza de coifas e exaustores', false, false, 2),
    (v_id, 'Organização e limpeza do estoque seco', false, false, 3),
    (v_id, 'Descarte de itens vencidos', true, false, 4);
end;
$fn$;

create or replace function public.ops_seed_settings(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.settings (company_id, store_id, key, value) values
    (p_company, null, 'estoque.metodo_custo',            '"medio"'::jsonb),
    (p_company, null, 'estoque.permitir_negativo',       'false'::jsonb),
    (p_company, null, 'estoque.permitir_consumo_vencido','false'::jsonb),
    (p_company, null, 'validade.dias_alerta',            '7'::jsonb),
    (p_company, null, 'validade.dias_critico',           '1'::jsonb),
    (p_company, null, 'etiquetas.impressora',            '{"tipo":"navegador","largura_mm":60,"altura_mm":40}'::jsonb),
    (p_company, null, 'temperaturas.intervalo_min',      '240'::jsonb),
    (p_company, null, 'alertas.email',                   'false'::jsonb),
    (p_company, null, 'inventario.nao_contado_zera',     'false'::jsonb),
    (p_company, null, 'producao.consumo_por',            '"planejado"'::jsonb)
  on conflict (company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do nothing;
end;
$fn$;

-- Função final de padrões (substitui o placeholder da migration 0001)
create or replace function public.ops_seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare s record;
begin
  perform public.ops_seed_categories(p_company);
  perform public.ops_seed_loss_reasons(p_company);
  perform public.ops_seed_label_templates(p_company);
  perform public.ops_seed_checklists(p_company);
  perform public.ops_seed_settings(p_company);
  for s in select id from public.stores where company_id = p_company loop
    perform public.ops_seed_store_locations(s.id);
  end loop;
end;
$fn$;

revoke execute on function public.ops_seed_categories(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_checklists(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_settings(uuid) from public, anon, authenticated;
revoke execute on function public.ops_seed_company_defaults(uuid) from public, anon, authenticated;

-- Aplica os padrões a todas as empresas já cadastradas (Vila Rica e demais)
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform public.ops_seed_company_defaults(c.id);
  end loop;
end $$;

-- Vila Rica: unidade principal com nome amigável (sem apagar nada)
update public.stores set name = 'Vila Rica — Matriz'
 where company_id = '11111111-1111-4111-8111-111111111111' and name = 'Matriz' and code = 'U1';



-- ===================================================================
-- migration: 0012_cadastros.sql
-- ===================================================================

-- =====================================================================
--  0012 · CADASTROS (produtos, categorias, unidades, fornecedores) —
--         apoio à interface
--    · v_suppliers  : fornecedores + última compra (max recorded_at do
--                     histórico de preços) + contagens, para lista paginada
--    · v_categories : categorias + quantidade de produtos (ativos e total)
--  Views com security_invoker: respeitam as policies das tabelas de origem.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fornecedores com última compra e contagens
-- ---------------------------------------------------------------------
drop view if exists public.v_suppliers;
create view public.v_suppliers with (security_invoker = true) as
select s.*,
       (select max(h.recorded_at) from public.supplier_price_history h where h.supplier_id = s.id) as last_purchase_at,
       (select count(*) from public.supplier_price_history h where h.supplier_id = s.id) as purchases_count,
       (select count(*) from public.supplier_products sp where sp.supplier_id = s.id) as products_count
from public.suppliers s;
grant select on public.v_suppliers to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Categorias com quantidade de produtos
-- ---------------------------------------------------------------------
drop view if exists public.v_categories;
create view public.v_categories with (security_invoker = true) as
select c.*,
       (select count(*) from public.products p where p.category_id = c.id and p.active) as products_count,
       (select count(*) from public.products p where p.category_id = c.id) as all_products_count,
       (select count(*) from public.categories x where x.parent_id = c.id) as children_count
from public.categories c;
grant select on public.v_categories to authenticated, service_role;



-- ===================================================================
-- migration: 0012_inventario_perdas.sql
-- ===================================================================

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



-- ===================================================================
-- migration: 0012_recebimento.sql
-- ===================================================================

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
