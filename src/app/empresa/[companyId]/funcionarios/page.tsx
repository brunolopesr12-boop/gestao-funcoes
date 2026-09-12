"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmployeeSheet } from "@/components/sheets";
import { Button, EmptyState, ProgressBar, StatusPill, TextInput } from "@/components/ui";
import { useData } from "@/lib/store";
import { companyEmployeeSummaries, type EmployeeBucket } from "@/lib/selectors";
import { avatarTone, initials } from "@/lib/format";

const FILTERS: { key: EmployeeBucket | "todos"; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "apto", label: "🟢 Aptos" },
  { key: "em_treinamento", label: "🟡 Treinando" },
  { key: "nao_treinado", label: "🔴 Não treinados" },
  { key: "sem_funcao", label: "⚪ Sem função" },
];

export default function EmployeesPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, trainingIndex } = useData();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EmployeeBucket | "todos">("todos");

  const company = data.companies.find((c) => c.id === companyId);
  const summaries = useMemo(
    () => companyEmployeeSummaries(data, trainingIndex, companyId),
    [data, trainingIndex, companyId],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: summaries.length };
    for (const s of summaries) c[s.bucket] = (c[s.bucket] ?? 0) + 1;
    return c;
  }, [summaries]);

  const visible = summaries.filter((s) => {
    if (filter !== "todos" && s.bucket !== filter) return false;
    if (!query.trim()) return true;
    return s.employee.name.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <AppShell
      title="Funcionários"
      subtitle={company?.name}
      backHref={`/empresa/${companyId}`}
    >
      {summaries.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="Nenhum funcionário cadastrado"
          description="Cadastre as pessoas da equipe para começar a acompanhar o treinamento."
          action={
            <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
              + Novo funcionário
            </Button>
          }
        />
      ) : (
        <>
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔎 Buscar funcionário…"
            className="mb-3"
          />

          <div className="scrollbar-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                  filter === f.key
                    ? "border-blue-500 bg-blue-500/20 text-blue-100"
                    : "border-[var(--line)] bg-white/5 text-slate-400"
                }`}
              >
                {f.label}
                <span className="ml-1.5 opacity-70">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState emoji="🔍" title="Nada encontrado com esse filtro" />
          ) : (
            <div className="space-y-2">
              {visible.map((s) => (
                <Link
                  key={s.employee.id}
                  href={`/empresa/${companyId}/funcionarios/${s.employee.id}`}
                  className="card card-hover flex items-center gap-3 p-3.5"
                >
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border text-sm font-bold ${avatarTone(s.employee.name)}`}
                  >
                    {initials(s.employee.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-bold">{s.employee.name}</p>
                      {s.employee.status !== "ativo" && (
                        <span className="shrink-0 rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                          {s.employee.status}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {s.current
                        ? `${s.current.link.role.emoji} ${s.current.link.role.name}`
                        : s.links.length > 0
                          ? `Treinando: ${s.links.map((l) => l.link.role.name).join(", ")}`
                          : "Sem função definida"}
                    </p>
                    <div className="mt-1.5">
                      <ProgressBar value={s.pct} showLabel />
                    </div>
                  </div>
                  <StatusPill
                    status={
                      s.bucket === "sem_funcao"
                        ? "sem_processos"
                        : s.bucket === "apto"
                          ? "apto"
                          : s.bucket === "em_treinamento"
                            ? "em_treinamento"
                            : "nao_treinado"
                    }
                    compact
                  />
                </Link>
              ))}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            full
            className="mt-4"
            onClick={() => setCreating(true)}
          >
            + Novo funcionário
          </Button>
        </>
      )}

      <EmployeeSheet
        open={creating}
        onClose={() => setCreating(false)}
        companyId={companyId}
        employee={null}
      />
    </AppShell>
  );
}
