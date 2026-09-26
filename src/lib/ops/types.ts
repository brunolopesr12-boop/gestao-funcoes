/* ------------------------------------------------------------------ */
/* Tipos das tabelas do sistema de cozinha (espelham supabase/migrations) */
/* ------------------------------------------------------------------ */

export type UUID = string;

export type Company = { id: UUID; name: string; emoji: string; color: string; notes: string; active: boolean; position: number };
export type Store = { id: UUID; company_id: UUID; name: string; code: string; address: string; phone: string; timezone: string; active: boolean; position: number };
export type Profile = { id: UUID; email: string; full_name: string; phone: string; avatar_url: string; active: boolean; last_store_id: UUID | null };
export type AccessRole = { id: UUID; company_id: UUID | null; code: string; name: string; description: string; system: boolean; position: number };
export type Permission = { code: string; module: string; name: string; description: string; position: number };
export type Membership = {
  id: UUID; company_id: UUID; user_id: UUID | null; invited_email: string; access_role_id: UUID; all_stores: boolean; active: boolean;
  employee_id: UUID | null; created_at: string;
  access_roles?: Pick<AccessRole, "id" | "code" | "name"> | null;
  companies?: Pick<Company, "id" | "name" | "emoji" | "color"> | null;
  profiles?: Pick<Profile, "id" | "email" | "full_name" | "phone" | "active"> | null;
  membership_stores?: { store_id: UUID }[];
};

export type UnitKind = "massa" | "volume" | "contagem" | "embalagem";
export type Unit = { id: UUID; company_id: UUID | null; code: string; name: string; kind: UnitKind; base_factor: number | null; decimals: number; active: boolean; position: number };
export type Category = { id: UUID; company_id: UUID; parent_id: UUID | null; name: string; emoji: string; color: string; position: number; active: boolean };

export type ProductKind = "materia_prima" | "semipronto" | "produzido" | "final" | "descartavel" | "outro";
export type StorageType = "ambiente" | "refrigerado" | "congelado";
export type Product = {
  id: UUID; company_id: UUID; name: string; internal_code: string; sku: string; barcode: string; category_id: UUID | null;
  product_kind: ProductKind; stock_unit_id: UUID; purchase_unit_id: UUID | null; purchase_factor: number;
  cost: number; last_purchase_price: number; min_stock: number; max_stock: number; reorder_point: number; ideal_stock: number;
  shelf_life_days: number | null; shelf_life_open_days: number | null; shelf_life_frozen_days: number | null; shelf_life_thawed_days: number | null;
  storage_type: StorageType; storage_temp_min: number | null; storage_temp_max: number | null; default_location_kind: string;
  default_supplier_id: UUID | null; photo_url: string; notes: string; active: boolean; created_at: string; updated_at: string;
  categories?: Pick<Category, "id" | "name" | "emoji" | "color"> | null;
  units?: Pick<Unit, "id" | "code" | "name"> | null;
  suppliers?: Pick<Supplier, "id" | "name"> | null;
};
export type ProductUnit = { id: UUID; product_id: UUID; unit_id: UUID; factor: number; label: string; units?: Pick<Unit, "code" | "name"> | null };
export type ProductStoreSettings = {
  id: UUID; product_id: UUID; store_id: UUID; min_stock: number | null; max_stock: number | null; reorder_point: number | null;
  ideal_stock: number | null; default_location_id: UUID | null; active: boolean;
};

export type Supplier = {
  id: UUID; company_id: UUID; name: string; trade_name: string; cnpj: string; contact_name: string; phone: string; whatsapp: string; email: string;
  address: string; payment_terms: string; lead_time_days: number; notes: string; active: boolean; created_at: string;
};
export type SupplierProduct = {
  id: UUID; supplier_id: UUID; product_id: UUID; supplier_code: string; unit_id: UUID | null; last_price: number; last_purchase_at: string | null;
  preferred: boolean; notes: string; products?: Pick<Product, "id" | "name" | "internal_code"> | null; suppliers?: Pick<Supplier, "id" | "name"> | null;
};

export type LocationKind = "estoque_seco" | "camara_fria" | "freezer" | "geladeira" | "cozinha" | "producao" | "bar" | "outro";
export type StockLocation = { id: UUID; store_id: UUID; name: string; kind: LocationKind; temperature_equipment_id: UUID | null; storage_type: StorageType; active: boolean; position: number };

