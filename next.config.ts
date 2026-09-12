import type { NextConfig } from "next";

/**
 * A integração Supabase da Vercel injeta as chaves com nomes que variam
 * conforme a versão (com ou sem o prefixo NEXT_PUBLIC_, "anon" ou
 * "publishable"). Aqui normalizamos tudo para os dois nomes que o app usa,
 * para que funcione sem ninguém precisar renomear variável na mão.
 */
const first = (...values: (string | undefined)[]) =>
  values.find((v) => typeof v === "string" && v.length > 0) ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: first(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_URL,
      process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_URL,
      process.env.POSTGRES_SUPABASE_URL,
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: first(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      process.env.SUPABASE_ANON_KEY,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  },
};

export default nextConfig;
