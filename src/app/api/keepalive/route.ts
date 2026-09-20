import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Mantém o banco acordado.
 *
 * O plano gratuito do Supabase pausa o projeto depois de ~7 dias sem nenhuma
 * atividade — e um projeto pausado derruba o app até alguém religar pelo
 * painel. Esta rota faz uma consulta mínima no banco e é chamada uma vez por
 * dia pelo Cron da Vercel (ver vercel.json), o que já conta como atividade.
 *
 * Também serve como verificação de saúde: abrir /api/keepalive no navegador
 * diz na hora se o app está conseguindo falar com o banco.
 */
export async function GET() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    "";

  if (!url || !key) {
    return NextResponse.json(
      { ok: false, erro: "Supabase não configurado neste ambiente." },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, erro: await res.text() },
        { status: 502 },
      );
    }

    const rows = (await res.json()) as unknown[];
    return NextResponse.json({
      ok: true,
      banco: "acordado",
      empresas: rows.length,
    });
  } catch (e) {
    // Projeto pausado ou fora do ar: o fetch falha antes de responder.
    return NextResponse.json(
      {
        ok: false,
        erro: e instanceof Error ? e.message : String(e),
        dica: "O banco pode estar pausado. Abra o painel do Supabase e clique em Resume project.",
      },
      { status: 503 },
    );
  }
}