export type LotOrigin = "recebimento" | "producao" | "ajuste" | "transferencia" | "inicial" | "devolucao";
export type LotStatus = "ativo" | "esgotado" | "bloqueado" | "vencido";
export type StockLot = {
  id: UUID; company_id: UUID; store_id: UUID; product_id: UUID; lot_code: string; origin: LotOrigin; supplier_id: UUID | null;
  receipt_id: UUID | null; production_id: UUID | null; origin_lot_id: UUID | null; produced_at: string | null; received_at: string | null;
  opened_at: string | null; frozen_at: string | null; thawed_at: string | null; expires_at: string | null; original_expires_at: string | null;
  unit_cost: number; initial_quantity: number; status: LotStatus; notes: string; created_by: UUID | null; created_at: string;
};

export type ExpiryStatus = "sem_validade" | "vencido" | "hoje" | "3dias" | "7dias" | "ok";
export type StockBalance = {
  id: UUID; store_id: UUID; company_id: UUID; product_id: UUID; product_name: string; internal_code: string; barcode: string; product_kind: ProductKind;
  category_id: UUID | null; category_name: string | null; unit: string; location_id: UUID; location_name: string; lot_id: UUID; lot_code: string;
  lot_origin: LotOrigin; supplier_id: UUID | null; expires_at: string | null; days_to_expire: number | null; expiry_status: ExpiryStatus; lot_status: LotStatus;
  produced_at: string | null; received_at: string | null; opened_at: string | null; frozen_at: string | null; thawed_at: string | null;
  quantity: number; unit_cost: number; total_value: number; updated_at: string;
};
export type StockLevel = "normal" | "atencao" | "baixo" | "critico";
export type StockByProduct = {
  store_id: UUID; company_id: UUID; product_id: UUID; product_name: string; internal_code: string; barcode: string; product_kind: ProductKind;
  category_id: UUID | null; category_name: string | null; unit: string; cost: number; active: boolean;
  default_supplier_id: UUID | null; default_supplier_name: string | null; purchase_unit_id: UUID | null; purchase_unit: string | null; purchase_factor: number;
  quantity: number; total_value: number; lots_count: number; next_expiry: string | null; expired_quantity: number; blocked_quantity: number;
  min_stock: number; max_stock: number; reorder_point: number; ideal_stock: number; level: StockLevel; suggested_purchase: number;
  suggested_purchase_units?: number; estimated_cost?: number;
};
export type ExpiringLot = {
  lot_id: UUID; store_id: UUID; company_id: UUID; product_id: UUID; product_name: string; internal_code: string; category_name: string | null; unit: string;
  lot_code: string; origin: LotOrigin; expires_at: string; days_to_expire: number; lot_status: LotStatus; unit_cost: number; supplier_id: UUID | null;
  supplier_name: string | null; quantity: number; total_value: number; locations: string; expiry_status: ExpiryStatus;
};

export type MovementType = "entrada" | "saida" | "producao_consumo" | "producao_entrada" | "consumo" | "transferencia" | "perda" | "ajuste" | "devolucao" | "inventario" | "inicial";
export type Movement = {
  id: UUID; company_id: UUID; store_id: UUID; product_id: UUID; product_name: string; internal_code: string; category_name: string | null; unit: string;
  lot_id: UUID; lot_code: string; expires_at: string | null; location_id: UUID; location_name: string; movement_type: MovementType; quantity: number;
  unit_cost: number; total_cost: number; balance_after: number; reason: string; reference_type: string | null; reference_id: UUID | null; notes: string;
  created_by: UUID | null; created_by_name: string; created_at: string;
};

export type LossReason = { id: UUID; company_id: UUID; code: string; name: string; requires_photo: boolean; active: boolean; position: number };
export type Loss = {
  id: UUID; company_id: UUID; store_id: UUID; product_id: UUID; product_name: string; internal_code: string; category_name: string | null; unit: string;
  lot_id: UUID | null; lot_code: string | null; location_id: UUID | null; location_name: string | null; quantity: number; unit_cost: number; total_cost: number;
  loss_reason_id: UUID | null; reason_name: string; notes: string; photo_url: string; created_by: UUID | null; created_by_name: string; created_at: string;
};

