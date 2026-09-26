"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Conteúdo padrão do QR de um lote: URL da ficha (abre no celular mesmo sem o app). */
export function lotQrValue(lotId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/l/${lotId}`;
}

/** Extrai o id do lote de um QR lido (URL /l/<id>, /lote/<id> ou o próprio uuid). */
export function parseLotQr(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/(?:l|lote)\/([0-9a-f-]{36})/i) ?? t.match(/^([0-9a-f-]{36})$/i) ?? t.match(/^vr:lot:([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
}

export function QrSvg({ value, size = 96, className = "" }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then((s) => alive && setSvg(s)).catch(() => setSvg(""));
    return () => {
      alive = false;
    };
  }, [value]);
  if (!svg) return <span style={{ width: size, height: size }} className={`inline-block ${className}`} />;
  return <span style={{ width: size, height: size }} className={`inline-block [&>svg]:h-full [&>svg]:w-full ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Data URL (PNG) para uso em impressão/PDF. */
export async function qrDataUrl(value: string, size = 256): Promise<string> {
  return QRCode.toDataURL(value, { margin: 0, width: size, errorCorrectionLevel: "M" });
}
