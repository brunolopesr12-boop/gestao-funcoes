"use client";

import { QrSvg } from "@/components/ops/QrCode";
import { FIELD_LABEL, fieldLines, fieldText, normalizeLayout, type LabelData } from "@/lib/ops/modules/labels";
import type { LabelTemplate } from "@/lib/ops/types";
import { Barcode128 } from "./Barcode";

/** 1 mm em pixels CSS (96 dpi) — usado só para o QR, que recebe tamanho em px. */
export const MM_PX = 96 / 25.4;

export type CanvasTemplate = Pick<LabelTemplate, "width_mm" | "height_mm" | "layout">;
/** chave de um elemento do layout: chave do campo, "qr", "barcode" ou "logo" */
export type LabelElementKey = string;

type CanvasProps = {
  template: CanvasTemplate;
  data: LabelData;
  /** modo editor: contornos, nomes dos campos vazios e clique para selecionar */
  guides?: boolean;
  selected?: LabelElementKey | null;
  onSelect?: (key: LabelElementKey) => void;
};

/**
 * Desenha a etiqueta em tamanho real (mm) a partir do layout jsonb.
 * É o mesmo componente usado na pré-visualização e na área de impressão.
 */
export function LabelCanvas({ template, data, guides, selected, onSelect }: CanvasProps) {
  const layout = normalizeLayout(template.layout);
  const w = Number(template.width_mm), h = Number(template.height_mm);
  const box = (key: LabelElementKey): React.CSSProperties =>
    guides
      ? { outline: selected === key ? "0.5mm solid #f97316" : "0.15mm dashed rgba(0,0,0,.3)", outlineOffset: "-0.15mm", cursor: onSelect ? "pointer" : undefined }
      : {};
  const click = (key: LabelElementKey) => (onSelect ? (e: React.MouseEvent) => { e.stopPropagation(); onSelect(key); } : undefined);

  return (
    <div className="label-sheet" style={{ width: `${w}mm`, height: `${h}mm` }}>
      {layout.fields.map((f, i) => {
        const text = fieldText(f, data);
        const lines = fieldLines(f);
        return (
          <div
            key={`${f.key}-${i}`}
            className="label-field"
            onClick={click(f.key)}
            title={guides ? FIELD_LABEL[f.key] ?? f.key : undefined}
            style={{
              left: `${f.x}mm`, top: `${f.y}mm`, width: `${f.w}mm`, height: `${f.h}mm`, fontSize: `${f.font}pt`, fontWeight: f.bold ? 700 : 400,
              textAlign: f.align ?? "left", whiteSpace: lines > 1 ? "normal" : "nowrap", wordBreak: "break-word", lineHeight: 1.1, ...box(f.key),
            }}
          >
            {text || (guides ? <span style={{ opacity: 0.35 }}>{FIELD_LABEL[f.key] ?? f.key}</span> : null)}
          </div>
        );
      })}

      {layout.qr && layout.qr.enabled !== false && (
        <div onClick={click("qr")} title={guides ? "QR Code" : undefined} style={{ position: "absolute", left: `${layout.qr.x}mm`, top: `${layout.qr.y}mm`, width: `${layout.qr.size}mm`, height: `${layout.qr.size}mm`, lineHeight: 0, ...box("qr") }}>
          {data.qr_value ? (
            <QrSvg value={data.qr_value} size={layout.qr.size * MM_PX} />
          ) : guides ? (
            <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", fontSize: "6pt", opacity: 0.4, lineHeight: 1 }}>QR</span>
          ) : null}
        </div>
      )}

      {layout.barcode?.enabled && (
        <div onClick={click("barcode")} title={guides ? "Código de barras" : undefined} style={{ position: "absolute", left: `${layout.barcode.x}mm`, top: `${layout.barcode.y}mm`, width: `${layout.barcode.w}mm`, height: `${layout.barcode.h}mm`, ...box("barcode") }}>
          {data.barcode_value ? (
            <Barcode128 value={data.barcode_value} widthMm={layout.barcode.w} heightMm={layout.barcode.h} />
          ) : guides ? (
            <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", fontSize: "6pt", opacity: 0.4, lineHeight: 1 }}>código de barras</span>
          ) : null}
        </div>
      )}

      {layout.logo?.enabled && (
        <div onClick={click("logo")} title={guides ? "Logo" : undefined} style={{ position: "absolute", left: `${layout.logo.x}mm`, top: `${layout.logo.y}mm`, width: `${layout.logo.w}mm`, height: `${layout.logo.h}mm`, lineHeight: 0, ...box("logo") }}>
          {data.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          ) : guides ? (
            <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", fontSize: "6pt", opacity: 0.4, lineHeight: 1 }}>logo</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Pré-visualização com fundo branco e sombra, opcionalmente ampliada (zoom 1×, 2×, 3×). */
export function LabelPreview({ template, data, scale = 1, className = "", ...rest }: CanvasProps & { scale?: number; className?: string }) {
  const w = Number(template.width_mm) * scale, h = Number(template.height_mm) * scale;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-sm bg-white shadow-lg ring-1 ring-black/30 ${className}`} style={{ width: `${w}mm`, height: `${h}mm` }}>
      <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <LabelCanvas template={template} data={data} {...rest} />
      </div>
    </div>
  );
}

export type PrintSheetJob = { key: string; data: LabelData; copies: number };

/**
 * Área de impressão: invisível na tela, única coisa visível ao imprimir.
 * Cada cópia vira uma página do tamanho exato da etiqueta (@page size).
 * O restante da interface já é escondido pelo shell (print:hidden) — a tela
 * que usa este componente deve envolver o conteúdo normal em `print:hidden`.
 */
export function LabelPrintArea({ template, jobs }: { template: CanvasTemplate | null; jobs: PrintSheetJob[] }) {
  if (!template || jobs.length === 0) return null;
  const w = Number(template.width_mm), h = Number(template.height_mm);
  const sheets: React.ReactNode[] = [];
  for (const j of jobs) {
    const n = Math.max(1, Math.min(500, Math.round(j.copies || 1)));
    for (let i = 0; i < n; i++) sheets.push(<LabelCanvas key={`${j.key}-${i}`} template={template} data={j.data} />);
  }
  return (
    <div className="label-print-area" aria-hidden>
      <style>{`
@page { size: ${w}mm ${h}mm; margin: 0; }
@media screen { .label-print-area { display: none !important; } }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; }
  .label-print-area { display: block !important; }
  .label-print-area .label-sheet { margin: 0; box-shadow: none; }
}
`}</style>
      {sheets}
    </div>
  );
}
