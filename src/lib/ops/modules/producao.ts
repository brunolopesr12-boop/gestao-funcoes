"use client";

/* ------------------------------------------------------------------ */
/* Módulo: Fichas técnicas · Produção — tipos, consultas e utilitários */
/* ------------------------------------------------------------------ */

import { useQueries, useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { useUnits } from "@/lib/ops/hooks";
import { useSession } from "@/lib/ops/session";
import type { Product, Production, ProductionPlan, ProductionStatus, Recipe, RecipeCost, RecipeItem, Unit, UUID } from "@/lib/ops/types";

/* ------------------------------------------------------------------ */
/* Tipos das consultas (com relações)                                  */
/* ------------------------------------------------------------------ */
export type EmbeddedCategory = { id: UUID; name: string; emoji: string; color: string } | null;

export type RecipeProduct = Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "product_kind" | "shelf_life_days" | "photo_url" | "active"> & {
  units?: Pick<Unit, "id" | "code" | "name"> | null;
  categories?: EmbeddedCategory;
};
export type RecipeRow = Omit<Recipe, "products"> & { products: RecipeProduct | null };

export type RecipeItemProduct = Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor" | "cost" | "photo_url"> & {
  units?: Pick<Unit, "id" | "code" | "name"> | null;
  categories?: EmbeddedCategory;
};
export type RecipeItemRow = Omit<RecipeItem, "products" | "units"> & {
  products: RecipeItemProduct | null;
  units: Pick<Unit, "id" | "code" | "name"> | null;
};

export type ProductionProduct = Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "photo_url"> & {
  units?: Pick<Unit, "id" | "code" | "name"> | null;
};
export type ProductionRow = Omit<Production, "products" | "recipes"> & {
  /** a tabela tem updated_at (o tipo compartilhado não declara) */
  updated_at?: string | null;
  products: ProductionProduct | null;
  recipes: Pick<Recipe, "id" | "name" | "yield_quantity" | "version" | "instructions"> | null;
  stock_locations?: { id: UUID; name: string } | null;
  lot?: { id: UUID; lot_code: string; expires_at: string | null; status: string } | null;
};

export type ProductionItemRow = {
  id: UUID;
  production_id: UUID;
  product_id: UUID;
  lot_id: UUID | null;
  location_id: UUID | null;
  planned_quantity: number;
  consumed_quantity: number;
  unit_cost: number;
  total_cost: number;
  movement_id: UUID | null;
  created_at: string;
  products: (Pick<Product, "id" | "name" | "internal_code"> & { units?: Pick<Unit, "id" | "code"> | null }) | null;
  stock_lots: { id: UUID; lot_code: string; expires_at: string | null } | null;
  stock_locations: { id: UUID; name: string } | null;
};

/** Retorno de ops_produce_now / ops_production_finish. */
export type ProduceResult = {
  ok: boolean;
  duplicated?: boolean;
  production_id: UUID;
  lot_id: UUID | null;
  lot_code?: string;
  expires_at?: string | null;
  produced?: number;
  total_cost?: number;
  unit_cost?: number;
  consumed?: { product_id: UUID; lot_id: UUID; quantity: number }[];
};

export type PlanItem = ProductionPlan["items"][number];
export type PlanLot = PlanItem["lots"][number];

/** Lote escolhido manualmente para um ingrediente (linha de v_stock_balances). */
export type ChosenLot = { balanceId: string; lot_id: UUID; location_id: UUID; lot_code: string; location_name: string; available: number; expires_at: string | null };

/** Ajuste do funcionário por ingrediente: quantidade a consumir e/ou lote. */
export type PlanOverride = { quantity?: number | null; lot?: ChosenLot | null };
export type PlanOverrides = Record<string, PlanOverride>;

/** Item enviado em p_items para as funções de produção (unidade de estoque). */
export type ConsumeItem = { product_id: UUID; lot_id?: UUID; location_id?: UUID; quantity: number };

/** Valores do formulário de conclusão. */
export type FinishValues = { produced: number; locationId: string; lotCode: string; expiresAt: string; notes: string };

