"use client";

/* ------------------------------------------------------------------ */
/* Módulo CADASTROS · produtos, categorias, unidades, fornecedores      */
/* Tipos, rótulos, utilitários, mapeamento de formulário e consultas.   */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import type {
  Category, LocationKind, Product, ProductKind, ProductStoreSettings, ProductUnit, PurchaseOrder, Receipt, StorageType, Supplier, SupplierProduct, Unit, UnitKind, UUID,
} from "@/lib/ops/types";
import { LOCATION_KIND_LABEL, PRODUCT_KIND_LABEL, STORAGE_TYPE_LABEL } from "@/lib/ops/types";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
/** Linha de v_suppliers (fornecedor + última compra + contagens). */
export type SupplierRow = Supplier & { updated_at: string; last_purchase_at: string | null; purchases_count: number; products_count: number };
/** Linha de v_categories (categoria + contagem de produtos). */
export type CategoryRow = Category & { products_count: number; all_products_count: number; children_count: number };

/** Produto com os relacionamentos usados nas telas de cadastro. */
export type ProductRow = Product & {
  purchase_units?: Pick<Unit, "id" | "code" | "name"> | null;
};

export type ProductUnitRow = ProductUnit & { units?: Pick<Unit, "id" | "code" | "name" | "kind"> | null };
export type StoreSettingsRow = ProductStoreSettings & { stock_locations?: { id: UUID; name: string } | null };
export type SupplierProductRow = SupplierProduct & { units?: Pick<Unit, "id" | "code"> | null };

/** Retorno de ops_supplier_price_comparison(p_product). */
export type PriceComparison = {
  supplier_id: UUID; supplier_name: string; last_price: number; last_purchase_at: string | null; preferred: boolean; supplier_code: string;
  avg_price_180d: number | null; purchases: number; min_price: number | null; max_price: number | null;
};

/** Linha de supplier_price_history com relacionamentos. */
export type PriceHistoryRow = {
  id: UUID; company_id: UUID; store_id: UUID | null; supplier_id: UUID | null; product_id: UUID; price: number; quantity: number; unit_id: UUID | null;
  receipt_id: UUID | null; recorded_by: UUID | null; recorded_at: string;
  suppliers?: Pick<Supplier, "id" | "name"> | null; products?: Pick<Product, "id" | "name" | "internal_code"> | null; units?: Pick<Unit, "code"> | null;
  stores?: { id: UUID; name: string } | null;
};

/* ------------------------------------------------------------------ */
/* Rótulos e opções                                                    */
/* ------------------------------------------------------------------ */
export const UNIT_KIND_LABEL: Record<UnitKind, string> = { massa: "Massa", volume: "Volume", contagem: "Contagem", embalagem: "Embalagem" };
export const UNIT_KIND_BASE: Record<UnitKind, string> = { massa: "g", volume: "ml", contagem: "un", embalagem: "—" };
export const UNIT_KIND_HELP: Record<UnitKind, string> = {
  massa: "Peso. A base é o grama (g): 1 kg = 1000 g.",
  volume: "Líquidos. A base é o mililitro (ml): 1 L = 1000 ml.",
  contagem: "Peças. A base é a unidade (un): 1 dúzia = 12 un.",
  embalagem: "Caixa, pacote, fardo… O fator é definido em cada produto (ex.: 1 caixa = 10 kg).",
};
export const UNIT_KIND_OPTIONS: { value: UnitKind; label: string; hint: string }[] = [
  { value: "massa", label: "Massa", hint: "base g" },
  { value: "volume", label: "Volume", hint: "base ml" },
  { value: "contagem", label: "Contagem", hint: "base un" },
  { value: "embalagem", label: "Embalagem", hint: "fator por produto" },
];
export const PRODUCT_KIND_OPTIONS: { value: ProductKind; label: string; hint: string }[] = [
  { value: "materia_prima", label: PRODUCT_KIND_LABEL.materia_prima, hint: "Comprado do fornecedor" },
  { value: "semipronto", label: PRODUCT_KIND_LABEL.semipronto, hint: "Preparo intermediário" },
  { value: "produzido", label: PRODUCT_KIND_LABEL.produzido, hint: "Feito pela cozinha" },
  { value: "final", label: PRODUCT_KIND_LABEL.final, hint: "Pronto para venda" },
  { value: "descartavel", label: PRODUCT_KIND_LABEL.descartavel, hint: "Embalagens, guardanapos…" },
  { value: "outro", label: PRODUCT_KIND_LABEL.outro, hint: "Limpeza, uso interno…" },
];
export const STORAGE_TYPE_OPTIONS: { value: StorageType; label: string; hint: string }[] = [
  { value: "ambiente", label: STORAGE_TYPE_LABEL.ambiente, hint: "Estoque seco" },
  { value: "refrigerado", label: STORAGE_TYPE_LABEL.refrigerado, hint: "Geladeira / câmara" },
  { value: "congelado", label: STORAGE_TYPE_LABEL.congelado, hint: "Freezer" },
];
export const LOCATION_KIND_OPTIONS: { value: LocationKind; label: string }[] = (Object.keys(LOCATION_KIND_LABEL) as LocationKind[]).map((k) => ({ value: k, label: LOCATION_KIND_LABEL[k] }));

