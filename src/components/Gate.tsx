"use client";

import { isSupabaseConfigured } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { Button } from "./ui";

export function Gate({ children }: { children: React.ReactNode }) {
  const { loading, error, refresh } = useData();

  if (!isSupabaseConfigured) return <SetupScreen />;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-10">
        <div className="mb-6 h-8 w-52 animate-pulse rounded-xl bg-white/10" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Carregando dados…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5">
        <div className="card p-6">
          <div className="mb-3 text-4xl">⚠️</div>
          <h1 className="mb-2 text-xl font-bold">Não consegui carregar os dados</h1>
          <p className="mb-4 text-sm text-slate-400">
            Verifique se o schema foi aplicado no Supabase (arquivo{" "}
            <code className="rounded bg-white/10 px-1">supabase/schema.sql</code>) e se
            as chaves em <code className="rounded bg-white/10 px-1">.env.local</code>{" "}
            estão corretas.
          </p>
          <pre className="mb-4 overflow-x-auto rounded-xl bg-black/40 p-3 text-xs text-rose-300">
            {error}
          </pre>
          <Button variant="primary" full onClick={() => void refresh()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function SetupScreen() {
  const passos = [
    {
      t: "Na Vercel: adicione o Supabase",
      d: "No projeto da Vercel abra a aba Storage (ou Integrations) → Create Database → Supabase. A Vercel cria o banco e injeta as chaves no projeto sozinha.",
    },
    {
      t: "Crie as tabelas",
      d: "Abra o painel do Supabase pelo botão que aparece na Vercel → SQL Editor → New query. Cole todo o arquivo supabase/schema.sql do projeto e clique em Run.",
    },
    {
      t: "Redeploy",
      d: "Na Vercel, aba Deployments → ⋯ no último deploy → Redeploy, para o app subir já com as chaves.",
    },
    {
      t: "Rodando no computador?",
      d: "Crie um arquivo .env.local na raiz com NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase → Project Settings → API) e rode npm run dev de novo.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10">
      <div className="mb-6 text-center">
        <div className="mb-2 text-5xl">🔌</div>
        <h1 className="text-2xl font-extrabold">Falta conectar o banco de dados</h1>
        <p className="mt-2 text-slate-400">
          O aplicativo está pronto — só precisa das chaves do Supabase.
        </p>
      </div>

      <ol className="space-y-3">
        {passos.map((s, i) => (
          <li key={s.t} className="card flex gap-4 p-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-bold">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{s.t}</p>
              <p className="mt-0.5 text-sm text-slate-400">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>

      <pre className="mt-6 overflow-x-auto rounded-2xl border border-[var(--line)] bg-black/40 p-4 text-xs text-slate-300">
{`# .env.local (só para rodar no computador)
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...`}
      </pre>

      <p className="mt-4 text-center text-xs text-slate-500">
        O passo a passo completo está no arquivo DEPLOY.md do projeto.
      </p>
    </div>
  );
}
