"use client";

import { useCallback, useRef } from "react";
import { Sheet } from "@/components/ops/ui";
import { QrScanner } from "@/components/ops/QrScanner";

/**
 * Folha com a câmera para ler o QR Code do lote ou o código de barras do produto.
 * Mantém o callback estável para a câmera não reiniciar a cada render.
 */
export function ScanSheet({ open, onClose, onResult, hint }: { open: boolean; onClose: () => void; onResult: (text: string) => void; hint?: string }) {
  const ref = useRef(onResult);
  ref.current = onResult;
  const stable = useCallback((t: string) => ref.current(t), []);
  return (
    <Sheet open={open} onClose={onClose} title="Ler código">
      {open && <QrScanner onResult={stable} onClose={onClose} hint={hint ?? "Aponte para o QR Code da etiqueta ou o código de barras do produto"} />}
    </Sheet>
  );
}