/** Emojis sugeridos para categorias de cozinha. */
export const CATEGORY_EMOJIS = ["📦", "🥩", "🍗", "🐟", "🧀", "🥛", "🥚", "🍞", "🌾", "🍝", "🍚", "🥫", "🫙", "🧂", "🌶️", "🧄", "🧅", "🥕", "🥬", "🍅", "🍎", "🍌", "🍋", "🥤", "🍺", "🍷", "☕", "🧊", "🍫", "🍰", "🍯", "🫒", "🧴", "🧻", "🧹", "🍽️", "🥡", "🔧"];
export const CATEGORY_COLORS = ["#64748b", "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#a16207"];

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
/** Termo seguro para `ilike` (remove caracteres que quebram o filtro do PostgREST). */
export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, "%")}%`;
}
export function onlyDigits(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}
/** 00.000.000/0000-00 (aceita CPF 000.000.000-00 se tiver 11 dígitos). */
export function formatCnpj(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}
/** Padrão `ilike` que encontra os dígitos digitados dentro de um CNPJ com máscara (12345 → %12%345%). */
export function cnpjLikePattern(v: string): string | null {
  const d = onlyDigits(v);
  if (d.length < 3) return null;
  const groups = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12, 14)].filter(Boolean);
  return `%${groups.join("%")}%`;
}
/** (00) 00000-0000 */
export function formatPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}
/** Link do WhatsApp (adiciona 55 quando o número não tem DDI). */
export function waLink(phone: string): string | null {
  const d = onlyDigits(phone);
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? "55" + d : d}`;
}

/** Descrição da conversão de uma unidade para a base do tipo. */
export function unitBaseText(u: Pick<Unit, "code" | "kind" | "base_factor">): string {
  if (u.kind === "embalagem" || u.base_factor === null || u.base_factor === undefined) return "definido em cada produto";
  return `1 ${u.code} = ${u.base_factor} ${UNIT_KIND_BASE[u.kind]}`;
}

