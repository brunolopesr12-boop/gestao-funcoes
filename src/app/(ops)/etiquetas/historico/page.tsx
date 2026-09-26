"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime } from "@/lib/ops/format";
import { LABEL_KIND_LABEL, type LabelKind } from "@/lib/ops/types";
import { LABEL_KINDS, type LabelRow } from "@/lib/ops/modules/labels";
import { Badge, DataTable, ErrorBox, IconButton, PageHeader, SearchInput, Select, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { PrintHelp } from "@/components/ops/etiquetas/shared";

const PAGE = 50;

/** Histórico de etiquetas emitidas na unidade (tabela imutável `labels`). */
export default function HistoricoPage() {
  const { store, can } = useSession();
  const canPrint = can("etiquetas.imprimir");
  const [term, setTerm] = useState("");
  const t = useDebounced(term, 300);
  const [kind, setKind] = useState<"" | LabelKind>("");
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [t, kind, setPage]);

  const q = useQuery({
    queryKey: ["labels", store?.id, t, kind, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("labels")
        .select("*, products(id, name, internal_code), stock_lots(id, lot_code, expires_at), label_templates(id, name)", { count: "exact" })
        .eq("store_id", store!.id)
        .order("printed_at", { ascending: false })
        .range(pg.range.from, pg.range.to);
      if (kind) qb = qb.eq("kind", kind);
      if (t.trim()) qb = qb.ilike("payload->>product_name", `%${t.trim().replace(/[%_,()]/g, " ")}%`);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as LabelRow[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["labels"]);

  const productName = (r: LabelRow) => r.products?.name || r.payload?.product_name || "—";
  const lotCode = (r: LabelRow) => r.stock_lots?.lot_code || r.payload?.lot_code || "";
  const reprintHref = (r: LabelRow) => (r.lot_id ? `/etiquetas/imprimir?lot=${r.lot_id}&kind=${r.kind}${r.template_id ? `&template=${r.template_id}` : ""}` : `/etiquetas/imprimir?label=${r.id}`);

  const columns: Column<LabelRow>[] = [
    { key: "printed_at", label: "Data", render: (r) => <span className="whitespace-nowrap tabular-nums text-slate-300">{fmtDateTime(r.printed_at)}</span> },
    {
      key: "product", label: "Produto",
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{productName(r)}</span>
          {!r.lot_id && <span className="text-[11px] text-slate-500">avulsa</span>}
        </span>
      ),
    },
    { key: "lot", label: "Lote", render: (r) => (r.lot_id ? <Link href={`/lote/${r.lot_id}`} className="font-mono font-semibold hover:underline">{lotCode(r) || "ver"}</Link> : <span className="font-mono text-slate-400">{lotCode(r) || "—"}</span>) },
    { key: "kind", label: "Tipo", render: (r) => <Badge tone="blue">{LABEL_KIND_LABEL[r.kind] ?? r.kind}</Badge> },
    { key: "copies", label: "Cópias", align: "right", render: (r) => <span className="font-bold tabular-nums">{r.copies}</span> },
    { key: "template", label: "Modelo", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.label_templates?.name ?? "—"}</span> },
    { key: "printed_by_name", label: "Quem imprimiu", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.printed_by_name || "—"}</span> },
    { key: "actions", label: "", align: "right", render: (r) => (canPrint ? <IconButton icon="printer" label="Reimprimir" href={reprintHref(r)} tone="primary" /> : null) },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader backHref="/etiquetas" title="Histórico de impressão" subtitle={store?.name} icon="history" />
      <PrintHelp compact />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_220px]">
        <SearchInput value={term} onChange={setTerm} placeholder="Buscar pelo nome do produto" />
        <Select value={kind} onChange={(e) => setKind(e.target.value as "" | LabelKind)}>
          <option value="">Todos os tipos</option>
          {LABEL_KINDS.map((k) => <option key={k} value={k}>{LABEL_KIND_LABEL[k]}</option>)}
        </Select>
      </div>
      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data?.rows ?? []}
          loading={q.isLoading}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          emptyTitle="Nenhuma etiqueta impressa ainda"
          emptyDescription={t || kind ? "Nenhuma etiqueta com esse filtro. Limpe a busca para ver tudo." : "As etiquetas impressas nesta unidade aparecem aqui, com data, lote, cópias e quem imprimiu."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{productName(r)}</p>
                <p className="text-xs text-slate-400">
                  {lotCode(r) ? <span className="font-mono">{lotCode(r)}</span> : "avulsa"} · {LABEL_KIND_LABEL[r.kind] ?? r.kind} · <strong className="text-slate-200">{r.copies}×</strong>
                </p>
                <p className="text-[11px] text-slate-500">{fmtDateTime(r.printed_at)} · {r.printed_by_name || "—"}</p>
              </div>
              {canPrint && <IconButton icon="printer" label="Reimprimir" href={reprintHref(r)} tone="primary" size={44} />}
            </div>
          )}
        />
      )}
    </div>
  );
}
