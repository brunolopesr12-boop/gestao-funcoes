/* ------------------------------------------------------------------ */
/* Módulo ESTOQUE · tipos específicos (complementam src/lib/ops/types)  */
/* ------------------------------------------------------------------ */

import type { MovementType, StockLot, StorageType, UUID } from "@/lib/ops/types";

export type { ExpiryStatus, LotStatus, MovementType, Product, StockLevel, StockLot, UUID, Unit } from "@/lib/ops/types";

export type StoreMinimal = { id: UUID; name: string };

/** Uma linha do histórico devolvido por ops_lot_summary. */
export type LotSummaryMovement = {
  id: UUID;
  type: MovementType;
  quantity: number;
  created_at: string;
  user: string;
  reason: string;
  notes: string;
  location: string;
  balance_after: number;
};

/** Retorno de ops_lot_summary(p_lot) — ficha do lote (tela do QR Code). */
export type LotSummary = {
  lot: StockLot;
  product: {
    id: UUID;
    name: string;
    internal_code: string;
    photo_url: string;
    unit: string;
    unit_name: string;
    storage_type: StorageType;
    category: string | null;
    cost: number;
  };
  store: StoreMinimal | null;
  supplier: StoreMinimal | null;
  balance: number;
  balances: { location_id: UUID; location: string; quantity: number }[];
  movements: LotSummaryMovement[];
  created_by_name: string;
  days_to_expire: number | null;
  fefo_first: boolean;
};

/** Item de transferência com os relacionamentos usados na lista de recentes. */
export type TransferItemRow = {
  id: UUID;
  product_id: UUID;
  quantity: number;
  unit_cost: number;
  products: { name: string; internal_code: string; units: { code: string } | null } | null;
  from_lot: { lot_code: string } | null;
};

/** Transferência (interna ou entre unidades) com itens. */
export type TransferRow = {
  id: UUID;
  from_store_id: UUID;
  to_store_id: UUID;
  from_location_id: UUID | null;
  to_location_id: UUID | null;
  status: "enviado" | "recebido" | "cancelado";
  notes: string;
  created_by_name: string;
  created_at: string;
  from_store: { name: string } | null;
  to_store: { name: string } | null;
  from_location: { name: string } | null;
  to_location: { name: string } | null;
  transfer_items: TransferItemRow[];
};

/** Resultado de ops_consume. */
export type ConsumeResult = {
  ok: boolean;
  duplicated?: boolean;
  quantity?: number;
  fefo_warning?: boolean;
  fefo_lot_id?: UUID | null;
  movements?: { movement_id: UUID; lot_id: UUID; location_id: UUID; quantity: number }[];
};

/** Resultado de ops_lot_event. */
export type LotEventResult = { lot_id: UUID; expires_at: string | null; status: string };
