"use client";

/* ------------------------------------------------------------------ */
/* Módulo CONFIGURAÇÕES · empresa, unidades, parâmetros, motivos de    */
/* perda, integrações (chaves de API + outbox)                         */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import type { LossReason, Setting, StockLocation, TemperatureEquipment, UUID } from "@/lib/ops/types";

export { useCompanyStores } from "./usuarios";

/* ------------------------------------------------------------------ */
/* Parâmetros (tabela settings)                                        */
/* ------------------------------------------------------------------ */
export type CostMethod = "medio" | "ultimo";
export type PrinterKind = "navegador" | "zpl";
export type PrinterSetting = { tipo: PrinterKind; largura_mm: number; altura_mm: number };
export type ConsumptionBasis = "planejado" | "produzido";

/** Valores editáveis na tela de parâmetros (chave → valor jsonb). */
export type ParamsForm = {
  "estoque.metodo_custo": CostMethod;
  "estoque.permitir_negativo": boolean;
  "estoque.permitir_consumo_vencido": boolean;
  "validade.dias_alerta": number;
  "validade.dias_critico": number;
  "etiquetas.impressora": PrinterSetting;
  "temperaturas.intervalo_min": number;
  "inventario.nao_contado_zera": boolean;
  "producao.consumo_por": ConsumptionBasis;
  "alertas.email": boolean;
};
export type ParamKey = keyof ParamsForm;

export const PARAM_DEFAULTS: ParamsForm = {
  "estoque.metodo_custo": "medio",
  "estoque.permitir_negativo": false,
  "estoque.permitir_consumo_vencido": false,
  "validade.dias_alerta": 7,
  "validade.dias_critico": 1,
  "etiquetas.impressora": { tipo: "navegador", largura_mm: 60, altura_mm: 40 },
  "temperaturas.intervalo_min": 240,
  "inventario.nao_contado_zera": false,
  "producao.consumo_por": "planejado",
  "alertas.email": false,
};
export const PARAM_KEYS = Object.keys(PARAM_DEFAULTS) as ParamKey[];

/** Dados da empresa para etiquetas e documentos (settings 'empresa.dados'). */
export type CompanyData = { razao_social: string; cnpj: string; telefone: string; endereco: string };
export const COMPANY_DATA_EMPTY: CompanyData = { razao_social: "", cnpj: "", telefone: "", endereco: "" };

function asNumber(v: unknown, d: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : d;
}
function asBool(v: unknown, d: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return d;
}

/** Converte o valor jsonb bruto de uma chave para o tipo do formulário. */
export function coerceParam<K extends ParamKey>(key: K, raw: unknown): ParamsForm[K] {
  const d = PARAM_DEFAULTS[key];
  if (raw === null || raw === undefined) return d;
  switch (key) {
    case "estoque.metodo_custo":
      return (raw === "ultimo" ? "ultimo" : "medio") as ParamsForm[K];
    case "producao.consumo_por":
      return (raw === "produzido" ? "produzido" : "planejado") as ParamsForm[K];
    case "estoque.permitir_negativo":
    case "estoque.permitir_consumo_vencido":
    case "inventario.nao_contado_zera":
    case "alertas.email":
      return asBool(raw, d as boolean) as ParamsForm[K];
    case "validade.dias_alerta":
    case "validade.dias_critico":
    case "temperaturas.intervalo_min":
      return asNumber(raw, d as number) as ParamsForm[K];
    case "etiquetas.impressora": {
      const o = (typeof raw === "object" && raw ? raw : {}) as Partial<PrinterSetting>;
      const dp = d as PrinterSetting;
      return { tipo: o.tipo === "zpl" ? "zpl" : "navegador", largura_mm: asNumber(o.largura_mm, dp.largura_mm), altura_mm: asNumber(o.altura_mm, dp.altura_mm) } as ParamsForm[K];
    }
    default:
      return d;
  }
}

export function coerceCompanyData(raw: unknown): CompanyData {
  const o = (typeof raw === "object" && raw ? raw : {}) as Partial<CompanyData>;
  return { razao_social: o.razao_social ?? "", cnpj: o.cnpj ?? "", telefone: o.telefone ?? "", endereco: o.endereco ?? "" };
}
export function coerceLogoUrl(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { url?: unknown }).url === "string") return (raw as { url: string }).url;
  return "";
}

/** Linhas da tabela settings de um escopo (empresa: store null; unidade: store id). */
export function useSettingsRows(companyId: string | undefined, storeId: string | null) {
  return useQuery({
    queryKey: ["settings", "rows", companyId, storeId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = supabaseBrowser().from("settings").select("*").eq("company_id", companyId!);
      q = storeId ? q.eq("store_id", storeId) : q.is("store_id", null);
      return unwrap(await q) as Setting[];
    },
  });
}