export type PurchaseOrderStatus = "rascunho" | "solicitado" | "aprovado" | "pedido" | "recebido" | "cancelado";
export type PurchaseOrder = {
  id: UUID; company_id: UUID; store_id: UUID; supplier_id: UUID | null; number: string; status: PurchaseOrderStatus; expected_at: string | null; notes: string;
  total: number; requested_at: string | null; approved_at: string | null; ordered_at: string | null; received_at: string | null; cancelled_at: string | null; cancel_reason: string;
  created_by: UUID | null; created_by_name: string; created_at: string; updated_at: string;
  suppliers?: Pick<Supplier, "id" | "name"> | null;
};
export type PurchaseOrderItem = {
  id: UUID; purchase_order_id: UUID; product_id: UUID; quantity: number; unit_id: UUID | null; quantity_stock: number; estimated_price: number; total: number;
  received_quantity: number; notes: string; position: number; products?: Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id"> | null; units?: Pick<Unit, "code"> | null;
};

export type ReceiptStatus = "rascunho" | "finalizado" | "cancelado";
export type ReceiptResult = "aprovado" | "aprovado_ressalva" | "recusado";
export type Receipt = {
  id: UUID; company_id: UUID; store_id: UUID; supplier_id: UUID | null; purchase_order_id: UUID | null; number: string; invoice_number: string;
  invoice_date: string | null; received_at: string; status: ReceiptStatus; result: ReceiptResult | null; notes: string; total: number;
  received_by: UUID | null; received_by_name: string; finalized_by: UUID | null; finalized_at: string | null; created_at: string; updated_at: string;
  suppliers?: Pick<Supplier, "id" | "name"> | null;
};
export type ReceiptItemResult = "aprovado" | "ressalva" | "recusado";
export type RejectionReason = "" | "embalagem_danificada" | "validade_inadequada" | "temperatura_inadequada" | "quantidade_incorreta" | "produto_diferente" | "qualidade_inadequada" | "outro";
export type PackageCondition = "ok" | "danificada" | "molhada" | "amassada" | "aberta" | "outro";
export type ReceiptItem = {
  id: UUID; receipt_id: UUID; product_id: UUID; purchase_order_item_id: UUID | null; quantity: number; unit_id: UUID | null; quantity_stock: number;
  weight: number | null; lot_code: string; expires_at: string | null; unit_price: number; total_price: number; temperature: number | null;
  package_condition: PackageCondition; result: ReceiptItemResult; rejection_reason: RejectionReason; location_id: UUID | null; notes: string; lot_id: UUID | null; position: number;
  products?: Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "shelf_life_days" | "storage_type"> | null; units?: Pick<Unit, "code"> | null;
};

export type Recipe = {
  id: UUID; company_id: UUID; product_id: UUID; name: string; version: number; yield_quantity: number; portion_quantity: number | null; prep_time_min: number | null;
  shelf_life_days: number | null; instructions: string; notes: string; active: boolean; created_at: string; updated_at: string;
  products?: Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "product_kind"> | null;
};
export type RecipeItem = {
  id: UUID; recipe_id: UUID; ingredient_product_id: UUID; gross_quantity: number; unit_id: UUID | null; net_quantity: number | null; notes: string; position: number;
  products?: Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id" | "cost"> | null; units?: Pick<Unit, "code"> | null;
};
export type RecipeCost = {
  recipe_id: UUID; yield_quantity: number; yield_unit: string; portion_quantity: number | null; portions: number | null; total_cost: number; cost_per_unit: number | null;
  cost_per_portion: number | null; gross_total: number | null; net_total: number | null; yield_factor: number | null; loss_pct: number | null;
  items: { id: UUID; product_id: UUID; name: string; gross_quantity: number; net_quantity: number | null; unit: string; quantity_stock: number; stock_unit: string; unit_cost: number; total_cost: number; loss_pct: number; correction_factor: number }[];
};

export type ProductionStatus = "planejada" | "em_andamento" | "concluida" | "cancelada";
export type Production = {
  id: UUID; company_id: UUID; store_id: UUID; recipe_id: UUID | null; product_id: UUID; number: string; status: ProductionStatus; planned_quantity: number;
  produced_quantity: number | null; expected_yield: number | null; actual_yield_pct: number | null; lot_id: UUID | null; lot_code: string; expires_at: string | null;
  location_id: UUID | null; scheduled_for: string | null; started_at: string | null; finished_at: string | null; produced_by: UUID | null; produced_by_name: string;
  notes: string; total_cost: number; unit_cost: number; created_by_name: string; created_at: string; updated_at: string;
  products?: Pick<Product, "id" | "name" | "internal_code" | "stock_unit_id"> | null; recipes?: Pick<Recipe, "id" | "name" | "yield_quantity"> | null;
};
export type ProductionPlan = {
  recipe_id: UUID; product_id: UUID; product_name: string; unit: string; planned: number; scale: number; has_shortage: boolean; estimated_cost: number;
  estimated_unit_cost: number | null; shelf_life_days: number | null; suggested_expires_at: string | null;
  items: { product_id: UUID; name: string; stock_unit: string; needed: number; available: number; shortage: number; unit_cost: number; estimated_cost: number;
           lots: { lot_id: UUID; location_id: UUID; lot_code: string; expires_at: string | null; unit_cost: number; available: number; quantity: number }[] }[];
};

