"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/ops/format";
import type { Product, ProductionStatus } from "@/lib/ops/types";
import { PRODUCTION_SELECT, PRODUCTION_TABS, matchingProductIds, productionDate, safeLike, type ProductionRow } from "@/lib/ops/modules/producao";
import { ProductPicker } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { Button, DataTable, ErrorBox, InlineAlert, PageHeader, SearchInput, Tabs, TextInput, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { LinkButton, ProductionStatusBadge, YieldBadge } from "@/components/ops/producao/shared";

/** Coluna de data conforme o status (prevista, início, conclusão, cancelamento). */
function DateCell({ p }: { p: ProductionRow }) {
  const d = productionDate(p);
  if (p.status === "planejada") return <span className="tabular-nums">{p.scheduled_for ? `prevista ${fmtDate(p.scheduled_for)}` : fmtDateTime(p.created_at)}</span>;
  return <span className="tabular-nums">{fmtDateTime(d)}</span>;
}

export default function ProductionsPage() {
  const { store, company, can } = useSession();
  const [tab, setTab] = useState<ProductionStatus>("planejada");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pg = usePagination(50);

  useEffect(() => {
    pg.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, t, from, to, product?.id]);

  const q = useQuery({
    queryKey: ["productions", "list", store?.id, tab, t, from, to, product?.id ?? null, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      // período: concluídas pela data de conclusão; demais pela data de criação
      const dateCol = tab === "concluida" ? "finished_at" : "created_at";
      let qb = supabaseBrowser()
        .from("productions")
        .select(PRODUCTION_SELECT, { count: "exact" })
        .eq("store_id", store!.id)
        .eq("status", tab)
        .order(tab === "planejada" ? "scheduled_for" : dateCol, { ascending: tab === "planejada", nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(pg.range.from, pg.range.to);
      if (product) qb = qb.eq("product_id", product.id);
      if (from) qb = qb.gte(dateCol, `${from}T00:00:00`);
      if (to) qb = qb.lte(dateCol, `${to}T23:59:59`);
      if (t.trim()) {
        const parts = [`number.ilike.${safeLike(t)}`, `lot_code.ilike.${safeLike(t)}`];
        const ids = company ? await matchingProductIds(company.id, t) : [];
        if (ids.length > 0) parts.push(`product_id.in.(${ids.join(",")})`);
        qb = qb.or(parts.join(","));
      }
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as ProductionRow[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["productions"]);

  const canCreate = can("producao.criar") || can("producao.finalizar");
  const hasFilters = Boolean(from || to || product);

  const columns: Column<ProductionRow>[] = [
    { key: "number", label: "Número", render: (p) => <span className="font-mono font-semibold">{p.number}</span> },
    {
      key: "product",
      label: "Produto",
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{p.products?.name ?? "—"}</p>
          <p className="truncate text-xs text-slate-500">{p.recipes ? `${p.recipes.name} · v${p.recipes.version}` : "sem ficha"}</p>
        </div>
      ),
    },
    { key: "planned", label: "Planejado", align: "right", render: (p) => <span className="tabular-nums">{fmtQty(p.planned_quantity, p.products?.units?.code)}</span> },
    { key: "produced", label: "Produzido", align: "right", render: (p) => (p.produced_quantity !== null && p.produced_quantity !== undefined ? <span className="font-semibold tabular-nums">{fmtQty(p.produced_quantity, p.products?.units?.code)}</span> : <span className="text-slate-500">—</span>) },
    { key: "yield", label: "Rendimento", align: "center", render: (p) => <YieldBadge pct={p.actual_yield_pct} /> },
    {
      key: "lot",
      label: "Lote",
      hideOnMobile: true,
      render: (p) =>
        p.lot_id ? (
          <Link href={`/lote/${p.lot_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[var(--accent)]">
            {p.lot?.lot_code || p.lot_code} <Icon name="chevronRight" size={12} />
          </Link>
        ) : (
          <span className="text-slate-500">—</span>
        ),
    },
    { key: "expires", label: "Validade", hideOnMobile: true, render: (p) => <span className="tabular-nums">{fmtDate(p.expires_at)}</span> },
    { key: "who", label: "Responsável", hideOnMobile: true, render: (p) => <span className="text-slate-300">{p.produced_by_name || p.created_by_name || "—"}</span> },
    { key: "date", label: "Data", render: (p) => <DateCell p={p} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Produção"
        subtitle={store?.name}
        icon="flame"
        actions={canCreate ? <LinkButton href="/producao/nova" icon="plus">Nova produção</LinkButton> : undefined}
      />
      {!can("producao.ver") && <InlineAlert tone="amber">Você não tem permissão para ver as produções desta unidade.</InlineAlert>}

      <Tabs value={tab} onChange={setTab} tabs={PRODUCTION_TABS} />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={term} onChange={setTerm} placeholder="Buscar por número, produto ou lote" className="sm:max-w-md sm:flex-1" />
        <Button variant={hasFilters ? "primary" : "soft"} onClick={() => setFiltersOpen((v) => !v)}>
          <Icon name="filter" size={16} /> Filtros{hasFilters ? " ativos" : ""}
        </Button>
      </div>

      {filtersOpen && (
        <div className="card mb-3 grid gap-3 p-3 sm:grid-cols-[1fr_1fr_2fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">{tab === "concluida" ? "Concluídas de" : "Criadas de"}</span>
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">até</span>
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-400">Produto</span>
            <ProductPicker value={product} onChange={setProduct} placeholder="Todos os produtos" />
          </div>
          {hasFilters && (
            <div className="sm:col-span-3">
              <Button size="sm" variant="ghost" onClick={() => { setFrom(""); setTo(""); setProduct(null); }}>Limpar filtros</Button>
            </div>
          )}
        </div>
      )}

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
          rowHref={(p) => `/producao/${p.id}`}
          emptyTitle={
            t || hasFilters
              ? "Nenhuma produção encontrada"
              : tab === "planejada" ? "Nenhuma produção planejada" : tab === "em_andamento" ? "Nenhuma produção em andamento" : tab === "concluida" ? "Nenhuma produção concluída" : "Nenhuma produção cancelada"
          }
          emptyDescription={t || hasFilters ? "Tente mudar a busca ou os filtros." : canCreate ? "Toque em “Nova produção”, escolha a ficha técnica e a quantidade." : "As produções registradas nesta unidade aparecem aqui."}
          mobileCard={(p) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{p.number}</span>
                  <ProductionStatusBadge status={p.status} />
                </p>
                <p className="truncate font-semibold">{p.products?.name ?? "—"}</p>
                <p className="text-xs text-slate-400 tabular-nums">
                  Planejado {fmtQty(p.planned_quantity, p.products?.units?.code)}
                  {p.produced_quantity !== null && p.produced_quantity !== undefined ? ` · produzido ${fmtQty(p.produced_quantity, p.products?.units?.code)}` : ""}
                  {p.lot_code ? ` · lote ${p.lot_code}` : ""}
                </p>
                <p className="text-xs text-slate-500">
                  <DateCell p={p} />
                  {p.produced_by_name || p.created_by_name ? ` · ${p.produced_by_name || p.created_by_name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <YieldBadge pct={p.actual_yield_pct} />
                <Icon name="chevronRight" className="text-slate-600" />
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
