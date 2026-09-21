"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, EmptyState, TextInput } from "@/components/ui";
import { AnswerText } from "@/components/vila-gpt/AnswerText";
import { DocSheet } from "@/components/vila-gpt/DocSheet";
import { useData } from "@/lib/store";
import { sortedCompanies, companyEmployees } from "@/lib/selectors";
import { normalize } from "@/lib/vila-gpt/text";
import { buildKnowledge, groupByCategory, type KnowledgeDoc } from "@/lib/vila-gpt/knowledge";
import { buildIndex, search } from "@/lib/vila-gpt/retrieval";
import {
  askVilaGpt,
  fetchSuggestions,
  readLocal,
  sendFeedback,
  STORAGE,
  writeLocal,
  type ChatTurn,
} from "@/lib/vila-gpt/client";
import type { GptMode, GptSource } from "@/lib/types";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  found?: boolean;
  mode?: GptMode;
  sources?: GptSource[];
  questionId?: string;
  helpful?: boolean | null;
  warning?: string | null;
  error?: boolean;
};

const EXAMPLES = [
  "Como faço o fechamento do caixa?",
  "Qual é o procedimento para abrir a loja?",
  "O que faço quando o cliente reclama?",
  "Quem sabe fazer esse processo?",
  "Como monto esse pedido?",
  "O que faço quando falta um produto?",
];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());
}

export default function VilaGptPage() {
  return (
    <Suspense fallback={null}>
      <VilaGpt />
    </Suspense>
  );
}

