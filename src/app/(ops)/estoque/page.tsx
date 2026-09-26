"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { downloadBlob, fmtDate, fmtMoney, fmtQty, LEVEL_META, toCSV, todayISO } from "@/lib/ops/format";
import { PRODUCT_KIND_LABEL, type ProductKind, type StockByProduct, type StockLevel } from "@/lib/ops/types";
import { LEVEL_OPTIONS, daysUntil, likeTerm, useStockKpis } from "@/lib/ops/modules/estoque";
import { Badge, Button, DataTable, ErrorBox, KpiCard, LevelDot, PageHeader, SearchInput, Select, Toggle, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { CategorySelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { ManualEntryDrawer } from "@/components/ops/estoque/ManualEntryDrawer";
import { EstoqueSubnav } from "@/components/ops/estoque/Subnav";

const PAGE = 50;
type Row = StockByProduct & { id: string };

/** Estoque consolidado por produto na unidade atual (view v_stock_by_product). */
export default function EstoquePage() {
  const { store, can } = useSession();
  const [term, setTerm] = useState("");
  const t = useDebounced(term.trim(), 300);
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState<StockLevel | "abaixo" | "">("");
  const [kind, setKind] = useState<ProductKind | "">("");
  const [onlyStock, setOnlyStock] = useState(true);
  const [entryOpen, setEntryOpen] = useState(false);
  const pg = usePagination(PAGE);
  const { setPage } = pg;

  useEffect(() => setPage(0), [t, category, level, kind, onlyStock, setPage]);

  const kpis = useStockKpis(store?.id);

  const q = useQuery({
    queryKey: ["stock_items", "by_product", store?.id, t, category, level, kind, onlyStock, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("v_stock_by_product")
        .select("*", { count: "exact" })
        .eq("store_id", store!.id)
        .order("product_name")
        .range(pg.range.from, pg.range.to);
      qb = onlyStock ? qb.or("quantity.gt.0,expired_quantity.gt.0,blocked_quantity.gt.0") : qb.or("active.eq.true,quantity.gt.0");
      if (t) {
        const like = likeTerm(t);
        const raw = /^\S+$/.test(t) ? t.replace(/[,()]/g, "") : "";
        qb = qb.or(`product_name.ilike.${like},internal_code.ilike.${like}${raw ? `,barcode.eq.${raw}` : ""}`);
      }
      if (category) qb = qb.eq("category_id", category);
      if (level === "abaixo") qb = qb.in("level", ["baixo", "critico"]);
      else if (level) qb = qb.eq("level", level);
      if (kind) qb = qb.eq("product_kind", kind);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: ((res.data ?? []) as StockByProduct[]).map((r) => ({ ...r, id: r.product_id })) as Row[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["stock_items", "stock_lots"], [["stock_items"], ["stock_lots"], ["stock_movements"]]);

  const rows = q.data?.rows ?? [];
  const hasFilter = Boolean(t || category || level || kind);

  function exportCsv() {
    const csv = toCSV(
      rows.map((r) => ({
        ...r,
        product_kind: PRODUCT_KIND_LABEL[r.product_kind],
        level: LEVEL_META[r.level].label,
        next_expiry: r.next_expiry ? fmtDate(r.next_expiry) : "",
      })),
      [
        { key: "internal_code", label: "Código" },
        { key: "product_name", label: "Produto" },
        { key: "category_name", label: "Categoria" },
        { key: "product_kind", label: "Tipo" },
        { key: "quantity", label: "Quantidade" },
        { key: "unit", label: "Unidade" },
        { key: "lots_count", label: "Lotes" },
        { key: "next_expiry", label: "Próxima validade" },
        { key: "expired_quantity", label: "Qtd. vencida" },
        { key: "blocked_quantity", label: "Qtd. bloqueada" },
        { key: "min_stock", label: "Mínimo" },
        { key: "max_stock", label: "Máximo" },
        { key: "reorder_point", label: "Ponto de reposição" },
        { key: "cost", label: "Custo unitário" },
        { key: "total_value", label: "Valor total" },
        { key: "level", label: "Nível" },
      ],
    );
    downloadBlob(`estoque-${store?.code || "unidade"}-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
  }

  const expiryTone = (iso: string | null) => {
    const d = daysUntil(iso);
    if (d === null) return "text-slate-400";
    if (d <= 0) return "text-rose-300 font-semibold";
    if (d <= 3) return "text-amber-300 font-semibold";
    if (d <= 7) return "text-yellow-200";
    return "text-slate-200";
  };

  const columns: Column<Row>[] = [
    {
      key: "product_name",
      label: "Produto",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{r.product_name}</p>
          <p className="text-xs text-slate-500">
            {r.internal_code && <span className="mr-2 font-mono">{r.internal_code}</span>}
            {PRODUCT_KIND_LABEL[r.product_kind]}
            {!r.active && <span className="ml-2 text-rose-300">inativo</span>}
          </p>
        </div>
      ),
    },
    { key: "category_name", label: "Categoria", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.category_name ?? "—"}</span> },
    {
      key: "quantity",
      label: "Quantidade",
      align: "right",
      render: (r) => (
        <div>
          <span className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</span>
          {Number(r.expired_quantity) > 0 && <span className="block text-[11px] text-rose-300">+{fmtQty(r.expired_quantity)} vencido</span>}
          {Number(r.blocked_quantity) > 0 && <span className="block text-[11px] text-amber-300">+{fmtQty(r.blocked_quantity)} bloqueado</span>}
        </div>
      ),
    },
    { key: "lots_count", label: "Lotes", align: "center", render: (r) => <span className="tabular-nums">{r.lots_count}</span> },
    { key: "next_expiry", label: "Próx. validade", render: (r) => <span className={`tabular-nums ${expiryTone(r.next_expiry)}`}>{fmtDate(r.next_expiry)}</span> },
    { key: "min_stock", label: "Mínimo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{Number(r.min_stock) > 0 ? fmtQty(r.min_stock, r.unit) : "—"}</span> },
    { key: "cost", label: "Custo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.cost)}</span> },
    { key: "total_value", label: "Valor total", align: "right", render: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.total_value)}</span> },
    {
      key: "level",
      label: "Nível",
      render: (r) => (
        <Badge className={LEVEL_META[r.level].className}>
          <LevelDot level={r.level} /> {LEVEL_META[r.level].short}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Estoque"
        subtitle={store ? `Saldos por produto · ${store.name}` : "Saldos por produto"}
        icon="warehouse"
        actions={
          <>
            {can("estoque.ajustar") && (
              <Button variant="primary" onClick={() => setEntryOpen(true)}>
                <Icon name="plus" size={18} /> Entrada manual
              </Button>
            )}
            <Button variant="soft" disabled={rows.length === 0} onClick={exportCsv}>
              <Icon name="download" size={18} /> <span className="hidden sm:inline">Exportar</span> CSV
            </Button>
          </>
        }
      />
      <EstoqueSubnav />

      {/* indicadores */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Valor em estoque" value={kpis.data ? fmtMoney(kpis.data.stock_value) : "…"} tone="slate" icon="chart" />
        <KpiCard label="Produtos com saldo" value={kpis.data?.products ?? "…"} tone="blue" icon="box" />
        <KpiCard label="Lotes" value={kpis.data?.lots ?? "…"} tone="cyan" icon="layers" href="/estoque/lotes" />
        <KpiCard label="Vencidos" value={kpis.data?.expired ?? "…"} tone={kpis.data && kpis.data.expired > 0 ? "red" : "green"} icon="clock" href="/validades?f=vencido" />
        <KpiCard label="Abaixo do mínimo" value={kpis.data?.below_min ?? "…"} tone={kpis.data && kpis.data.below_min > 0 ? "amber" : "green"} icon="alert" onClick={() => setLevel(level === "abaixo" ? "" : "abaixo")} />
      </div>
      {kpis.error && <ErrorBox error={toOpsError(kpis.error as Error).message} onRetry={() => void kpis.refetch()} />}

      {/* filtros */}
      <div className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <SearchInput value={term} onChange={setTerm} placeholder="Produto, código interno ou código de barras" />
          <CategorySelect value={category} onChange={setCategory} />
          <Select value={level} onChange={(e) => setLevel(e.target.value as StockLevel | "abaixo" | "")}>
            <option value="">Todos os níveis</option>
            <option value="abaixo">🔴🚨 Abaixo do mínimo (baixo + crítico)</option>
            {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ProductKind | "")}>
            <option value="">Todos os tipos</option>
            {(Object.keys(PRODUCT_KIND_LABEL) as ProductKind[]).map((k) => <option key={k} value={k}>{PRODUCT_KIND_LABEL[k]}</option>)}
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="-mb-3 flex-1 sm:max-w-xs">
            <Toggle checked={onlyStock} onChange={setOnlyStock} label="Só produtos com saldo" />
          </div>
          {hasFilter && (
            <button type="button" className="text-xs font-semibold text-[var(--accent)]" onClick={() => { setTerm(""); setCategory(""); setLevel(""); setKind(""); }}>
              Limpar filtros
            </button>
          )}
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
          rowHref={(r) => `/estoque/produto/${r.product_id}`}
          emptyTitle={hasFilter ? "Nenhum produto encontrado com esses filtros" : onlyStock ? "Ainda não há produtos com saldo nesta unidade" : "Nenhum produto cadastrado"}
          emptyDescription={
            hasFilter
              ? "Tente outra busca ou limpe os filtros."
              : onlyStock
                ? "Registre um Recebimento ou use “Entrada manual” para lançar o estoque inicial. Desligue “Só produtos com saldo” para ver todos os produtos."
                : "Cadastre produtos em Cadastros › Produtos."
          }
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <span className="text-xl"><LevelDot level={r.level} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.product_name}</p>
                <p className="truncate text-xs text-slate-500">
                  {r.internal_code && <span className="mr-2 font-mono">{r.internal_code}</span>}
                  {r.category_name ?? PRODUCT_KIND_LABEL[r.product_kind]} · {r.lots_count} {r.lots_count === 1 ? "lote" : "lotes"}
                </p>
                <p className={`text-xs ${expiryTone(r.next_expiry)}`}>{r.next_expiry ? `Próxima validade ${fmtDate(r.next_expiry)}` : "Sem validade próxima"}</p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</p>
                <p className="text-xs text-slate-400">{fmtMoney(r.total_value)}</p>
                {Number(r.expired_quantity) > 0 && <p className="text-[11px] text-rose-300">+{fmtQty(r.expired_quantity)} vencido</p>}
              </div>
            </div>
          )}
        />
      )}

      <ManualEntryDrawer open={entryOpen} onClose={() => setEntryOpen(false)} />
    </div>
  );
}
