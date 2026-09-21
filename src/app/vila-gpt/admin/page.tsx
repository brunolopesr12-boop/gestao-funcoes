"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, Field, TextInput } from "@/components/ui";
import { ArticleSheet, type ArticleDraft } from "@/components/vila-gpt/ArticleSheet";
import { DocSheet } from "@/components/vila-gpt/DocSheet";
import { SchemaCard } from "@/components/vila-gpt/SchemaCard";
import { KnowledgeBaseTab } from "@/components/vila-gpt/admin/KnowledgeBaseTab";
import { HistoryTab } from "@/components/vila-gpt/admin/HistoryTab";
import { DashboardTab } from "@/components/vila-gpt/admin/DashboardTab";
import { StatusTab } from "@/components/vila-gpt/admin/StatusTab";
import { useData } from "@/lib/store";
import { buildKnowledge, type KnowledgeDoc } from "@/lib/vila-gpt/knowledge";
import {
  adminLogin,
  adminLogout,
  deleteHistoryRow,
  fetchAdminSession,
  fetchHistory,
  type AdminSession,
} from "@/lib/vila-gpt/client";
import type { GptQuestion, KbArticle } from "@/lib/types";

type Tab = "base" | "historico" | "painel" | "status";

const TABS: { key: Tab; label: string }[] = [
  { key: "base", label: "📚 Base" },
  { key: "historico", label: "🕓 Perguntas" },
  { key: "painel", label: "📊 Painel" },
  { key: "status", label: "⚙️ Status" },
];

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <Admin />
    </Suspense>
  );
}

