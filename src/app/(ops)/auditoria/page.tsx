"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { downloadBlob, fmtDateTime, slug, toCSV, todayISO } from "@/lib/ops/format";
import type { AuditLog } from "@/lib/ops/types";
import { actionLabel, actionTone, entityLabel, fetchAuditPage, KNOWN_AUDIT_ENTITIES, useAuditFilters, type AuditQueryFilters } from "@/lib/ops/modules/gestao";
import { EXPORT_BATCH, EXPORT_MAX } from "@/lib/ops/modules/reports";
import { Badge, Button, DataTable, EmptyState, ErrorBox, Field, InlineAlert, PageHeader, Select, TextInput, usePagination, useDebounced, useToast, type Column } from "@/components/ops/ui";
import { MemberSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { AuditDetailDrawer } from "@/components/ops/gestao/AuditDetail";

const PAGE = 50;
const EMPTY: AuditQueryFilters = { from: todayISO(-29), to: todayISO(), userId: "", userText: "", entity: "", action: "", storeId: "", term: "" };

/** Trilha de auditoria da empresa (v_audit_logs). */
export default function AuditoriaPage() {
  const { company, stores, canCompany, displayName } = useSession();
  const notify = useToast();
  const cid = company?.id;
  const [f, setF] = useState<AuditQueryFilters>(EMPTY);
  const dUser = useDebounced(f.userText, 350);
  const dTerm = useDebounced(f.term, 350);
  const effective = useMemo(() => ({ ...f, userText: dUser, term: dTerm }), [f, dUser, dTerm]);
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState<{ loaded: number; total: number } | null>(null);
  const key = JSON.stringify(effective);
  useEffect(() => setPage(0), [key, setPage]);
  useRealtimeInvalidate(["audit_logs"]);

  const filters = useAuditFilters(cid);
  const entities = useMemo(() => {
    const found = new Set((filters.data?.entities ?? []).map((e) => e.entity));
    for (const k of KNOWN_AUDIT_ENTITIES) found.add(k);
    return Array.from(found).sort((a, b) => entityLabel(a).localeCompare(entityLabel(b)));
  }, [filters.data]);
  const actions = filters.data?.actions ?? [];
  const companyStores = useMemo(() => stores.filter((s) => s.company_id === cid), [stores, cid]);

  const q = useQuery({
    queryKey: ["audit_logs", "list", cid, key, pg.page],
    enabled: Boolean(cid),
    queryFn: () => fetchAuditPage(cid!, effective, pg.range.from, pg.range.to),
  });

  async function exportCsv() {
    if (!cid) return;
    setExporting({ loaded: 0, total: 0 });
    try {
      const all: AuditLog[] = [];
      let total = 0;
      for (let from = 0; from < EXPORT_MAX; from += EXPORT_BATCH) {
        const page = await fetchAuditPage(cid, effective, from, Math.min(from + EXPORT_BATCH, EXPORT_MAX) - 1);
        total = page.total;
        all.push(...page.rows);
        setExporting({ loaded: all.length, total });
        if (page.rows.length < EXPORT_BATCH || all.length >= total) break;
      }
      if (all.length === 0) return notify("Nada para exportar com esses filtros.", "info");
      if (total > EXPORT_MAX) notify(`A auditoria tem ${total.toLocaleString("pt-BR")} registros; só os primeiros ${EXPORT_MAX.toLocaleString("pt-BR")} foram exportados.`, "info");
      const cols = [
        { key: "created_at", label: "Data/hora" }, { key: "user_name", label: "Usuário" }, { key: "action", label: "Ação" }, { key: "entity", label: "Entidade" },
        { key: "entity_label", label: "Registro" }, { key: "entity_id", label: "ID do registro" }, { key: "store_name", label: "Unidade" }, { key: "detail", label: "Detalhe" },
        { key: "before", label: "Antes (JSON)" }, { key: "after", label: "Depois (JSON)" },
      ];
      const rows = all.map((a) => ({
        created_at: fmtDateTime(a.created_at), user_name: a.user_name || "Sistema", action: actionLabel(a.action), entity: entityLabel(a.entity), entity_label: a.entity_label,
        entity_id: a.entity_id ?? "", store_name: a.store_name ?? "Toda a empresa", detail: a.detail, before: a.before ? JSON.stringify(a.before) : "", after: a.after ? JSON.stringify(a.after) : "",
      }));
      const head = `Auditoria;${company?.name ?? ""};${effective.from} a ${effective.to};gerado por ${displayName} em ${fmtDateTime(new Date().toISOString())}\n`;
      downloadBlob(`auditoria-${slug(company?.name ?? "empresa")}-${todayISO()}.csv`, head + toCSV(rows, cols).replace(/^﻿/, ""), "text/csv;charset=utf-8");
      notify(`CSV gerado com ${all.length.toLocaleString("pt-BR")} registro(s)`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setExporting(null);
    }
  }

  if (!company) return <ErrorBox error="Escolha uma unidade para ver a auditoria." />;
  if (!canCompany("auditoria.ver")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Auditoria" icon="history" />
        <EmptyState emoji="🔒" title="Sem permissão" description="Seu perfil não tem a permissão auditoria.ver. Fale com o gerente." />
      </div>
    );
  }

  const columns: Column<AuditLog>[] = [
    { key: "created_at", label: "Data/hora", className: "whitespace-nowrap", render: (r) => fmtDateTime(r.created_at) },
    { key: "user_name", label: "Usuário", render: (r) => r.user_name || <span className="text-slate-500">Sistema</span> },
    { key: "action", label: "Ação", render: (r) => <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge> },
    { key: "entity", label: "Entidade", render: (r) => entityLabel(r.entity) },
    { key: "entity_label", label: "Registro", render: (r) => <span className="block max-w-[260px] truncate">{r.entity_label || r.detail || <span className="text-slate-500">—</span>}</span> },
    { key: "store_name", label: "Unidade", hideOnMobile: true, render: (r) => r.store_name ?? <span className="text-slate-500">Toda a empresa</span> },
  ];
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Auditoria"
        subtitle={`${company.name} · quem fez o quê, quando, com o antes e o depois`}
        icon="history"
        actions={<Button variant="soft" disabled={Boolean(exporting)} onClick={() => void exportCsv()}><Icon name="download" size={16} /> Exportar CSV</Button>}
      />
      <InlineAlert tone="blue" icon="lock">Registros de auditoria nunca são apagados. Correções geram novos registros; nada aqui pode ser editado.</InlineAlert>

      <section className="card mb-4 p-4">
        <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="De"><TextInput type="date" value={f.from} max={f.to} onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} /></Field>
          <Field label="Até"><TextInput type="date" value={f.to} min={f.from} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} /></Field>
          <Field label="Usuário"><MemberSelect value={f.userId} onChange={(v) => setF((x) => ({ ...x, userId: v }))} placeholder="Todos os usuários" /></Field>
          <Field label="Nome do usuário (texto)"><TextInput value={f.userText} onChange={(e) => setF((x) => ({ ...x, userText: e.target.value }))} placeholder="Parte do nome" /></Field>
          <Field label="Entidade">
            <Select value={f.entity} onChange={(e) => setF((x) => ({ ...x, entity: e.target.value }))}>
              <option value="">Todas as entidades</option>
              {entities.map((e) => {
                const n = filters.data?.entities.find((x) => x.entity === e)?.total;
                return <option key={e} value={e}>{entityLabel(e)}{n ? ` (${n})` : ""}</option>;
              })}
            </Select>
          </Field>
          <Field label="Ação">
            <Select value={f.action} onChange={(e) => setF((x) => ({ ...x, action: e.target.value }))}>
              <option value="">Todas as ações</option>
              {actions.map((a) => <option key={a.action} value={a.action}>{actionLabel(a.action)} ({a.total})</option>)}
              {f.action && !actions.some((a) => a.action === f.action) && <option value={f.action}>{actionLabel(f.action)}</option>}
            </Select>
          </Field>
          <Field label="Unidade">
            <Select value={f.storeId} onChange={(e) => setF((x) => ({ ...x, storeId: e.target.value }))}>
              <option value="">Todas as unidades</option>
              {companyStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Busca no registro / detalhe"><TextInput type="search" value={f.term} onChange={(e) => setF((x) => ({ ...x, term: e.target.value }))} placeholder="Nome do produto, lote, nota…" /></Field>
        </div>
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{q.isFetching ? "Consultando…" : q.data ? `${total.toLocaleString("pt-BR")} registro(s)` : ""}</p>
          <Button size="sm" variant="ghost" onClick={() => setF(EMPTY)}>Limpar filtros</Button>
        </div>
      </section>

      {exporting && <InlineAlert tone="blue" icon="download">Preparando CSV… {exporting.loaded.toLocaleString("pt-BR")}{exporting.total > 0 ? ` de ${Math.min(exporting.total, EXPORT_MAX).toLocaleString("pt-BR")}` : ""} registros.</InlineAlert>}

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable<AuditLog>
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          emptyTitle="Nenhum registro com esses filtros"
          emptyDescription="Amplie o período ou limpe os filtros. A auditoria registra criações, edições, exclusões e ações de negócio (recebimentos, produções, perdas, inventários…)."
          page={pg.page}
          pageSize={pg.pageSize}
          total={total}
          onPage={pg.setPage}
          onRowClick={(r) => setSelected(r)}
          mobileCard={(r) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge>
                  <span className="text-sm font-semibold">{entityLabel(r.entity)}</span>
                </p>
                <p className="truncate text-sm text-slate-300">{r.entity_label || r.detail || "—"}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)} · {r.user_name || "Sistema"}{r.store_name ? ` · ${r.store_name}` : ""}</p>
              </div>
              <Icon name="chevronRight" className="mt-1 shrink-0 text-slate-600" />
            </div>
          )}
        />
      )}

      <AuditDetailDrawer log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
