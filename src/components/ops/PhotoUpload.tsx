"use client";

import { useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { newId } from "@/lib/ops/format";
import { toOpsError } from "@/lib/ops/errors";
import { Icon } from "./Icon";

/** Redimensiona a imagem no navegador (máx. 1280px, JPEG 0.82) para economizar dados. */
async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
}

/** Envia uma foto para o bucket ops-fotos/<empresa>/<pasta>/ e devolve a URL pública. */
export async function uploadPhoto(companyId: string, folder: string, file: File): Promise<string> {
  const sb = supabaseBrowser();
  const blob = await compress(file);
  const path = `${companyId}/${folder}/${newId()}.jpg`;
  const { error } = await sb.storage.from("ops-fotos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw toOpsError(error);
  return sb.storage.from("ops-fotos").getPublicUrl(path).data.publicUrl;
}

export function PhotoUpload({
  value, onChange, folder, label = "Foto", hint, required,
}: { value: string; onChange: (url: string) => void; folder: string; label?: string; hint?: string; required?: boolean }) {
  const { company } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !company) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadPhoto(company.id, folder, f));
    } catch (ex) {
      setErr(toOpsError(ex as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="mb-4">
      <span className="mb-1.5 block text-sm font-semibold text-slate-300">
        {label} {required && <span className="text-rose-400">*</span>}
      </span>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-20 w-20 rounded-xl border border-[var(--line)] object-cover" />
        ) : (
          <span className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-[var(--line)] text-slate-500"><Icon name="camera" /></span>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm font-semibold disabled:opacity-50">
            <Icon name="camera" size={16} /> {busy ? "Enviando…" : value ? "Trocar foto" : "Tirar / escolher foto"}
          </button>
          {value && <button type="button" onClick={() => onChange("")} className="text-left text-xs text-rose-300 underline">Remover</button>}
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {err && <p className="mt-1 text-xs text-rose-300">{err}</p>}
    </div>
  );
}