function Admin() {
  const { data, notify, missingTables } = useData();
  const params = useSearchParams();

  const [session, setSession] = useState<AdminSession | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [tab, setTab] = useState<Tab>("base");
  const [rows, setRows] = useState<GptQuestion[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<KbArticle | null>(null);
  const [draft, setDraft] = useState<ArticleDraft | undefined>(undefined);
  const [openDoc, setOpenDoc] = useState<KnowledgeDoc | null>(null);
  const editedFromUrl = useRef("");

  const loadSession = useCallback(async () => {
    try {
      setSession(await fetchAdminSession());
      setSessionError("");
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const admin = Boolean(session?.admin);

  const reloadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      setRows(await fetchHistory(null, 1000));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao carregar o histórico", "erro");
    } finally {
      setLoadingRows(false);
    }
  }, [notify]);

  useEffect(() => {
    if (admin && (tab === "historico" || tab === "painel") && rows === null && !loadingRows) {
      void reloadRows();
    }
  }, [admin, tab, rows, loadingRows, reloadRows]);

  /* base completa, com rascunhos e dados do sistema (só para administrar) */
  const allDocs = useMemo(
    () => buildKnowledge(data, { includeDrafts: true, includeSystem: true }),
    [data],
  );

  const openNew = (d?: ArticleDraft) => {
    setEditing(null);
    setDraft(d);
    setSheet(true);
  };
  const openEdit = (a: KbArticle) => {
    setEditing(a);
    setDraft(undefined);
    setSheet(true);
  };

  useEffect(() => {
    const id = params.get("edit");
    if (!admin || !id || editedFromUrl.current === id) return;
    const a = data.kb_articles.find((x) => x.id === id);
    if (a) {
      editedFromUrl.current = id;
      openEdit(a);
    }
  }, [admin, params, data.kb_articles]);

  const removeRow = async (id: string) => {
    try {
      await deleteHistoryRow(id);
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao excluir", "erro");
    }
  };

  const logout = async () => {
    try {
      await adminLogout();
    } finally {
      setRows(null);
      await loadSession();
    }
  };

  return (
    <AppShell
      title="VILA GPT · Administração"
      subtitle="Base oficial, histórico e painel"
      backHref="/vila-gpt"
      identity={{
        title: "Quem é você?",
        help: "Seu nome fica registrado nas alterações que você fizer na base oficial.",
      }}
    >
      {missingTables.includes("kb_articles") ? (
        <SchemaCard />
      ) : !session && !sessionError ? (
        <p className="pt-6 text-center text-sm text-slate-500">Verificando acesso…</p>
      ) : sessionError ? (
        <div className="card p-5">
          <p className="font-semibold text-rose-200">Não consegui verificar o acesso.</p>
          <p className="mt-1 text-sm text-slate-400">{sessionError}</p>
          <Button className="mt-4" onClick={() => void loadSession()}>
            Tentar de novo
          </Button>
        </div>
      ) : !session?.configured ? (
        <SetupCard />
      ) : !admin ? (
        <LoginCard onDone={loadSession} />
      ) : (
        <>
          <div className="scrollbar-thin mb-4 flex gap-2 overflow-x-auto pb-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  tab === t.key
                    ? "border-blue-500 bg-blue-500/20 text-blue-100"
                    : "border-[var(--line)] bg-white/5 text-slate-400"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "base" && (
            <KnowledgeBaseTab
              docs={allDocs}
              onNew={() => openNew()}
              onEdit={openEdit}
              onOpen={setOpenDoc}
            />
          )}
          {tab === "historico" && (
            <HistoryTab
              rows={rows}
              loading={loadingRows}
              onReload={reloadRows}
              onCreateFrom={(q) => openNew({ title: q.question.replace(/\?+$/, ""), question: q.question, company_id: q.company_id })}
              onDelete={removeRow}
            />
          )}
          {tab === "painel" && (
            <DashboardTab
              rows={rows}
              loading={loadingRows}
              onReload={reloadRows}
              onCreate={(d) => openNew(d)}
              onEdit={openEdit}
            />
          )}
          {tab === "status" && (
            <StatusTab session={session} docs={allDocs} onLogout={logout} onRefresh={loadSession} />
          )}
        </>
      )}

      <ArticleSheet
        open={sheet}
        onClose={() => setSheet(false)}
        article={editing}
        draft={draft}
      />
      <DocSheet
        doc={openDoc}
        onClose={() => setOpenDoc(null)}
        adminHref={openDoc?.article ? `/vila-gpt/admin?edit=${openDoc.article.id}` : undefined}
      />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

function SetupCard() {
  const passos = [
    {
      t: "Escolha uma senha de administrador",
      d: "Na Vercel: Settings → Environment Variables → adicione VILA_GPT_ADMIN_PIN com a senha (mínimo 6 caracteres; evite algo óbvio). Rodando no computador: coloque VILA_GPT_ADMIN_PIN=... no .env.local.",
    },
    {
      t: "Ligue a IA (opcional, mas recomendado)",
      d: "Adicione também ANTHROPIC_API_KEY (chave da API da Anthropic). Sem ela o VILA GPT funciona em modo busca: mostra o procedimento oficial mais parecido, sem redigir a resposta.",
    },
    {
      t: "Redeploy",
      d: "Vercel → Deployments → ⋯ → Redeploy. Depois volte aqui e entre com a senha.",
    },
  ];
  return (
    <div>
      <div className="mb-5 text-center">
        <div className="mb-2 text-5xl">🔐</div>
        <h2 className="text-xl font-extrabold">Falta definir a senha de administrador</h2>
        <p className="mt-2 text-sm text-slate-400">
          Só administradores podem cadastrar, alterar ou excluir informações da base
          oficial. Os funcionários continuam podendo perguntar normalmente.
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
      <pre className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-black/40 p-4 text-xs text-slate-300">
{`# variáveis do VILA GPT
VILA_GPT_ADMIN_PIN=sua-senha
ANTHROPIC_API_KEY=sk-ant-...`}
      </pre>
    </div>
  );
}

function LoginCard({ onDone }: { onDone: () => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pin || busy) return;
    setBusy(true);
    setError("");
    try {
      await adminLogin(pin);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Senha incorreta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mx-auto max-w-md p-5">
      <div className="mb-1 text-3xl">🔐</div>
      <h2 className="text-xl font-extrabold">Área da administração</h2>
      <p className="mb-4 mt-1 text-sm text-slate-400">
        Aqui você cadastra e altera as regras, procedimentos e respostas oficiais que o
        VILA GPT usa.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Senha de administrador">
          <TextInput
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </Field>
        {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}
        <Button type="submit" variant="primary" size="lg" full disabled={!pin || busy}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
