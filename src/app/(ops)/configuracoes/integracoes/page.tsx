"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime, fmtRelative } from "@/lib/ops/format";
import { EVENT_STATUS_LABEL, INTEGRATION_ROUTES, useApiKeys, useIntegrationEvents, type ApiKey, type IntegrationEvent } from "@/lib/ops/modules/configuracoes";
import { useServiceRole } from "@/lib/ops/modules/usuarios";
import { Badge, Button, ConfirmSheet, DataTable, EmptyState, ErrorBox, InlineAlert, PageHeader, SectionCard, Skeleton, Tabs, toneFor, usePagination, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { CopyButton, NoPermission } from "@/components/ops/usuarios/Common";
import { ApiKeySheet } from "@/components/ops/configuracoes/ApiKeySheet";

type Tab = "chaves" | "rotas" | "eventos";

export default function IntegracoesPage() {
  const { company, canCompany } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("configuracoes.editar");
  const svc = useServiceRole();
  const keys = useApiKeys();
  const pg = usePagination(50);
  const events = useIntegrationEvents(pg.range, pg.page);
  const [tab, setTab] = useState<Tab>("chaves");
  const [sheet, setSheet] = useState(false);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("https://SEU-APP.vercel.app");
  useEffect(() => setOrigin(window.location.origin), []);
  useRealtimeInvalidate(["api_keys", "integration_events"]);

  async function revoke() {
    if (!toRevoke) return;
    setBusy(true);
    try {
      unwrap(await supabaseBrowser().from("api_keys").update({ active: false }).eq("id", toRevoke.id));
      notify("Chave revogada");
      invalidate("api_keys");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
      setToRevoke(null);
    }
  }

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Integrações" backHref="/configuracoes" />
        <NoPermission perm="configuracoes.editar" what="gerenciar integrações" />
      </div>
    );
  }

  const keyColumns: Column<ApiKey>[] = [
    { key: "name", label: "Nome", render: (k) => <span className="font-semibold">{k.name}</span> },
    { key: "scopes", label: "Escopos", render: (k) => <span className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone={s === "*" ? "red" : "blue"}>{s}</Badge>)}</span> },
    { key: "active", label: "Situação", align: "center", render: (k) => <Badge tone={k.active ? "green" : "red"}>{k.active ? "ativa" : "revogada"}</Badge> },
    { key: "last", label: "Último uso", hideOnMobile: true, render: (k) => <span className="text-slate-400" title={k.last_used_at ? fmtDateTime(k.last_used_at) : undefined}>{k.last_used_at ? fmtRelative(k.last_used_at) : "nunca"}</span> },
    { key: "created", label: "Criada em", hideOnMobile: true, render: (k) => <span className="text-slate-400">{fmtDateTime(k.created_at)}</span> },
    { key: "acoes", label: "", align: "right", render: (k) => (k.active ? <Button size="sm" variant="ghost" className="!text-rose-300" disabled={busy} onClick={() => setToRevoke(k)}>Revogar</Button> : null) },
  ];
  const eventColumns: Column<IntegrationEvent>[] = [
    { key: "created", label: "Quando", render: (e) => <span className="whitespace-nowrap text-slate-300">{fmtDateTime(e.created_at)}</span> },
    { key: "kind", label: "Evento", render: (e) => <span className="font-mono text-xs">{e.kind}</span> },
    { key: "provider", label: "Origem/destino", render: (e) => <span>{e.provider || "—"} <Badge tone={e.direction === "in" ? "cyan" : "violet"}>{e.direction === "in" ? "entrada" : "saída"}</Badge></span> },
    { key: "status", label: "Situação", align: "center", render: (e) => <Badge tone={toneFor(e.status === "processado" ? "concluido" : e.status)}>{EVENT_STATUS_LABEL[e.status]}</Badge> },
    { key: "erro", label: "Detalhe", hideOnMobile: true, render: (e) => <span className="block max-w-[320px] truncate text-xs text-slate-500" title={e.last_error || undefined}>{e.last_error || (e.attempts > 0 ? `${e.attempts} tentativa(s)` : "")}</span> },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Integrações"
        subtitle="Chaves de API, rotas disponíveis e fila de eventos (PDV, iFood, ERP, balança, BI…)"
        backHref="/configuracoes"
        icon="swap"
        actions={tab === "chaves" ? <Button variant="primary" onClick={() => setSheet(true)}><Icon name="plus" size={18} /> Nova chave</Button> : undefined}
      />

      {svc.data === false && (
        <InlineAlert tone="amber" icon="alert">
          As rotas de integração respondem <strong>501</strong> enquanto a variável <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> não estiver configurada na Vercel. Você já pode criar chaves; elas passam a funcionar após configurar e fazer o Redeploy.
        </InlineAlert>
      )}

      <SectionCard title="Como funciona" className="mb-4">
        <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--line)] bg-white/5 p-3">
            <p className="flex items-center gap-2 font-bold text-slate-100"><Icon name="lock" size={16} className="text-[var(--accent)]" /> 1. Chave de API</p>
            <p className="mt-1 text-xs text-slate-400">Cada sistema externo recebe uma chave com escopos limitados. Só o hash fica no banco; a chave aparece uma vez.</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-white/5 p-3">
            <p className="flex items-center gap-2 font-bold text-slate-100"><Icon name="swap" size={16} className="text-[var(--accent)]" /> 2. Rotas /api/ops/integrations</p>
            <p className="mt-1 text-xs text-slate-400">O sistema externo lê estoque e produtos ou envia baixas de venda. As mesmas regras do estoque valem (FEFO, lotes, auditoria).</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-white/5 p-3">
            <p className="flex items-center gap-2 font-bold text-slate-100"><Icon name="layers" size={16} className="text-[var(--accent)]" /> 3. Fila de eventos (outbox)</p>
            <p className="mt-1 text-xs text-slate-400">Tudo que entra ou sai fica registrado em <span className="font-mono">integration_events</span> com situação e erro, para conferência e reprocessamento.</p>
          </div>
        </div>
      </SectionCard>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "chaves", label: "Chaves de API", count: keys.data?.filter((k) => k.active).length }, { value: "rotas", label: "Rotas disponíveis", count: INTEGRATION_ROUTES.length }, { value: "eventos", label: "Eventos recentes", count: events.data?.total }]} />

      {tab === "chaves" && (
        keys.isError ? (
          <ErrorBox error={toOpsError(keys.error as Error).message} onRetry={() => void keys.refetch()} />
        ) : keys.isLoading ? (
          <Skeleton rows={2} />
        ) : (keys.data ?? []).length === 0 ? (
          <EmptyState emoji="🔑" title="Nenhuma chave de API" description="Crie uma chave para cada sistema externo (PDV, ERP, iFood…). Você escolhe o que cada uma pode fazer." action={<Button variant="primary" size="lg" onClick={() => setSheet(true)}>Nova chave</Button>} />
        ) : (
          <DataTable
            columns={keyColumns}
            rows={keys.data ?? []}
            mobileCard={(k) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold"><span className="truncate">{k.name}</span><Badge tone={k.active ? "green" : "red"}>{k.active ? "ativa" : "revogada"}</Badge></p>
                  <p className="mt-1 flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone={s === "*" ? "red" : "blue"}>{s}</Badge>)}</p>
                  <p className="mt-1 text-xs text-slate-500">Último uso: {k.last_used_at ? fmtRelative(k.last_used_at) : "nunca"} · criada {fmtRelative(k.created_at)}</p>
                </div>
                {k.active && <Button size="sm" variant="ghost" className="!text-rose-300" disabled={busy} onClick={() => setToRevoke(k)}>Revogar</Button>}
              </div>
            )}
          />
        )
      )}

      {tab === "rotas" && (
        <div className="space-y-3">
          <InlineAlert tone="blue" icon="info">
            Envie a chave no cabeçalho <span className="font-mono">Authorization: Bearer vr_…</span>. Endereço base: <span className="font-mono">{origin}</span>. Respostas em JSON com <span className="font-mono">{"{ ok, ... }"}</span>.
          </InlineAlert>
          {INTEGRATION_ROUTES.map((r) => {
            const example = r.example.replace("{origin}", origin);
            return (
              <div key={`${r.method} ${r.path}`} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.method === "GET" ? "green" : "amber"}>{r.method}</Badge>
                  <code className="font-mono text-sm text-slate-100">{r.path}</code>
                  <Badge tone="blue">escopo: {r.scope}</Badge>
                  <span className="ml-auto text-xs text-emerald-300">disponível para integração</span>
                </div>
                <p className="mt-1 text-sm font-semibold">{r.title}</p>
                <p className="text-xs text-slate-400">{r.description}</p>
                <div className="mt-2 flex items-start gap-2">
                  <pre className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-xl bg-black/40 p-3 text-[11px] text-slate-300">{example}</pre>
                  <CopyButton text={example} label="Copiar" size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "eventos" && (
        events.isError ? (
          <ErrorBox error={toOpsError(events.error as Error).message} onRetry={() => void events.refetch()} />
        ) : (
          <DataTable
            columns={eventColumns}
            rows={events.data?.rows ?? []}
            loading={events.isLoading || events.isFetching}
            total={events.data?.total}
            page={pg.page}
            pageSize={pg.pageSize}
            onPage={pg.setPage}
            emptyTitle="Nenhum evento ainda"
            emptyDescription="Os eventos aparecem aqui quando um sistema externo usar as rotas de integração ou quando o sistema gerar eventos de saída."
            mobileCard={(e) => (
              <div>
                <p className="flex items-center gap-2"><span className="font-mono text-xs font-semibold">{e.kind}</span><Badge tone={toneFor(e.status === "processado" ? "concluido" : e.status)}>{EVENT_STATUS_LABEL[e.status]}</Badge></p>
                <p className="text-xs text-slate-500">{fmtDateTime(e.created_at)} · {e.provider || "—"} · {e.direction === "in" ? "entrada" : "saída"}</p>
                {e.last_error && <p className="mt-1 truncate text-xs text-rose-300">{e.last_error}</p>}
              </div>
            )}
          />
        )
      )}

      <ApiKeySheet open={sheet} onClose={() => setSheet(false)} />
      <ConfirmSheet
        open={Boolean(toRevoke)}
        onClose={() => setToRevoke(null)}
        title="Revogar chave?"
        message={`A chave "${toRevoke?.name ?? ""}" deixará de funcionar imediatamente. O sistema externo que a usa perderá o acesso. Não dá para desfazer; crie uma nova chave se precisar.`}
        confirmLabel="Revogar"
        onConfirm={() => void revoke()}
      />
    </div>
  );
}