/** Opções de conversão de um produto (unidade de estoque = 1; compra; extras; mesma natureza). */
export function conversionOptions(
  units: Unit[], stockUnitId: string, purchaseUnitId: string, purchaseFactor: number | null, extras: { unit_id: string; factor: number }[],
): { id: string; code: string; name: string; factor: number; source: "estoque" | "compra" | "extra" | "natureza" }[] {
  const stock = units.find((u) => u.id === stockUnitId);
  if (!stock) return [];
  const out: { id: string; code: string; name: string; factor: number; source: "estoque" | "compra" | "extra" | "natureza" }[] = [
    { id: stock.id, code: stock.code, name: stock.name, factor: 1, source: "estoque" },
  ];
  const seen = new Set([stock.id]);
  for (const e of extras) {
    const u = units.find((x) => x.id === e.unit_id);
    if (u && !seen.has(u.id) && e.factor > 0) {
      out.push({ id: u.id, code: u.code, name: u.name, factor: e.factor, source: "extra" });
      seen.add(u.id);
    }
  }
  if (purchaseUnitId && purchaseFactor && purchaseFactor > 0) {
    const u = units.find((x) => x.id === purchaseUnitId);
    if (u && !seen.has(u.id)) {
      out.push({ id: u.id, code: u.code, name: u.name, factor: purchaseFactor, source: "compra" });
      seen.add(u.id);
    }
  }
  if (stock.base_factor && stock.kind !== "embalagem") {
    for (const u of units) {
      if (seen.has(u.id) || u.kind !== stock.kind || !u.base_factor) continue;
      out.push({ id: u.id, code: u.code, name: u.name, factor: u.base_factor / stock.base_factor, source: "natureza" });
      seen.add(u.id);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Formulário de produto                                               */
/* ------------------------------------------------------------------ */
export type ProductForm = {
  name: string; internal_code: string; sku: string; barcode: string; category_id: string; product_kind: ProductKind; photo_url: string; notes: string; active: boolean;
  stock_unit_id: string; purchase_unit_id: string; purchase_factor: number | null;
  cost: number | null;
  min_stock: number | null; max_stock: number | null; reorder_point: number | null; ideal_stock: number | null;
  shelf_life_days: number | null; shelf_life_open_days: number | null; shelf_life_frozen_days: number | null; shelf_life_thawed_days: number | null;
  storage_type: StorageType; storage_temp_min: number | null; storage_temp_max: number | null; default_location_kind: string;
  default_supplier_id: string;
};

export function emptyProductForm(): ProductForm {
  return {
    name: "", internal_code: "", sku: "", barcode: "", category_id: "", product_kind: "materia_prima", photo_url: "", notes: "", active: true,
    stock_unit_id: "", purchase_unit_id: "", purchase_factor: 1, cost: null,
    min_stock: null, max_stock: null, reorder_point: null, ideal_stock: null,
    shelf_life_days: null, shelf_life_open_days: null, shelf_life_frozen_days: null, shelf_life_thawed_days: null,
    storage_type: "ambiente", storage_temp_min: null, storage_temp_max: null, default_location_kind: "", default_supplier_id: "",
  };
}

export function productToForm(p: Product): ProductForm {
  return {
    name: p.name, internal_code: p.internal_code, sku: p.sku, barcode: p.barcode, category_id: p.category_id ?? "", product_kind: p.product_kind,
    photo_url: p.photo_url, notes: p.notes, active: p.active,
    stock_unit_id: p.stock_unit_id, purchase_unit_id: p.purchase_unit_id ?? "", purchase_factor: Number(p.purchase_factor ?? 1), cost: Number(p.cost ?? 0),
    min_stock: Number(p.min_stock ?? 0), max_stock: Number(p.max_stock ?? 0), reorder_point: Number(p.reorder_point ?? 0), ideal_stock: Number(p.ideal_stock ?? 0),
    shelf_life_days: p.shelf_life_days, shelf_life_open_days: p.shelf_life_open_days, shelf_life_frozen_days: p.shelf_life_frozen_days, shelf_life_thawed_days: p.shelf_life_thawed_days,
    storage_type: p.storage_type, storage_temp_min: p.storage_temp_min, storage_temp_max: p.storage_temp_max, default_location_kind: p.default_location_kind ?? "",
    default_supplier_id: p.default_supplier_id ?? "",
  };
}

/** Valida o formulário; devolve a primeira mensagem de erro ou null. */
export function validateProductForm(f: ProductForm): string | null {
  if (!f.name.trim()) return "Informe o nome do produto.";
  if (!f.stock_unit_id) return "Escolha a unidade de estoque (como o produto é contado no estoque).";
  if (f.purchase_unit_id && (!f.purchase_factor || f.purchase_factor <= 0)) return "Informe o fator da unidade de compra (ex.: 1 caixa = 10 kg).";
  if (f.storage_temp_min !== null && f.storage_temp_max !== null && f.storage_temp_min > f.storage_temp_max) return "A temperatura mínima não pode ser maior que a máxima.";
  if ((f.min_stock ?? 0) < 0 || (f.max_stock ?? 0) < 0 || (f.reorder_point ?? 0) < 0 || (f.ideal_stock ?? 0) < 0) return "Os níveis de estoque não podem ser negativos.";
  if ((f.max_stock ?? 0) > 0 && (f.min_stock ?? 0) > (f.max_stock ?? 0)) return "O estoque mínimo não pode ser maior que o máximo.";
  return null;
}

/** Colunas gravadas em `products` (o custo é tratado à parte na edição). */
export function productPayload(f: ProductForm, companyId: string, includeCost: boolean) {
  return {
    company_id: companyId,
    name: f.name.trim(), internal_code: f.internal_code.trim(), sku: f.sku.trim(), barcode: f.barcode.trim(),
    category_id: f.category_id || null, product_kind: f.product_kind, photo_url: f.photo_url, notes: f.notes.trim(), active: f.active,
    stock_unit_id: f.stock_unit_id, purchase_unit_id: f.purchase_unit_id || null, purchase_factor: f.purchase_unit_id ? (f.purchase_factor ?? 1) : 1,
    ...(includeCost ? { cost: f.cost ?? 0 } : {}),
    min_stock: f.min_stock ?? 0, max_stock: f.max_stock ?? 0, reorder_point: f.reorder_point ?? 0, ideal_stock: f.ideal_stock ?? 0,
    shelf_life_days: f.shelf_life_days, shelf_life_open_days: f.shelf_life_open_days, shelf_life_frozen_days: f.shelf_life_frozen_days, shelf_life_thawed_days: f.shelf_life_thawed_days,
    storage_type: f.storage_type, storage_temp_min: f.storage_temp_min, storage_temp_max: f.storage_temp_max, default_location_kind: f.default_location_kind,
    default_supplier_id: f.default_supplier_id || null,
  };
}

/* ------------------------------------------------------------------ */
/* Formulário de fornecedor                                            */
/* ------------------------------------------------------------------ */
export type SupplierForm = {
  name: string; trade_name: string; cnpj: string; contact_name: string; phone: string; whatsapp: string; email: string; address: string;
  payment_terms: string; lead_time_days: number | null; notes: string; active: boolean;
};
export function emptySupplierForm(): SupplierForm {
  return { name: "", trade_name: "", cnpj: "", contact_name: "", phone: "", whatsapp: "", email: "", address: "", payment_terms: "", lead_time_days: 0, notes: "", active: true };
}
export function supplierToForm(s: Supplier): SupplierForm {
  return {
    name: s.name, trade_name: s.trade_name, cnpj: formatCnpj(s.cnpj), contact_name: s.contact_name, phone: s.phone, whatsapp: s.whatsapp, email: s.email, address: s.address,
    payment_terms: s.payment_terms, lead_time_days: Number(s.lead_time_days ?? 0), notes: s.notes, active: s.active,
  };
}
export function validateSupplierForm(f: SupplierForm): string | null {
  if (!f.name.trim()) return "Informe o nome do fornecedor.";
  const d = onlyDigits(f.cnpj);
  if (d && d.length !== 14 && d.length !== 11) return "CNPJ incompleto (14 dígitos) ou CPF (11 dígitos).";
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return "E-mail inválido.";
  if ((f.lead_time_days ?? 0) < 0) return "O prazo de entrega não pode ser negativo.";
  return null;
}
export function supplierPayload(f: SupplierForm, companyId: string) {
  return {
    company_id: companyId, name: f.name.trim(), trade_name: f.trade_name.trim(), cnpj: formatCnpj(f.cnpj), contact_name: f.contact_name.trim(), phone: f.phone.trim(),
    whatsapp: f.whatsapp.trim(), email: f.email.trim(), address: f.address.trim(), payment_terms: f.payment_terms.trim(), lead_time_days: Math.round(f.lead_time_days ?? 0),
    notes: f.notes.trim(), active: f.active,
  };
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */
export const PRODUCT_SELECT = "*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name), purchase_units:purchase_unit_id(id, code, name), suppliers:default_supplier_id(id, name)";

/** Produto completo para a tela de edição. */
export function useProductDetail(id: string | null | undefined) {
  return useQuery({
    queryKey: ["products", "detail", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("products").select(PRODUCT_SELECT).eq("id", id!).maybeSingle()) as ProductRow | null,
  });
}

/** Todas as unidades (sistema + empresa), inclusive inativas — para as telas de cadastro. */
export function useAllUnits() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["units", "all", company?.id],
    enabled: Boolean(company?.id),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("units").select("*").or(`company_id.is.null,company_id.eq.${company!.id}`).order("company_id", { ascending: true, nullsFirst: true }).order("position").order("code")) as Unit[],
  });
}

