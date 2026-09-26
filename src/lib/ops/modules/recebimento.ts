"use client";

/* ------------------------------------------------------------------ */
/* Módulo: Recebimento · Compras · Reposição — tipos, hooks e utilitários */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { fmtDate, fmtQty } from "@/lib/ops/format";
import type {
  Product, ProductStoreSettings, ProductUnit, PurchaseOrder, PurchaseOrderItem, Receipt, ReceiptItem, StockByProduct, Supplier, SupplierProduct, Unit, UUID,
} from "@/lib/ops/types";

/* ------------------------------------------------------------------ */
/* Tipos das consultas (com relações)                                  */
/* ------------------------------------------------------------------ */
export type ReceiptRow = Receipt & {
  suppliers?: Pick<Supplier, "id" | "name"> | null;
  receipt_items?: { count: number }[] | null;
};

export type ReceiptDetail = Receipt & {
  finalized_by?: UUID | null;
  suppliers?: Pick<Supplier, "id" | "name" | "whatsapp" | "phone"> | null;
  purchase_orders?: Pick<PurchaseOrder, "id" | "number" | "status"> | null;
};

export type ReceiptItemProduct = Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor" | "shelf_life_days" | "storage_type" | "storage_temp_min" | "storage_temp_max" | "last_purchase_price" | "photo_url"> & {
  units?: Pick<Unit, "id" | "code" | "name"> | null;
  categories?: { id: UUID; name: string; emoji: string; color: string } | null;
};

export type ReceiptItemRow = ReceiptItem & {
  products?: ReceiptItemProduct | null;
  units?: Pick<Unit, "id" | "code"> | null;
  stock_locations?: { id: UUID; name: string } | null;
  stock_lots?: { id: UUID; lot_code: string; expires_at: string | null } | null;
};

export type ReceiveResult = {
  ok: boolean;
  result: "aprovado" | "aprovado_ressalva" | "recusado";
  lots: { lot_id: UUID; lot_code: string; product_id: UUID; quantity: number; item_id: UUID }[];
  approved: number;
  with_issues: number;
  rejected: number;
};

export type PurchaseOrderRow = PurchaseOrder & {
  suppliers?: Pick<Supplier, "id" | "name"> | null;
  purchase_order_items?: { count: number }[] | null;
};

export type PurchaseOrderDetail = PurchaseOrder & {
  cancelled_at?: string | null;
  suppliers?: Pick<Supplier, "id" | "name" | "whatsapp" | "phone" | "email" | "contact_name" | "lead_time_days"> | null;
};

export type PoItemProduct = Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor" | "last_purchase_price" | "cost" | "photo_url"> & {
  units?: Pick<Unit, "id" | "code" | "name"> | null;
  categories?: { id: UUID; name: string; emoji: string; color: string } | null;
};

export type PurchaseOrderItemRow = PurchaseOrderItem & {
  products?: PoItemProduct | null;
  units?: Pick<Unit, "id" | "code"> | null;
};

export type ReplenishmentRow = StockByProduct & {
  /** a view não tem id; as linhas são identificadas por product_id (keyFn) */
  id?: string;
  suggested_purchase_units: number;
  estimated_cost: number;
  level_rank: number;
};

export type CreatedPo = { id: UUID; number: string; supplier_id: UUID | null; supplier_name: string; items: number };

/* Campos de produto que as telas deste módulo carregam junto com os itens */
export const RECEIPT_ITEM_SELECT =
  "*, products(id, name, internal_code, stock_unit_id, purchase_unit_id, purchase_factor, shelf_life_days, storage_type, storage_temp_min, storage_temp_max, last_purchase_price, photo_url, units:stock_unit_id(id, code, name), categories(id, name, emoji, color)), units(id, code), stock_locations(id, name), stock_lots(id, lot_code, expires_at)";

export const PO_ITEM_SELECT =
  "*, products(id, name, internal_code, stock_unit_id, purchase_unit_id, purchase_factor, last_purchase_price, cost, photo_url, units:stock_unit_id(id, code, name), categories(id, name, emoji, color)), units(id, code)";

/* ------------------------------------------------------------------ */
/* Hooks de leitura                                                    */
/* ------------------------------------------------------------------ */

/** Conversões extras cadastradas no produto (1 <unit> = factor <unidade de estoque>). */
export function useProductUnits(productId: string | null | undefined) {
  return useQuery({
    queryKey: ["product_units", productId],
    enabled: Boolean(productId),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("product_units").select("*, units(code, name)").eq("product_id", productId!)) as ProductUnit[],
  });
}

