"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { useProduct } from "@/lib/ops/hooks";
import { addDaysISO, downloadBlob, fmtDateTime, fmtMoney, fmtQty, toCSV, todayISO } from "@/lib/ops/format";
import { MOVEMENT_LABEL, type Movement, type MovementType, type Product } from "@/lib/ops/types";
import { isUuid, likeTerm, movementTone } from "@/lib/ops/modules/estoque";
import { Badge, Button, DataTable, ErrorBox, Field, PageHeader, Select, Skeleton, TextInput, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { ProductPicker } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { EstoqueSubnav } from "@/components/ops/estoque/Subnav";

const PAGE = 50;

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <MovimentacoesPage />
    </Suspense>
  );
}

/** Histórico de movimentações da unidade (view v_movements), com filtros e exportação. */
function MovimentacoesPage() {
  const { store } = useSession();
  const sp = useSearchParams();
  const productParam = sp.get("product");
  const preload = useProduct(productParam);

  const [type, setType] = useState<MovementType | "">("");
  const [product, setProduct] = useState<Product | null>(null);
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const [user, setUser] = useState("");
  const [reference, setReference] = useState("");
  const u = useDebounced(user.trim(), 300);
  const ref = useDebounced(reference.trim(), 300);
  const pg = usePagination(PAGE);
  const { setPage } = pg;

  useEffect(() => {
    if (preload.data && !product) setProduct(preload.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preload.data]);
  useEffect(() => setPage(0), [type, product?.id, from, to, u, ref, setPage]);

  const q = useQuery({
    queryKey: ["stock_movements", "list", store?.id, type, product?.id, from, to, u, ref, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("v_movements")
        .select("*", { count: "exact" })
        .eq("store_id", store!.id)
        .order("created_at", { ascending: false })
        .range(pg.range.from, pg.range.to);
      if (type) qb = qb.eq("movement_type", type);
      if (product) qb = qb.eq("product_id", product.id);
      // limites do dia no fuso do navegador (created_at é timestamptz)
      if (from) qb = qb.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) qb = qb.lt("created_at", new Date(`${addDaysISO(to, 1)}T00:00:00`).toISOString());
      if (u) qb = qb.ilike("created_by_name", likeTerm(u));
      if (ref) {
        if (isUuid(ref)) qb = qb.or(`reference_id.eq.${ref},lot_id.eq.${ref},id.eq.${ref}`);
        else qb = qb.or(`reference_type.ilike.${likeTerm(ref)},lot_code.ilike.${likeTerm(ref)},reason.ilike.${likeTerm(ref)}`);
      }
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as Movement[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["stock_items"], [["stock_movements"]]);

  const rows = q.data?.rows ?? [];

  function exportCsv() {
    const csv = toCSV(
      rows.map((r) => ({ ...r, created_at: fmtDateTime(r.created_at), movement_type: MOVEMENT_LABEL[r.movement_type] })),
      [
        { key: "created_at", label: "Data/hora" },
        { key: "movement_type", label: "Tipo" },
        { key: "internal_code", label: "Código" },
        { key: "product_name", label: "Produto" },
        { key: "lot_code", label: "Lote" },
        { key: "location_name", label: "Local" },
        { key: "quantity", label: "Quantidade" },
        { key: "unit", label: "Unidade" },
        { key: "unit_cost", label: "Custo unitário" },
        { key: "total_cost", label: "Custo total" },
        { key: "balance_after", label: "Saldo após" },
        { key: "created_by_name", label: "Usuário" },
        { key: "reason", label: "Motivo" },
        { key: "notes", label: "Observação" },
        { key: "reference_type", label: "Referência" },
        { key: "reference_id", label: "Ref. id" },
      ],
    );
    downloadBlob(`movimentacoes-${store?.code || "unidade"}-${from || "inicio"}-${to || "hoje"}.csv`, csv, "text/csv;charset=utf-8");
  }

  const columns: Column<Movement>[] = [
    { key: "created_at", label: "Data/hora", render: (r) => <span className="whitespace-nowrap tabular-nums text-slate-300">{fmtDateTime(r.created_at)}</span> },
    { key: "movement_type", label: "Tipo", render: (r) => <Badge tone={movementTone(r.movement_type, Number(r.quantity))}>{MOVEMENT_LABEL[r.movement_type]}</Badge> },
    {
      key: "product_name",
      label: "Produto",
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/estoque/produto/${r.product_id}`} className="block truncate font-semibold text-slate-100 hover:underline">{r.product_name}</Link>
          {r.internal_code && <span className="font-mono text-xs text-slate-500">{r.internal_code}</span>}
        </div>
      ),
    },
    { key: "lot_code", label: "Lote", render: (r) => <Link href={`/lote/${r.lot_id}`} className="font-mono text-[var(--accent)]">{r.lot_code || "—"}</Link> },
    { key: "location_name", label: "Local", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.location_name}</span> },
    {
      key: "quantity",
      label: "Quantidade",
      align: "right",
      render: (r) => <span className={`font-bold tabular-nums ${Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(r.quantity) >= 0 ? "+" : ""}{fmtQty(r.quantity, r.unit)}</span>,
    },
    { key: "total_cost", label: "Custo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.total_cost)}</span> },
    { key: "balance_after", label: "Saldo após", align: "right", render: (r) => <span className="tabular-nums text-slate-300">{fmtQty(r.balance_after, r.unit)}</span> },
    { key: "created_by_name", label: "Usuário", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.created_by_name || "—"}</span> },
    { key: "reason", label: "Motivo", hideOnMobile: true, render: (r) => <span className="block max-w-[220px] truncate text-slate-400" title={r.notes}>{r.reason || r.notes || "—"}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Movimentações"
        subtitle={store ? `Histórico de entradas e saídas · ${store.name}` : "Histórico"}
        icon="history"
        actions={
          <Button variant="soft" disabled={rows.length === 0} onClick={exportCsv}>
            <Icon name="download" size={18} /> <span className="hidden sm:inline">Exportar</span> CSV
          </Button>
        }
      />
      <EstoqueSubnav />

      <div className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-x-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Produto</span>
            <ProductPicker value={product} onChange={setProduct} placeholder="Todos os produtos" />
          </div>
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value as MovementType | "")}>
              <option value="">Todos os tipos</option>
              {(Object.keys(MOVEMENT_LABEL) as MovementType[]).map((k) => <option key={k} value={k}>{MOVEMENT_LABEL[k]}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="De"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Até"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label="Usuário"><TextInput value={user} onChange={(e) => setUser(e.target.value)} placeholder="Nome de quem registrou" /></Field>
          <Field label="Referência / lote / motivo" hint="Código do lote, motivo, tipo de referência ou id.">
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex.: L240915-001, receipt, contagem" />
          </Field>
        </div>
      </div>

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={q.isLoading || q.isFetching}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          emptyTitle="Nenhuma movimentação no período"
          emptyDescription="Amplie o período ou limpe os filtros. Toda entrada, consumo, perda, ajuste e transferência aparece aqui."
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.product_name}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                  <Badge tone={movementTone(r.movement_type, Number(r.quantity))}>{MOVEMENT_LABEL[r.movement_type]}</Badge>
                  <Link href={`/lote/${r.lot_id}`} className="font-mono text-[var(--accent)]">{r.lot_code}</Link>
                  <span>· {r.location_name}</span>
                </p>
                <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)} · {r.created_by_name || "—"}{r.reason ? ` · ${r.reason}` : ""}</p>
              </div>
              <div className="text-right">
                <p className={`font-bold tabular-nums ${Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(r.quantity) >= 0 ? "+" : ""}{fmtQty(r.quantity, r.unit)}</p>
                <p className="text-xs text-slate-500">saldo {fmtQty(r.balance_after)}</p>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