export type InventoryCountStatus = "aberta" | "finalizada" | "cancelada";
export type InventoryCount = {
  id: UUID; company_id: UUID; store_id: UUID; location_id: UUID | null; category_id: UUID | null; number: string; kind: "rapida" | "completa"; status: InventoryCountStatus;
  notes: string; items_count: number; differences: number; difference_value: number; started_by_name: string; finished_at: string | null; created_at: string;
  stock_locations?: Pick<StockLocation, "id" | "name"> | null;
};
export type InventoryItem = {
  id: UUID; count_id: UUID; product_id: UUID; lot_id: UUID | null; location_id: UUID; theoretical_quantity: number; counted_quantity: number | null; difference: number | null;
  unit_cost: number; reason: string; notes: string; counted_by_name: string; counted_at: string | null; movement_id: UUID | null;
  products?: Pick<Product, "id" | "name" | "internal_code"> | null; stock_lots?: Pick<StockLot, "id" | "lot_code" | "expires_at"> | null; stock_locations?: Pick<StockLocation, "id" | "name"> | null;
};

export type EquipmentKind = "geladeira" | "freezer" | "camara_fria" | "balcao_refrigerado" | "estufa" | "outro";
export type TemperatureEquipment = { id: UUID; store_id: UUID; name: string; kind: EquipmentKind; location_text: string; min_temp: number; max_temp: number; check_interval_min: number; active: boolean; position: number };
export type CorrectiveAction = "" | "ajuste_equipamento" | "transferencia_produtos" | "manutencao" | "descarte" | "outro";
export type TemperatureLog = {
  id: UUID; store_id: UUID; equipment_id: UUID; temperature: number; in_range: boolean; min_temp: number | null; max_temp: number | null; measured_at: string;
  measured_by_name: string; corrective_action: CorrectiveAction; notes: string; alert_id: UUID | null; temperature_equipment?: Pick<TemperatureEquipment, "id" | "name" | "kind"> | null;
};

export type ChecklistKind = "abertura" | "fechamento" | "limpeza" | "geladeira" | "freezer" | "cozinha" | "estoque" | "seguranca_alimentar" | "outro";
export type ChecklistFrequency = "diaria" | "semanal" | "mensal" | "por_turno" | "sob_demanda";
export type Checklist = {
  id: UUID; company_id: UUID; store_id: UUID | null; name: string; kind: ChecklistKind; description: string; frequency: ChecklistFrequency; scheduled_time: string | null;
  weekdays: number[]; month_day: number | null; assigned_role_id: UUID | null; assigned_to: UUID | null; mandatory: boolean; requires_evidence: boolean; active: boolean; position: number;
};
export type ChecklistTask = { id: UUID; checklist_id: UUID; text: string; description: string; critical: boolean; requires_photo: boolean; position: number; active: boolean };
export type ChecklistExecutionStatus = "pendente" | "em_andamento" | "concluido" | "atrasado" | "cancelado";
export type ChecklistExecution = {
  id: UUID; company_id: UUID; store_id: UUID; checklist_id: UUID; due_date: string; due_time: string | null; shift: string; status: ChecklistExecutionStatus;
  total_items: number; done_items: number; assigned_to: UUID | null; started_at: string | null; finished_by_name: string; finished_at: string | null; notes: string;
  checklists?: Pick<Checklist, "id" | "name" | "kind" | "mandatory"> | null;
};
export type ChecklistExecutionItem = {
  id: UUID; execution_id: UUID; task_id: UUID | null; text: string; critical: boolean; requires_photo: boolean; done: boolean; done_by_name: string; done_at: string | null;
  notes: string; photo_url: string; position: number;
};

