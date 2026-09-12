"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleSheet } from "@/components/sheets";
import { Button, EmptyState, ProgressBar, StatusPill } from "@/components/ui";
import { useData } from "@/lib/store";
import { companyOverview } from "@/lib/selectors";

export default function RolesPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, trainingIndex, actions } = useData();
  const [creating, setCreating] = useState(false);
  const [reordering, setReordering] = useState(false);

  const company = data.companies.find((c) => c.id === companyId);
  const ov = useMemo(
    () => companyOverview(data, trainingIndex, companyId),
    [data, trainingIndex, companyId],
  );

  return (
    <AppShell
      title="Funções"
      subtitle={company?.name}
      backHref={`/empresa/${companyId}`}
      action={
        ov.roles.length > 1 ? (
          <Button size="sm" variant="ghost" onClick={() => setReordering((v) => !v)}>
            {reordering ? "Pronto" : "Reordenar"}
          </Button>
        ) : undefined
      }
    >
      {ov.roles.length === 0 ? (
        <EmptyState
          emoji="🧩"
          title="Nenhuma função ainda"
          description="Cadastre as funções que essa empresa precisa ter — atendente, caixa, montador de pedidos…"
          action={
            <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
              + Nova função
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {ov.roles.map(({ role, coverage, processes }, i) => {
            const pessoas = coverage.all.length;
            const pct =
              pessoas === 0 ? 0 : Math.round((coverage.apt.length / pessoas) * 100);
            return (
              <div key={role.id} className="card card-hover overflow-hidden">
                <Link
                  href={`/empresa/${companyId}/funcoes/${role.id}`}
                  className="block p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-2xl">
                      {role.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold leading-tight">
                        {role.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {processes.length}{" "}
                        {processes.length === 1 ? "processo" : "processos"} ·{" "}
                        {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"}
                      </p>
                    </div>
                    {coverage.apt.length > 0 ? (
                      <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
                        🟢 {coverage.apt.length} apto{coverage.apt.length > 1 ? "s" : ""}
                      </span>
                    ) : coverage.training.length > 0 ? (
                      <StatusPill status="em_treinamento" compact />
                    ) : (
                      <StatusPill status="nao_treinado" compact />
                    )}
                  </div>

                  <div className="mt-3">
                    <ProgressBar value={pct} showLabel />
                  </div>

                  {!coverage.hasProcesses && (
                    <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      ⚠️ Sem processos cadastrados — ninguém pode ser certificado nesta
                      função.
                    </p>
                  )}
                  {coverage.hasProcesses && coverage.apt.length === 0 && (
                    <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      🔴 Nenhum funcionário apto nesta função.
                    </p>
                  )}
                </Link>

                {reordering && (
                  <div className="flex gap-2 border-t border-[var(--line)] p-2">
                    <Button
                      size="sm"
                      full
                      disabled={i === 0}
                      onClick={() => void actions.moveRole(role.id, -1)}
                    >
                      ↑ Subir
                    </Button>
                    <Button
                      size="sm"
                      full
                      disabled={i === ov.roles.length - 1}
                      onClick={() => void actions.moveRole(role.id, 1)}
                    >
                      ↓ Descer
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          <Button variant="primary" size="lg" full onClick={() => setCreating(true)}>
            + Nova função
          </Button>
        </div>
      )}

      <RoleSheet
        open={creating}
        onClose={() => setCreating(false)}
        companyId={companyId}
        role={null}
      />
    </AppShell>
  );
}
