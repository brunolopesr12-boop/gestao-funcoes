"use client";

/* ------------------------------------------------------------------ */
/* Módulo ETIQUETAS · tipos, catálogo de campos, dados, ZPL e consultas */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { fmtDate, fmtQty, todayISO } from "@/lib/ops/format";
import { STORAGE_TYPE_LABEL, type LabelField, type LabelKind, type LabelLayout, type LabelTemplate, type StockLot, type StorageType, type UUID } from "@/lib/ops/types";
import { code128Modules } from "./labels-code128";

/* ------------------------------------------------------------------ */
/* Dados de uma etiqueta (tudo string; '' quando não há)                */
/* ------------------------------------------------------------------ */
export type LabelData = {
  company_name: string;
  product_name: string;
  internal_code: string;
  lot_code: string;
  /** texto com unidade, ex.: "2,5 kg" */
  quantity: string;
  produced_at: string;
  opened_at: string;
  frozen_at: string;
  thawed_at: string;
  received_at: string;
  expires_at: string;
  responsible: string;
  location: string;
  /** Ambiente / Refrigerado / Congelado */
  storage: string;
  supplier: string;
  qr_value: string;
  barcode_value: string;
  logo_url: string;
};
export type LabelDataKey = keyof LabelData;
/** Chaves que podem virar campo de texto no layout. */
export type LabelFieldKey = Exclude<LabelDataKey, "qr_value" | "barcode_value" | "logo_url">;

export const EMPTY_LABEL_DATA: LabelData = {
  company_name: "", product_name: "", internal_code: "", lot_code: "", quantity: "", produced_at: "", opened_at: "", frozen_at: "", thawed_at: "",
  received_at: "", expires_at: "", responsible: "", location: "", storage: "", supplier: "", qr_value: "", barcode_value: "", logo_url: "",
};

/** Catálogo de campos para o editor (ordem de exibição). */
export const FIELD_CATALOG: { key: LabelFieldKey; label: string; defaultLabel: string; hint?: string }[] = [
  { key: "product_name", label: "Nome do produto", defaultLabel: "" },
  { key: "produced_at", label: "Data de produção", defaultLabel: "Produção" },
  { key: "opened_at", label: "Data de abertura", defaultLabel: "Abertura" },
  { key: "frozen_at", label: "Data de congelamento", defaultLabel: "Congelado" },
  { key: "thawed_at", label: "Data de descongelamento", defaultLabel: "Descongel." },
  { key: "received_at", label: "Data de recebimento", defaultLabel: "Recebido" },
  { key: "expires_at", label: "Validade", defaultLabel: "Validade" },
  { key: "lot_code", label: "Lote", defaultLabel: "Lote" },
  { key: "quantity", label: "Quantidade", defaultLabel: "Qtd" },
  { key: "responsible", label: "Responsável", defaultLabel: "Resp." },
  { key: "location", label: "Local", defaultLabel: "Local" },
  { key: "internal_code", label: "Código interno", defaultLabel: "Cód." },
  { key: "storage", label: "Armazenamento", defaultLabel: "Armaz." },
  { key: "supplier", label: "Fornecedor", defaultLabel: "Forn." },
  { key: "company_name", label: "Empresa", defaultLabel: "" },
];
export const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELD_CATALOG.map((f) => [f.key, f.label]));

export const LABEL_KINDS: LabelKind[] = ["producao", "abertura", "congelamento", "descongelamento", "fracionamento", "armazenamento", "recebimento", "generica"];
export function isLabelKind(v: string | null | undefined): v is LabelKind {
  return Boolean(v) && (LABEL_KINDS as string[]).includes(v as string);
}

/** Campo de data que cada tipo de etiqueta costuma destacar. */
export const KIND_DATE_FIELD: Record<LabelKind, LabelFieldKey> = {
  producao: "produced_at", abertura: "opened_at", congelamento: "frozen_at", descongelamento: "thawed_at", fracionamento: "produced_at",
  armazenamento: "received_at", recebimento: "received_at", generica: "produced_at",
};

/* ------------------------------------------------------------------ */
/* Texto do campo e datas                                               */
/* ------------------------------------------------------------------ */
/** dd/mm/aaaa ou '' (nunca "—" na etiqueta). */
export function labelDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = fmtDate(iso);
  return s === "—" ? "" : s;
}

