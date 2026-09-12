"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmployeeSheet } from "@/components/sheets";
import { ProcessTrainingCard } from "@/components/TrainingChips";
import {
  BlockBar,
  Button,
  EmptyState,
  ProgressBar,
  SectionTitle,
  StatusPill,
} from "@/components/ui";
import { useData } from "@/lib/store";
import { employeeSummary } from "@/lib/selectors";
import { avatarTone, fmtDate, fmtDateTime, initials } from "@/lib/format";
import { STEP_META } from "@/lib/types";

export default function EmployeeDetailPage() {
  return (
    <Suspense fallback={null}>
      <EmployeeDetail />
    </Suspense>
  );
}

function EmployeeDetail() {
  const { companyId, employeeId } = useParams<{
    companyId: string;
    employeeId: string;
  }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data, trainingIndex } = useData();
  const [editing, setEditing] = useState(false);
  const [pickedRole, setPickedRole] = useState<string | null>(null);

  const employee = data.employees.find((e) => e.id === employeeId);
  const summary = useMemo(
    () => (employee ? employeeSummary(data, trainingIndex, employee) : null),
    [data, trainingIndex, employee],
  );

  if (!employee || !summary) {
    return (
      <AppShell title="Funcionário" backHref={`/empresa/${companyId}/funcionarios`}>
        <EmptyState emoji="🔍" title="Funcionário não encontrado" />
      </AppShell>
    );
  }

  const links = summary.links;
  const activeRoleId =
    pickedRole ??
    search.get("funcao") ??
    summary.current?.link.role.id ??
    links[0]?.link.role.id ??
    null;
  const active = links.find((l) => l.link.role.id === activeRoleId) ?? links[0] ?? null;

  const history = data.training_events
    .filter((e) => e.employee_id === employeeId)
    .slice(0, 12);

  return (
    <AppShell
      title={employee.name}
      subtitle={
        summary.current
          ? `${summary.current.link.role.emoji} ${summary.current.link.role.name}`
          : "Sem função definida"
      }
      backHref={`/empresa/${companyId}/funcionarios`}
      action={
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Editar
        </Button>
      }
    >
      {/* Cabeçalho ------------------------------------------------- */}
      <div className="card mb-4 p-4">
        <div className="flex items-center gap-3">
          <span
            className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl border text-xl font-bold ${avatarTone(employee.name)}`}
          >
            {initials(employee.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-extrabold">{employee.name}</p>
            <p className="text-sm text-slate-400">
              {summary.current
                ? `${summary.current.link.role.emoji} ${summary.current.link.role.name}`
                : "Sem função definida"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 uppercase">
                {employee.status}
              </span>
              {employee.hired_on && (
                <span className="rounded-full border border-[var(--line)] px-2 py-0.5">
                  desde {fmtDate(employee.hired_on)}
                </span>
              )}
            </div>
          </div>
        </div>

        {employee.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/25 p-3 text-sm text-slate-300">
            {employee.notes}
          </p>
        )}
      </div>

      {links.length === 0 ? (
        <EmptyState
          emoji="🧩"
          title="Sem função definida"
          description="Defina a função atual para começar o treinamento."
          action={
            <Button variant="primary" onClick={() => setEditing(true)}>
              Definir função
            </Button>
          }
        />
      ) : (
        <>
          {/* Seletor de função ------------------------------------ */}
          {links.length > 1 && (
            <div className="scrollbar-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {links.map(({ link, progress }) => (
                <button
                  key={link.role.id}
                  onClick={() => setPickedRole(link.role.id)}
                  className={`shrink-0 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                    link.role.id === active?.link.role.id
                      ? "border-blue-500 bg-blue-500/20 text-blue-100"
                      : "border-[var(--line)] bg-white/5 text-slate-400"
                  }`}
                >
                  {link.role.emoji} {link.role.name}
                  <span className="ml-1.5 opacity-70">{progress.pct}%</span>
                </button>
              ))}
            </div>
          )}

          {active && (
            <>
              {/* Progresso ------------------------------------------ */}
              <div className="card mb-4 p-4">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <SectionTitle>Progresso do treinamento</SectionTitle>
                  <StatusPill status={active.progress.fitness} />
                </div>
                <div className="mb-2 flex items-center gap-3">
                  <BlockBar value={active.progress.pct} />
                  <span className="text-2xl font-extrabold tabular-nums">
                    {active.progress.pct}%
                  </span>
                </div>
                <ProgressBar value={active.progress.pct} />
                <p className="mt-2 text-xs text-slate-400">
                  {active.progress.certifiedCount} de {active.progress.requiredCount}{" "}
                  processos certificados · {active.progress.doneStepCount}/
                  {active.progress.totalStepCount} etapas
                </p>
              </div>

              {/* Aptidão -------------------------------------------- */}
              {active.progress.fitness === "apto" ? (
                <div className="mb-5 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 p-4">
                  <p className="text-lg font-extrabold text-emerald-200">
                    🟢 APTO PARA A FUNÇÃO
                  </p>
                  <p className="mt-1 text-sm text-emerald-100/80">
                    Todos os processos obrigatórios de {active.link.role.name} estão
                    certificados.
                  </p>
                </div>
              ) : active.progress.fitness === "sem_processos" ? (
                <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  ⚠️ A função {active.link.role.name} ainda não tem processos
                  obrigatórios cadastrados.{" "}
                  <Link
                    href={`/empresa/${companyId}/funcoes/${active.link.role.id}`}
                    className="underline"
                  >
                    Cadastrar agora
                  </Link>
                </div>
              ) : (
                <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="font-bold text-amber-100">
                    Falta para ficar apto ({active.progress.pending.length}{" "}
                    {active.progress.pending.length === 1 ? "processo" : "processos"})
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-amber-50/90">
                    {active.progress.pending.map((p) => (
                      <li key={p.process.id} className="flex flex-wrap items-center gap-1.5">
                        <span>{p.status === "nao_iniciado" ? "🔴" : "🟡"}</span>
                        <strong>{p.process.name}</strong>
                        <span className="opacity-75">
                          — falta{" "}
                          {p.missingSteps.map((s) => STEP_META[s].label).join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Processos ------------------------------------------ */}
              <SectionTitle hint="Toque em uma etapa para marcar">
                Processos de {active.link.role.name}
              </SectionTitle>

              {active.progress.all.length === 0 ? (
                <EmptyState
                  emoji="📋"
                  title="Essa função não tem processos"
                  description="Cadastre o que a pessoa precisa saber fazer."
                  action={
                    <Link href={`/empresa/${companyId}/funcoes/${active.link.role.id}`}>
                      <Button variant="primary">Abrir função</Button>
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {active.progress.all.map((p) => (
                    <ProcessTrainingCard
                      key={p.process.id}
                      employeeId={employee.id}
                      process={p.process}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Histórico -------------------------------------------------- */}
      <div className="mt-8">
        <SectionTitle
          action={
            <Link
              href={`/empresa/${companyId}/historico`}
              className="text-xs font-semibold text-blue-300"
            >
              Ver tudo
            </Link>
          }
        >
          Histórico recente
        </SectionTitle>
        {history.length === 0 ? (
          <p className="card p-4 text-sm text-slate-500">
            Nenhuma etapa registrada ainda.
          </p>
        ) : (
          <ul className="card divide-y divide-[var(--line)]">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-3 p-3.5 text-sm">
                <span className="text-lg">
                  {h.action === "desmarcou"
                    ? "↩️"
                    : (STEP_META[h.step as keyof typeof STEP_META]?.emoji ?? "•")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-slate-200">
                    <strong>{h.process_name}</strong> —{" "}
                    {h.action === "desmarcou" ? "desmarcou " : ""}
                    {STEP_META[h.step as keyof typeof STEP_META]?.label ?? h.step}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtDateTime(h.created_at)}
                    {h.trainer ? ` · por ${h.trainer}` : ""}
                  </p>
                  {h.notes && (
                    <p className="mt-1 rounded-lg bg-black/25 px-2 py-1 text-xs text-slate-300">
                      {h.notes}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <EmployeeSheet
        open={editing}
        onClose={() => setEditing(false)}
        companyId={companyId}
        employee={employee}
        onDeleted={() => router.replace(`/empresa/${companyId}/funcionarios`)}
      />
    </AppShell>
  );
}