export function settingsToMap(rows: Setting[] | undefined): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const r of rows ?? []) m[r.key] = r.value;
  return m;
}

/** Grava uma configuração (empresa ou unidade) via RPC. */
export async function setSetting(companyId: string, storeId: string | null, key: string, value: unknown): Promise<void> {
  await rpc("ops_set_setting", { p_company: companyId, p_store: storeId, p_key: key, p_value: value ?? null });
}
/** Remove o override de uma unidade (volta a valer o padrão da empresa). */
export async function deleteStoreSetting(companyId: string, storeId: string, key: string): Promise<void> {
  unwrap(await supabaseBrowser().from("settings").delete().eq("company_id", companyId).eq("store_id", storeId).eq("key", key));
}

/* ------------------------------------------------------------------ */
/* Unidades e locais                                                   */
/* ------------------------------------------------------------------ */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (America/Sao_Paulo)" },
  { value: "America/Manaus", label: "Manaus (America/Manaus)" },
  { value: "America/Cuiaba", label: "Cuiabá (America/Cuiaba)" },
  { value: "America/Campo_Grande", label: "Campo Grande (America/Campo_Grande)" },
  { value: "America/Belem", label: "Belém (America/Belem)" },
  { value: "America/Fortaleza", label: "Fortaleza (America/Fortaleza)" },
  { value: "America/Recife", label: "Recife (America/Recife)" },
  { value: "America/Bahia", label: "Salvador (America/Bahia)" },
  { value: "America/Rio_Branco", label: "Rio Branco (America/Rio_Branco)" },
  { value: "America/Noronha", label: "Fernando de Noronha (America/Noronha)" },
];

export type StoreInput = { name: string; code: string; address: string; phone: string; timezone: string; active: boolean };

/** Cria a unidade + 4 locais padrão (atômico, no banco). */
export async function createStore(companyId: string, s: StoreInput): Promise<string> {
  return rpc<string>("ops_store_create", { p_company: companyId, p_name: s.name.trim(), p_code: s.code.trim(), p_address: s.address.trim(), p_phone: s.phone.trim(), p_timezone: s.timezone });
}
export async function updateStore(id: string, s: Partial<StoreInput> & { position?: number }): Promise<void> {
  unwrap(await supabaseBrowser().from("stores").update(s).eq("id", id));
}

/** Locais de estoque de uma unidade (incluindo inativos), para a tela de configuração. */
export function useStoreLocationsAll(storeId: string | null | undefined) {
  return useQuery({
    queryKey: ["stock_locations", "all", storeId],
    enabled: Boolean(storeId),
    queryFn: async () => unwrap(await supabaseBrowser().from("stock_locations").select("*").eq("store_id", storeId!).order("position").order("name")) as StockLocation[],
  });
}
export function useStoreEquipmentAll(storeId: string | null | undefined) {
  return useQuery({
    queryKey: ["temperature_equipment", "all", storeId],
    enabled: Boolean(storeId),
    queryFn: async () => unwrap(await supabaseBrowser().from("temperature_equipment").select("*").eq("store_id", storeId!).order("position").order("name")) as TemperatureEquipment[],
  });
}

export const DEFAULT_LOCATIONS: Pick<StockLocation, "name" | "kind" | "storage_type" | "position">[] = [
  { name: "Estoque seco", kind: "estoque_seco", storage_type: "ambiente", position: 0 },
  { name: "Geladeira", kind: "geladeira", storage_type: "refrigerado", position: 1 },
  { name: "Freezer", kind: "freezer", storage_type: "congelado", position: 2 },
  { name: "Cozinha", kind: "cozinha", storage_type: "ambiente", position: 3 },
];
/** Cria os 4 locais padrão em uma unidade que ainda não tem nenhum. */
export async function seedDefaultLocations(storeId: string): Promise<void> {
  unwrap(await supabaseBrowser().from("stock_locations").insert(DEFAULT_LOCATIONS.map((l) => ({ ...l, store_id: storeId }))));
}

/* ------------------------------------------------------------------ */
/* Motivos de perda                                                    */
/* ------------------------------------------------------------------ */
export function useLossReasonsAll() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["loss_reasons", "all", company?.id],
    enabled: Boolean(company?.id),
    queryFn: async () => unwrap(await supabaseBrowser().from("loss_reasons").select("*").eq("company_id", company!.id).order("position").order("name")) as LossReason[],
  });
}

/* ------------------------------------------------------------------ */
/* Integrações                                                         */
/* ------------------------------------------------------------------ */
export type ApiKey = { id: UUID; company_id: UUID; name: string; key_hash: string; scopes: string[]; active: boolean; last_used_at: string | null; created_by: UUID | null; created_at: string };
export type IntegrationEventStatus = "pendente" | "processado" | "erro" | "ignorado";
export type IntegrationEvent = {
  id: UUID; company_id: UUID; store_id: UUID | null; direction: "in" | "out"; provider: string; kind: string; payload: unknown; status: IntegrationEventStatus;
  attempts: number; last_error: string; processed_at: string | null; created_at: string;
};
export const EVENT_STATUS_LABEL: Record<IntegrationEventStatus, string> = { pendente: "Pendente", processado: "Processado", erro: "Erro", ignorado: "Ignorado" };

