-- =====================================================================
--  0012 · ROTINAS (temperaturas, checklists, tarefas) — apoio à interface
--    · v_temperature_equipment_status : cada equipamento da unidade com a
--      ÚLTIMA medição (temperatura, hora, quem mediu, dentro/fora) e o
--      status calculado para os cartões da tela /temperaturas:
--        sem_medicao  → nunca foi medido
--        fora         → última medição fora da faixa
--        vencida      → última medição mais antiga que check_interval_min
--        ok           → dentro da faixa e no prazo
--      security_invoker: respeita a RLS de temperature_equipment e
--      temperature_logs (temperaturas.ver). Idempotente.
-- =====================================================================
drop view if exists public.v_temperature_equipment_status;
create view public.v_temperature_equipment_status with (security_invoker = true) as
select
  e.id, e.store_id, e.name, e.kind, e.location_text, e.min_temp, e.max_temp, e.check_interval_min, e.active, e.position,
  e.created_at, e.updated_at,
  l.id                as last_log_id,
  l.temperature       as last_temperature,
  l.in_range          as last_in_range,
  l.measured_at       as last_measured_at,
  l.measured_by_name  as last_measured_by_name,
  l.corrective_action as last_corrective_action,
  l.notes             as last_notes,
  case when l.id is null then null
       else greatest(0, floor(extract(epoch from (now() - l.measured_at)) / 60))::integer end as minutes_since,
  (l.id is not null and now() - l.measured_at > make_interval(mins => greatest(e.check_interval_min, 1))) as stale,
  case when l.id is null then 'sem_medicao'
       when not l.in_range then 'fora'
       when now() - l.measured_at > make_interval(mins => greatest(e.check_interval_min, 1)) then 'vencida'
       else 'ok' end as status
from public.temperature_equipment e
left join lateral (
  select t.id, t.temperature, t.in_range, t.measured_at, t.measured_by_name, t.corrective_action, t.notes
  from public.temperature_logs t
  where t.equipment_id = e.id
  order by t.measured_at desc
  limit 1
) l on true;

grant select on public.v_temperature_equipment_status to authenticated, service_role;
revoke all on public.v_temperature_equipment_status from anon;
