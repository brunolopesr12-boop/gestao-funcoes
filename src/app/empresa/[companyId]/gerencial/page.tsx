"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ProgressBar, SectionTitle, Stat } from "@/components/ui";
import { useData } from "@/lib/store";
import { companyOverview, stalledTrainings } from "@/lib/selectors";
import { fmtDate } from "@/lib/format";

export default function ManagementPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, trainingIndex } = useData();

  const company = data.companies.find((c) => c.id === companyId);
  const ov = useMemo(
    () => companyOverview(data, trainingIndex, companyId),
    [data, trainingIndex, companyId],
  );
  const stalled = useMemo(
    () => stalledTrainings(data, trainingIndex, companyId),
    [data, trainingIndex, companyId],
  );

  const cobertas = ov.roles.filter((r) => r.coverage.apt.length > 0).length;
  const coberturaPct =
    ov.roles.length === 0 ? 0 : Math.round((cobertas / ov.roles.length) * 100);

  const criticas = ov.roles.filter(
    (r) => r.coverage.hasProcesses && r.coverage.apt.length === 0,
  );
  const atencao = ov.roles.filter((r) => r.coverage.apt.length === 1);

  const semApto = ov.roles.length - cobertas;

  const veredito =
    ov.roles.length === 0
      ? { emoji: "⚪", text: "Cadastre as funções da empresa para avaliar a cobertura.", tone: "slate" }
      : semApto > 0
        ? {
            emoji: "🔴",
            text: `${semApto} ${semApto === 1 ? "função está" : "funções estão"} sem ninguém apto. Existe risco de parar a operação.`,
            tone: "red",
          }
        : atencao.length > 0
          ? {
              emoji: "🟡",
              text: `${atencao.length} ${atencao.length === 1 ? "função depende" : "funções dependem"} de uma única pessoa apta.`,
              tone: "amber",
            }
          : {
              emoji: "🟢",
              text: "Todas as funções têm pelo menos duas pessoas aptas. Operação coberta.",
              tone: "green",
            };

  const veredictoClass = {
    red: "border-rose-500/40 bg-rose-500/15 text-rose-100",
    amber: "border-amber-500/40 bg-amber-500/15 text-amber-100",
    green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-100",
    slate: "border-[var(--line)] bg-white/5 text-slate-200",
  }[veredito.tone as "red" | "amber" | "green" | "slate"];

  return (
    <AppShell
      title="Visão gerencial"
      subtitle={company?.name}
      backHref={`/empresa/${companyId}`}
    >
      <div className={`mb-5 rounded-2xl border p-5 ${veredictoClass}`}>
        <p className="text-xs font-bold uppercase tracking-wider opacity-70">
          Minha empresa está coberta?
        </p>
        <p className="mt-2 flex items-start gap-2 text-lg font-bold leading-snug">
          <span className="text-2xl">{veredito.emoji}</span>
          {veredito.text}
        </p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Funções" value={ov.roles.length} tone="blue" />
        <Stat label="Cobertas" value={cobertas} tone="green" />
        <Stat label="Sem apto" value={semApto} tone="red" />
      </div>

      <div className="card mb-6 p-4">
        <div className="mb-2 text-sm font-semibold text-slate-300">
          Cobertura operacional
        </div>
        <ProgressBar value={coberturaPct} showLabel />
      </div>

      {/* Funções necessárias ---------------------------------------- */}
      <SectionTitle hint="Situação de cada função da empresa">
        Funções necessárias
      </SectionTitle>
      {ov.roles.length === 0 ? (
        <EmptyState emoji="🧩" title="Nenhuma função cadastrada" />
      ) : (
        <div className="space-y-2">
          {ov.roles.map(({ role, coverage }) => {
            const dot =
              !coverage.hasProcesses
                ? "⚪"
                : coverage.apt.length >= 2
                  ? "🟢"
                  : coverage.apt.length === 1
                    ? "🟡"
                    : coverage.training.length > 0
                      ? "🟡"
                      : "🔴";
            const parts: string[] = [];
            if (coverage.apt.length > 0) parts.push(`${coverage.apt.length} apto${coverage.apt.length > 1 ? "s" : ""}`);
            if (coverage.training.length > 0)
              parts.push(`${coverage.training.length} em treinamento`);
            if (parts.length === 0)
              parts.push(coverage.all.length === 0 ? "sem funcionários" : "nenhum apto");

            return (
              <Link
                key={role.id}
                href={`/empresa/${companyId}/funcoes/${role.id}`}
                className="card card-hover flex items-center gap-3 p-3.5"
              >
                <span className="text-xl">{dot}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {role.emoji} {role.name}
                  </p>
                  <p className="text-xs text-slate-400">{parts.join(" / ")}</p>
                </div>
                <span className="text-slate-600">›</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Alertas ---------------------------------------------------- */}
      <div className="mt-8 space-y-5">
        <AlertBlock
          emoji="🔴"
          title="Funções sem ninguém apto"
          items={criticas.map((r) => ({
            id: r.role.id,
            label: `${r.role.emoji} ${r.role.name}`,
            hint:
              r.coverage.training.length > 0
                ? `${r.coverage.training.length} em treinamento`
                : "ninguém treinando",
            href: `/empresa/${companyId}/funcoes/${r.role.id}`,
          }))}
          emptyText="Todas as funções com processos têm alguém apto."
          tone="red"
        />

        <AlertBlock
          emoji="👻"
          title="Funções sem funcionários"
          items={ov.rolesSemFuncionario.map((r) => ({
            id: r.id,
            label: `${r.emoji} ${r.name}`,
            hint: "ninguém vinculado",
            href: `/empresa/${companyId}/funcoes/${r.id}`,
          }))}
          emptyText="Todas as funções têm pelo menos uma pessoa vinculada."
          tone="red"
        />

        <AlertBlock
          emoji="⚠️"
          title="Funções sem processos cadastrados"
          items={ov.rolesSemProcesso.map((r) => ({
            id: r.id,
            label: `${r.emoji} ${r.name}`,
            hint: "ninguém pode ser certificado",
            href: `/empresa/${companyId}/funcoes/${r.id}`,
          }))}
          emptyText="Todas as funções têm processos definidos."
          tone="amber"
        />

        <AlertBlock
          emoji="🙋"
          title="Funcionários sem função definida"
          items={ov.employees
            .filter((e) => e.bucket === "sem_funcao")
            .map((e) => ({
              id: e.employee.id,
              label: e.employee.name,
              hint: "definir função",
              href: `/empresa/${companyId}/funcionarios/${e.employee.id}`,
            }))}
          emptyText="Todos os funcionários têm função definida."
          tone="amber"
        />

        <AlertBlock
          emoji="🟡"
          title="Funcionários em treinamento"
          items={ov.employees
            .filter((e) => e.bucket === "em_treinamento")
            .map((e) => ({
              id: e.employee.id,
              label: e.employee.name,
              hint: `${e.pct}% · ${e.focus?.link.role.name ?? ""}`,
              href: `/empresa/${companyId}/funcionarios/${e.employee.id}`,
            }))}
          emptyText="Ninguém em treinamento no momento."
          tone="blue"
        />

        <AlertBlock
          emoji="⏳"
          title="Treinamentos parados há mais de 14 dias"
          items={stalled.map((s) => ({
            id: `${s.employee.id}-${s.process.id}`,
            label: `${s.employee.name} — ${s.process.name}`,
            hint: `parado há ${s.days} dias · último registro ${fmtDate(s.lastAt)}`,
            href: `/empresa/${companyId}/funcionarios/${s.employee.id}?funcao=${s.role.id}`,
          }))}
          emptyText="Nenhum treinamento parado."
          tone="amber"
        />
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

function AlertBlock({
  emoji,
  title,
  items,
  emptyText,
  tone,
}: {
  emoji: string;
  title: string;
  items: { id: string; label: string; hint?: string; href: string }[];
  emptyText: string;
  tone: "red" | "amber" | "blue";
}) {
  const border = {
    red: "border-rose-500/30",
    amber: "border-amber-500/30",
    blue: "border-blue-500/30",
  }[tone];

  return (
    <div>
      <SectionTitle>
        {emoji} {title}
        {items.length > 0 && (
          <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
            {items.length}
          </span>
        )}
      </SectionTitle>
      {items.length === 0 ? (
        <p className="card p-3.5 text-sm text-slate-500">✅ {emptyText}</p>
      ) : (
        <div className={`card divide-y divide-[var(--line)] ${border}`}>
          {items.map((it) => (
            <Link
              key={it.id}
              href={it.href}
              className="flex items-center gap-3 p-3.5 hover:bg-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{it.label}</p>
                {it.hint && <p className="truncate text-xs text-slate-400">{it.hint}</p>}
              </div>
              <span className="text-slate-600">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
