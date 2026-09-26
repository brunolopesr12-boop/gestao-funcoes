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
