"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { Button, Field, TextInput } from "@/components/ui";

type Mode = "entrar" | "cadastrar" | "recuperar" | "nova-senha";
const ALLOW_SIGNUP = process.env.NEXT_PUBLIC_ALLOW_SIGNUP === "true";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "erro" | "ok"; text: string } | null>(null);
  const [firstAccess, setFirstAccess] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void supabaseBrowser().rpc("ops_needs_bootstrap").then(({ data }) => setFirstAccess(data === true));
    if (params.get("erro") === "link") setMsg({ kind: "erro", text: "O link expirou ou é inválido. Peça um novo." });
  }, [params]);

  if (!isSupabaseConfigured) {
    return (
      <Wrap>
        <div className="mb-2 text-5xl">🔌</div>
        <h1 className="text-2xl font-extrabold">Falta conectar o banco de dados</h1>
        <p className="mt-2 text-sm text-slate-400">Configure as variáveis do Supabase e rode supabase/install.sql. Veja DEPLOY.md.</p>
      </Wrap>
    );
  }

  const canSignup = ALLOW_SIGNUP || firstAccess === true;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    try {
      if (mode === "entrar") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        window.location.href = next.startsWith("/") ? next : "/";
        return;
      }
      if (mode === "cadastrar") {
        if (!canSignup) {
          const { data: invited } = await sb.rpc("ops_invite_exists", { p_email: email.trim() });
          if (invited !== true) throw new Error("Este e-mail não foi convidado. Peça ao administrador para cadastrar você em Usuários.");
        }
        if (password.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          window.location.href = "/";
          return;
        }
        setMsg({ kind: "ok", text: "Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre." });
        setMode("entrar");
        return;
      }
      if (mode === "recuperar") {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?type=recovery` });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Se o e-mail existir, enviamos um link para criar uma nova senha." });
        return;
      }
      if (mode === "nova-senha") {
        if (password.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Senha atualizada. Entrando…" });
        router.replace("/");
        return;
      }
    } catch (err) {
      const m = toOpsError(err as Error).message;
      setMsg({ kind: "erro", text: /invalid login/i.test(m) ? "E-mail ou senha incorretos." : /email not confirmed/i.test(m) ? "Confirme seu e-mail antes de entrar (ou peça ao administrador para confirmar no painel do Supabase)." : m });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Wrap>
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent)] text-2xl font-black text-white">V</span>
        <div>
          <h1 className="text-xl font-extrabold leading-tight">Vila Rica · Cozinha</h1>
          <p className="text-xs text-slate-400">Estoque, produção, validade e operação</p>
        </div>
      </div>

      {firstAccess && mode === "entrar" && (
        <div className="mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-sm text-blue-100">
          <strong>Primeiro acesso.</strong> Ainda não existe nenhum usuário. Crie a conta do administrador para começar.
          <button type="button" onClick={() => setMode("cadastrar")} className="ml-1 font-semibold underline">Criar conta</button>
        </div>
      )}

      <form onSubmit={submit}>
        {mode === "cadastrar" && (
          <Field label="Seu nome">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Bruno Lopes" required autoFocus />
          </Field>
        )}
        {mode !== "nova-senha" && (
          <Field label="E-mail">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" required autoComplete="email" autoFocus={mode !== "cadastrar"} />
          </Field>
        )}
        {mode !== "recuperar" && (
          <Field label={mode === "nova-senha" ? "Nova senha" : "Senha"} hint={mode !== "entrar" ? "Mínimo de 6 caracteres" : undefined}>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "entrar" ? "current-password" : "new-password"} minLength={6} />
          </Field>
        )}

        {msg && (
          <p className={`mb-4 rounded-xl border px-3 py-2 text-sm ${msg.kind === "erro" ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"}`}>
            {msg.text}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" full disabled={busy}>
          {busy ? "Aguarde…" : mode === "entrar" ? "Entrar" : mode === "cadastrar" ? "Criar conta" : mode === "recuperar" ? "Enviar link" : "Salvar nova senha"}
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm text-slate-400">
        {mode === "entrar" ? (
          <>
            <button type="button" onClick={() => setMode("recuperar")} className="underline">Esqueci a senha</button>
            <button type="button" onClick={() => setMode("cadastrar")} className="underline">{canSignup ? "Criar conta" : "Fui convidado"}</button>
          </>
        ) : (
          <button type="button" onClick={() => setMode("entrar")} className="underline">Voltar para entrar</button>
        )}
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="card p-6">{children}</div>
      <p className="mt-4 text-center text-xs text-slate-500">Acesso restrito aos funcionários autorizados.</p>
    </div>
  );
}