/* ------------------------------------------------------------------ */
/* Selects                                                             */
/* ------------------------------------------------------------------ */
export const RECIPE_SELECT =
  "*, products(id, name, internal_code, stock_unit_id, product_kind, shelf_life_days, photo_url, active, units:stock_unit_id(id, code, name), categories(id, name, emoji, color))";

export const RECIPE_ITEM_SELECT =
  "*, products(id, name, internal_code, stock_unit_id, purchase_unit_id, purchase_factor, cost, photo_url, units:stock_unit_id(id, code, name), categories(id, name, emoji, color)), units(id, code, name)";

export const PRODUCTION_SELECT =
  "*, products(id, name, internal_code, stock_unit_id, photo_url, units:stock_unit_id(id, code, name)), recipes(id, name, yield_quantity, version, instructions), stock_locations(id, name), lot:stock_lots!lot_id(id, lot_code, expires_at, status)";

export const PRODUCTION_ITEM_SELECT =
  "*, products(id, name, internal_code, units:stock_unit_id(id, code)), stock_lots(id, lot_code, expires_at), stock_locations(id, name)";

export const PRODUCTION_TABS: { value: ProductionStatus; label: string }[] = [
  { value: "planejada", label: "Planejadas" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluídas" },
  { value: "cancelada", label: "Canceladas" },
];

/* ------------------------------------------------------------------ */
/* Fichas técnicas                                                     */
/* ------------------------------------------------------------------ */
export function useRecipe(id: string | null | undefined) {
  return useQuery({
    queryKey: ["recipes", "one", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("recipes").select(RECIPE_SELECT).eq("id", id!).single()) as RecipeRow,
  });
}

export function useRecipeItems(recipeId: string | null | undefined) {
  return useQuery({
    queryKey: ["recipe_items", recipeId],
    enabled: Boolean(recipeId),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser().from("recipe_items").select(RECIPE_ITEM_SELECT).eq("recipe_id", recipeId!).order("position").order("created_at"),
      ) as RecipeItemRow[],
  });
}

/** Custo e rendimento calculados pelo banco (rpc ops_recipe_cost). */
export function useRecipeCost(recipeId: string | null | undefined) {
  return useQuery({
    queryKey: ["recipe_cost", recipeId],
    enabled: Boolean(recipeId),
    queryFn: () => rpc<RecipeCost | null>("ops_recipe_cost", { p_recipe: recipeId }),
  });
}

/** Custo de várias fichas de uma vez (uma chamada por ficha visível; a página é limitada a 25). */
export function useRecipeCosts(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["recipe_cost", id],
      queryFn: () => rpc<RecipeCost | null>("ops_recipe_cost", { p_recipe: id }),
      staleTime: 60_000,
    })),
  });
  const map: Record<string, { data: RecipeCost | null | undefined; loading: boolean; error: boolean }> = {};
  ids.forEach((id, i) => {
    const r = results[i];
    map[id] = { data: r?.data, loading: Boolean(r?.isLoading), error: Boolean(r?.isError) };
  });
  return map;
}

/** Fichas ativas da empresa para escolher na produção (busca por nome da ficha ou do produto). */
export function useActiveRecipes(term: string, limit = 40) {
  const { company } = useSession();
  const t = term.trim();
  return useQuery({
    queryKey: ["recipes", "active", company?.id, t, limit],
    enabled: Boolean(company?.id),
    staleTime: 30_000,
    queryFn: async () => {
      let qb = supabaseBrowser().from("recipes").select(RECIPE_SELECT).eq("company_id", company!.id).eq("active", true).order("name").order("version", { ascending: false }).limit(limit);
      if (t) {
        const ids = await matchingProductIds(company!.id, t);
        const parts = [`name.ilike.${safeLike(t)}`];
        if (ids.length > 0) parts.push(`product_id.in.(${ids.join(",")})`);
        qb = qb.or(parts.join(","));
      }
      return unwrap(await qb) as RecipeRow[];
    },
  });
}

/** ids de produtos cujo nome/código contém o termo (para buscar fichas/produções pelo produto). */
export async function matchingProductIds(companyId: string, term: string, limit = 100): Promise<string[]> {
  const t = term.trim();
  if (!t) return [];
  const like = safeLike(t);
  const res = await supabaseBrowser().from("products").select("id").eq("company_id", companyId).or(`name.ilike.${like},internal_code.ilike.${like}`).limit(limit);
  return (unwrap(res) as { id: string }[]).map((p) => p.id);
}

