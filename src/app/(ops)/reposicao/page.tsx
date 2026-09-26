"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { LEVEL_META, downloadBlob, fmtMoney, fmtQty, toCSV, todayISO } from "@/lib/ops/format";
import type { StockLevel } from "@/lib/ops/types";
import { safeLike, type CreatedPo, type ReplenishmentRow } from "@/lib/ops/modules/recebimento";
import { CategorySelect, SupplierSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { Badge, Button, DataTable, ErrorBox, LevelDot, PageHeader, SearchInput, Select, Sheet, useDebounced, usePagination, useToast, type Column } from "@/components/ops/ui";
import { ConfirmActionSheet, LinkButton } from "@/components/ops/recebimento/shared";

type Sort = "nivel" | "produto" | "sugestao" | "custo";
const LEVELS: StockLevel[] = ["critico", "baixo", "atencao", "normal"];

/** quantidade e preço a usar no pedido (unidade de compra quando existir) */
function orderQty(r: ReplenishmentRow): number {
  return Number(r.purchase_unit_id ? r.suggested_purchase_units : r.suggested_purchase) || 0;
}
function orderPrice(r: ReplenishmentRow): number {
  const cost = Number(r.cost) || 0;
  return r.purchase_unit_id ? cost * (Number(r.purchase_factor) || 1) : cost;
}

export default function ReplenishmentPage() {
  const { store, can } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();

  const [level, setLevel] = useState<"" | StockLevel>("");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const [sort, setSort] = useState<Sort>("nivel");
  const pg = usePagination(50);
  const [selected, setSelected] = useState<Map<string, ReplenishmentRow>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedPo[] | null>(null);

  useEffect(() => {
    pg.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, categoryId, supplierId, t, sort]);

  function buildQuery(withRange: boolean) {
    let qb = supabaseBrowser().from("v_replenishment_ranked").select("*", { count: "exact" }).eq("store_id", store!.id);
    if (level) qb = qb.eq("level", level);
    if (categoryId) qb = qb.eq("category_id", categoryId);
    if (supplierId === "__none") qb = qb.is("default_supplier_id", null);
    else if (supplierId) qb = qb.eq("default_supplier_id", supplierId);
    if (t.trim()) qb = qb.or(`product_name.ilike.${safeLike(t)},internal_code.ilike.${safeLike(t)}`);
    if (sort === "nivel") qb = qb.order("level_rank").order("product_name");
    else if (sort === "produto") qb = qb.order("product_name");
    else if (sort === "sugestao") qb = qb.order("suggested_purchase", { ascending: false }).order("product_name");
    else qb = qb.order("estimated_cost", { ascending: false }).order("product_name");
    if (withRange) qb = qb.range(pg.range.from, pg.range.to);
    else qb = qb.limit(5000);
    return qb;
  }

  const q = useQuery({
    queryKey: ["v_replenishment_ranked", store?.id, level, categoryId, supplierId, t, sort, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const res = await buildQuery(true);
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as ReplenishmentRow[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["stock_items", "purchase_orders"], [["v_replenishment_ranked"]]);

  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const selectable = (r: ReplenishmentRow) => orderQty(r) > 0;

  function toggle(r: ReplenishmentRow) {
    if (!selectable(r)) return;
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(r.product_id)) n.delete(r.product_id);
      else n.set(r.product_id, r);
      return n;
    });
  }
  function selectPage() {
    setSelected((m) => {
      const n = new Map(m);
      const all = rows.filter(selectable).every((r) => n.has(r.product_id));
      for (const r of rows.filter(selectable)) {
        if (all) n.delete(r.product_id);
        else n.set(r.product_id, r);
      }
      return n;
    });
  }

  const groups = useMemo(() => {
    const g = new Map<string, { name: string; items: ReplenishmentRow[]; cost: number }>();
    for (const r of selected.values()) {
      const key = r.default_supplier_id ?? "";
      const cur = g.get(key) ?? { name: r.default_supplier_name ?? "Sem fornecedor", items: [], cost: 0 };
      cur.items.push(r);
      cur.cost += Number(r.estimated_cost) || 0;
      g.set(key, cur);
    }
    return [...g.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[1].name.localeCompare(b[1].name)));
  }, [selected]);

  async function generate() {
    if (!store) return;
    setBusy(true);
    try {
      const items = [...selected.values()].filter(selectable).map((r) => ({
        product_id: r.product_id,
        supplier_id: r.default_supplier_id ?? "",
        quantity: orderQty(r),
        unit_id: r.purchase_unit_id ?? "",
        estimated_price: Number(orderPrice(r).toFixed(4)),
      }));
      const res = await rpc<CreatedPo[]>("ops_po_create_batch", { p_store: store.id, p_items: items, p_notes: `Gerado pela reposição em ${todayISO()}` });
      invalidate("purchase_orders", "purchase_order_items");
      setSelected(new Map());
      setConfirmOpen(false);
      if (res.length === 1) {
        notify(`Pedido ${res[0].number} criado como rascunho`);
        router.push(`/compras/${res[0].id}`);
      } else {
        notify(`${res.length} pedidos criados como rascunho`);
        setCreated(res);
      }
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    if (!store) return;
    try {
      const res = await buildQuery(false);
      if (res.error) throw toOpsError(res.error);
      const data = (res.data ?? []) as ReplenishmentRow[];
      const csv = toCSV(
        data.map((r) => ({
          produto: r.product_name, codigo: r.internal_code, categoria: r.category_name ?? "", unidade: r.unit,
          atual: Number(r.quantity), minimo: Number(r.min_stock), maximo: Number(r.max_stock), ponto_reposicao: Number(r.reorder_point),
          sugestao: Number(r.suggested_purchase), sugestao_compra: Number(r.suggested_purchase_units), unidade_compra: r.purchase_unit ?? "",
          nivel: LEVEL_META[r.level].label, fornecedor: r.default_supplier_name ?? "", custo_unitario: Number(r.cost), custo_estimado: Number(r.estimated_cost),
        })),
        [
          { key: "produto", label: "Produto" }, { key: "codigo", label: "Código" }, { key: "categoria", label: "Categoria" }, { key: "unidade", label: "Unidade" },
          { key: "atual", label: "Atual" }, { key: "minimo", label: "Mínimo" }, { key: "maximo", label: "Máximo" }, { key: "ponto_reposicao", label: "Ponto de reposição" },
          { key: "sugestao", label: "Sugestão" }, { key: "sugestao_compra", label: "Sugestão (un. compra)" }, { key: "unidade_compra", label: "Unidade de compra" },
          { key: "nivel", label: "Nível" }, { key: "fornecedor", label: "Fornecedor padrão" }, { key: "custo_unitario", label: "Custo unitário" }, { key: "custo_estimado", label: "Custo estimado" },
        ],
      );
      downloadBlob(`reposicao-${store.code || store.name}-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
      notify(`${data.length} linha(s) exportada(s)`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  const canOrder = can("compras.criar");
  const allPageSelected = rows.filter(selectable).length > 0 && rows.filter(selectable).every((r) => selected.has(r.product_id));

  const columns: Column<ReplenishmentRow>[] = [
    ...(canOrder
      ? [{
          key: "sel", label: "", className: "w-8",
          render: (r: ReplenishmentRow) => (
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={selected.has(r.product_id)} disabled={!selectable(r)} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} aria-label="Selecionar" />
          ),
        } satisfies Column<ReplenishmentRow>]
      : []),
    { key: "product", label: "Produto", render: (r) => (
      <div className="min-w-0">
        <Link href={`/produtos/${r.product_id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold hover:underline">{r.product_name}</Link>
        <span className="text-xs text-slate-500">{r.internal_code ? <span className="mr-2 font-mono">{r.internal_code}</span> : null}{r.category_name ?? ""}</span>
      </div>
    ) },
    { key: "quantity", label: "Atual", align: "right", render: (r) => <span className="tabular-nums">{fmtQty(r.quantity, r.unit)}</span> },
    { key: "min_stock", label: "Mínimo", align: "right", render: (r) => <span className="tabular-nums text-slate-300">{fmtQty(r.min_stock, r.unit)}</span> },
    { key: "max_stock", label: "Máximo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{Number(r.max_stock) > 0 ? fmtQty(r.max_stock, r.unit) : "—"}</span> },
    { key: "suggested", label: "Sugestão", align: "right", render: (r) => (
      <div className="tabular-nums">
        <span className="font-bold">{fmtQty(r.suggested_purchase, r.unit)}</span>
        {r.purchase_unit_id && r.purchase_unit && Number(r.suggested_purchase) > 0 && <span className="block text-xs text-slate-400">≈ {fmtQty(r.suggested_purchase_units, r.purchase_unit)}</span>}
      </div>
    ) },
    { key: "level", label: "Nível", align: "center", render: (r) => <Badge tone={r.level === "normal" ? "green" : r.level === "atencao" ? "amber" : "red"}><LevelDot level={r.level} /> {LEVEL_META[r.level].short}</Badge> },
    { key: "supplier", label: "Fornecedor padrão", hideOnMobile: true, render: (r) => r.default_supplier_name ?? <span className="text-slate-500">—</span> },
    { key: "estimated_cost", label: "Custo estimado", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.estimated_cost)}</span> },
  ];

  return (
    <div className="mx-auto max-w-6xl pb-28">
      <PageHeader
        title="Reposição"
        subtitle="Produtos abaixo do mínimo ou no ponto de reposição, com sugestão de compra"
        icon="cart"
        actions={
          <>
            <Button variant="soft" onClick={() => void exportCsv()} disabled={!store}><Icon name="download" size={18} /> CSV</Button>
            <LinkButton href="/compras" variant="soft"><Icon name="file" size={18} /> Pedidos</LinkButton>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_160px_200px_200px_170px]">
        <SearchInput value={term} onChange={setTerm} placeholder="Produto ou código" />
        <Select value={level} onChange={(e) => setLevel(e.target.value as "" | StockLevel)}>
          <option value="">Todos os níveis</option>
          {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_META[l].dot} {LEVEL_META[l].label}</option>)}
        </Select>
        <CategorySelect value={categoryId} onChange={setCategoryId} />
        <SupplierSelectWithNone value={supplierId} onChange={setSupplierId} />
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="nivel">Ordem: nível</option>
          <option value="produto">Ordem: produto</option>
          <option value="sugestao">Ordem: maior sugestão</option>
          <option value="custo">Ordem: maior custo</option>
        </Select>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {LEVELS.map((l) => <span key={l}><span aria-hidden>{LEVEL_META[l].dot}</span> {LEVEL_META[l].label}</span>)}
        {canOrder && rows.length > 0 && (
          <button type="button" onClick={selectPage} className="ml-auto font-semibold text-[var(--accent)]">{allPageSelected ? "Desmarcar página" : "Selecionar página"}</button>
        )}
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
          onRowClick={canOrder ? toggle : undefined}
          keyFn={(r) => r.product_id}
          emptyTitle="Nenhum produto precisa de reposição"
          emptyDescription={level || categoryId || supplierId || t ? "Ajuste os filtros para ver outros produtos." : "Quando um produto ficar abaixo do mínimo ou do ponto de reposição, ele aparece aqui. Cadastre mínimo e máximo nos produtos."}
          mobileCard={(r) => (
            <div className="flex items-start gap-3">
              {canOrder && <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={selected.has(r.product_id)} disabled={!selectable(r)} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} aria-label="Selecionar" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LevelDot level={r.level} />
                  <p className="truncate font-semibold">{r.product_name}</p>
                </div>
                <p className="text-xs text-slate-400 tabular-nums">Atual {fmtQty(r.quantity, r.unit)} · mínimo {fmtQty(r.min_stock, r.unit)}{Number(r.max_stock) > 0 ? ` · máximo ${fmtQty(r.max_stock, r.unit)}` : ""}</p>
                <p className="text-xs text-slate-500">{r.default_supplier_name ?? "Sem fornecedor padrão"}</p>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-bold">{fmtQty(r.suggested_purchase, r.unit)}</p>
                {r.purchase_unit_id && r.purchase_unit && Number(r.suggested_purchase) > 0 && <p className="text-xs text-slate-400">≈ {fmtQty(r.suggested_purchase_units, r.purchase_unit)}</p>}
                <p className="text-xs text-slate-500">{fmtMoney(r.estimated_cost)}</p>
              </div>
            </div>
          )}
        />
      )}

      {/* barra de seleção */}
      {canOrder && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 px-3 lg:bottom-4 lg:left-64">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--accent)]/50 bg-[var(--panel)] px-4 py-3 shadow-2xl">
            <div className="text-sm">
              <p className="font-bold">{selected.size} produto(s) selecionado(s)</p>
              <p className="text-xs text-slate-400">{groups.length} pedido(s) · {fmtMoney(groups.reduce((s, g) => s + g[1].cost, 0))} estimado</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelected(new Map())}>Limpar</Button>
              <Button variant="primary" onClick={() => setConfirmOpen(true)}><Icon name="cart" size={18} /> Gerar pedido de compra</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Gerar pedidos de compra"
        confirmLabel={groups.length > 1 ? `Criar ${groups.length} pedidos` : "Criar pedido"}
        busy={busy}
        onConfirm={generate}
        message={
          <div className="text-sm">
            <p className="mb-2">Os pedidos são criados como <strong>rascunho</strong>, agrupados por fornecedor padrão, com a quantidade sugerida. Você pode ajustar tudo antes de solicitar.</p>
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
              {groups.map(([key, g]) => (
                <li key={key || "none"} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{g.name}</span>
                    <span className="text-xs text-slate-400">{g.items.length} item(ns) · {fmtMoney(g.cost)}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500">{g.items.map((i) => `${fmtQty(orderQty(i), i.purchase_unit_id ? i.purchase_unit : i.unit)} ${i.product_name}`).join(", ")}</p>
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <Sheet open={Boolean(created)} onClose={() => setCreated(null)} title="Pedidos criados">
        <p className="mb-3 text-sm text-slate-300">Os pedidos abaixo foram criados como rascunho. Abra cada um para revisar e solicitar.</p>
        <ul className="divide-y divide-[var(--line)]">
          {(created ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/compras/${c.id}`} className="flex items-center gap-3 py-2.5">
                <span className="font-mono font-bold">{c.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{c.supplier_name || "Sem fornecedor"} · {c.items} item(ns)</span>
                <Icon name="chevronRight" className="text-slate-600" />
              </Link>
            </li>
          ))}
        </ul>
        <LinkButton href="/compras" variant="soft" size="lg" full className="mt-4">Ver todos os pedidos</LinkButton>
      </Sheet>
    </div>
  );
}

/** Fornecedor padrão, incluindo a opção "sem fornecedor". */
function SupplierSelectWithNone({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  if (value === "__none") {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos os fornecedores</option>
        <option value="__none">Sem fornecedor padrão</option>
      </Select>
    );
  }
  return (
    <div className="flex gap-1">
      <div className="min-w-0 flex-1"><SupplierSelect value={value} onChange={onChange} placeholder="Todos os fornecedores" /></div>
      <button type="button" onClick={() => onChange("__none")} title="Só produtos sem fornecedor padrão" className="shrink-0 rounded-xl border border-[var(--line)] bg-white/5 px-2 text-xs font-semibold text-slate-300">sem</button>
    </div>
  );
}
