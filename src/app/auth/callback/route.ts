import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Troca o código do link de e-mail (confirmação / recuperação de senha) por uma sessão. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const type = searchParams.get("type");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      if (type === "recovery") return NextResponse.redirect(`${origin}/login?mode=nova-senha`);
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?erro=link`);
}
