"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtTime, todayISO } from "@/lib/ops/format";
import { CHECKLIST_KIND_LABEL, FREQUENCY_LABEL, WEEKDAYS } from "@/lib/ops/types";
import { useChecklistModels, type ChecklistRow } from "@/lib/ops/modules/rotinas";
import { Badge, Button, DataTable, EmptyState, ErrorBox, InlineAlert, PageHeader, SearchInput, Skeleton, Toggle, useDebounced, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { RotinasSubnav } from "@/components/ops/rotinas/Subnav";

function scheduleText(c: ChecklistRow): string {
  if (c.frequency === "mensal") return `dia ${c.month_day ?? 1}`;
  if (c.frequency === "sob_demanda") return "—";
  const days = (c.weekdays ?? []).slice().sort();
  if (days.length === 7) return "todos os dias";
  if (days.length === 0) return "nenhum dia";
  return days.map((d) => WEEKDAYS[d]).join(", ");
}

export default function ModelosPage() {
  const { store, canCompany, can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("checklists.editar");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const [showInactive, setShowInactive] = useState(false);
  const q = useChecklistModels({ includeInactive: true });
  useRealtimeInvalidate(["checklists", "checklist_tasks"]);

  const rows = useMemo(() => {
    const needle = t.trim().toLowerCase();
    return (q.data ?? []).filter((c) => (showInactive || c.active) && (!needle || c.name.toLowerCase().includes(needle) || CHECKLIST_KIND_LABEL[c.kind].toLowerCase().includes(needle)));
  }, [q.data, t, showInactive]);

  const [generating, setGenerating] = useState(false);
  async function generateToday() {
    if (!store) return;
    setGenerating(true);
    try {
      const n = await rpc<number>("ops_generate_checklists", { p_store: store.id, p_date: todayISO() });
      notify(n > 0 ? `${n} execução(ões) gerada(s) para hoje em ${store.name}` : "Nada novo: as execuções de hoje já existiam (ou nenhum modelo está previsto para hoje).", n > 0 ? "ok" : "info");
      invalidate("checklist_executions", "checklist_execution_items");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setGenerating(false);
    }
  }

  const columns: Column<ChecklistRow>[] = [
    { key: "name", label: "Nome", render: (c) => <span className="font-semibold">{c.name}{!c.active && <Badge tone="slate" className="ml-2">inativo</Badge>}</span> },
    { key: "kind", label: "Tipo", render: (c) => CHECKLIST_KIND_LABEL[c.kind] },
    { key: "frequency", label: "Frequência", render: (c) => <span>{FREQUENCY_LABEL[c.frequency]} <span className="text-xs text-slate-500">· {scheduleText(c)}</span></span> },
    { key: "scheduled_time", label: "Horário", hideOnMobile: true, render: (c) => (c.scheduled_time ? fmtTime(c.scheduled_time) : <span className="text-slate-500">—</span>) },
    { key: "store", label: "Unidade", render: (c) => c.stores?.name ?? <span className="text-slate-400">Todas</span> },
    { key: "tasks", label: "Tarefas", align: "right", render: (c) => <span className="tabular-nums">{c.checklist_tasks?.[0]?.count ?? 0}</span> },
    { key: "mandatory", label: "Obrigatório", align: "center", hideOnMobile: true, render: (c) => (c.mandatory ? <Badge tone="amber">sim</Badge> : <span className="text-slate-500">não</span>) },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Modelos de checklist"
        subtitle="Defina as rotinas e suas tarefas; as execuções do dia são geradas automaticamente"
        backHref="/checklists"
        icon="list"
        actions={
          <>
            {can("checklists.ver") && store && (
              <Button variant="soft" disabled={generating} onClick={() => void generateToday()}><Icon name="refresh" size={16} /> {generating ? "Gerando…" : "Gerar execuções de hoje"}</Button>
            )}
            {canEdit && <Link href="/checklists/modelos/novo" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[15px] font-semibold text-white"><Icon name="plus" size={16} /> Novo modelo</Link>}
          </>
        }
      />
      <RotinasSubnav area="checklists" />
      {!canEdit && <InlineAlert tone="blue" icon="info">Você pode consultar os modelos. Para criar ou alterar, é preciso a permissão “checklists.editar”.</InlineAlert>}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={term} onChange={setTerm} placeholder="Buscar por nome ou tipo" className="flex-1" />
        <div className="sm:w-56"><Toggle checked={showInactive} onChange={setShowInactive} label="Mostrar inativos" /></div>
      </div>

      {q.isLoading ? (
        <Skeleton rows={3} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📋"
          title={t ? "Nenhum modelo encontrado" : "Nenhum modelo de checklist"}
          description="Crie modelos como Abertura da cozinha, Fechamento, Limpeza semanal… e cadastre as tarefas de cada um."
          action={canEdit ? <Link href="/checklists/modelos/novo" className="rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-white">Criar primeiro modelo</Link> : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowHref={(c) => `/checklists/modelos/${c.id}`}
          mobileCard={(c) => (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.name} {!c.active && <Badge tone="slate">inativo</Badge>}</p>
                <p className="text-xs text-slate-400">{CHECKLIST_KIND_LABEL[c.kind]} · {FREQUENCY_LABEL[c.frequency]} · {scheduleText(c)}{c.scheduled_time ? ` · ${fmtTime(c.scheduled_time)}` : ""}</p>
                <p className="text-xs text-slate-500">{c.stores?.name ?? "Todas as unidades"} · {c.checklist_tasks?.[0]?.count ?? 0} tarefa(s){c.mandatory ? " · obrigatório" : ""}</p>
              </div>
              <Icon name="chevronRight" className="shrink-0 text-slate-600" />
            </div>
          )}
        />
      )}
    </div>
  );
}