/** Categorias com contagem de produtos (v_categories). */
export function useCategoryRows() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["categories", "rows", company?.id],
    enabled: Boolean(company?.id),
    queryFn: async () => unwrap(await supabaseBrowser().from("v_categories").select("*").eq("company_id", company!.id).order("position").order("name")) as CategoryRow[],
  });
}

export function useProductUnits(productId: string | null | undefined) {
  return useQuery({
    queryKey: ["product_units", productId],
    enabled: Boolean(productId),
    queryFn: async () => unwrap(await supabaseBrowser().from("product_units").select("*, units(id, code, name, kind)").eq("product_id", productId!).order("created_at")) as ProductUnitRow[],
  });
}

export function useProductStoreSettings(productId: string | null | undefined) {
  return useQuery({
    queryKey: ["product_store_settings", productId],
    enabled: Boolean(productId),
    queryFn: async () => unwrap(await supabaseBrowser().from("product_store_settings").select("*, stock_locations:default_location_id(id, name)").eq("product_id", productId!)) as StoreSettingsRow[],
  });
}

/** Fornecedores de um produto ou produtos de um fornecedor. */
export function useSupplierProducts(by: { productId?: string | null; supplierId?: string | null }) {
  const key = by.productId ? ["supplier_products", "product", by.productId] : ["supplier_products", "supplier", by.supplierId];
  return useQuery({
    queryKey: key,
    enabled: Boolean(by.productId || by.supplierId),
    queryFn: async () => {
      let q = supabaseBrowser().from("supplier_products").select("*, suppliers(id, name), products(id, name, internal_code), units(id, code)").order("preferred", { ascending: false });
      q = by.productId ? q.eq("product_id", by.productId) : q.eq("supplier_id", by.supplierId!);
      return unwrap(await q.order("created_at")) as SupplierProductRow[];
    },
  });
}

