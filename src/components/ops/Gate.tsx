"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/ops/session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { CenteredCard, ShellSkeleton } from "./Shell";

/** Decide o que mostrar conforme o estado da sessão. */
export function OpsGate({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const pathname = usePathname();

  if (!isSupabaseConfigured) return <SetupHint />;
  if (s.status === "carregando") return <ShellSkeleton text="Carregando sua sessão…" />;
  if (s.status === "deslogado") {
    if (typeof window !== "undefined") window.location.href = "/login";
    return <ShellSkeleton text="Redirecionando para o login…" />;
  }
  if (s.status === "erro") {
    return (
      <CenteredCard>
        <div className="mb-3 text-4xl">⚠️</div>
        <h1 className="mb-2 text-xl font-bold">Não consegui carregar sua sessão</h1>
        <p className="mb-3 text-sm text-slate-400">
          Se o banco estiver pausado (plano gratuito do Supabase), abra o painel e clique em <strong className="text-slate-200">Resume project</strong>.
          Se as tabelas do sistema ainda não existirem, rode <code className="rounded bg-white/10 px-1">supabase/install.sql</code> no SQL Editor.
        </p>
        <pre className="mb-4 overflow-x-auto rounded-xl bg-black/40 p-3 text-xs text-rose-300">{s.error}</pre>
        <div className="flex gap-2">
          <Button variant="primary" full onClick={() => void s.refresh()}>Tentar novamente</Button>
          <Button variant="ghost" onClick={() => void s.signOut()}>Sair</Button>
        </div>
      </CenteredCard>
    );
  }
  if (s.status === "sem_acesso" && !pathname.startsWith("/inicio")) {
    return (
      <CenteredCard>
        <div className="mb-3 text-4xl">🔒</div>
        <h1 className="mb-2 text-xl font-bold">Sua conta ainda não foi liberada</h1>
        <p className="mb-4 text-sm text-slate-400">
          Você entrou como <strong className="text-slate-200">{s.user?.email}</strong>, mas nenhuma empresa liberou seu acesso.
          Peça ao administrador para cadastrar ou convidar este e-mail em <strong className="text-slate-200">Usuários</strong>.
        </p>
        <p className="mb-4 text-sm text-slate-400">É a primeira empresa do sistema? Crie-a agora e você será o administrador.</p>
        <div className="flex flex-col gap-2">
          <Link href="/inicio" className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white">Criar minha empresa</Link>
          <Button variant="soft" full onClick={() => void s.refresh()}>Já fui liberado, atualizar</Button>
          <Button variant="ghost" full onClick={() => void s.signOut()}>Sair</Button>
        </div>
      </CenteredCard>
    );
  }
  return <>{children}</>;
}

function SetupHint() {
  return (
    <CenteredCard>
      <div className="mb-2 text-5xl">🔌</div>
      <h1 className="text-2xl font-extrabold">Falta conectar o banco de dados</h1>
      <p className="mt-2 text-sm text-slate-400">
        Defina <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_SUPABASE_URL</code> e <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        (na Vercel: Storage → Create Database → Supabase) e rode <code className="rounded bg-white/10 px-1">supabase/install.sql</code> no SQL Editor. Depois faça o Redeploy.
        O passo a passo completo está em <strong className="text-slate-200">DEPLOY.md</strong>.
      </p>
    </CenteredCard>
  );
}
