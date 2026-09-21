"use client";

/**
 * Aviso mostrado quando as tabelas do VILA GPT ainda não existem no banco
 * (o supabase/schema.sql novo não foi rodado). O resto do app continua
 * funcionando normalmente.
 */
export function SchemaCard({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="card mb-4 border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        ⚠️ As tabelas do VILA GPT ainda não existem no banco. Abra o Supabase →{" "}
        <strong>SQL Editor</strong> → <strong>New query</strong>, cole o arquivo{" "}
        <code className="rounded bg-black/30 px-1">supabase/schema.sql</code> do projeto e
        clique em <strong>Run</strong>.
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-lg py-6">
      <div className="mb-5 text-center">
        <div className="mb-2 text-5xl">🗄️</div>
        <h2 className="text-xl font-extrabold">Falta criar as tabelas do VILA GPT</h2>
        <p className="mt-2 text-sm text-slate-400">
          O aplicativo está no ar e o resto do sistema funciona normalmente. O VILA GPT só
          precisa que o banco seja atualizado — leva um minuto e não apaga nada.
        </p>
      </div>
      <ol className="space-y-3">
        {[
          {
            t: "Abra o Supabase",
            d: "Pelo painel da Vercel (aba Storage → Open in Supabase) ou por supabase.com/dashboard.",
          },
          {
            t: "SQL Editor → New query",
            d: "Cole todo o conteúdo do arquivo supabase/schema.sql do projeto e clique em Run. Pode rodar de novo sem medo: o arquivo não duplica nada.",
          },
          {
            t: "Volte aqui e recarregue",
            d: "As telas do VILA GPT passam a funcionar na hora.",
          },
        ].map((s, i) => (
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
    </div>
  );
}
