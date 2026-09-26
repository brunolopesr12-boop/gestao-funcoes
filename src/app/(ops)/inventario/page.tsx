"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime } from "@/lib/ops/format";
import type { InventoryCountStatus } from "@/lib/ops/types";
import { countScopeLabel, useCountStatusTotals, type CountRow } from "@/lib/ops/modules/inventario";
import { Button, DataTable, ErrorBox, PageHeader, Tabs, usePagination, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NewCountSheet } from "@/components/ops/inventario/NewCountSheet";
import { CountKindBadge, DiffValue } from "@/components/ops/inventario/shared";

const PAGE = 50;

/** Contagens de estoque da unidade: em contagem, finalizadas e canceladas. */
export default function InventarioPage() {
  const { store, can } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<InventoryCountStatus>("aberta");
  const [newOpen, setNewOpen] = useState(false);
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [tab, setPage]);

  const totals = useCountStatusTotals(store?.id);
  const q = useQuery({
    queryKey: ["inventory_counts", "list", store?.id, tab, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await supabaseBrowser()
        .from("inventory_counts")
        .select("*, stock_locations(id, name), categories(id, name)", { count: "exact" })
        .eq("store_id", store!.id)
        .eq("status", tab)
        .order("created_at", { ascending: false })
        .range(pg.range.from, pg.range.to);
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as CountRow[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["inventory_counts"]);

  const canCount = can("inventario.contar");
  const rows = q.data?.rows ?? [];

  const columns: Column<CountRow>[] = [
    { key: "number", label: "Número", render: (r) => <span className="font-mono font-semibold text-slate-100">{r.number}</span> },
    { key: "kind", label: "Tipo", render: (r) => <CountKindBadge kind={r.kind} /> },
    { key: "location", label: "Local", render: (r) => <span className="text-slate-200">{countScopeLabel(r)}</span> },
    { key: "items_count", label: "Itens", align: "right", render: (r) => <span className="tabular-nums">{r.items_count}</span> },
    { key: "differences", label: "Diferenças", align: "right", render: (r) => <span className={`tabular-nums ${r.differences > 0 ? "font-semibold text-amber-300" : "text-slate-400"}`}>{r.differences}</span> },
    { key: "difference_value", label: "Valor da diferença", align: "right", render: (r) => <DiffValue diff={Number(r.difference_value)} money className="!font-semibold" /> },
    { key: "started_by_name", label: "Iniciado por", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.started_by_name || "—"}</span> },
    { key: "created_at", label: tab === "finalizada" ? "Finalizada em" : "Data", render: (r) => <span className="tabular-nums text-slate-300">{fmtDateTime(tab === "finalizada" ? r.finished_at : r.created_at)}</span> },
  ];

  const emptyByTab: Record<InventoryCountStatus, { title: string; description: string }> = {
    aberta: { title: "Nenhuma contagem em andamento", description: canCount ? "Toque em “Nova contagem” para começar, ou use o modo rápido pelo celular em “Contar”." : "Quando alguém abrir uma contagem, ela aparece aqui." },
    finalizada: { title: "Nenhuma contagem finalizada", description: "As contagens finalizadas ficam aqui com o relatório das diferenças." },
    cancelada: { title: "Nenhuma contagem cancelada", description: "Contagens canceladas não alteram o estoque." },
  };

  return (
    <div>
      <PageHeader
        title="Inventário"
        subtitle={store ? `Contagens de estoque · ${store.name}` : "Contagens de estoque"}
        icon="clipboard"
        actions={
          <>
            {canCount && (
              <Link href="/contar" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 text-[15px] font-medium text-slate-100 hover:bg-white/10 lg:hidden">
                <Icon name="scan" size={18} /> Contar agora
              </Link>
            )}
            {canCount && (
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={18} /> Nova contagem
              </Button>
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "aberta", label: "Em contagem", count: totals.data?.aberta },
          { value: "finalizada", label: "Finalizadas", count: totals.data?.finalizada },
          { value: "cancelada", label: "Canceladas", count: totals.data?.cancelada },
        ]}
      />

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          rowHref={(r) => `/inventario/${r.id}`}
          emptyTitle={emptyByTab[tab].title}
          emptyDescription={emptyByTab[tab].description}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{r.number}</span>
                  <CountKindBadge kind={r.kind} />
                </p>
                <p className="truncate text-sm text-slate-300">{countScopeLabel(r)}</p>
                <p className="text-xs text-slate-500">
                  {r.items_count} itens · {r.differences} diferenças · {r.started_by_name || "—"} · {fmtDateTime(r.created_at)}
                </p>
              </div>
              <div className="text-right">
                <DiffValue diff={Number(r.difference_value)} money />

              </div>
              <Icon name="chevronRight" className="text-slate-600" />
            </div>
          )}
        />
      )}

      <NewCountSheet open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => router.push(`/inventario/${id}`)} />
    </div>
  );
}
