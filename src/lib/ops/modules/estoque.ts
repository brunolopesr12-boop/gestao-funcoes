"use client";

/* ------------------------------------------------------------------ */
/* Módulo ESTOQUE · tipos, rótulos, utilitários e consultas            */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { useUnits } from "@/lib/ops/hooks";
import { useSession } from "@/lib/ops/session";
import type { ExpiryStatus, LotStatus, MovementType, Product, StockLevel, StockLot, StoreMinimal, TransferRow, UUID, Unit } from "./estoque-types";

export type { LotSummary, LotSummaryMovement, TransferRow, TransferItemRow } from "./estoque-types";

/* ------------------------------------------------------------------ */
/* Rótulos e opções                                                    */
/* ------------------------------------------------------------------ */
export const LEVEL_OPTIONS: { value: StockLevel; label: string }[] = [
  { value: "normal", label: "🟢 Nível adequado" },
  { value: "atencao", label: "🟡 Próximo do mínimo" },
  { value: "baixo", label: "🔴 Abaixo do mínimo" },
  { value: "critico", label: "🚨 Crítico" },
];

export const EXPIRY_OPTIONS: { value: ExpiryStatus; label: string }[] = [
  { value: "vencido", label: "Vencido" },
  { value: "hoje", label: "Vence hoje" },
  { value: "3dias", label: "Vence em 3 dias" },
  { value: "7dias", label: "Vence em 7 dias" },
  { value: "ok", label: "No prazo" },
  { value: "sem_validade", label: "Sem validade" },
];

export const LOT_STATUS_OPTIONS: { value: LotStatus; label: string }[] = [
  { value: "ativo", label: "Ativo" },
  { value: "bloqueado", label: "Bloqueado" },
  { value: "vencido", label: "Vencido" },
  { value: "esgotado", label: "Esgotado" },
];

/** Motivos de consumo oferecidos no botão "Consumir". */
export const CONSUME_REASONS: { value: string; label: string }[] = [
  { value: "consumo", label: "Consumo na cozinha" },
  { value: "producao manual", label: "Produção (sem ficha técnica)" },
  { value: "venda", label: "Venda / saída para cliente" },
  { value: "uso interno", label: "Uso interno / refeição da equipe" },
  { value: "amostra", label: "Amostra / degustação" },
  { value: "outro", label: "Outro (descreva na observação)" },
];

/** Motivos de ajuste manual de saldo. */
export const ADJUST_REASONS: { value: string; label: string }[] = [
  { value: "contagem", label: "Contagem física diferente do sistema" },
  { value: "erro de lançamento", label: "Erro de lançamento" },
  { value: "quebra", label: "Quebra / embalagem danificada" },
  { value: "sobra", label: "Sobra encontrada" },
  { value: "correcao de unidade", label: "Correção de unidade de medida" },
  { value: "outro", label: "Outro (descreva na observação)" },
];

export type ManualEntryOrigin = "inicial" | "ajuste" | "devolucao";
export const MANUAL_ORIGIN_OPTIONS: { value: ManualEntryOrigin; label: string; hint: string }[] = [
  { value: "inicial", label: "Estoque inicial", hint: "Primeira carga do sistema" },
  { value: "ajuste", label: "Entrada manual", hint: "Compra sem recebimento" },
  { value: "devolucao", label: "Devolução", hint: "Voltou de cliente/produção" },
];

export type LotEvent = "abertura" | "congelamento" | "descongelamento" | "bloqueio" | "desbloqueio";
export const LOT_EVENT_META: Record<LotEvent, { label: string; verb: string; perm: string; tone: "primary" | "soft" | "danger" | "success"; help: string }> = {
  abertura: { label: "Abrir", verb: "abrir", perm: "estoque.movimentar", tone: "soft", help: "Marca a embalagem como aberta. A validade passa a ser a de produto aberto, se o produto tiver esse prazo." },
  congelamento: { label: "Congelar", verb: "congelar", perm: "estoque.movimentar", tone: "soft", help: "Registra o congelamento. A validade passa a ser a de produto congelado, se o produto tiver esse prazo." },
  descongelamento: { label: "Descongelar", verb: "descongelar", perm: "estoque.movimentar", tone: "soft", help: "Registra o descongelamento. A validade passa a ser a de produto descongelado (nunca maior que a original)." },
  bloqueio: { label: "Bloquear", verb: "bloquear", perm: "estoque.ajustar", tone: "danger", help: "Lote bloqueado não pode ser consumido nem transferido: só perda ou ajuste." },
  desbloqueio: { label: "Desbloquear", verb: "desbloquear", perm: "estoque.ajustar", tone: "success", help: "Libera o lote para uso novamente." },
};

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
/** Termo seguro para `ilike` (remove caracteres que quebram o filtro do PostgREST). */
export function likeTerm(t: string): string {
  return `%${t.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, "%")}%`;
}

