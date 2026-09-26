-- =====================================================================
--  0012 · ETIQUETAS — apoio à interface de impressão e modelos
--    · ops_label_print(...)                      : registra a etiqueta emitida na tabela
--        imutável `labels` (a interface nunca escreve nela diretamente). Exige
--        etiquetas.imprimir na unidade e confere que modelo/lote são da mesma empresa.
--    · ops_label_template_set_default(p_template): marca o modelo como padrão do seu tipo
--        e desmarca os demais do mesmo tipo/empresa em uma só transação.
--        Exige etiquetas.editar_modelos.
--    · ops_label_templates_seed_defaults(p_company): cria os modelos de fábrica (0008)
--        quando a empresa ainda não tem nenhum — chamável pela tela Modelos.
--        Exige etiquetas.editar_modelos.
--  Idempotente (create or replace). Sem tabelas novas; RLS de 0008 permanece.
-- =====================================================================

create or replace function public.ops_label_print(
  p_store    uuid,
  p_template uuid,
  p_product  uuid,
  p_lot      uuid,
  p_kind     text,
  p_copies   integer,
  p_payload  jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_company uuid; v_id uuid; v_kind text;
begin
  perform public.ops_require(p_store, 'etiquetas.imprimir');
  v_company := public.ops_store_company(p_store);
  if v_company is null then raise exception 'Unidade não encontrada.'; end if;
  if p_copies is null or p_copies < 1 then raise exception 'Informe pelo menos 1 cópia.'; end if;
  if p_copies > 500 then raise exception 'Máximo de 500 cópias por vez.'; end if;
  v_kind := coalesce(nullif(trim(p_kind), ''), 'generica');
  if v_kind not in ('producao','abertura','congelamento','descongelamento','fracionamento','armazenamento','recebimento','generica') then
    raise exception 'Tipo de etiqueta inválido: %', v_kind;
  end if;
  if p_template is not null and not exists (select 1 from public.label_templates t where t.id = p_template and t.company_id = v_company) then
    raise exception 'Modelo de etiqueta de outra empresa.';
  end if;
  if p_lot is not null and not exists (select 1 from public.stock_lots l where l.id = p_lot and l.company_id = v_company) then
    raise exception 'Lote de outra empresa.';
  end if;
  if p_product is not null and not exists (select 1 from public.products p where p.id = p_product and p.company_id = v_company) then
    raise exception 'Produto de outra empresa.';
  end if;

  insert into public.labels (company_id, store_id, template_id, product_id, lot_id, kind, copies, payload)
  values (v_company, p_store, p_template, p_product, p_lot, v_kind, p_copies, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.ops_label_template_set_default(p_template uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_t record;
begin
  select id, company_id, kind into v_t from public.label_templates where id = p_template;
  if v_t.id is null then raise exception 'Modelo de etiqueta não encontrado.'; end if;
  perform public.ops_require_company(v_t.company_id, 'etiquetas.editar_modelos');
  update public.label_templates
     set is_default = false
   where company_id = v_t.company_id and kind = v_t.kind and is_default and id <> p_template;
  update public.label_templates
     set is_default = true, active = true
   where id = p_template;
end;
$fn$;

create or replace function public.ops_label_templates_seed_defaults(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n integer;
begin
  perform public.ops_require_company(p_company, 'etiquetas.editar_modelos');
  perform public.ops_seed_label_templates(p_company);
  select count(*) into v_n from public.label_templates where company_id = p_company;
  return v_n;
end;
$fn$;

grant execute on function public.ops_label_print(uuid, uuid, uuid, uuid, text, integer, jsonb) to authenticated, service_role;
grant execute on function public.ops_label_template_set_default(uuid) to authenticated, service_role;
grant execute on function public.ops_label_templates_seed_defaults(uuid) to authenticated, service_role;
revoke execute on function public.ops_label_print(uuid, uuid, uuid, uuid, text, integer, jsonb) from anon;
revoke execute on function public.ops_label_template_set_default(uuid) from anon;
revoke execute on function public.ops_label_templates_seed_defaults(uuid) from anon;
