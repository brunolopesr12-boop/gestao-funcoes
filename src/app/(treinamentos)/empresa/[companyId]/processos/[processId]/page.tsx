"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { TrainingChips } from "@/components/TrainingChips";
import { EmptyState, SectionTitle, Stat, StatusPill } from "@/components/ui";
import { useData } from "@/lib/store";
import { processKnowledge } from "@/lib/selectors";
import { avatarTone, fmtDateTime, initials } from "@/lib/format";
import { STEP_META, STEPS } from "@/lib/types";

export default function ProcessDetail() {
  const { companyId, processId } = useParams<{ companyId: string; processId: string }>();
  const { data, trainingIndex } = useData();

  const process = data.processes.find((p) => p.id === processId);
  const role = process ? data.roles.find((r) => r.id === process.role_id) : undefined;
  const rows = useMemo(
    () => processKnowledge(data, trainingIndex, companyId, processId),
    [data, trainingIndex, companyId, processId],
  );

  if (!process) {
    return (
      <AppShell title="Processo" backHref={`/empresa/${companyId}/processos`}>
        <EmptyState emoji="🔍" title="Processo não encontrado" />
      </AppShell>
    );
  }

  const certificados = rows.filter((r) => r.status === "certificado");
  const treinando = rows.filter((r) => r.status === "em_treinamento");
  const naoTreinados = rows.filter((r) => r.status === "nao_iniciado");

  return (
    <AppShell
      title={process.name}
      subtitle={
        role ? (
          <Link href={`/empresa/${companyId}/funcoes/${role.id}`} className="underline">
            {role.emoji} {role.name}
          </Link>
        ) : undefined
      }
      backHref={`/empresa/${companyId}/processos`}
    >
      {process.description && (
        <p className="card mb-4 whitespace-pre-wrap p-4 text-sm text-slate-300">
          {process.description}
        </p>
      )}

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="Certificados" value={certificados.length} tone="green" emoji="🟢" />
        <Stat label="Treinando" value={treinando.length} tone="amber" emoji="🟡" />
        <Stat label="Não treinados" value={naoTreinados.length} tone="red" emoji="🔴" />
      </div>

      {certificados.length === 0 && (
        <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          🔴 <strong>Ninguém certificado neste processo.</strong> Se a pessoa que faz
          isso hoje faltar, a operação para.
        </div>
      )}

      <SectionTitle hint="Toque nas etapas para treinar direto daqui">
        Quem sabe fazer
      </SectionTitle>

      {rows.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="Nenhum funcionário nesta empresa"
          description="Cadastre funcionários para acompanhar quem sabe fazer o quê."
        />
      ) : (
        <div className="space-y-2">
          {rows.map(({ employee, status, doneSteps, linked }) => {
            const stepMap = trainingIndex.get(`${employee.id}::${processId}`) ?? {};
            const lastAt = STEPS.map((s) => stepMap[s]?.done_at)
              .filter(Boolean)
              .sort()
              .at(-1);
            return (
              <div key={employee.id} className="card p-3.5">
                <div className="mb-2.5 flex items-center gap-3">
                  <Link
                    href={`/empresa/${companyId}/funcionarios/${employee.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-xs font-bold ${avatarTone(employee.name)}`}
                    >
                      {initials(employee.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{employee.name}</p>
                        {!linked && (
                          <span className="shrink-0 rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
                            outra função
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {doneSteps.length > 0
                          ? `${doneSteps.map((s) => STEP_META[s].emoji).join(" ")} · ${fmtDateTime(lastAt)}`
                          : "sem registro"}
                      </p>
                    </div>
                  </Link>
                  <StatusPill status={status} compact />
                </div>
                <TrainingChips employeeId={employee.id} process={process} />
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
