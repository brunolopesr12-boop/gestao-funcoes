"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TrainingChips } from "@/components/TrainingChips";
import { Button, EmptyState, ProgressBar, SectionTitle } from "@/components/ui";
import { useData } from "@/lib/store";
import { pendingsByEmployee } from "@/lib/selectors";
import { avatarTone, initials } from "@/lib/format";
import { STEP_META } from "@/lib/types";

export default function PendingsPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, trainingIndex } = useData();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlyStarted, setOnlyStarted] = useState(false);

  const company = data.companies.find((c) => c.id === companyId);
  const pendings = useMemo(
    () => pendingsByEmployee(data, trainingIndex, companyId),
    [data, trainingIndex, companyId],
  );

  const filtered = pendings
    .map((p) => ({
      ...p,
      items: onlyStarted ? p.items.filter((i) => i.doneSteps.length > 0) : p.items,
    }))
    .filter((p) => p.items.length > 0);

  const totalItems = filtered.reduce((a, p) => a + p.items.length, 0);

  return (
    <AppShell
      title="O que preciso treinar?"
      subtitle={company?.name}
      backHref={`/empresa/${companyId}`}
    >
      {pendings.length === 0 ? (
        <EmptyState
          emoji="🎉"
          title="Nenhuma pendência!"
          description="Todo mundo está certificado nos processos das funções vinculadas."
        />
      ) : (
        <>
          <div className="card mb-4 flex items-center gap-3 p-4">
            <span className="text-3xl">🎯</span>
            <div className="flex-1">
              <p className="font-bold">
                {totalItems} {totalItems === 1 ? "processo pendente" : "processos pendentes"}
              </p>
              <p className="text-xs text-slate-400">
                Toque direto nas etapas para marcar durante o trabalho.
              </p>
            </div>
          </div>

          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setOnlyStarted(false)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                !onlyStarted
                  ? "border-blue-500 bg-blue-500/20 text-blue-100"
                  : "border-[var(--line)] bg-white/5 text-slate-400"
              }`}
            >
              Tudo
            </button>
            <button
              onClick={() => setOnlyStarted(true)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                onlyStarted
                  ? "border-blue-500 bg-blue-500/20 text-blue-100"
                  : "border-[var(--line)] bg-white/5 text-slate-400"
              }`}
            >
              🟡 Só os começados
            </button>
          </div>

          {filtered.length === 0 ? (
            <EmptyState emoji="🔍" title="Nada com esse filtro" />
          ) : (
            <div className="space-y-3">
              {filtered.map((p) => {
                const isOpen = open[p.employee.id] ?? true;
                return (
                  <div key={p.employee.id} className="card overflow-hidden">
                    <button
                      onClick={() =>
                        setOpen((o) => ({ ...o, [p.employee.id]: !isOpen }))
                      }
                      className="flex w-full items-center gap-3 p-3.5 text-left"
                    >
                      <span
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border text-sm font-bold ${avatarTone(p.employee.name)}`}
                      >
                        {initials(p.employee.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{p.employee.name}</p>
                        <p className="text-xs text-slate-400">
                          {p.items.length}{" "}
                          {p.items.length === 1 ? "pendência" : "pendências"}
                        </p>
                        <div className="mt-1.5">
                          <ProgressBar value={p.pct} showLabel />
                        </div>
                      </div>
                      <span className="text-slate-500">{isOpen ? "▾" : "▸"}</span>
                    </button>

                    {isOpen && (
                      <div className="space-y-2 border-t border-[var(--line)] p-3">
                        {p.items.map((item) => (
                          <div
                            key={`${item.role.id}-${item.process.id}`}
                            className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-3"
                          >
                            <div className="mb-2 flex items-start gap-2">
                              <span className="text-base leading-none">
                                {item.status === "nao_iniciado" ? "🔴" : "🟡"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold leading-tight">
                                  {item.process.name}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {item.role.emoji} {item.role.name} · falta{" "}
                                  {item.missingSteps
                                    .map((s) => STEP_META[s].label)
                                    .join(", ")}
                                </p>
                              </div>
                            </div>
                            <TrainingChips
                              employeeId={p.employee.id}
                              process={item.process}
                            />
                          </div>
                        ))}

                        <Link
                          href={`/empresa/${companyId}/funcionarios/${p.employee.id}`}
                          className="block"
                        >
                          <Button variant="ghost" size="sm" full>
                            Abrir ficha de {p.employee.name.split(" ")[0]} →
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="mt-8">
        <SectionTitle>Legenda das etapas</SectionTitle>
        <ul className="card divide-y divide-[var(--line)] text-sm">
          {(["mostrei", "fez", "ensinou", "certifiquei"] as const).map((s) => (
            <li key={s} className="flex gap-3 p-3">
              <span className="text-lg">{STEP_META[s].emoji}</span>
              <div>
                <p className="font-semibold">{STEP_META[s].label}</p>
                <p className="text-xs text-slate-400">{STEP_META[s].help}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
