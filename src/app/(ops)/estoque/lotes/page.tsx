"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { daysLabel, EXPIRY_META, fmtDate, fmtMoney, fmtQty } from "@/lib/ops/format";
import { LOT_ORIGIN_LABEL, LOT_STATUS_LABEL, type ExpiryStatus, type LotOrigin, type LotStatus, type StockBalance } from "@/lib/ops/types";
import { EXPIRY_OPTIONS, LOT_STATUS_OPTIONS, likeTerm } from "@/lib/ops/modules/estoque";
import { Badge, DataTable, ErrorBox, PageHeader, SearchInput, Select, toneFor, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { LocationSelect, SupplierSelect } from "@/components/ops/pickers";
import { EstoqueSubnav } from "@/components/ops/estoque/Subnav";

const PAGE = 50;

/** Lotes com saldo na unidade (view v_stock_balances = lote × local). */
export default function LotesPage() {
  const { store } = useSession();
  const [term, setTerm] = useState("");
  const t = useDebounced(term.trim(), 300);
  const [expiry, setExpiry] = useState<ExpiryStatus | "">("");
  const [status, setStatus] = useState<LotStatus | "">("");
  const [location, setLocation] = useState("");
  const [supplier, setSupplier] = useState("");
  const [origin, setOrigin] = useState<LotOrigin | "">("");
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [t, expiry, status, location, supplier, origin, setPage]);

  const q = useQuery({
    queryKey: ["stock_items", "lots_list", store?.id, t, expiry, status, location, supplier, origin, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("v_stock_balances")
        .select("*", { count: "exact" })
        .eq("store_id", store!.id)
        .gt("quantity", 0)
        .order("expires_at", { ascending: true, nullsFirst: false })
        .order("product_name")
        .order("lot_code")
        .range(pg.range.from, pg.range.to);
      if (t) {
        const like = likeTerm(t);
        qb = qb.or(`lot_code.ilike.${like},product_name.ilike.${like},internal_code.ilike.${like}`);
      }
      if (expiry) qb = qb.eq("expiry_status", expiry);
      if (status) qb = qb.eq("lot_status", status);
      if (location) qb = qb.eq("location_id", location);
      if (supplier) qb = qb.eq("supplier_id", supplier);
      if (origin) qb = qb.eq("lot_origin", origin);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as StockBalance[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["stock_items", "stock_lots"], [["stock_items"], ["stock_lots"]]);

  const hasFilter = Boolean(t || expiry || status || location || supplier || origin);
  const rows = q.data?.rows ?? [];

  const columns: Column<StockBalance>[] = [
    {
      key: "product_name",
      label: "Produto",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{r.product_name}</p>
          {r.internal_code && <p className="font-mono text-xs text-slate-500">{r.internal_code}</p>}
        </div>
      ),
    },
    {
      key: "lot_code",
      label: "Lote",
      render: (r) => (
        <div>
          <p className="font-mono font-semibold">{r.lot_code || "—"}</p>
          <p className="text-[11px] text-slate-500">{LOT_ORIGIN_LABEL[r.lot_origin]}</p>
        </div>
      ),
    },
    { key: "location_name", label: "Local", render: (r) => <span className="text-slate-200">{r.location_name}</span> },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</span> },
    {
      key: "expires_at",
      label: "Validade",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="tabular-nums">{fmtDate(r.expires_at)}</span>
          <Badge className={EXPIRY_META[r.expiry_status].className}>{r.expires_at ? daysLabel(r.days_to_expire) : "sem validade"}</Badge>
        </div>
      ),
    },
    { key: "lot_status", label: "Status", render: (r) => <Badge tone={toneFor(r.lot_status)}>{LOT_STATUS_LABEL[r.lot_status]}</Badge> },
    { key: "received_at", label: "Entrada", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-400">{fmtDate(r.received_at ?? r.produced_at)}</span> },
    { key: "unit_cost", label: "Custo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.unit_cost)}</span> },
    { key: "total_value", label: "Valor", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.total_value)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Lotes" subtitle={store ? `Lotes com saldo por local · ${store.name}` : "Lotes com saldo"} icon="layers" />
      <EstoqueSubnav />

      <div className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-6">
          <div className="md:col-span-3 lg:col-span-2">
            <SearchInput value={term} onChange={setTerm} placeholder="Lote, produto ou código" />
          </div>
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryStatus | "")}>
            <option value="">Qualquer validade</option>
            {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as LotStatus | "")}>
            <option value="">Qualquer status</option>
            {LOT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <LocationSelect value={location} onChange={setLocation} allowEmpty placeholder="Todos os locais" />
          <SupplierSelect value={supplier} onChange={setSupplier} placeholder="Todos os fornecedores" />
          <Select value={origin} onChange={(e) => setOrigin(e.target.value as LotOrigin | "")}>
            <option value="">Qualquer origem</option>
            {(Object.keys(LOT_ORIGIN_LABEL) as LotOrigin[]).map((k) => <option key={k} value={k}>{LOT_ORIGIN_LABEL[k]}</option>)}
          </Select>
        </div>
        {hasFilter && (
          <div className="mt-2 text-right">
            <button type="button" className="text-xs font-semibold text-[var(--accent)]" onClick={() => { setTerm(""); setExpiry(""); setStatus(""); setLocation(""); setSupplier(""); setOrigin(""); }}>
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={q.isLoading || q.isFetching}
          keyFn={(r) => r.id}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          rowHref={(r) => `/lote/${r.lot_id}`}
          emptyTitle={hasFilter ? "Nenhum lote com esses filtros" : "Nenhum lote com saldo"}
          emptyDescription={hasFilter ? "Tente outra busca ou limpe os filtros." : "Os lotes são criados no Recebimento, na Produção ou pela Entrada manual no Estoque."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.product_name}</p>
                <p className="text-xs text-slate-400"><span className="font-mono">{r.lot_code || "—"}</span> · {r.location_name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge className={EXPIRY_META[r.expiry_status].className}>{r.expires_at ? `${fmtDate(r.expires_at)} · ${daysLabel(r.days_to_expire)}` : "sem validade"}</Badge>
                  {r.lot_status !== "ativo" && <Badge tone={toneFor(r.lot_status)}>{LOT_STATUS_LABEL[r.lot_status]}</Badge>}
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</p>
                <p className="text-xs text-slate-400">{fmtMoney(r.total_value)}</p>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
