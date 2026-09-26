import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Mantém o banco acordado e serve como verificação de saúde.
 *
 * O plano gratuito do Supabase pausa o projeto depois de ~7 dias sem
 * atividade. Esta rota faz uma chamada mínima (a função pública
 * ops_needs_bootstrap, liberada para a chave anon) e é chamada uma vez por
 * dia pelo Cron da Vercel (ver vercel.json). Abrir /api/keepalive no
 * navegador diz na hora se o app está conseguindo falar com o banco.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    "";

  if (!url || !key) {
    return NextResponse.json({ ok: false, erro: "Supabase não configurado neste ambiente." }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/ops_needs_bootstrap`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      const schemaMissing = res.status === 404 || /PGRST202|schema cache/i.test(text);
      return NextResponse.json(
        { ok: false, status: res.status, erro: text, dica: schemaMissing ? "Rode supabase/install.sql no SQL Editor do Supabase." : undefined },
        { status: 502 },
      );
    }
    const needsBootstrap = (await res.json()) as boolean;
    return NextResponse.json({ ok: true, banco: "acordado", primeiro_acesso_pendente: needsBootstrap });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : String(e), dica: "O banco pode estar pausado. Abra o painel do Supabase e clique em Resume project." },
      { status: 503 },
    );
  }
}