export const API_SCOPES: { value: string; label: string; hint: string }[] = [
  { value: "estoque.ler", label: "Ler estoque", hint: "Saldos por produto e por lote" },
  { value: "produtos.ler", label: "Ler produtos", hint: "Catálogo de produtos" },
  { value: "estoque.movimentar", label: "Movimentar estoque", hint: "Baixas de venda (PDV, iFood) e devoluções" },
  { value: "eventos.enviar", label: "Enviar eventos", hint: "Gravar eventos externos na fila" },
  { value: "eventos.ler", label: "Ler eventos", hint: "Consumir a fila de saída (outbox)" },
  { value: "*", label: "Tudo", hint: "Todos os escopos (use com cuidado)" },
];

export type IntegrationRoute = { method: "GET" | "POST"; path: string; scope: string; title: string; description: string; example: string };
export const INTEGRATION_ROUTES: IntegrationRoute[] = [
  {
    method: "GET", path: "/api/ops/integrations/estoque", scope: "estoque.ler", title: "Saldo de estoque",
    description: "Saldo consolidado por produto da unidade (?store=<id>). Com &lotes=1 devolve saldo por lote e local. Paginação: &page=0&size=200.",
    example: `curl -H "Authorization: Bearer vr_SUA_CHAVE" "{origin}/api/ops/integrations/estoque?store=<id-da-unidade>"`,
  },
  {
    method: "GET", path: "/api/ops/integrations/produtos", scope: "produtos.ler", title: "Catálogo de produtos",
    description: "Produtos da empresa com códigos, unidade e custo. Filtro incremental: &atualizado_desde=<data ISO>.",
    example: `curl -H "Authorization: Bearer vr_SUA_CHAVE" "{origin}/api/ops/integrations/produtos?page=0&size=200"`,
  },
  {
    method: "POST", path: "/api/ops/integrations/movimentos", scope: "estoque.movimentar", title: "Baixa ou entrada de estoque",
    description: "Consumo (venda no PDV/iFood) ou entrada (devolução) por produto, código de barras ou código interno. Idempotente por external_id.",
    example: `curl -X POST -H "Authorization: Bearer vr_SUA_CHAVE" -H "Content-Type: application/json" "{origin}/api/ops/integrations/movimentos" -d '{"store_id":"<id>","provider":"pdv","external_id":"venda-123","items":[{"barcode":"7891000000000","quantity":2,"type":"consumo"}]}'`,
  },
  {
    method: "POST", path: "/api/ops/integrations/eventos", scope: "eventos.enviar", title: "Enviar evento externo",
    description: "Grava um evento (pedido, venda, leitura de balança…) na fila integration_events para processamento.",
    example: `curl -X POST -H "Authorization: Bearer vr_SUA_CHAVE" -H "Content-Type: application/json" "{origin}/api/ops/integrations/eventos" -d '{"provider":"ifood","kind":"order.received","payload":{}}'`,
  },
  {
    method: "GET", path: "/api/ops/integrations/eventos", scope: "eventos.ler", title: "Ler fila de saída",
    description: "Eventos pendentes gerados pelo sistema (outbox) para o sistema externo consumir, ex.: enviar estoque ao ERP.",
    example: `curl -H "Authorization: Bearer vr_SUA_CHAVE" "{origin}/api/ops/integrations/eventos"`,
  },
];

export function useApiKeys() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["api_keys", company?.id],
    enabled: Boolean(company?.id),
    queryFn: async () => unwrap(await supabaseBrowser().from("api_keys").select("*").eq("company_id", company!.id).order("active", { ascending: false }).order("created_at", { ascending: false })) as ApiKey[],
  });
}

export function useIntegrationEvents(range: { from: number; to: number }, page: number) {
  const { company } = useSession();
  return useQuery({
    queryKey: ["integration_events", company?.id, page],
    enabled: Boolean(company?.id),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await supabaseBrowser().from("integration_events").select("*", { count: "exact" }).eq("company_id", company!.id).order("created_at", { ascending: false }).range(range.from, range.to);
      if (res.error) throw res.error;
      return { rows: (res.data ?? []) as IntegrationEvent[], total: res.count ?? 0 };
    },
  });
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Gera uma chave forte no navegador (prefixo vr_ + 32 bytes aleatórios) e o hash que vai para o banco. */
export async function generateApiKey(): Promise<{ key: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = `vr_${base64url(bytes)}`;
  return { key, hash: await sha256Hex(key) };
}