function VilaGpt() {
  const { data, trainer, setTrainer, notify } = useData();
  const router = useRouter();
  const params = useSearchParams();

  const companies = useMemo(() => sortedCompanies(data), [data]);
  const [companyId, setCompanyId] = useState("");
  const [tab, setTab] = useState<"chat" | "manual">("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [openDoc, setOpenDoc] = useState<KnowledgeDoc | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [query, setQuery] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openedDocRef = useRef("");

  /* ---- empresa escolhida ------------------------------------------ */
  useEffect(() => {
    if (companies.length === 0) return;
    const fromUrl = params.get("empresa") ?? "";
    const saved = readLocal(STORAGE.company);
    const pick =
      (fromUrl && companies.some((c) => c.id === fromUrl) && fromUrl) ||
      (saved && companies.some((c) => c.id === saved) && saved) ||
      companies[0].id;
    setCompanyId((cur) => cur || pick);
  }, [companies, params]);

  const chooseCompany = (id: string) => {
    setCompanyId(id);
    writeLocal(STORAGE.company, id);
    setMessages([]);
  };

  useEffect(() => {
    setEmployeeId(readLocal(STORAGE.employee));
  }, []);

  /* o funcionário escolhido acompanha o nome e a empresa atuais */
  const employees = useMemo(
    () => (companyId ? companyEmployees(data, companyId) : []),
    [data, companyId],
  );
  useEffect(() => {
    if (!trainer) return;
    const match = employees.find((e) => normalize(e.name) === normalize(trainer));
    const id = match?.id ?? "";
    setEmployeeId(id);
    writeLocal(STORAGE.employee, id);
  }, [trainer, employees]);

  /* ---- base de conhecimento (para o Manual e as fontes) ------------ */
  const docs = useMemo(
    () => buildKnowledge(data, { companyId: companyId || null }),
    [data, companyId],
  );

  useEffect(() => {
    const id = params.get("doc");
    if (!id || openedDocRef.current === id) return;
    const doc = docs.find((d) => d.id === id);
    if (doc) {
      openedDocRef.current = id;
      setOpenDoc(doc);
    }
  }, [params, docs]);

  useEffect(() => {
    let alive = true;
    void fetchSuggestions(companyId || null).then((s) => alive && setSuggestions(s));
    return () => {
      alive = false;
    };
  }, [companyId]);

  const chips = useMemo(() => {
    const faq = docs.filter((d) => d.kind === "kb" && d.question).map((d) => d.question);
    const all = [...suggestions, ...faq, ...EXAMPLES];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of all) {
      const k = normalize(q);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(q);
      if (out.length >= 6) break;
    }
    return out;
  }, [docs, suggestions]);

  const company = companies.find((c) => c.id === companyId);

  /* ---- enviar ------------------------------------------------------ */
  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || sending) return;
      const history: ChatTurn[] = messages
        .filter((m) => !m.error)
        .slice(-4)
        .map((m) => ({ role: m.role, content: m.text }));
      setMessages((prev) => [...prev, { id: uid(), role: "user", text: question }]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setSending(true);
      scrollDown();
      try {
        const r = await askVilaGpt({
          question,
          company_id: companyId || null,
          employee_name: trainer,
          employee_id: employeeId || null,
          history,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            text: r.answer,
            found: r.found,
            mode: r.mode,
            sources: r.sources,
            questionId: r.logged ? r.id : undefined,
            helpful: null,
            warning: r.warning,
          },
        ]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            text: `Não consegui responder agora. ${e instanceof Error ? e.message : ""}`.trim(),
            error: true,
          },
        ]);
      } finally {
        setSending(false);
        scrollDown();
      }
    },
    [companyId, employeeId, messages, scrollDown, sending, trainer],
  );

  const feedback = async (m: Msg, helpful: boolean) => {
    if (!m.questionId) return;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, helpful } : x)));
    try {
      await sendFeedback(m.questionId, helpful);
    } catch {
      /* feedback é opcional */
    }
  };

  const openSource = (s: GptSource) => {
    const doc = docs.find((d) => d.id === s.id);
    if (doc) setOpenDoc(doc);
    else if (s.href.startsWith("/vila-gpt")) notify("Essa informação não está mais na base oficial.", "erro");
    else router.push(s.href);
  };

  /* ---- quem é você ------------------------------------------------- */
  const identify = (name: string) => {
    const clean = name.trim();
    if (clean) setTrainer(clean);
  };

  const subtitle = company
    ? `${company.emoji} ${company.name} · manual vivo da empresa`
    : "manual vivo da empresa";

  return (
    <AppShell
      title="VILA GPT"
      subtitle={subtitle}
      backHref="/"
      identity={{
        title: "Quem é você?",
        help: "Seu nome fica registrado junto com as perguntas que você faz ao VILA GPT (e nas etapas de treinamento que marcar).",
      }}
      action={
        <Link
          href="/vila-gpt/admin"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-lg text-slate-300 active:scale-95"
          aria-label="Administração do VILA GPT"
          title="Administração"
        >
          ⚙️
        </Link>
      }
    >
      {companies.length > 1 && (
        <div className="scrollbar-thin mb-3 flex gap-2 overflow-x-auto pb-1">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => chooseCompany(c.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                c.id === companyId
                  ? "border-blue-500 bg-blue-500/20 text-blue-100"
                  : "border-[var(--line)] bg-white/5 text-slate-400"
              }`}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-2">
        {(
          [
            { key: "chat", label: "💬 Perguntar" },
            { key: "manual", label: "📖 Manual" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "border-blue-500 bg-blue-500/20 text-blue-100"
                : "border-[var(--line)] bg-white/5 text-slate-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "manual" ? (
        <Manual docs={docs} query={query} setQuery={setQuery} onOpen={setOpenDoc} />
      ) : !trainer ? (
        <NameCard employees={employees.map((e) => e.name)} onDone={identify} />
      ) : (
        <div className="flex min-h-[calc(100dvh-13rem)] flex-col">
          <div className="flex-1 space-y-3 pb-4">
            {messages.length === 0 ? (
              <div className="pop-in pt-6 text-center">
                <div className="mb-2 text-5xl">💬</div>
                <h2 className="text-2xl font-extrabold">Como posso ajudar?</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
                  Pergunte qualquer dúvida sobre o funcionamento da empresa. Eu respondo com
                  base nas regras e procedimentos oficiais e mostro de onde veio a
                  informação.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {chips.map((q) => (
                    <button
                      key={q}
                      onClick={() => void send(q)}
                      className="rounded-full border border-[var(--line)] bg-white/5 px-3.5 py-2 text-left text-sm text-slate-200 hover:bg-white/10 active:scale-[0.98]"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <Bubble key={m.id} m={m} onSource={openSource} onFeedback={feedback} />
              ))
            )}
            {sending && (
              <div className="pop-in flex items-center gap-2 text-sm text-slate-400">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                Procurando na base oficial…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="sticky bottom-0 z-20 -mx-4 border-t border-[var(--line)] bg-[#0b1020]/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Digite sua dúvida…"
                className="field max-h-[140px] flex-1 resize-none !py-3"
                aria-label="Sua dúvida"
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={!input.trim() || sending}
                className="!rounded-xl !px-5"
              >
                Enviar
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-slate-500">
              Respondendo como <strong className="text-slate-400">{trainer}</strong> · as
              perguntas ficam registradas
            </p>
          </form>
        </div>
      )}

      <DocSheet doc={openDoc} onClose={() => setOpenDoc(null)} />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

function Bubble({
  m,
  onSource,
  onFeedback,
}: {
  m: Msg;
  onSource: (s: GptSource) => void;
  onFeedback: (m: Msg, helpful: boolean) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="pop-in flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-[15px] text-white">
          {m.text}
        </div>
      </div>
    );
  }
  const notFound = m.found === false && !m.error;
  return (
    <div className="pop-in flex justify-start">
      <div
        className={`card max-w-[92%] rounded-2xl rounded-bl-md p-4 ${
          notFound ? "border-amber-500/40 bg-amber-500/10" : m.error ? "border-rose-500/40" : ""
        }`}
      >
        <AnswerText text={m.text} />
        {m.sources && m.sources.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-2.5">
            {m.sources.map((s) => (
              <button
                key={s.id}
                onClick={() => onSource(s)}
                className="block w-full text-left text-xs text-slate-400 hover:text-slate-200"
              >
                📎 Fonte: <span className="underline decoration-dotted">{s.label}</span>
              </button>
            ))}
          </div>
        )}
        {m.warning && <p className="mt-2 text-[11px] text-amber-300/80">{m.warning}</p>}
        {m.questionId && !m.error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            {m.helpful === null || m.helpful === undefined ? (
              <>
                <span>Isso ajudou?</span>
                <button
                  onClick={() => onFeedback(m, true)}
                  className="rounded-lg border border-[var(--line)] px-2 py-1 hover:bg-white/10"
                  aria-label="Ajudou"
                >
                  👍
                </button>
                <button
                  onClick={() => onFeedback(m, false)}
                  className="rounded-lg border border-[var(--line)] px-2 py-1 hover:bg-white/10"
                  aria-label="Não ajudou"
                >
                  👎
                </button>
              </>
            ) : (
              <span>{m.helpful ? "Obrigado pelo retorno! 👍" : "Anotado. Vamos melhorar essa resposta. 👎"}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NameCard({ employees, onDone }: { employees: string[]; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="card pop-in p-5">
      <div className="mb-1 text-3xl">👋</div>
      <h2 className="text-xl font-extrabold">Quem é você?</h2>
      <p className="mb-4 mt-1 text-sm text-slate-400">
        Seu nome fica registrado junto com as perguntas. Assim a gerência descobre quais
        assuntos precisam de mais treinamento.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone(name);
        }}
      >
        <TextInput
          list="vgpt-nomes"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          autoFocus
          autoComplete="off"
        />
        <datalist id="vgpt-nomes">
          {employees.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Button type="submit" variant="primary" size="lg" full className="mt-3" disabled={!name.trim()}>
          Começar
        </Button>
      </form>
    </div>
  );
}

function Manual({
  docs,
  query,
  setQuery,
  onOpen,
}: {
  docs: KnowledgeDoc[];
  query: string;
  setQuery: (q: string) => void;
  onOpen: (d: KnowledgeDoc) => void;
}) {
  // "quem sabe fazer / quem exerce" são derivados e mudam sempre: ficam
  // fora da lista do manual, mas o chat continua usando-os.
  const browsable = useMemo(() => docs.filter((d) => d.kind !== "responsaveis"), [docs]);
  const index = useMemo(() => buildIndex(browsable), [browsable]);
  const results = useMemo(
    () => (query.trim() ? search(index, query, { limit: 30 }).map((h) => h.doc) : null),
    [index, query],
  );
  const groups = useMemo(() => groupByCategory(browsable), [browsable]);

  const Item = ({ d }: { d: KnowledgeDoc }) => (
    <button
      onClick={() => onOpen(d)}
      className="card card-hover flex w-full items-center gap-3 p-3.5 text-left"
    >
      <span className="text-2xl">{d.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{d.title}</p>
        <p className="truncate text-xs text-slate-400">
          {d.kindLabel}
          {d.question ? ` · ${d.question}` : ""}
        </p>
      </div>
      <span className="text-lg text-slate-600">›</span>
    </button>
  );

  return (
    <div>
      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔎 Buscar procedimento, regra, produto…"
        className="mb-4"
      />
      {browsable.length === 0 ? (
        <EmptyState
          emoji="📖"
          title="O manual ainda está vazio"
          description="A administração cadastra procedimentos, regras e fichas técnicas em ⚙️ Administração."
        />
      ) : results ? (
        results.length === 0 ? (
          <EmptyState emoji="🔎" title="Nada encontrado" description="Tente outras palavras." />
        ) : (
          <div className="space-y-2">
            {results.map((d) => (
              <Item key={d.id} d={d} />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                {g.category} · {g.docs.length}
              </p>
              <div className="space-y-2">
                {g.docs.map((d) => (
                  <Item key={d.id} d={d} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