export type TaskPriority = "baixa" | "media" | "alta" | "urgente";
export type TaskStatus = "pendente" | "em_andamento" | "concluida" | "atrasada" | "cancelada";
export type Task = {
  id: UUID; company_id: UUID; store_id: UUID; title: string; description: string; assigned_to: UUID | null; assigned_name: string; priority: TaskPriority; status: TaskStatus;
  due_at: string | null; started_at: string | null; completed_at: string | null; source_type: string | null; source_id: UUID | null; notes: string; created_by_name: string; created_at: string;
};

export type AlertKind = "vencido" | "vencendo" | "estoque_minimo" | "estoque_proximo_minimo" | "estoque_critico" | "temperatura" | "checklist_atrasado" | "producao_pendente" | "recebimento_problema" | "tarefa_atrasada" | "sincronizacao" | "outro";
export type AlertSeverity = "info" | "atencao" | "critico";
export type Alert = {
  id: UUID; company_id: UUID; store_id: UUID | null; kind: AlertKind; severity: AlertSeverity; title: string; message: string; entity_type: string | null; entity_id: UUID | null;
  dedupe_key: string | null; status: "aberto" | "lido" | "resolvido"; read_at: string | null; resolved_at: string | null; created_at: string; updated_at: string;
};

export type LabelKind = "producao" | "abertura" | "congelamento" | "descongelamento" | "fracionamento" | "armazenamento" | "recebimento" | "generica";
export type LabelField = { key: string; label?: string; x: number; y: number; w: number; h: number; font: number; bold?: boolean; align?: "left" | "center" | "right" };
export type LabelLayout = {
  fields: LabelField[];
  qr?: { x: number; y: number; size: number; enabled?: boolean };
  barcode?: { enabled: boolean; x: number; y: number; w: number; h: number };
  logo?: { enabled: boolean; x: number; y: number; w: number; h: number };
};
export type LabelTemplate = { id: UUID; company_id: UUID; name: string; kind: LabelKind; width_mm: number; height_mm: number; layout: LabelLayout; is_default: boolean; active: boolean; position: number };

export type AuditLog = {
  id: UUID; company_id: UUID | null; store_id: UUID | null; store_name?: string | null; user_id: UUID | null; user_name: string; action: string; entity: string; entity_id: UUID | null;
  entity_label: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; detail: string; created_at: string;
};

export type Setting = { id: UUID; company_id: UUID; store_id: UUID | null; key: string; value: unknown; updated_at: string };

export type DashboardData = {
  store_id: UUID; from: string; to: string; generated_at: string;
  cards: Record<string, number>;
  series: {
    losses_by_day: { day: string; value: number; quantity: number }[];
    losses_by_reason: { label: string; quantity: number; cost: number; occurrences: number }[];
    losses_by_product: { label: string; quantity: number; cost: number; occurrences: number }[];
    consumption_by_category: { label: string; unit: string; quantity: number; cost: number; movements: number }[];
    top_consumed: { label: string; unit: string; quantity: number; cost: number; movements: number }[];
    production_by_day: { day: string; productions: number; quantity: number; cost: number }[];
    stock_by_category: { label: string; id: UUID | null; products: number; value: number }[];
    expiring_products: { lot_id: UUID; product_name: string; lot_code: string; expires_at: string; days_to_expire: number; quantity: number; unit: string; expiry_status: ExpiryStatus; locations: string }[];
    replenishment: { product_id: UUID; product_name: string; unit: string; quantity: number; min_stock: number; max_stock: number; level: StockLevel; suggested_purchase: number }[];
  };
};