/** Parâmetros do produto na unidade atual (mínimo, local padrão…). */
export function useProductStoreSettings(productId: string | null | undefined, storeId: string | null | undefined) {
  return useQuery({
    queryKey: ["product_store_settings", storeId, productId],
    enabled: Boolean(productId && storeId),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabaseBrowser().from("product_store_settings").select("*").eq("product_id", productId!).eq("store_id", storeId!).maybeSingle(),
      ) as ProductStoreSettings | null,
  });
}

/** Último preço pago a um fornecedor por um produto (por unidade de estoque). */
export function useSupplierProduct(supplierId: string | null | undefined, productId: string | null | undefined) {
  return useQuery({
    queryKey: ["supplier_products", supplierId, productId],
    enabled: Boolean(supplierId && productId),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabaseBrowser().from("supplier_products").select("*, units(code, name)").eq("supplier_id", supplierId!).eq("product_id", productId!).maybeSingle(),
      ) as (SupplierProduct & { units?: Pick<Unit, "code" | "name"> | null }) | null,
  });
}

/** Produto completo (com unidade de estoque e categoria) para o seletor. */
export function useProductById(id: string | null | undefined) {
  const { company } = useSession();
  return useQuery({
    queryKey: ["products", "full", id],
    enabled: Boolean(id && company?.id),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("products")
          .select("*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)")
          .eq("id", id!)
          .single(),
      ) as Product,
  });
}

/** Busca um produto ativo pelo código de barras lido na câmera. */
export async function findProductByBarcode(companyId: string, code: string): Promise<Product | null> {
  const c = code.trim();
  if (!c) return null;
  const res = await supabaseBrowser()
    .from("products")
    .select("*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)")
    .eq("company_id", companyId)
    .eq("active", true)
    .or(`barcode.eq.${c.replace(/[,()]/g, "")},internal_code.eq.${c.replace(/[,()]/g, "")}`)
    .limit(1);
  const rows = unwrap(res) as Product[];
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Unidades compatíveis e conversão                                    */
/* ------------------------------------------------------------------ */
export type UnitOption = { unit: Unit; factor: number; source: "estoque" | "compra" | "produto" | "conversao" };

/**
 * Unidades em que o produto pode ser informado (a mesma regra da função
 * ops_convert_qty do banco): unidade de estoque, unidade de compra,
 * conversões do produto e unidades do mesmo tipo (kg ↔ g, L ↔ ml).
 * `factor` = quantas unidades de estoque cabem em 1 desta unidade.
 */
export function compatibleUnits(product: Pick<Product, "stock_unit_id" | "purchase_unit_id" | "purchase_factor">, units: Unit[], productUnits: ProductUnit[]): UnitOption[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const stock = byId.get(product.stock_unit_id);
  const out: UnitOption[] = [];
  const seen = new Set<string>();
  const push = (u: Unit | undefined, factor: number, source: UnitOption["source"]) => {
    if (!u || seen.has(u.id) || !(factor > 0)) return;
    seen.add(u.id);
    out.push({ unit: u, factor, source });
  };
  push(stock, 1, "estoque");
  if (product.purchase_unit_id && product.purchase_unit_id !== product.stock_unit_id) push(byId.get(product.purchase_unit_id), Number(product.purchase_factor) || 1, "compra");
  for (const pu of productUnits) push(byId.get(pu.unit_id), Number(pu.factor), "produto");
  if (stock && stock.base_factor) {
    for (const u of units) {
      if (u.kind === stock.kind && u.base_factor && u.id !== stock.id) push(u, Number(u.base_factor) / Number(stock.base_factor), "conversao");
    }
  }
  return out;
}

export function unitFactor(options: UnitOption[], unitId: string): number | null {
  const o = options.find((x) => x.unit.id === unitId);
  return o ? o.factor : null;
}

/** Unidade padrão para informar quantidade: a de compra, se houver; senão a de estoque. */
export function defaultUnitId(product: Pick<Product, "stock_unit_id" | "purchase_unit_id">, options: UnitOption[]): string {
  if (product.purchase_unit_id && options.some((o) => o.unit.id === product.purchase_unit_id)) return product.purchase_unit_id;
  return product.stock_unit_id;
}

/* ------------------------------------------------------------------ */
/* Datas para <input type="datetime-local"> / <input type="date">      */
/* ------------------------------------------------------------------ */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString());
}

