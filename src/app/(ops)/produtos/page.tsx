"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { downloadBlob, fmtMoney, fmtQty, toCSV, todayISO } from "@/lib/ops/format";
import { PRODUCT_KIND_LABEL, STORAGE_TYPE_LABEL, type Product, type ProductKind, type StorageType } from "@/lib/ops/types";
import { likeTerm } from "@/lib/ops/modules/cadastros";
import { Badge, Button, DataTable, ErrorBox, PageHeader, SearchInput, Select, useDebounced, usePagination, useToast, type Column } from "@/components/ops/ui";
import { CategorySelect, ProductThumb } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { CadastrosSubnav } from "@/components/ops/cadastros/Subnav";

const PAGE = 50;
const SELECT = "*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)";

/** Catálogo de produtos da empresa (lista paginada com filtros no banco). */
export default function ProdutosPage() {
  const { company, canCompany } = useSession();
  const notify = useToast();
  const [term, setTerm] = useState("");
  const t = useDebounced(term.trim(), 300);
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<ProductKind | "">("");
  const [active, setActive] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [storage, setStorage] = useState<StorageType | "">("");
  const [exporting, setExporting] = useState(false);
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [t, category, kind, active, storage, setPage]);

  function applyFilters<T extends { or: (s: string) => T; eq: (c: string, v: unknown) => T }>(qb: T): T {
    if (t) {
      const like = likeTerm(t);
      const raw = /^\S+$/.test(t) ? t.replace(/[,()]/g, "") : "";
      qb = qb.or(`name.ilike.${like},internal_code.ilike.${like},sku.ilike.${like}${raw ? `,barcode.eq.${raw}` : ""}`);
    }
    if (category) qb = qb.eq("category_id", category);
    if (kind) qb = qb.eq("product_kind", kind);
    if (active !== "todos") qb = qb.eq("active", active === "ativos");
    if (storage) qb = qb.eq("storage_type", storage);
    return qb;
  }

  const q = useQuery({
    queryKey: ["products", "list", company?.id, t, category, kind, active, storage, pg.page],
    enabled: Boolean(company?.id),
    queryFn: async () => {
      let qb = supabaseBrowser().from("products").select(SELECT, { count: "exact" }).eq("company_id", company!.id).order("name").range(pg.range.from, pg.range.to);
      qb = applyFilters(qb);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as Product[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["products"]);

  const rows = q.data?.rows ?? [];
  const hasFilter = Boolean(t || category || kind || storage || active !== "ativos");

  async function exportCsv() {
    if (!company) return;
    setExporting(true);
    try {
      let qb = supabaseBrowser().from("products").select(SELECT).eq("company_id", company.id).order("name").limit(5000);
      qb = applyFilters(qb);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      const all = (res.data ?? []) as Product[];
      const csv = toCSV(
        all.map((p) => ({
          internal_code: p.internal_code, name: p.name, sku: p.sku, barcode: p.barcode, category: p.categories?.name ?? "", kind: PRODUCT_KIND_LABEL[p.product_kind],
          unit: p.units?.code ?? "", cost: Number(p.cost), last_purchase_price: Number(p.last_purchase_price), min_stock: Number(p.min_stock), max_stock: Number(p.max_stock),
          reorder_point: Number(p.reorder_point), storage: STORAGE_TYPE_LABEL[p.storage_type], shelf_life_days: p.shelf_life_days ?? "", active: p.active ? "Sim" : "Não",
        })),
        [
          { key: "internal_code", label: "Código" }, { key: "name", label: "Nome" }, { key: "sku", label: "SKU" }, { key: "barcode", label: "Código de barras" },
          { key: "category", label: "Categoria" }, { key: "kind", label: "Tipo" }, { key: "unit", label: "Unidade" }, { key: "cost", label: "Custo" },
          { key: "last_purchase_price", label: "Último preço" }, { key: "min_stock", label: "Mínimo" }, { key: "max_stock", label: "Máximo" }, { key: "reorder_point", label: "Ponto de reposição" },
          { key: "storage", label: "Armazenamento" }, { key: "shelf_life_days", label: "Validade (dias)" }, { key: "active", label: "Ativo" },
        ],
      );
      downloadBlob(`produtos-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
      notify(`${all.length} produtos exportados`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<Product>[] = [
    { key: "internal_code", label: "Código", render: (r) => <span className="font-mono text-slate-300">{r.internal_code || "—"}</span> },
    {
      key: "name", label: "Nome",
      render: (r) => (
        <div className="flex items-center gap-3">
          <ProductThumb product={r} size={36} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-100">{r.name}</p>
            {(r.barcode || r.sku) && <p className="truncate text-xs text-slate-500">{r.barcode && <span className="mr-2 font-mono">{r.barcode}</span>}{r.sku && <span>SKU {r.sku}</span>}</p>}
          </div>
        </div>
      ),
    },
    { key: "category", label: "Categoria", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.categories ? `${r.categories.emoji} ${r.categories.name}` : "—"}</span> },
    { key: "product_kind", label: "Tipo", hideOnMobile: true, render: (r) => <span className="text-slate-300">{PRODUCT_KIND_LABEL[r.product_kind]}</span> },
    { key: "unit", label: "Unidade", align: "center", render: (r) => <span className="font-semibold">{r.units?.code ?? "—"}</span> },
    { key: "cost", label: "Custo", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.cost)}</span> },
    { key: "min_stock", label: "Mínimo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{Number(r.min_stock) > 0 ? fmtQty(r.min_stock, r.units?.code) : "—"}</span> },
    { key: "active", label: "Ativo", align: "center", render: (r) => <Badge tone={r.active ? "green" : "red"}>{r.active ? "Sim" : "Não"}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Produtos"
        subtitle={company ? `Catálogo de ${company.name}` : "Catálogo da empresa"}
        icon="box"
        actions={
          <>
            {canCompany("produtos.editar") && (
              <Link href="/produtos/novo" className="inline-flex items-center gap-2 rounded-xl border border-blue-500/60 bg-blue-600 px-4 py-2.5 text-[15px] font-medium text-white shadow-lg shadow-blue-900/30 hover:bg-blue-500">
                <Icon name="plus" size={18} /> Novo produto
              </Link>
            )}
            <Link href="/produtos/categorias" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 text-[15px] font-medium text-slate-100 hover:bg-white/10">
              <Icon name="layers" size={18} /> Categorias
            </Link>
            <Link href="/produtos/unidades" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2.5 text-[15px] font-medium text-slate-100 hover:bg-white/10">
              <Icon name="scale" size={18} /> <span className="hidden sm:inline">Unidades de medida</span><span className="sm:hidden">Unidades</span>
            </Link>
            <Button variant="soft" disabled={exporting || (q.data?.total ?? 0) === 0} onClick={() => void exportCsv()}>
              <Icon name="download" size={18} /> <span className="hidden sm:inline">{exporting ? "Exportando…" : "Exportar"}</span> CSV
            </Button>
          </>
        }
      />
      <CadastrosSubnav />

      <div className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <SearchInput value={term} onChange={setTerm} placeholder="Nome, código interno, código de barras ou SKU" />
          <CategorySelect value={category} onChange={setCategory} />
          <Select value={kind} onChange={(e) => setKind(e.target.value as ProductKind | "")}>
            <option value="">Todos os tipos</option>
            {(Object.keys(PRODUCT_KIND_LABEL) as ProductKind[]).map((k) => <option key={k} value={k}>{PRODUCT_KIND_LABEL[k]}</option>)}
          </Select>
          <Select value={active} onChange={(e) => setActive(e.target.value as "ativos" | "inativos" | "todos")}>
            <option value="ativos">Somente ativos</option>
            <option value="inativos">Somente inativos</option>
            <option value="todos">Ativos e inativos</option>
          </Select>
          <Select value={storage} onChange={(e) => setStorage(e.target.value as StorageType | "")}>
            <option value="">Qualquer armazenamento</option>
            {(Object.keys(STORAGE_TYPE_LABEL) as StorageType[]).map((k) => <option key={k} value={k}>{STORAGE_TYPE_LABEL[k]}</option>)}
          </Select>
        </div>
        {hasFilter && (
          <div className="mt-2 flex justify-end">
            <button type="button" className="text-xs font-semibold text-[var(--accent)]" onClick={() => { setTerm(""); setCategory(""); setKind(""); setActive("ativos"); setStorage(""); }}>Limpar filtros</button>
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
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          rowHref={(r) => `/produtos/${r.id}`}
          emptyTitle={hasFilter ? "Nenhum produto encontrado com esses filtros" : "Nenhum produto cadastrado"}
          emptyDescription={hasFilter ? "Tente outra busca ou limpe os filtros." : canCompany("produtos.editar") ? "Clique em “Novo produto” para cadastrar o primeiro item do catálogo." : "Peça a um gerente para cadastrar os produtos."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <ProductThumb product={r} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {r.internal_code && <span className="mr-2 font-mono">{r.internal_code}</span>}
                  {r.categories?.name ?? PRODUCT_KIND_LABEL[r.product_kind]} · {r.units?.code ?? "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{fmtMoney(r.cost)}</p>
                {!r.active && <Badge tone="red">inativo</Badge>}
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