/** Texto final de um campo: "Rótulo: valor" quando o campo tem rótulo e valor. */
export function fieldText(field: LabelField, data: LabelData): string {
  const value = (data as Record<string, string>)[field.key] ?? "";
  const label = (field.label ?? "").trim();
  if (!value) return label ? `${label}: ` : "";
  return label ? `${label}: ${value}` : value;
}

/** Linhas que cabem no campo (altura em mm ÷ altura da linha ≈ fonte × 0,3528 mm × 1,1). */
export function fieldLines(field: LabelField): number {
  const lineMm = Math.max(1, field.font) * 0.3528 * 1.1;
  return Math.max(1, Math.floor((field.h + 0.2) / lineMm));
}

/* ------------------------------------------------------------------ */
/* Resumo do lote (retorno de ops_lot_summary) — só o que a etiqueta usa */
/* ------------------------------------------------------------------ */
export type LabelLotSummary = {
  lot: StockLot;
  product: { id: UUID; name: string; internal_code: string; photo_url: string; unit: string; unit_name: string; storage_type: StorageType; category: string | null; cost: number };
  store: { id: UUID; name: string } | null;
  supplier: { id: UUID; name: string } | null;
  balance: number;
  balances: { location_id: UUID; location: string; quantity: number }[];
  days_to_expire: number | null;
};

