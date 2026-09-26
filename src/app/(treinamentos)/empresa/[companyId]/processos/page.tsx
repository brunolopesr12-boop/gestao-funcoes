"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionTitle, TextInput } from "@/components/ui";
import { useData } from "@/lib/store";
import { companyRoles, processKnowledge, roleProcesses } from "@/lib/selectors";

export default function ProcessesPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, trainingIndex } = useData();
  const [query, setQuery] = useState("");

  const company = data.companies.find((c) => c.id === companyId);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companyRoles(data, companyId)
      .map((role) => ({
        role,
        processes: roleProcesses(data, role.id)
          .filter((p) => !q || p.name.toLowerCase().includes(q))
          .map((process) => {
            const rows = processKnowledge(data, trainingIndex, companyId, process.id);
            return {
              process,
              certificados: rows.filter((r) => r.status === "certificado").length,
              treinando: rows.filter((r) => r.status === "em_treinamento").length,
            };
          }),
      }))
      .filter((g) => g.processes.length > 0);
  }, [data, trainingIndex, companyId, query]);

  const total = groups.reduce((a, g) => a + g.processes.length, 0);

  return (
    <AppShell
      title="Quem sabe fazer isso?"
      subtitle={company?.name}
      backHref={`/empresa/${companyId}`}
    >
      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔎 Buscar processo… ex.: estrogonofe"
        className="mb-4"
      />

      {total === 0 ? (
        <EmptyState
          emoji="📋"
          title={query ? "Nenhum processo encontrado" : "Nenhum processo cadastrado"}
          description={
            query
              ? "Tente outro termo."
              : "Cadastre os processos dentro de cada função para poder acompanhar quem sabe fazer o quê."
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map(({ role, processes }) => (
            <div key={role.id}>
              <SectionTitle>
                {role.emoji} {role.name}
              </SectionTitle>
              <div className="space-y-2">
                {processes.map(({ process, certificados, treinando }) => (
                  <Link
                    key={process.id}
                    href={`/empresa/${companyId}/processos/${process.id}`}
                    className="card card-hover flex items-center gap-3 p-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{process.name}</p>
                      <p className="text-xs text-slate-400">
                        🟢 {certificados} certificados · 🟡 {treinando} em treinamento
                      </p>
                    </div>
                    {certificados === 0 ? (
                      <span className="shrink-0 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300">
                        ninguém
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
                        {certificados}
                      </span>
                    )}
                    <span className="text-slate-600">›</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
