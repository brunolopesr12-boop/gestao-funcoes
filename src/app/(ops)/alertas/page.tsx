"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { rpc, unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import type { Alert, AlertKind, AlertSeverity } from "@/lib/ops/types";
import { ALERT_KIND_OPTIONS, SEVERITY_META, alertScopeFilter, useAlertCounts, type AlertTab } from "@/lib/ops/modules/gestao";
import { Button, ConfirmSheet, EmptyState, ErrorBox, Field, PageHeader, Select, Skeleton, Tabs, usePagination, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { AlertCard } from "@/components/ops/gestao/AlertCard";

const PAGE = 30;

/** Central de alertas da unidade (e alertas da empresa inteira). */
export default function AlertasPage() {
  const { store, company, stores, can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const sid = store?.id;
  const cid = company?.id;
  const [tab, setTab] = useState<AlertTab>("aberto");
  const [kind, setKind] = useState<"" | AlertKind>("");
  const [severity, setSeverity] = useState<"" | AlertSeverity>("");
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toResolve, setToResolve] = useState<Alert | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => setPage(0), [tab, kind, severity, setPage]);
  useRealtimeInvalidate(["alerts"]);

  // varredura silenciosa, uma vez por carga da tela (por unidade)
  useEffect(() => {
    if (!sid || !can("alertas.ver") || refreshedFor.current === sid) return;
    refreshedFor.current = sid;
    rpc("ops_refresh_alerts", { p_store: sid })
      .then(() => invalidate("alerts"))
      .catch(() => { /* silencioso: a lista continua funcionando */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const counts = useAlertCounts(sid, cid);
  const list = useQuery({
    queryKey: ["alerts", "list", sid, cid, tab, kind, severity, pg.page],
    enabled: Boolean(sid && cid),
    queryFn: async () => {
      let q = supabaseBrowser().from("alerts").select("*", { count: "exact" }).or(alertScopeFilter(sid!, cid!)).order("created_at", { ascending: false }).range(pg.range.from, pg.range.to);
      if (tab !== "todos") q = q.eq("status", tab);
      if (kind) q = q.eq("kind", kind);
      if (severity) q = q.eq("severity", severity);
      const res = await q;
      return { rows: unwrap(res) as Alert[], total: res.count ?? 0 };
    },
  });

  async function mark(a: Alert, status: "lido" | "resolvido") {
    setBusyId(a.id);
    try {
      await rpc("ops_alert_mark", { p_alert: a.id, p_status: status });
      notify(status === "lido" ? "Alerta marcado como lido" : "Alerta resolvido");
      invalidate("alerts");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    if (!sid) return;
    try {
      const n = await rpc<number>("ops_alerts_mark_all_read", { p_store: sid });
      notify(n > 0 ? `${n} alerta(s) marcado(s) como lido(s)` : "Nenhum alerta aberto nesta unidade", n > 0 ? "ok" : "info");
      invalidate("alerts");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  async function refreshNow() {
    if (!sid) return;
    setRefreshing(true);
    try {
      const r = await rpc<{ touched?: number }>("ops_refresh_alerts", { p_store: sid });
      notify(`Alertas atualizados${r?.touched !== undefined ? ` (${r.touched} verificado(s))` : ""}`);
      invalidate("alerts", "dashboard");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setRefreshing(false);
    }
  }

  if (!store) return <ErrorBox error="Escolha uma unidade para ver os alertas." />;
  if (!can("alertas.ver")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Alertas" icon="bell" />
        <EmptyState emoji="🔒" title="Sem permissão" description="Seu perfil não tem a permissão alertas.ver nesta unidade." />
      </div>
    );
  }

  const c = counts.data;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const storeName = (id: string | null) => (id === null ? null : id === sid ? store.name : (stores.find((s) => s.id === id)?.name ?? "Outra unidade"));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Alertas"
        subtitle={`${store.name} · vencimentos, estoque mínimo, temperatura, checklists, tarefas e recebimentos`}
        icon="bell"
        actions={
          <>
            <Button variant="soft" disabled={refreshing} onClick={() => void refreshNow()}><Icon name="refresh" size={16} /> Atualizar</Button>
            <Button variant="primary" disabled={(c?.aberto ?? 0) === 0} onClick={() => setConfirmAll(true)}><Icon name="check" size={16} /> Marcar todos como lidos</Button>
          </>
        }
      />

      <Tabs<AlertTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "aberto", label: "Abertos", count: c?.aberto },
          { value: "lido", label: "Lidos", count: c?.lido },
          { value: "resolvido", label: "Resolvidos", count: c?.resolvido },
          { value: "todos", label: "Todos", count: c?.todos },
        ]}
      />

      <div className="mb-3 grid grid-cols-2 gap-x-3">
        <Field label="Tipo">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "" | AlertKind)}>
            <option value="">Todos os tipos</option>
            {ALERT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Gravidade">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as "" | AlertSeverity)}>
            <option value="">Todas</option>
            {(["critico", "atencao", "info"] as AlertSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_META[s].dot} {SEVERITY_META[s].label}</option>)}
          </Select>
        </Field>
      </div>

      {list.isLoading ? (
        <Skeleton rows={4} />
      ) : list.error ? (
        <ErrorBox error={toOpsError(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji={tab === "aberto" ? "✅" : "📭"}
          title={tab === "aberto" ? "Nenhum alerta aberto" : "Nenhum alerta aqui"}
          description={tab === "aberto" ? "Tudo em ordem. Os alertas são gerados automaticamente ao abrir esta tela e pelas rotinas do sistema." : "Mude a aba ou os filtros para ver outros alertas."}
        />
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                storeName={a.store_id === sid ? undefined : storeName(a.store_id)}
                canRead={can("alertas.ver")}
                canResolve={can("alertas.resolver")}
                busy={busyId === a.id}
                onRead={(x) => void mark(x, "lido")}
                onResolve={(x) => setToResolve(x)}
              />
            ))}
          </div>
          {total > PAGE && (
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span className="tabular-nums">{total} alertas · página {pg.page + 1} de {pages}</span>
              <div className="flex gap-1">
                <button type="button" disabled={pg.page <= 0} onClick={() => setPage(pg.page - 1)} className="rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-40" aria-label="Anterior"><Icon name="chevronLeft" size={16} /></button>
                <button type="button" disabled={pg.page + 1 >= pages} onClick={() => setPage(pg.page + 1)} className="rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-40" aria-label="Próxima"><Icon name="chevronRight" size={16} /></button>
              </div>
            </div>
          )}
          {list.isFetching && <div className="mt-2 h-0.5 w-full animate-pulse bg-[var(--accent)]/60" />}
        </>
      )}

      <ConfirmSheet
        open={Boolean(toResolve)}
        title="Resolver alerta"
        message={toResolve ? `Confirma que "${toResolve.title}" foi resolvido? Ele sai da lista de abertos. Se o problema continuar, o sistema cria um novo alerta na próxima verificação.` : ""}
        confirmLabel="Resolver"
        onConfirm={() => { if (toResolve) void mark(toResolve, "resolvido"); }}
        onClose={() => setToResolve(null)}
      />
      <ConfirmSheet
        open={confirmAll}
        title="Marcar todos como lidos"
        message={`Todos os ${c?.aberto ?? 0} alerta(s) abertos de ${store.name} serão marcados como lidos. Eles continuam na aba "Lidos" até serem resolvidos.`}
        confirmLabel="Marcar como lidos"
        onConfirm={() => void markAllRead()}
        onClose={() => setConfirmAll(false)}
      />
    </div>
  );
}
