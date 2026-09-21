import { NextResponse } from "next/server";
import { readIfoodConfig } from "@/lib/ifood/config";
import { readPollState } from "@/lib/server/kds-repo";
import { isDbConfigured } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Diz, sem rodeios, se a integração está de pé. Nunca devolve credencial —
 * só o que falta configurar e o resultado do último polling.
 */
export async function GET() {
  const config = readIfoodConfig();
  const state = isDbConfigured
    ? await readPollState().catch(() => null)
    : null;

  return NextResponse.json({
    configurado: config.ok,
    banco: isDbConfigured,
    falta: config.ok ? [] : config.missing,
    mensagem: config.ok ? "" : config.message,
    lojas: config.ok ? config.config.merchantIds.length : 0,
    ultimo_polling: state?.last_poll_at ?? null,
    conectado: Boolean(state?.last_poll_ok),
    erro: state?.last_poll_error ?? "",
  });
}