/** Limpa o termo para uso dentro de filtros `or(...)` do PostgREST. */
export function safeLike(term: string): string {
  return `%${term.trim().replace(/[%_,()]/g, "")}%`;
}

/** Número de porções da ficha (rendimento ÷ tamanho da porção). */
export function portionsOf(r: Pick<Recipe, "yield_quantity" | "portion_quantity">): number | null {
  const p = Number(r.portion_quantity);
  const y = Number(r.yield_quantity);
  if (!(p > 0) || !(y > 0)) return null;
  return Math.round((y / p) * 100) / 100;
}

/** Instruções: um passo por linha. */
export function splitSteps(instructions: string | null | undefined): string[] {
  return (instructions ?? "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*(\d+[.)-]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Duplica a ficha (e seus ingredientes) como nova versão ativa.
 * A ficha original continua como está — o usuário decide se a inativa.
 * Devolve o id e a versão realmente gravada (maior versão do produto + 1).
 */
export async function duplicateRecipe(recipe: RecipeRow, _items: RecipeItemRow[], _userId: string | null | undefined): Promise<{ id: string; version: number }> {
  // cópia atômica (cabeçalho + ingredientes) feita pelo banco
  const { data, error } = await supabaseBrowser().rpc("ops_recipe_duplicate", { p_recipe: recipe.id, p_name: recipe.name });
  if (error) throw toOpsError(error);
  const r = data as { id: string; version: number };
  return { id: r.id, version: Number(r.version) };
}

/* ------------------------------------------------------------------ */
/* Unidades em que um ingrediente pode ser informado                   */
/* ------------------------------------------------------------------ */
export type IngredientUnitOption = { id: string; code: string; label: string; factor: number };

/**
 * Mesma regra da função ops_convert_qty do banco: unidade de estoque,
 * conversões do produto (product_units), unidade de compra e unidades do
 * mesmo tipo (kg ↔ g, L ↔ ml). `factor` = unidades de estoque em 1 desta unidade.
 */
export function useIngredientUnitOptions(product: Pick<Product, "id" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor"> | null | undefined) {
  const units = useUnits();
  const pu = useQuery({
    queryKey: ["product_units", product?.id],
    enabled: Boolean(product?.id),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("product_units").select("id, unit_id, factor, label").eq("product_id", product!.id)) as { id: UUID; unit_id: UUID; factor: number; label: string }[],
  });
  const all: Unit[] = units.data ?? [];
  const stock = product ? all.find((u) => u.id === product.stock_unit_id) : undefined;
  const options: IngredientUnitOption[] = [];
  if (product && stock) {
    options.push({ id: stock.id, code: stock.code, label: `${stock.code} — ${stock.name} (unidade de estoque)`, factor: 1 });
    for (const x of pu.data ?? []) {
      const u = all.find((y) => y.id === x.unit_id);
      if (u && !options.some((o) => o.id === u.id)) options.push({ id: u.id, code: u.code, label: `${u.code} — ${x.label || u.name} (= ${x.factor} ${stock.code})`, factor: Number(x.factor) });
    }
    if (product.purchase_unit_id && Number(product.purchase_factor) > 0) {
      const u = all.find((y) => y.id === product.purchase_unit_id);
      if (u && !options.some((o) => o.id === u.id)) options.push({ id: u.id, code: u.code, label: `${u.code} — ${u.name} (compra, = ${product.purchase_factor} ${stock.code})`, factor: Number(product.purchase_factor) });
    }
    if (stock.base_factor) {
      for (const u of all) {
        if (u.kind === stock.kind && u.base_factor && !options.some((o) => o.id === u.id)) {
          options.push({ id: u.id, code: u.code, label: `${u.code} — ${u.name}`, factor: Number(u.base_factor) / Number(stock.base_factor) });
        }
      }
    }
  }
  return { options, stockUnit: stock ?? null, loading: units.isLoading || pu.isLoading };
}

/* ------------------------------------------------------------------ */
/* Produções                                                           */
/* ------------------------------------------------------------------ */
export function useProduction(id: string | null | undefined) {
  return useQuery({
    queryKey: ["productions", "one", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("productions").select(PRODUCTION_SELECT).eq("id", id!).single()) as ProductionRow,
  });
}

export function useProductionItems(productionId: string | null | undefined) {
  return useQuery({
    queryKey: ["production_items", productionId],
    enabled: Boolean(productionId),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("production_items").select(PRODUCTION_ITEM_SELECT).eq("production_id", productionId!).order("created_at")) as ProductionItemRow[],
  });
}

