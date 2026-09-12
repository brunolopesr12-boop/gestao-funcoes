"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ProgressBar, SectionTitle, Stat } from "@/components/ui";
import { useData } from "@/lib/store";
import { companyOverview } from "@/lib/selectors";

const NAV = [
  {
    href: "funcoes",
    emoji: "🧩",
    title: "Funções",
    desc: "O que cada função exige",
  },
  {
    href: "funcionarios",
    emoji: "👥",
    title: "Funcionários",
    desc: "Progresso de cada pessoa",
  },
  {
    href: "pendencias",
    emoji: "🎯",
    title: "O que preciso treinar?",
    desc: "Pendências prontas para marcar",
  },
  {
    href: "processos",
    emoji: "🔎",
    title: "Quem sabe fazer isso?",
    desc: "Quem pode substituir quem",
  },
  {
    href: "gerencial",
    emoji: "📊",
    title: "Visão gerencial",
    desc: "Riscos e cobertura operacional",
  },
  {
    href: "historico",
    emoji: "🕓",
    title: "Histórico",
    desc: "Quem treinou, quando e o quê",
  },
];

export default function CompanyHub() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, trainingIndex } = useData();

  const company = data.companies.find((c) => c.id === companyId);
  const ov = useMemo(
    () => companyOverview(data, trainingIndex, companyId),
    [data, trainingIndex, companyId],
  );

  if (!company) {
    return (
      <AppShell title="Empresa" backHref="/">
        <EmptyState emoji="🔍" title="Empresa não encontrada" />
      </AppShell>
    );
  }

  const total = ov.employees.length;
  const coberturaPct =
    ov.roles.length === 0
      ? 0
      : Math.round(
          (ov.roles.filter((r) => r.coverage.apt.length > 0).length / ov.roles.length) * 100,
        );
  const alertas =
    ov.rolesSemApto.length + ov.rolesSemFuncionario.length + ov.semFuncao;

  return (
    <AppShell
      title={`${company.emoji} ${company.name}`}
      subtitle={`${ov.roles.length} funções · ${total} funcionários`}
      backHref="/"
    >
      {/* Indicadores ------------------------------------------------ */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Aptos" value={ov.aptos} tone="green" emoji="🟢" />
        <Stat label="Treinando" value={ov.emTreinamento} tone="amber" emoji="🟡" />
        <Stat
          label="Não treinados"
          value={ov.naoTreinados + ov.semFuncao}
          tone="red"
          emoji="🔴"
        />
      </div>

      <div className="card mb-4 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-slate-300">
            Cobertura das funções
          </span>
          <span className="text-sm font-bold tabular-nums text-slate-200">
            {ov.roles.filter((r) => r.coverage.apt.length > 0).length}/{ov.roles.length}
          </span>
        </div>
        <ProgressBar value={coberturaPct} showLabel />
        <p className="mt-2 text-xs text-slate-400">
          Funções com pelo menos uma pessoa apta.
        </p>
      </div>

      {alertas > 0 && (
        <Link
          href={`/empresa/${companyId}/gerencial`}
          className="card card-hover mb-4 flex items-center gap-3 border-rose-500/30 bg-rose-500/10 p-4"
        >
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <p className="font-semibold text-rose-100">
              {alertas} {alertas === 1 ? "ponto de risco" : "pontos de risco"} operacional
            </p>
            <p className="text-xs text-rose-200/80">
              Toque para ver o que precisa de atenção
            </p>
          </div>
          <span className="text-xl text-rose-300">›</span>
        </Link>
      )}

      {/* Navegação -------------------------------------------------- */}
      <SectionTitle>Painel</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={`/empresa/${companyId}/${n.href}`}
            className="card card-hover flex flex-col gap-1 p-4"
          >
            <span className="text-3xl">{n.emoji}</span>
            <span className="mt-1 font-bold leading-tight">{n.title}</span>
            <span className="text-xs text-slate-400">{n.desc}</span>
            {n.href === "pendencias" && ov.pendingProcessCount > 0 && (
              <span className="mt-2 inline-flex w-fit rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                {ov.pendingProcessCount} pendentes
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Resumo por função ------------------------------------------ */}
      <div className="mt-8">
        <SectionTitle hint="Toque para abrir a função">Funções da empresa</SectionTitle>
        {ov.roles.length === 0 ? (
          <EmptyState
            emoji="🧩"
            title="Nenhuma função cadastrada"
            description="Cadastre as funções que essa empresa precisa ter."
          />
        ) : (
          <div className="space-y-2">
            {ov.roles.map(({ role, coverage, processes }) => {
              const dot =
                coverage.apt.length > 0
                  ? "🟢"
                  : coverage.training.length > 0
                    ? "🟡"
                    : "🔴";
              return (
                <Link
                  key={role.id}
                  href={`/empresa/${companyId}/funcoes/${role.id}`}
                  className="card card-hover flex items-center gap-3 p-3.5"
                >
                  <span className="text-2xl">{role.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{role.name}</p>
                    <p className="text-xs text-slate-400">
                      {coverage.apt.length} aptos · {coverage.training.length} treinando ·{" "}
                      {processes.length}{" "}
                      {processes.length === 1 ? "processo" : "processos"}
                    </p>
                  </div>
                  <span className="text-lg">{dot}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
