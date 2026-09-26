import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/", "/offline"];
const PUBLIC_FILES = ["/manifest.webmanifest", "/sw.js", "/icon.svg", "/robots.txt"];

function isPublic(path: string): boolean {
  if (PUBLIC_FILES.includes(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Renova a sessão (cookie) em cada requisição e exige login em todas as
 * telas. As rotas /api verificam o usuário por conta própria.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return NextResponse.next(); // tela de setup cuida do resto

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const path = request.nextUrl.pathname;

  if (!user && !isPublic(path)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (path !== "/") login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  if (user && path === "/login" && !request.nextUrl.searchParams.get("mode")) {
    const home = request.nextUrl.clone();
    home.pathname = request.nextUrl.searchParams.get("next") ?? "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml|js|css|map|woff2?)$).*)",
  ],
};