/** Plano de produção (ingredientes escalados, disponibilidade e lotes FEFO). */
export function useProductionPlan(storeId: string | null | undefined, recipeId: string | null | undefined, planned: number | null | undefined) {
  const ok = Boolean(storeId && recipeId && planned && planned > 0);
  return useQuery({
    queryKey: ["production_plan", storeId, recipeId, planned],
    enabled: ok,
    staleTime: 10_000,
    queryFn: () => rpc<ProductionPlan>("ops_production_plan", { p_store: storeId, p_recipe: recipeId, p_planned: planned }),
  });
}

/** Quantidade efetiva a consumir de um ingrediente (ajuste do funcionário ou o necessário pela ficha). */
export function effectiveQuantity(item: PlanItem, ov: PlanOverride | undefined): number {
  if (ov && ov.quantity !== undefined && ov.quantity !== null) return Math.max(0, Number(ov.quantity));
  return Number(item.needed);
}

/** Monta p_items para ops_produce_now / ops_production_finish. */
export function buildConsumeItems(plan: ProductionPlan, overrides: PlanOverrides): ConsumeItem[] {
  return plan.items.map((it) => {
    const ov = overrides[it.product_id];
    const quantity = effectiveQuantity(it, ov);
    if (ov?.lot) return { product_id: it.product_id, lot_id: ov.lot.lot_id, location_id: ov.lot.location_id, quantity };
    return { product_id: it.product_id, quantity };
  });
}

export type Shortage = { product_id: UUID; name: string; unit: string; missing: number; lot_code?: string };

/** Faltas considerando os ajustes (quantidade e lote escolhido). */
export function effectiveShortages(plan: ProductionPlan, overrides: PlanOverrides): Shortage[] {
  const out: Shortage[] = [];
  for (const it of plan.items) {
    const ov = overrides[it.product_id];
    const qty = effectiveQuantity(it, ov);
    if (qty <= 0) continue;
    if (ov?.lot) {
      const missing = qty - Number(ov.lot.available);
      if (missing > 1e-6) out.push({ product_id: it.product_id, name: it.name, unit: it.stock_unit, missing, lot_code: ov.lot.lot_code });
    } else {
      const missing = qty - Number(it.available);
      if (missing > 1e-6) out.push({ product_id: it.product_id, name: it.name, unit: it.stock_unit, missing });
    }
  }
  return out;
}

/** Custo estimado com os ajustes (usa o custo unitário do plano). */
export function estimatedCost(plan: ProductionPlan, overrides: PlanOverrides): number {
  return plan.items.reduce((acc, it) => acc + effectiveQuantity(it, overrides[it.product_id]) * Number(it.unit_cost ?? 0), 0);
}

/** Rendimento real em % (produzido ÷ planejado). */
export function yieldPct(produced: number | null | undefined, planned: number | null | undefined): number | null {
  const p = Number(planned);
  const q = Number(produced);
  if (!(p > 0) || produced === null || produced === undefined) return null;
  return Math.round((q / p) * 10000) / 100;
}

export function yieldTone(pct: number | null | undefined): "green" | "amber" | "red" | "slate" {
  if (pct === null || pct === undefined) return "slate";
  if (pct >= 95) return "green";
  if (pct >= 80) return "amber";
  return "red";
}

/** Data (yyyy-mm-dd) relevante para exibir na lista conforme o status. */
export function productionDate(p: Pick<ProductionRow, "status" | "scheduled_for" | "started_at" | "finished_at" | "created_at" | "updated_at">): string | null {
  if (p.status === "concluida") return p.finished_at ?? p.created_at;
  if (p.status === "em_andamento") return p.started_at ?? p.created_at;
  if (p.status === "cancelada") return p.updated_at ?? p.created_at;
  return p.scheduled_for ?? p.created_at;
}
