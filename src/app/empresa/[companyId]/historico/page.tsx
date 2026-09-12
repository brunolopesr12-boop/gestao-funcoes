"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, TextInput } from "@/components/ui";
import { useData } from "@/lib/store";
import { fmtDateTime } from "@/lib/format";
import { STEP_META } from "@/lib/types";

type Entry = {
  id: string;
  at: string;
  emoji: string;
  title: string;
  subtitle: string;
  notes?: string;
  kind: "treinamento" | "cadastro";
};

const TABS = [
  { key: "tudo", label: "Tudo" },
  { key: "treinamento", label: "Treinamentos" },
  { key: "cadastro", label: "Cadastros" },
] as const;

export default function HistoryPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data } = useData();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("tudo");
  const [query, setQuery] = useState("");

  const company = data.companies.find((c) => c.id === companyId);

  const entries = useMemo<Entry[]>(() => {
    const training: Entry[] = data.training_events
      .filter((e) => e.company_id === companyId)
      .map((e) => {
        const meta = STEP_META[e.step as keyof typeof STEP_META];
        return {
          id: e.id,
          at: e.created_at,
          emoji: e.action === "desmarcou" ? "↩️" : (meta?.emoji ?? "•"),
          title: `${e.employee_name} — ${e.process_name}`,
          subtitle: `${e.action === "desmarcou" ? "Desmarcou" : "Concluiu"} ${meta?.label ?? e.step}${e.role_name ? ` · ${e.role_name}` : ""}${e.trainer ? ` · por ${e.trainer}` : ""}`,
          notes: e.notes || undefined,
          kind: "treinamento",
        };
      });

    const activity: Entry[] = data.activity_log
      .filter((a) => a.company_id === companyId)
      .map((a) => ({
        id: a.id,
        at: a.created_at,
        emoji: a.action === "excluiu" ? "🗑️" : a.action === "criou" ? "➕" : "✏️",
        title: `${a.entity_name || "—"}`,
        subtitle: `${a.action} ${a.entity}${a.detail ? ` · ${a.detail}` : ""}${a.actor ? ` · por ${a.actor}` : ""}`,
        kind: "cadastro",
      }));

    return [...training, ...activity].sort((a, b) => b.at.localeCompare(a.at));
  }, [data, companyId]);

  const visible = entries.filter((e) => {
    if (tab !== "tudo" && e.kind !== tab) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      e.title.toLowerCase().includes(q) || e.subtitle.toLowerCase().includes(q)
    );
  });

  // agrupa por dia
  const groups = visible.reduce<Record<string, Entry[]>>((acc, e) => {
    const day = new Date(e.at).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    (acc[day] ??= []).push(e);
    return acc;
  }, {});

  return (
    <AppShell
      title="Histórico"
      subtitle={company?.name}
      backHref={`/empresa/${companyId}`}
    >
      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔎 Buscar por pessoa, processo…"
        className="mb-3"
      />

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
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

      {visible.length === 0 ? (
        <EmptyState
          emoji="🕓"
          title="Nada registrado ainda"
          description="Cada etapa marcada guarda data, hora, responsável e observação."
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([day, items]) => (
            <div key={day}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                {day}
              </p>
              <ul className="card divide-y divide-[var(--line)]">
                {items.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 p-3.5">
                    <span className="text-lg leading-none">{e.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-tight">
                        {e.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">{e.subtitle}</p>
                      {e.notes && (
                        <p className="mt-1.5 rounded-lg bg-black/25 px-2 py-1 text-xs text-slate-300">
                          “{e.notes}”
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {fmtDateTime(e.at).split(" ")[1]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-600">
        Mostrando os registros mais recentes.
      </p>
    </AppShell>
  );
}