/** Histórico de preços (paginado no banco). */
export function usePriceHistory(by: { productId?: string | null; supplierId?: string | null }, range: { from: number; to: number }) {
  return useQuery({
    queryKey: ["supplier_price_history", by.productId ? "product" : "supplier", by.productId ?? by.supplierId, range.from],
    enabled: Boolean(by.productId || by.supplierId),
    queryFn: async () => {
      let q = supabaseBrowser()
        .from("supplier_price_history")
        .select("*, suppliers(id, name), products(id, name, internal_code), units(code), stores(id, name)", { count: "exact" })
        .order("recorded_at", { ascending: false })
        .range(range.from, range.to);
      q = by.productId ? q.eq("product_id", by.productId) : q.eq("supplier_id", by.supplierId!);
      const res = await q;
      if (res.error) throw res.error;
      return { rows: (res.data ?? []) as PriceHistoryRow[], total: res.count ?? 0 };
    },
  });
}

export function usePriceComparison(productId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["supplier_products", "comparison", productId],
    enabled: Boolean(productId) && enabled,
    queryFn: async () => (await rpc<PriceComparison[] | null>("ops_supplier_price_comparison", { p_product: productId })) ?? [],
  });
}

export function useSupplierDetail(id: string | null | undefined) {
  return useQuery({
    queryKey: ["suppliers", "detail", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabaseBrowser().from("v_suppliers").select("*").eq("id", id!).maybeSingle()) as SupplierRow | null,
  });
}

export function useSupplierReceipts(supplierId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ["receipts", "supplier", supplierId, limit],
    enabled: Boolean(supplierId),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("receipts").select("*, stores(id, name)").eq("supplier_id", supplierId!).order("received_at", { ascending: false }).limit(limit)) as (Receipt & { stores?: { id: UUID; name: string } | null })[],
  });
}

export function useSupplierOrders(supplierId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ["purchase_orders", "supplier", supplierId, limit],
    enabled: Boolean(supplierId),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("purchase_orders").select("*, stores(id, name)").eq("supplier_id", supplierId!).order("created_at", { ascending: false }).limit(limit)) as (PurchaseOrder & { stores?: { id: UUID; name: string } | null })[],
  });
}

/** Próximo código interno sugerido pelo banco. */
export async function nextInternalCode(companyId: string): Promise<string> {
  return (await rpc<string>("ops_next_internal_code", { p_company: companyId })) ?? "";
}
