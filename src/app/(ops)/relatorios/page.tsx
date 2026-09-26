"use client";

import Link from "next/link";
import { useSession } from "@/lib/ops/session";
import { REPORTS } from "@/lib/ops/modules/reports";
import { EmptyState, ErrorBox, PageHeader } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/** Hub de relatórios: um cartão para cada relatório. */
export default function RelatoriosPage() {
  const { store, can } = useSession();
  if (!store) return <ErrorBox error="Escolha uma unidade para ver os relatórios." />;
  if (!can("relatorios.ver")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Relatórios" icon="chart" />
        <EmptyState emoji="🔒" title="Sem permissão" description="Seu perfil não tem a permissão relatorios.ver nesta unidade. Fale com o gerente." />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Relatórios" subtitle={`${store.name} · exporte em CSV, Excel ou PDF${can("relatorios.exportar") ? "" : " (seu perfil só consulta na tela)"}`} icon="chart" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.key} href={`/relatorios/${r.key}`} className="card card-hover flex items-start gap-3 p-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--line)] bg-white/5 text-2xl">{r.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-base font-extrabold leading-tight">{r.title}</span>
                {r.modes.length > 1 && <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-400">{r.modes.length} visões</span>}
              </span>
              <span className="mt-1 block text-sm text-slate-400">{r.description}</span>
            </span>
            <Icon name="chevronRight" className="mt-1 shrink-0 text-slate-600" />
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/painel" className="card card-hover flex items-center gap-3 p-4">
          <Icon name="dashboard" className="text-[var(--accent)]" />
          <span className="min-w-0 flex-1"><span className="block font-bold">Painel gerencial</span><span className="block text-xs text-slate-400">Indicadores e gráficos do período</span></span>
          <Icon name="chevronRight" className="text-slate-600" />
        </Link>
        {can("auditoria.ver") && (
          <Link href="/auditoria" className="card card-hover flex items-center gap-3 p-4">
            <Icon name="history" className="text-[var(--accent)]" />
            <span className="min-w-0 flex-1"><span className="block font-bold">Auditoria</span><span className="block text-xs text-slate-400">Quem fez o quê, quando — com antes e depois</span></span>
            <Icon name="chevronRight" className="text-slate-600" />
          </Link>
        )}
      </div>
    </div>
  );
}
