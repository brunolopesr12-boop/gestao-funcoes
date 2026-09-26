"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { useSuppliers } from "@/lib/ops/hooks";
import { fmtDateTime, fmtMoney } from "@/lib/ops/format";
import { RECEIPT_RESULT_LABEL, RECEIPT_STATUS_LABEL, type ReceiptStatus } from "@/lib/ops/types";
import { embeddedCount, runListWithCount, safeLike, supplierIdsMatching, type ReceiptRow } from "@/lib/ops/modules/recebimento";
import { Icon } from "@/components/ops/Icon";
import { Badge, DataTable, ErrorBox, PageHeader, SearchInput, Tabs, TextInput, toneFor, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { LinkButton } from "@/components/ops/recebimento/shared";

const TABS: { value: ReceiptStatus; label: string }[] = [
  { value: "rascunho", label: RECEIPT_STATUS_LABEL.rascunho },
  { value: "finalizado", label: RECEIPT_STATUS_LABEL.finalizado },
  { value: "cancelado", label: RECEIPT_STATUS_LABEL.cancelado },
];

function ReceiptBadge({ r }: { r: ReceiptRow }) {
  if (r.status === "finalizado" && r.result) return <Badge tone={toneFor(r.result === "aprovado_ressalva" ? "ressalva" : r.result)}>{RECEIPT_RESULT_LABEL[r.result]}</Badge>;
  return <Badge tone={r.status === "rascunho" ? "amber" : toneFor(r.status)}>{RECEIPT_STATUS_LABEL[r.status]}</Badge>;
}

export default function ReceiptsPage() {
  const { store, can } = useSession();
  const suppliers = useSuppliers();
  const [tab, setTab] = useState<ReceiptStatus>("rascunho");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const pg = usePagination(50);

  useEffect(() => {
    pg.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, t, from, to]);

  const q = useQuery({
    queryKey: ["receipts", "list", store?.id, tab, t, from, to, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await runListWithCount<ReceiptRow>((withCount) => {
        const select: string = withCount ? "*, suppliers(id, name), receipt_items(count)" : "*, suppliers(id, name)";
        let qb = supabaseBrowser()
          .from("receipts")
          .select(select, { count: "exact" })
          .eq("store_id", store!.id)
          .eq("status", tab)
          .order("received_at", { ascending: false })
          .range(pg.range.from, pg.range.to);
        if (t.trim()) {
          const parts = [`number.ilike.${safeLike(t)}`, `invoice_number.ilike.${safeLike(t)}`];
          const ids = supplierIdsMatching(suppliers.data, t);
          if (ids.length > 0) parts.push(`supplier_id.in.(${ids.join(",")})`);
          qb = qb.or(parts.join(","));
        }
        if (from) qb = qb.gte("received_at", new Date(`${from}T00:00:00`).toISOString());
        if (to) qb = qb.lte("received_at", new Date(`${to}T23:59:59`).toISOString());
        return qb;
      });
      if (res.error) throw toOpsError(res.error);
      return { rows: res.rows, total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["receipts"]);

  const columns: Column<ReceiptRow>[] = [
    { key: "number", label: "Número", render: (r) => <span className="font-mono font-semibold">{r.number}</span> },
    { key: "received_at", label: "Data", render: (r) => <span className="tabular-nums">{fmtDateTime(r.received_at)}</span> },
    { key: "supplier", label: "Fornecedor", render: (r) => r.suppliers?.name ?? <span className="text-slate-500">—</span> },
    { key: "invoice_number", label: "NF", render: (r) => r.invoice_number || <span className="text-slate-500">—</span>, hideOnMobile: true },
    { key: "items", label: "Itens", align: "center", render: (r) => <span className="tabular-nums">{embeddedCount(r.receipt_items)}</span> },
    { key: "total", label: "Total", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.total)}</span> },
    { key: "status", label: "Situação", render: (r) => <ReceiptBadge r={r} /> },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Recebimento"
        subtitle="Conferência de mercadorias e entrada no estoque"
        icon="truck"
        actions={can("recebimento.criar") ? <LinkButton href="/recebimento/novo"><Icon name="plus" size={18} /> Novo recebimento</LinkButton> : undefined}
      />

      <Tabs value={tab} onChange={setTab} tabs={TABS} />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <SearchInput value={term} onChange={setTerm} placeholder="Número, nota fiscal ou fornecedor" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">de</span>
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">até</span>
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto" />
        </div>
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
          rowHref={(r) => `/recebimento/${r.id}`}
          emptyTitle={tab === "rascunho" ? "Nenhum recebimento em conferência" : tab === "finalizado" ? "Nenhum recebimento finalizado" : "Nenhum recebimento cancelado"}
          emptyDescription={tab === "rascunho" ? (can("recebimento.criar") ? "Toque em “Novo recebimento” quando a mercadoria chegar." : "Quando chegar mercadoria, quem tem permissão registra o recebimento aqui.") : "Ajuste a busca ou o período."}
          mobileCard={(r) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{r.number}</span>
                  <ReceiptBadge r={r} />
                </div>
                <p className="truncate text-sm text-slate-200">{r.suppliers?.name ?? "Sem fornecedor"}</p>
                <p className="text-xs text-slate-500">
                  {fmtDateTime(r.received_at)} · {embeddedCount(r.receipt_items)} item(ns){r.invoice_number ? ` · NF ${r.invoice_number}` : ""}
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
