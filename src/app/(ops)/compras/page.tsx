"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { useSuppliers } from "@/lib/ops/hooks";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/ops/format";
import { PO_STATUS_LABEL, type PurchaseOrderStatus } from "@/lib/ops/types";
import { embeddedCount, runListWithCount, safeLike, supplierIdsMatching, type PurchaseOrderRow } from "@/lib/ops/modules/recebimento";
import { SupplierSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { DataTable, ErrorBox, PageHeader, SearchInput, Tabs, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { LinkButton, PoStatusBadge } from "@/components/ops/recebimento/shared";

type Tab = "abertos" | PurchaseOrderStatus | "todos";
const TABS: { value: Tab; label: string }[] = [
  { value: "abertos", label: "Em aberto" },
  ...(Object.keys(PO_STATUS_LABEL) as PurchaseOrderStatus[]).map((s) => ({ value: s as Tab, label: PO_STATUS_LABEL[s] })),
  { value: "todos", label: "Todos" },
];

export default function PurchaseOrdersPage() {
  const { store, can } = useSession();
  const suppliers = useSuppliers();
  const [tab, setTab] = useState<Tab>("abertos");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const [supplierId, setSupplierId] = useState("");
  const pg = usePagination(50);

  useEffect(() => {
    pg.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, t, supplierId]);

  const q = useQuery({
    queryKey: ["purchase_orders", "list", store?.id, tab, t, supplierId, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await runListWithCount<PurchaseOrderRow>((withCount) => {
        const select: string = withCount ? "*, suppliers(id, name), purchase_order_items(count)" : "*, suppliers(id, name)";
        let qb = supabaseBrowser()
          .from("purchase_orders")
          .select(select, { count: "exact" })
          .eq("store_id", store!.id)
          .order("created_at", { ascending: false })
          .range(pg.range.from, pg.range.to);
        if (tab === "abertos") qb = qb.in("status", ["rascunho", "solicitado", "aprovado", "pedido"]);
        else if (tab !== "todos") qb = qb.eq("status", tab);
        if (supplierId) qb = qb.eq("supplier_id", supplierId);
        if (t.trim()) {
          const parts = [`number.ilike.${safeLike(t)}`, `notes.ilike.${safeLike(t)}`];
          const ids = supplierIdsMatching(suppliers.data, t);
          if (ids.length > 0) parts.push(`supplier_id.in.(${ids.join(",")})`);
          qb = qb.or(parts.join(","));
        }
        return qb;
      });
      if (res.error) throw toOpsError(res.error);
      return { rows: res.rows, total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["purchase_orders"]);

  const columns: Column<PurchaseOrderRow>[] = [
    { key: "number", label: "Número", render: (r) => <span className="font-mono font-semibold">{r.number}</span> },
    { key: "created_at", label: "Criado em", render: (r) => <span className="tabular-nums">{fmtDateTime(r.created_at)}</span> },
    { key: "supplier", label: "Fornecedor", render: (r) => r.suppliers?.name ?? <span className="text-slate-500">—</span> },
    { key: "expected_at", label: "Previsão", render: (r) => <span className="tabular-nums">{fmtDate(r.expected_at)}</span>, hideOnMobile: true },
    { key: "items", label: "Itens", align: "center", render: (r) => <span className="tabular-nums">{embeddedCount(r.purchase_order_items)}</span> },
    { key: "total", label: "Total", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.total)}</span> },
    { key: "status", label: "Situação", render: (r) => <PoStatusBadge status={r.status} /> },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Pedidos de compra"
        subtitle="Do pedido ao recebimento"
        icon="file"
        actions={
          <>
            <LinkButton href="/reposicao" variant="soft"><Icon name="cart" size={18} /> Reposição</LinkButton>
            {can("compras.criar") && <LinkButton href="/compras/novo"><Icon name="plus" size={18} /> Novo pedido</LinkButton>}
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_260px]">
        <SearchInput value={term} onChange={setTerm} placeholder="Número, fornecedor ou observação" />
        <SupplierSelect value={supplierId} onChange={setSupplierId} placeholder="Todos os fornecedores" />
      </div>
      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data?.rows ?? []}
          loading={q.isLoading || q.isFetching}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          rowHref={(r) => `/compras/${r.id}`}
          emptyTitle="Nenhum pedido por aqui"
          emptyDescription={can("compras.criar") ? "Crie um pedido ou use a Reposição para gerar pedidos a partir do estoque mínimo." : "Ajuste os filtros para ver outros pedidos."}
          mobileCard={(r) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{r.number}</span>
                  <PoStatusBadge status={r.status} />
                </div>
                <p className="truncate text-sm text-slate-200">{r.suppliers?.name ?? "Sem fornecedor"}</p>
                <p className="text-xs text-slate-500">
                  {fmtDate(r.created_at)} · {embeddedCount(r.purchase_order_items)} item(ns){r.expected_at ? ` · previsão ${fmtDate(r.expected_at)}` : ""}
                </p>
              </div>
              <span className="font-bold tabular-nums">{fmtMoney(r.total)}</span>
            </div>
          )}
        />
      )}
    </div>
  );
}
