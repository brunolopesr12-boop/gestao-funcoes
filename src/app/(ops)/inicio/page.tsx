"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/ops/session";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { Button, Field, TextInput, TextArea, EmojiPicker } from "@/components/ui";
import { PageHeader, useToast } from "@/components/ops/ui";

const EMOJIS = ["🏪", "👨‍🍳", "🍕", "🍔", "🥟", "☕", "🍰", "🍩", "🚚", "🏢"];
const COLORS = ["#e11d48", "#f97316", "#f59e0b", "#10b981", "#2563eb", "#8b5cf6", "#06b6d4"];

/**
 * Assistente inicial: cria a empresa, a primeira unidade e torna o usuário
 * administrador. Os padrões (categorias, unidades de medida, locais de estoque,
 * motivos de perda, modelos de etiqueta, checklists) são criados pelo banco.
 */
export default function OnboardingPage() {
  const { refresh, status, companies } = useSession();
  const router = useRouter();
  const notify = useToast();
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("Matriz");
  const [emoji, setEmoji] = useState("🏪");
  const [color, setColor] = useState("#f97316");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("ops_create_company", { p_name: name.trim(), p_emoji: emoji, p_color: color, p_store_name: storeName.trim() || "Matriz", p_notes: notes });
      notify("Empresa criada! Você é o administrador.");
      await refresh();
      router.replace("/configuracoes");
    } catch (e) {
      setError(toOpsError(e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Nova empresa" subtitle="Assistente inicial" backHref={status === "pronto" && companies.length > 0 ? "/configuracoes" : undefined} />
      <div className="card p-5">
        <ol className="mb-5 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-slate-400 sm:grid-cols-5">
          {["Empresa", "Unidade", "Usuários", "Cadastros", "Operação"].map((s, i) => (
            <li key={s} className={`rounded-lg border px-2 py-1.5 ${i === 0 ? "border-[var(--accent)] text-white" : "border-[var(--line)]"}`}>{i + 1}. {s}</li>
          ))}
        </ol>
        <Field label="Nome da empresa">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Vila Rica" autoFocus />
        </Field>
        <Field label="Primeira unidade (loja)" hint="Você pode cadastrar outras unidades depois em Configurações.">
          <TextInput value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Ex.: Matriz" />
        </Field>
        <Field label="Ícone">
          <EmojiPicker value={emoji} onChange={setEmoji} options={EMOJIS} />
        </Field>
        <Field label="Cor">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={`h-10 w-10 rounded-xl border-2 ${color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
            ))}
          </div>
        </Field>
        <Field label="Observações" hint="Opcional">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Endereço, segmento (salgados, pizzas, lanches, delivery…)" />
        </Field>
        {error && <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <Button variant="primary" size="lg" full disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? "Criando…" : "Criar empresa e começar"}
        </Button>
        <p className="mt-3 text-xs text-slate-500">
          Ao criar, o sistema já cadastra unidades de medida, categorias, locais de estoque, motivos de perda, modelos de etiqueta e checklists iniciais — tudo editável.
        </p>
      </div>
    </div>
  );
}