/* ------------------------------------------------------------------ */
/* Temperatura                                                         */
/* ------------------------------------------------------------------ */
/** Diz se a temperatura informada está fora da faixa de armazenagem do produto. */
export function temperatureIssue(
  product: Pick<Product, "storage_type" | "storage_temp_min" | "storage_temp_max"> | null | undefined,
  temperature: number | null | undefined,
): { outOfRange: boolean; rangeLabel: string | null } {
  if (!product || product.storage_type === "ambiente") return { outOfRange: false, rangeLabel: null };
  const min = product.storage_temp_min, max = product.storage_temp_max;
  if (min === null && max === null) return { outOfRange: false, rangeLabel: null };
  const rangeLabel = min !== null && max !== null ? `${fmtQty(min)} °C a ${fmtQty(max)} °C` : min !== null ? `mínimo ${fmtQty(min)} °C` : `máximo ${fmtQty(max)} °C`;
  if (temperature === null || temperature === undefined) return { outOfRange: false, rangeLabel };
  const out = (min !== null && temperature < Number(min)) || (max !== null && temperature > Number(max));
  return { outOfRange: out, rangeLabel };
}

/* ------------------------------------------------------------------ */
/* Texto do pedido para WhatsApp / área de transferência               */
/* ------------------------------------------------------------------ */
export function purchaseOrderText(po: PurchaseOrderDetail, items: PurchaseOrderItemRow[], storeName: string): string {
  const lines: string[] = [];
  lines.push(`*Pedido de compra ${po.number}*`);
  if (storeName) lines.push(storeName);
  if (po.suppliers?.name) lines.push(`Fornecedor: ${po.suppliers.name}`);
  if (po.expected_at) lines.push(`Previsão de entrega: ${fmtDate(po.expected_at)}`);
  lines.push("");
  lines.push("Itens:");
  for (const it of items) {
    const unit = it.units?.code ?? it.products?.units?.code ?? "";
    const stockUnit = it.products?.units?.code ?? "";
    const conv = it.units?.id && it.units.id !== it.products?.stock_unit_id && stockUnit ? ` (= ${fmtQty(it.quantity_stock, stockUnit)})` : "";
    lines.push(`- ${fmtQty(it.quantity, unit)} ${it.products?.name ?? "Produto"}${conv}`);
  }
  if (po.notes) {
    lines.push("");
    lines.push(`Obs.: ${po.notes}`);
  }
  return lines.join("\n");
}

/** Número de WhatsApp em formato internacional (só dígitos), ou null. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function whatsappLink(raw: string | null | undefined, text: string): string | null {
  const d = whatsappDigits(raw);
  if (!d) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* tenta o modo antigo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Diversos                                                            */
/* ------------------------------------------------------------------ */
/** ids de fornecedores cujo nome contém o termo (para busca por fornecedor na lista). */
export function supplierIdsMatching(suppliers: Supplier[] | undefined, term: string): string[] {
  const t = term.trim().toLowerCase();
  if (!t || !suppliers) return [];
  return suppliers.filter((s) => s.name.toLowerCase().includes(t) || s.trade_name.toLowerCase().includes(t)).map((s) => s.id);
}

/** Limpa o termo para uso dentro de filtros `or(...)` do PostgREST. */
export function safeLike(term: string): string {
  return `%${term.trim().replace(/[%_,()]/g, "")}%`;
}

export function embeddedCount(v: { count: number }[] | null | undefined): number {
  return v && v.length > 0 ? Number(v[0].count) : 0;
}

type RawList = { data: unknown; error: { message: string; code?: string } | null; count: number | null };

/**
 * Executa a consulta da lista com a contagem de itens embutida (`tabela(count)`).
 * Se o PostgREST estiver com agregações desligadas, refaz sem a contagem para a
 * lista continuar funcionando (a coluna "Itens" mostra 0 nesse caso).
 */
export async function runListWithCount<T>(build: (withCount: boolean) => PromiseLike<RawList>): Promise<{ rows: T[]; error: RawList["error"]; count: number | null }> {
  let res = await build(true);
  if (res.error && /aggregate/i.test(res.error.message)) res = await build(false);
  return { rows: (res.data ?? []) as T[], error: res.error, count: res.count };
}

/** Data local (yyyy-mm-dd) de um instante ISO. */
export function toLocalDateISO(iso: string | null | undefined): string {
  const v = toLocalInput(iso);
  return v ? v.slice(0, 10) : "";
}

/** Etapas editáveis do pedido de compra (itens/cabeçalho). */
export const PO_EDITABLE_STATUSES = new Set(["rascunho", "solicitado", "aprovado"]);