/** Conteúdo padrão do QR de um lote: URL da ficha (/l/<id>), a mesma que o leitor /qr entende. */
export function lotQrUrl(lotId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/l/${lotId}`;
}

export type BuildOpts = {
  company: { name: string } | null | undefined;
  responsible: string;
  location?: string;
  /** texto pronto com unidade; se ausente usa o saldo (ou a quantidade inicial) do lote */
  quantity?: string;
  logoUrl?: string;
  /** valor do código de barras; padrão = código do lote */
  barcode?: string;
};

/** Monta os dados da etiqueta a partir do resumo do lote. */
export function buildLabelData(s: LabelLotSummary, opts: BuildOpts): LabelData {
  const qty = Number(s.balance) > 0 ? Number(s.balance) : Number(s.lot.initial_quantity);
  const firstLocation = s.balances?.[0]?.location ?? "";
  return {
    company_name: opts.company?.name ?? "",
    product_name: s.product.name,
    internal_code: s.product.internal_code ?? "",
    lot_code: s.lot.lot_code ?? "",
    quantity: opts.quantity ?? (qty > 0 ? fmtQty(qty, s.product.unit) : ""),
    produced_at: labelDate(s.lot.produced_at),
    opened_at: labelDate(s.lot.opened_at),
    frozen_at: labelDate(s.lot.frozen_at),
    thawed_at: labelDate(s.lot.thawed_at),
    received_at: labelDate(s.lot.received_at),
    expires_at: labelDate(s.lot.expires_at),
    responsible: opts.responsible ?? "",
    location: opts.location || firstLocation,
    storage: STORAGE_TYPE_LABEL[s.product.storage_type] ?? "",
    supplier: s.supplier?.name ?? "",
    qr_value: lotQrUrl(s.lot.id),
    barcode_value: opts.barcode ?? (s.lot.lot_code ?? ""),
    logo_url: opts.logoUrl ?? "",
  };
}

/** Campos manuais da etiqueta avulsa (sem lote). Datas em yyyy-mm-dd. */
export type AdHocLabelInput = {
  product_name: string;
  internal_code: string;
  lot_code: string;
  quantity: number | null;
  unit: string;
  produced_at: string;
  opened_at: string;
  frozen_at: string;
  thawed_at: string;
  received_at: string;
  expires_at: string;
  responsible: string;
  location: string;
  storage: StorageType | "";
  supplier: string;
};

export function emptyAdHoc(responsible = ""): AdHocLabelInput {
  return {
    product_name: "", internal_code: "", lot_code: "", quantity: null, unit: "", produced_at: todayISO(), opened_at: "", frozen_at: "", thawed_at: "",
    received_at: "", expires_at: "", responsible, location: "", storage: "", supplier: "",
  };
}

export function buildAdHocLabelData(f: AdHocLabelInput, opts: { company: { name: string } | null | undefined; logoUrl?: string }): LabelData {
  return {
    company_name: opts.company?.name ?? "",
    product_name: f.product_name.trim(),
    internal_code: f.internal_code.trim(),
    lot_code: f.lot_code.trim(),
    quantity: f.quantity !== null && f.quantity !== undefined ? fmtQty(f.quantity, f.unit.trim() || null) : "",
    produced_at: labelDate(f.produced_at),
    opened_at: labelDate(f.opened_at),
    frozen_at: labelDate(f.frozen_at),
    thawed_at: labelDate(f.thawed_at),
    received_at: labelDate(f.received_at),
    expires_at: labelDate(f.expires_at),
    responsible: f.responsible.trim(),
    location: f.location.trim(),
    storage: f.storage ? STORAGE_TYPE_LABEL[f.storage] : "",
    supplier: f.supplier.trim(),
    qr_value: "",
    barcode_value: f.lot_code.trim() || f.internal_code.trim(),
    logo_url: opts.logoUrl ?? "",
  };
}

/** Dados de exemplo para o editor de modelos (produto fictício só para visualização). */
export function sampleLabelData(company: { name: string } | null | undefined, logoUrl = ""): LabelData {
  return {
    company_name: company?.name ?? "Minha empresa",
    product_name: "Recheio de frango",
    internal_code: "REC-001",
    lot_code: "L260926-001",
    quantity: "2,5 kg",
    produced_at: labelDate(todayISO()),
    opened_at: labelDate(todayISO()),
    frozen_at: labelDate(todayISO()),
    thawed_at: labelDate(todayISO()),
    received_at: labelDate(todayISO()),
    expires_at: labelDate(todayISO(3)),
    responsible: "Maria",
    location: "Geladeira",
    storage: "Refrigerado",
    supplier: "Fornecedor exemplo",
    qr_value: lotQrUrl("00000000-0000-4000-8000-000000000000"),
    barcode_value: "L260926-001",
    logo_url: logoUrl,
  };
}

/* ------------------------------------------------------------------ */
/* Layouts de fábrica (iguais à migration 0008)                         */
/* ------------------------------------------------------------------ */
function baseFactoryLayout(): LabelLayout {
  return {
    fields: [
      { key: "company_name", x: 2, y: 1.5, w: 36, h: 4, font: 7, bold: true },
      { key: "product_name", x: 2, y: 6, w: 40, h: 9, font: 11, bold: true },
      { key: "produced_at", label: "Produção", x: 2, y: 16, w: 20, h: 4, font: 7 },
      { key: "expires_at", label: "Validade", x: 22, y: 16, w: 20, h: 4, font: 7, bold: true },
      { key: "lot_code", label: "Lote", x: 2, y: 21, w: 20, h: 4, font: 7 },
      { key: "quantity", label: "Qtd", x: 22, y: 21, w: 20, h: 4, font: 7 },
      { key: "responsible", label: "Resp.", x: 2, y: 26, w: 40, h: 4, font: 7 },
      { key: "location", label: "Local", x: 2, y: 31, w: 40, h: 4, font: 7 },
    ],
    qr: { x: 43, y: 20, size: 16 },
    barcode: { enabled: false, x: 2, y: 35, w: 40, h: 4 },
    logo: { enabled: true, x: 43, y: 2, w: 15, h: 15 },
  };
}

/** Layout de fábrica de um tipo (60×40; o tipo "generica" usa o modelo pequeno 50×30). */
export function factoryLayout(kind: LabelKind): { width_mm: number; height_mm: number; layout: LabelLayout } {
  if (kind === "generica") {
    return {
      width_mm: 50, height_mm: 30,
      layout: {
        fields: [
          { key: "product_name", x: 1.5, y: 1.5, w: 32, h: 8, font: 9, bold: true },
          { key: "expires_at", label: "Val.", x: 1.5, y: 11, w: 32, h: 4, font: 7, bold: true },
          { key: "lot_code", label: "Lote", x: 1.5, y: 16, w: 32, h: 4, font: 6 },
          { key: "responsible", label: "Resp.", x: 1.5, y: 21, w: 32, h: 4, font: 6 },
        ],
        qr: { x: 35, y: 8, size: 13 },
        barcode: { enabled: false, x: 1.5, y: 25, w: 32, h: 4 },
        logo: { enabled: false, x: 35, y: 1, w: 13, h: 6 },
      },
    };
  }
  const layout = baseFactoryLayout();
  const third: Record<string, LabelField | undefined> = {
    abertura: { key: "opened_at", label: "Abertura", x: 2, y: 16, w: 20, h: 4, font: 7 },
    congelamento: { key: "frozen_at", label: "Congelado", x: 2, y: 16, w: 20, h: 4, font: 7 },
    descongelamento: { key: "thawed_at", label: "Descongel.", x: 2, y: 16, w: 20, h: 4, font: 7 },
    armazenamento: { key: "received_at", label: "Recebido", x: 2, y: 16, w: 20, h: 4, font: 7 },
    recebimento: { key: "received_at", label: "Recebido", x: 2, y: 16, w: 20, h: 4, font: 7 },
  };
  const repl = third[kind];
  if (repl) layout.fields[2] = repl;
  return { width_mm: 60, height_mm: 40, layout };
}

/** Modelo em branco (sem campos) no tamanho informado. */
export function blankLayout(): LabelLayout {
  return { fields: [], qr: { x: 42, y: 22, size: 16, enabled: false }, barcode: { enabled: false, x: 2, y: 34, w: 40, h: 5 }, logo: { enabled: false, x: 43, y: 2, w: 15, h: 12 } };
}

/** Garante a forma do layout vindo do banco (jsonb pode estar vazio ou parcial). */
export function normalizeLayout(raw: unknown): LabelLayout {
  const l = (raw && typeof raw === "object" ? raw : {}) as Partial<LabelLayout>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const fields = Array.isArray(l.fields)
    ? l.fields
        .filter((f): f is LabelField => Boolean(f) && typeof f === "object" && typeof (f as LabelField).key === "string")
        .map((f): LabelField => ({
          key: f.key, label: typeof f.label === "string" ? f.label : undefined, x: num(f.x, 0), y: num(f.y, 0), w: num(f.w, 20), h: num(f.h, 4), font: num(f.font, 7),
          bold: Boolean(f.bold), align: f.align === "center" || f.align === "right" ? f.align : "left",
        }))
    : [];
  const qr = l.qr && typeof l.qr === "object" ? { x: num(l.qr.x, 40), y: num(l.qr.y, 20), size: num(l.qr.size, 15), enabled: l.qr.enabled !== false } : { x: 40, y: 20, size: 15, enabled: false };
  const bc = l.barcode && typeof l.barcode === "object" ? { enabled: Boolean(l.barcode.enabled), x: num(l.barcode.x, 2), y: num(l.barcode.y, 30), w: num(l.barcode.w, 40), h: num(l.barcode.h, 5) } : { enabled: false, x: 2, y: 30, w: 40, h: 5 };
  const logo = l.logo && typeof l.logo === "object" ? { enabled: Boolean(l.logo.enabled), x: num(l.logo.x, 43), y: num(l.logo.y, 2), w: num(l.logo.w, 15), h: num(l.logo.h, 12) } : { enabled: false, x: 43, y: 2, w: 15, h: 12 };
  return { fields, qr, barcode: bc, logo };
}

/** Modelo ainda não salvo (novo) ou vindo do banco, com layout normalizado. */
export function normalizeTemplate(t: LabelTemplate): LabelTemplate {
  return { ...t, width_mm: Number(t.width_mm), height_mm: Number(t.height_mm), layout: normalizeLayout(t.layout) };
}

/* ------------------------------------------------------------------ */
/* Escolha do modelo                                                    */
/* ------------------------------------------------------------------ */
/** Modelo padrão do tipo → outro ativo do tipo → padrão de qualquer tipo → primeiro ativo. */
export function pickTemplate(templates: LabelTemplate[], kind: LabelKind, preferredId?: string | null): LabelTemplate | null {
  const active = templates.filter((t) => t.active);
  if (preferredId) {
    const p = templates.find((t) => t.id === preferredId);
    if (p) return p;
  }
  return active.find((t) => t.kind === kind && t.is_default) ?? active.find((t) => t.kind === kind) ?? active.find((t) => t.is_default) ?? active[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* ZPL (Zebra Programming Language)                                      */
/*                                                                      */
/* PREMISSAS                                                            */
/*  · Impressora de 203 dpi → 8 pontos por mm (^PW/^LL/^FO em pontos).  */
/*    Em impressoras de 300 dpi (12 dpmm) a etiqueta sairá menor: ajuste */
/*    ZPL_DPMM ou reescale no driver.                                    */
/*  · Fonte ^A0 (escalável) com altura em pontos ≈ tamanho_pt × 2,8      */
/*    (1 pt = 1/72 pol = 203/72 ≈ 2,82 pontos).                          */
/*  · Texto em UTF-8 (^CI28) — firmwares antigos podem trocar acentos.   */
/*  · QR: ^BQN,2,<ampliação>; a ampliação é calculada para o QR ocupar    */
/*    o tamanho em mm definido no layout.                                */
/*  · Código de barras: Code 128 nativo da impressora (^BCN).            */
/*  · Logo não é enviado no ZPL (exige ^GF gráfico): só na impressão     */
/*    pelo navegador.                                                    */
/* ------------------------------------------------------------------ */
export const ZPL_DPMM = 8;

const dots = (mm: number) => Math.max(0, Math.round(mm * ZPL_DPMM));
const fontDots = (pt: number) => Math.max(8, Math.round(pt * 2.8));

/** Remove caracteres de comando do ZPL (^ e ~) e controles. */
export function zplText(s: string): string {
  return s.replace(/[\^~]/g, " ").replace(/[\u0000-\u001f]/g, " ").trim();
}

function qrModules(value: string): number {
  try {
    return QRCode.create(value, { errorCorrectionLevel: "L" }).modules.size;
  } catch {
    return 33;
  }
}

/** Gera o ZPL de uma etiqueta (repetida `copies` vezes via ^PQ). */
export function toZpl(template: Pick<LabelTemplate, "width_mm" | "height_mm" | "layout" | "name">, data: LabelData, copies = 1): string {
  const layout = normalizeLayout(template.layout);
  const w = Number(template.width_mm), h = Number(template.height_mm);
  const out: string[] = [];
  out.push("^XA");
  out.push(`^FX Modelo: ${zplText(template.name ?? "")} · ${w}x${h} mm · 203 dpi (8 pontos/mm)^FS`);
  out.push("^CI28");
  out.push(`^PW${dots(w)}`);
  out.push(`^LL${dots(h)}`);
  out.push("^LH0,0");
  for (const f of layout.fields) {
    const text = zplText(fieldText(f, data));
    if (!text) continue;
    const fd = fontDots(f.font);
    const just = f.align === "center" ? "C" : f.align === "right" ? "R" : "L";
    out.push(`^FO${dots(f.x)},${dots(f.y)}^A0N,${fd},${fd}^FB${dots(f.w)},${fieldLines(f)},0,${just},0^FD${text}^FS`);
  }
  if (layout.qr && layout.qr.enabled !== false && data.qr_value) {
    const modules = qrModules(data.qr_value);
    const mag = Math.max(1, Math.min(10, Math.floor(dots(layout.qr.size) / modules)));
    out.push(`^FO${dots(layout.qr.x)},${dots(layout.qr.y)}^BQN,2,${mag}^FDLA,${zplText(data.qr_value)}^FS`);
  }
  if (layout.barcode?.enabled && data.barcode_value) {
    const modules = code128Modules(data.barcode_value);
    const moduleWidth = Math.max(1, Math.min(4, Math.floor(dots(layout.barcode.w) / modules)));
    const height = Math.max(8, dots(layout.barcode.h));
    out.push(`^FO${dots(layout.barcode.x)},${dots(layout.barcode.y)}^BY${moduleWidth},3,${height}^BCN,${height},N,N,N^FD${zplText(data.barcode_value)}^FS`);
  }
  if (layout.logo?.enabled && data.logo_url) out.push("^FX Logo da empresa não incluído no ZPL (só na impressão pelo navegador)^FS");
  out.push(`^PQ${Math.max(1, Math.round(copies))}`);
  out.push("^XZ");
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Consultas                                                            */
/* ------------------------------------------------------------------ */
export function useLabelTemplates(opts: { onlyActive?: boolean } = {}) {
  const { company } = useSession();
  return useQuery({
    queryKey: ["label_templates", company?.id, opts.onlyActive ?? false],
    enabled: Boolean(company?.id),
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabaseBrowser().from("label_templates").select("*").eq("company_id", company!.id).order("position").order("name");
      if (opts.onlyActive) q = q.eq("active", true);
      return (unwrap(await q) as LabelTemplate[]).map(normalizeTemplate);
    },
  });
}

export function useLabelTemplate(id: string | null | undefined) {
  return useQuery({
    queryKey: ["label_templates", "one", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const row = unwrap(await supabaseBrowser().from("label_templates").select("*").eq("id", id!).maybeSingle()) as LabelTemplate | null;
      return row ? normalizeTemplate(row) : null;
    },
  });
}

/** Logo da empresa: settings key 'empresa.logo_url' (escopo da empresa). Aceita "url" ou {"url": "..."}. */
export function useCompanyLogo() {
  const { company } = useSession();
  return useQuery({
    queryKey: ["settings", company?.id, "empresa.logo_url"],
    enabled: Boolean(company?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const row = unwrap(
        await supabaseBrowser().from("settings").select("value").eq("company_id", company!.id).is("store_id", null).eq("key", "empresa.logo_url").maybeSingle(),
      ) as { value: unknown } | null;
      const v = row?.value;
      if (typeof v === "string") return v;
      if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") return (v as { url: string }).url;
      return "";
    },
  });
}

/** Resumos de vários lotes (ops_lot_summary). null quando o lote não existe/sem acesso. */
export function useLotSummaries(lotIds: string[]) {
  const key = lotIds.join(",");
  return useQuery({
    queryKey: ["stock_lots", "label_summaries", key],
    enabled: lotIds.length > 0,
    queryFn: async () => {
      const rows = await Promise.all(lotIds.map((id) => rpc<LabelLotSummary | null>("ops_lot_summary", { p_lot: id })));
      return rows;
    },
  });
}

export type RecentLotRow = StockLot & { products: { id: UUID; name: string; internal_code: string; units: { code: string } | null } | null };

/** Últimos lotes criados na unidade (para o hub de etiquetas). */
export function useRecentLots(storeId: string | undefined, limit = 20) {
  return useQuery({
    queryKey: ["stock_lots", "recent", storeId, limit],
    enabled: Boolean(storeId),
    queryFn: async () =>
      unwrap(
        await supabaseBrowser()
          .from("stock_lots")
          .select("*, products(id, name, internal_code, units:stock_unit_id(code))")
          .eq("store_id", storeId!)
          .order("created_at", { ascending: false })
          .limit(limit),
      ) as RecentLotRow[],
  });
}

/** Etiqueta emitida (histórico) com os relacionamentos usados na lista. */
export type LabelRow = {
  id: UUID; company_id: UUID; store_id: UUID; template_id: UUID | null; product_id: UUID | null; lot_id: UUID | null; kind: LabelKind; copies: number;
  payload: Partial<LabelData>; printed_by: UUID | null; printed_by_name: string; printed_at: string;
  products?: { id: UUID; name: string; internal_code: string } | null;
  stock_lots?: { id: UUID; lot_code: string; expires_at: string | null } | null;
  label_templates?: { id: UUID; name: string } | null;
};

export function useLabelRecord(id: string | null | undefined) {
  return useQuery({
    queryKey: ["labels", "one", id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabaseBrowser().from("labels").select("*, products(id, name, internal_code), stock_lots(id, lot_code, expires_at), label_templates(id, name)").eq("id", id!).maybeSingle()) as LabelRow | null,
  });
}

/* ------------------------------------------------------------------ */
/* Ações                                                                */
/* ------------------------------------------------------------------ */
export type PrintJob = {
  /** chave estável (id do lote ou 'avulsa') */
  key: string;
  lotId: string | null;
  productId: string | null;
  data: LabelData;
  copies: number;
};

/** Registra as etiquetas emitidas (uma linha por lote/etiqueta) via RPC. */
export async function registerLabels(storeId: string, templateId: string | null, kind: LabelKind, jobs: PrintJob[]): Promise<string[]> {
  const ids: string[] = [];
  for (const j of jobs) {
    const id = await rpc<string>("ops_label_print", {
      p_store: storeId, p_template: templateId, p_product: j.productId, p_lot: j.lotId, p_kind: kind, p_copies: Math.max(1, Math.round(j.copies)), p_payload: j.data,
    });
    ids.push(id);
  }
  return ids;
}

export function totalCopies(jobs: PrintJob[]): number {
  return jobs.reduce((a, j) => a + Math.max(0, Math.round(j.copies || 0)), 0);
}

export function isUuid(t: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.trim());
}

/** Tipo de etiqueta sugerido pela origem do lote. */
export function kindFromOrigin(origin: string | null | undefined): LabelKind {
  if (origin === "producao") return "producao";
  if (origin === "recebimento") return "recebimento";
  return "armazenamento";
}
