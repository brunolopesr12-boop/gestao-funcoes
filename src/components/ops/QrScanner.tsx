"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
  }
}

/**
 * Leitor de QR Code / código de barras pela câmera.
 * Usa a API nativa BarcodeDetector quando existe (Android/Chrome) e cai para
 * a biblioteca ZXing nos demais navegadores (iPhone/Safari).
 */
export function QrScanner({ onResult, onClose, hint = "Aponte para o QR Code da etiqueta ou o código de barras" }: { onResult: (text: string) => void; onClose?: () => void; hint?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop: (() => void) | null = null;
    let alive = true;

    const finish = (text: string) => {
      if (done.current || !alive) return;
      done.current = true;
      try {
        navigator.vibrate?.(60);
      } catch {
        /* ignora */
      }
      onResult(text);
    };

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não permite usar a câmera. Digite o código abaixo.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!alive) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();

        if (window.BarcodeDetector) {
          const det = new window.BarcodeDetector({ formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"] });
          const tick = async () => {
            if (!alive || done.current) return;
            try {
              if (v.readyState >= 2) {
                const codes = await det.detect(v);
                if (codes.length > 0 && codes[0].rawValue) return finish(codes[0].rawValue);
              }
            } catch {
              /* frame inválido */
            }
            raf = requestAnimationFrame(() => void tick());
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromVideoElement(v, (result) => {
            if (result) finish(result.getText());
          });
          stop = () => controls.stop();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível abrir a câmera.");
      }
    }
    void start();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-black" style={{ aspectRatio: "4 / 3" }}>
        <video ref={video} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-48 w-48 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white">
            <Icon name="x" size={18} />
          </button>
        )}
      </div>
      <p className="text-center text-xs text-slate-400">{hint}</p>
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{error}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onResult(manual.trim());
        }}
      >
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ou digite o código / lote" className="field flex-1" />
        <button type="submit" className="rounded-xl bg-[var(--accent)] px-4 font-semibold text-white">OK</button>
      </form>
    </div>
  );
}