/** Só dígitos com 6+ caracteres = provável código de barras (EAN/UPC/ITF). */
export function looksLikeBarcode(t: string): boolean {
  return /^\d{6,}$/.test(t.trim());
}

export function isUuid(t: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.trim());
}

/** Mesma regra das views (v_stock_balances/v_expiring_lots), calculada no cliente. */
export function expiryStatusFromDays(days: number | null | undefined): ExpiryStatus {
  if (days === null || days === undefined) return "sem_validade";
  if (days < 0) return "vencido";
  if (days === 0) return "hoje";
  if (days <= 3) return "3dias";
  if (days <= 7) return "7dias";
  return "ok";
}

/** Dias entre hoje e uma data yyyy-mm-dd (negativo = passado). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** yyyy-mm-dd + n dias */
export function plusDaysISO(baseISO: string, days: number): string {
  const d = new Date(`${baseISO.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/** Prevê a validade após um evento, com a mesma regra da função ops_lot_event. */
export function previewLotEventExpiry(event: LotEvent, lot: Pick<StockLot, "expires_at" | "original_expires_at">, product: Pick<Product, "shelf_life_open_days" | "shelf_life_frozen_days" | "shelf_life_thawed_days"> | null | undefined, todayISO: string): { expires_at: string | null; changed: boolean; noRule: boolean } {
  const cur = lot.expires_at ? lot.expires_at.slice(0, 10) : null;
  const min = (a: string | null, b: string) => (a && a < b ? a : b);
  if (event === "abertura") {
    const d = product?.shelf_life_open_days ?? null;
    if (d === null) return { expires_at: cur, changed: false, noRule: true };
    const n = min(cur, plusDaysISO(todayISO, d));
    return { expires_at: n, changed: n !== cur, noRule: false };
  }
  if (event === "congelamento") {
    const d = product?.shelf_life_frozen_days ?? null;
    if (d === null) return { expires_at: cur, changed: false, noRule: true };
    const n = plusDaysISO(todayISO, d);
    return { expires_at: n, changed: n !== cur, noRule: false };
  }
  if (event === "descongelamento") {
    const d = product?.shelf_life_thawed_days ?? null;
    if (d === null) return { expires_at: cur, changed: false, noRule: true };
    const orig = lot.original_expires_at ? lot.original_expires_at.slice(0, 10) : null;
    const n = min(orig, plusDaysISO(todayISO, d));
    return { expires_at: n, changed: n !== cur, noRule: false };
  }
  return { expires_at: cur, changed: false, noRule: false };
}

/** Sinal e cor de uma movimentação (positivo entra, negativo sai). */
export function movementTone(type: MovementType, quantity: number): "green" | "red" | "amber" | "blue" | "slate" {
  if (type === "ajuste" || type === "inventario") return "amber";
  if (type === "transferencia") return "blue";
  if (type === "perda") return "red";
  return quantity >= 0 ? "green" : "red";
}

/* ------------------------------------------------------------------ */
/* Consultas do módulo                                                 */
/* ------------------------------------------------------------------ */
export type StockKpis = { stock_value: number; products: number; lots: number; expired: number; below_min: number };

/** Indicadores do topo da tela de estoque, calculados no banco (sem carregar a lista inteira). */
export function useStockKpis(storeId: string | undefined) {
  return useQuery({
    queryKey: ["stock_items", "kpis", storeId],
    enabled: Boolean(storeId),
    staleTime: 30_000,
    queryFn: async (): Promise<StockKpis> => {
      const sb = supabaseBrowser();
      const [byCat, lots, expired, below] = await Promise.all([
        rpc<{ label: string; products: number; value: number }[] | null>("ops_report_stock_by_category", { p_store: storeId }),
        sb.from("stock_lots").select("id", { count: "exact", head: true }).eq("store_id", storeId!).in("status", ["ativo", "bloqueado", "vencido"]),
        sb.from("v_expiring_lots").select("lot_id", { count: "exact", head: true }).eq("store_id", storeId!).eq("expiry_status", "vencido"),
        sb.from("v_stock_by_product").select("product_id", { count: "exact", head: true }).eq("store_id", storeId!).eq("active", true).in("level", ["baixo", "critico"]),
      ]);
      if (lots.error) throw lots.error;
      if (expired.error) throw expired.error;
      if (below.error) throw below.error;
      const cats = byCat ?? [];
      return {
        stock_value: cats.reduce((s, c) => s + Number(c.value ?? 0), 0),
        products: cats.reduce((s, c) => s + Number(c.products ?? 0), 0),
        lots: lots.count ?? 0,
        expired: expired.count ?? 0,
        below_min: below.count ?? 0,
      };
    },
  });
}

/** Linha crua do lote (para pré-carregar telas a partir de ?lot=). */
export function useLot(lotId: string | null | undefined) {
  return useQuery({
    queryKey: ["stock_lots", "row", lotId],
    enabled: Boolean(lotId),
    queryFn: async () => unwrap(await supabaseBrowser().from("stock_lots").select("*").eq("id", lotId!).maybeSingle()) as StockLot | null,
  });
}

/** Ficha completa do lote (RPC ops_lot_summary). Retorna null quando o lote não existe. */
export function useLotSummary(lotId: string | null | undefined) {
  return useQuery({
    queryKey: ["stock_lots", "summary", lotId],
    enabled: Boolean(lotId),
    queryFn: () => rpc<import("./estoque-types").LotSummary | null>("ops_lot_summary", { p_lot: lotId }),
  });
}

export type UnitOption = { id: UUID; code: string; label: string; factor: number | null };

/**
 * Unidades em que o funcionário pode informar a quantidade de um produto:
 * unidade de estoque, unidade de compra, conversões cadastradas no produto
 * e unidades do mesmo tipo (kg↔g, L↔ml). É exatamente o que ops_convert_qty aceita.
 */
export function useProductUnitOptions(product: Pick<Product, "id" | "stock_unit_id" | "purchase_unit_id" | "purchase_factor"> | null | undefined) {
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
  const options: UnitOption[] = [];
  if (product && stock) {
    options.push({ id: stock.id, code: stock.code, label: `${stock.code} — ${stock.name} (unidade de estoque)`, factor: 1 });
    for (const x of pu.data ?? []) {
      const u = all.find((y) => y.id === x.unit_id);
      if (u && !options.some((o) => o.id === u.id)) options.push({ id: u.id, code: u.code, label: `${u.code} — ${x.label || u.name} (= ${x.factor} ${stock.code})`, factor: Number(x.factor) });
    }
    if (product.purchase_unit_id && product.purchase_factor > 0) {
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

/** Unidades da mesma empresa, exceto a atual (destino de transferência). */
export function useOtherStores(): StoreMinimal[] {
  const { stores, store } = useSession();
  return stores.filter((s) => s.id !== store?.id && s.company_id === store?.company_id).map((s) => ({ id: s.id, name: s.name }));
}

/** Transferências recentes da unidade (enviadas ou recebidas), com itens. */
export function useRecentTransfers(storeId: string | undefined, limit = 20) {
  return useQuery({
    queryKey: ["transfers", "recent", storeId, limit],
    enabled: Boolean(storeId),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("transfers")
          .select(
            "id, from_store_id, to_store_id, from_location_id, to_location_id, status, notes, created_by_name, created_at, " +
              "from_store:stores!from_store_id(name), to_store:stores!to_store_id(name), " +
              "from_location:stock_locations!from_location_id(name), to_location:stock_locations!to_location_id(name), " +
              "transfer_items(id, product_id, quantity, unit_cost, products(name, internal_code, units:stock_unit_id(code)), from_lot:stock_lots!from_lot_id(lot_code))",
          )
          .or(`from_store_id.eq.${storeId},to_store_id.eq.${storeId}`)
          .order("created_at", { ascending: false })
          .limit(limit),
      ) as unknown as TransferRow[],
  });
}
