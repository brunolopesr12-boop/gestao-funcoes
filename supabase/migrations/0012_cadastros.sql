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
