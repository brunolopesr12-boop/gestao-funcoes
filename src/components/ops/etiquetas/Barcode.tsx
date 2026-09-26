"use client";

import { useMemo } from "react";
import { encodeCode128 } from "@/lib/ops/modules/labels-code128";

/**
 * Código de barras Code 128 (B/C) desenhado em SVG, em milímetros.
 * Se o texto tiver caracteres não suportados, mostra o valor em texto monoespaçado.
 */
export function Barcode128({ value, widthMm, heightMm, showText = true, className = "" }: { value: string; widthMm: number; heightMm: number; showText?: boolean; className?: string }) {
  const enc = useMemo(() => encodeCode128(value), [value]);
  if (!enc) {
    return (
      <div className={className} style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, fontFamily: "monospace", fontSize: `${Math.max(6, Math.min(12, heightMm * 1.6))}pt`, lineHeight: 1, overflow: "hidden", whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "0.08em" }} title="Código de barras em texto (caracteres não suportados pelo Code 128)">
        {value}
      </div>
    );
  }
  // reserva ~2 mm para o texto legível (quando cabe)
  const textMm = showText && heightMm >= 6 ? Math.min(2.6, heightMm * 0.35) : 0;
  const barsH = 100;
  const rects: React.ReactNode[] = [];
  let x = 0;
  for (let i = 0; i < enc.widths.length; i++) {
    const w = enc.widths[i];
    if (i % 2 === 0) rects.push(<rect key={i} x={x} y={0} width={w} height={barsH} fill="#000" />);
    x += w;
  }
  return (
    <div className={className} style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${enc.modules} ${barsH}`} preserveAspectRatio="none" style={{ width: "100%", height: textMm ? `calc(100% - ${textMm}mm)` : "100%", display: "block" }} shapeRendering="crispEdges" aria-label={value}>
        {rects}
      </svg>
      {textMm > 0 && (
        <div style={{ height: `${textMm}mm`, fontFamily: "monospace", fontSize: `${Math.max(4.5, textMm * 2.2)}pt`, lineHeight: 1, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", letterSpacing: "0.1em" }}>{value}</div>
      )}
    </div>
  );
}