/* ------------------------------------------------------------------ */
/* Rótulos em português                                                */
/* ------------------------------------------------------------------ */
export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  materia_prima: "Matéria-prima", semipronto: "Semipronto", produzido: "Produzido", final: "Produto final", descartavel: "Descartável", outro: "Outro",
};
export const STORAGE_TYPE_LABEL: Record<StorageType, string> = { ambiente: "Ambiente", refrigerado: "Refrigerado", congelado: "Congelado" };
export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  estoque_seco: "Estoque seco", camara_fria: "Câmara fria", freezer: "Freezer", geladeira: "Geladeira", cozinha: "Cozinha", producao: "Produção", bar: "Bar/Balcão", outro: "Outro",
};
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  entrada: "Entrada", saida: "Saída", producao_consumo: "Consumo em produção", producao_entrada: "Produção", consumo: "Consumo", transferencia: "Transferência",
  perda: "Perda", ajuste: "Ajuste", devolucao: "Devolução", inventario: "Inventário", inicial: "Estoque inicial",
};
export const LOT_STATUS_LABEL: Record<LotStatus, string> = { ativo: "Ativo", esgotado: "Esgotado", bloqueado: "Bloqueado", vencido: "Vencido" };
export const LOT_ORIGIN_LABEL: Record<LotOrigin, string> = { recebimento: "Recebimento", producao: "Produção", ajuste: "Ajuste", transferencia: "Transferência", inicial: "Estoque inicial", devolucao: "Devolução" };
export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = { rascunho: "Rascunho", solicitado: "Solicitado", aprovado: "Aprovado", pedido: "Pedido ao fornecedor", recebido: "Recebido", cancelado: "Cancelado" };
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = { rascunho: "Em conferência", finalizado: "Finalizado", cancelado: "Cancelado" };
export const RECEIPT_RESULT_LABEL: Record<ReceiptResult, string> = { aprovado: "Aprovado", aprovado_ressalva: "Aprovado com ressalva", recusado: "Recusado" };
export const ITEM_RESULT_LABEL: Record<ReceiptItemResult, string> = { aprovado: "Aprovado", ressalva: "Com ressalva", recusado: "Recusado" };
export const REJECTION_LABEL: Record<RejectionReason, string> = {
  "": "—", embalagem_danificada: "Embalagem danificada", validade_inadequada: "Validade inadequada", temperatura_inadequada: "Temperatura inadequada",
  quantidade_incorreta: "Quantidade incorreta", produto_diferente: "Produto diferente", qualidade_inadequada: "Qualidade inadequada", outro: "Outro",
};
export const PACKAGE_LABEL: Record<PackageCondition, string> = { ok: "Íntegra", danificada: "Danificada", molhada: "Molhada", amassada: "Amassada", aberta: "Aberta", outro: "Outro" };
export const PRODUCTION_STATUS_LABEL: Record<ProductionStatus, string> = { planejada: "Planejada", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
export const COUNT_STATUS_LABEL: Record<InventoryCountStatus, string> = { aberta: "Em contagem", finalizada: "Finalizada", cancelada: "Cancelada" };
export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = { geladeira: "Geladeira", freezer: "Freezer", camara_fria: "Câmara fria", balcao_refrigerado: "Balcão refrigerado", estufa: "Estufa", outro: "Outro" };
export const CORRECTIVE_LABEL: Record<CorrectiveAction, string> = { "": "Nenhuma", ajuste_equipamento: "Ajuste do equipamento", transferencia_produtos: "Transferência dos produtos", manutencao: "Manutenção", descarte: "Descarte", outro: "Outro" };
export const CHECKLIST_KIND_LABEL: Record<ChecklistKind, string> = { abertura: "Abertura", fechamento: "Fechamento", limpeza: "Limpeza", geladeira: "Geladeira", freezer: "Freezer", cozinha: "Cozinha", estoque: "Estoque", seguranca_alimentar: "Segurança alimentar", outro: "Outro" };
export const FREQUENCY_LABEL: Record<ChecklistFrequency, string> = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal", por_turno: "Por turno", sob_demanda: "Sob demanda" };
export const EXEC_STATUS_LABEL: Record<ChecklistExecutionStatus, string> = { pendente: "Pendente", em_andamento: "Em andamento", concluido: "Concluído", atrasado: "Atrasado", cancelado: "Cancelado" };
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída", atrasada: "Atrasada", cancelada: "Cancelada" };
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  vencido: "Produto vencido", vencendo: "Produto vencendo", estoque_minimo: "Abaixo do mínimo", estoque_proximo_minimo: "Próximo do mínimo", estoque_critico: "Estoque crítico",
  temperatura: "Temperatura fora da faixa", checklist_atrasado: "Checklist atrasado", producao_pendente: "Produção pendente", recebimento_problema: "Recebimento com problema",
  tarefa_atrasada: "Tarefa atrasada", sincronizacao: "Sincronização", outro: "Outro",
};
export const LABEL_KIND_LABEL: Record<LabelKind, string> = {
  producao: "Produção", abertura: "Abertura", congelamento: "Congelamento", descongelamento: "Descongelamento", fracionamento: "Fracionamento", armazenamento: "Armazenamento", recebimento: "Recebimento", generica: "Genérica",
};
export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
