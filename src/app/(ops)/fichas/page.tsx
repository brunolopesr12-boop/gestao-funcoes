"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { fmtMoney, fmtQty } from "@/lib/ops/format";
import type { RecipeCost } from "@/lib/ops/types";
import { RECIPE_SELECT, matchingProductIds, portionsOf, safeLike, useRecipeCosts, type RecipeRow } from "@/lib/ops/modules/producao";
import { Icon } from "@/components/ops/Icon";
import { Badge, DataTable, ErrorBox, InlineAlert, PageHeader, SearchInput, Tabs, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { LinkButton } from "@/components/ops/producao/shared";

type Tab = "ativas" | "inativas" | "todas";
const TABS: { value: Tab; label: string }[] = [
  { value: "ativas", label: "Ativas" },
  { value: "inativas", label: "Inativas" },
  { value: "todas", label: "Todas" },
];

type CostCell = { data: RecipeCost | null | undefined; loading: boolean; error: boolean };

function CostValue({ c, kind, unit }: { c: CostCell | undefined; kind: "total" | "unit"; unit: string }) {
  if (!c || c.loading) return <span className="inline-block h-4 w-14 animate-pulse rounded bg-white/10" />;
  if (c.error || !c.data) return <span className="text-slate-500">—</span>;
  if (kind === "total") return <span className="font-semibold tabular-nums">{fmtMoney(c.data.total_cost)}</span>;
  if (c.data.cost_per_unit === null || c.data.cost_per_unit === undefined) return <span className="text-slate-500">—</span>;
  return <span className="tabular-nums">{fmtMoney(c.data.cost_per_unit)}<span className="text-slate-500">/{unit || c.data.yield_unit}</span></span>;
}

export default function RecipesPage() {
  const { company, canCompany, can } = useSession();
  const [tab, setTab] = useState<Tab>("ativas");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  // página limitada a 25 para calcular o custo de cada ficha visível sem sobrecarregar o banco
  const pg = usePagination(25);

  useEffect(() => {
    pg.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, t]);

  const q = useQuery({
    queryKey: ["recipes", "list", company?.id, tab, t, pg.page],
    enabled: Boolean(company?.id),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("recipes")
        .select(RECIPE_SELECT, { count: "exact" })
        .eq("company_id", company!.id)
        .order("name")
        .order("version", { ascending: false })
        .range(pg.range.from, pg.range.to);
      if (tab !== "todas") qb = qb.eq("active", tab === "ativas");
      if (t.trim()) {
        const ids = await matchingProductIds(company!.id, t);
        const parts = [`name.ilike.${safeLike(t)}`];
        if (ids.length > 0) parts.push(`product_id.in.(${ids.join(",")})`);
        qb = qb.or(parts.join(","));
      }
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as RecipeRow[], total: res.count ?? 0 };
    },
  });

  const rows = q.data?.rows ?? [];
  const costs = useRecipeCosts(rows.map((r) => r.id));
  const editable = canCompany("fichas.editar");
  const canProduce = can("producao.criar") || can("producao.finalizar");

  const columns: Column<RecipeRow>[] = [
    {
      key: "name",
      label: "Ficha",
      render: (r) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold">
            <span className="truncate">{r.name}</span>
            <Badge tone="slate">v{r.version}</Badge>
            {!r.active && <Badge tone="red">Inativa</Badge>}
          </p>
          {r.prep_time_min ? <p className="text-xs text-slate-500">{r.prep_time_min} min de preparo</p> : null}
        </div>
      ),
    },
    {
      key: "product",
      label: "Produto produzido",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.products?.name ?? "—"}</p>
          {r.products?.internal_code && <p className="font-mono text-xs text-slate-500">{r.products.internal_code}</p>}
        </div>
      ),
    },
    { key: "yield", label: "Rendimento", align: "right", render: (r) => <span className="tabular-nums">{fmtQty(r.yield_quantity, r.products?.units?.code)}</span> },
    { key: "portions", label: "Porções", align: "right", hideOnMobile: true, render: (r) => { const p = portionsOf(r); return p ? <span className="tabular-nums">{fmtQty(p)}</span> : <span className="text-slate-500">—</span>; } },
    { key: "cost", label: "Custo total", align: "right", render: (r) => <CostValue c={costs[r.id]} kind="total" unit={r.products?.units?.code ?? ""} /> },
    { key: "unit_cost", label: "Custo/unidade", align: "right", render: (r) => <CostValue c={costs[r.id]} kind="unit" unit={r.products?.units?.code ?? ""} /> },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Fichas técnicas"
        subtitle={company?.name}
        icon="book"
        actions={
          <>
            {canProduce && <LinkButton href="/producao/nova" variant="soft" icon="flame">Produzir</LinkButton>}
            {editable && <LinkButton href="/fichas/nova" icon="plus">Nova ficha</LinkButton>}
          </>
        }
      />
      {!canCompany("fichas.ver") && !can("producao.ver") && <InlineAlert tone="amber">Você não tem permissão para ver fichas técnicas.</InlineAlert>}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={term} onChange={setTerm} placeholder="Buscar por nome da ficha ou do produto" className="sm:max-w-md sm:flex-1" />
        <Tabs value={tab} onChange={setTab} tabs={TABS} className="!mb-0" />
      </div>

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
          rowHref={(r) => `/fichas/${r.id}`}
          emptyTitle={t ? "Nenhuma ficha encontrada" : tab === "ativas" ? "Nenhuma ficha técnica ativa" : "Nenhuma ficha por aqui"}
          emptyDescription={t ? "Tente outro nome ou código." : editable ? "Toque em “Nova ficha” para cadastrar a primeira receita com ingredientes e rendimento." : "Peça a um gerente para cadastrar as fichas técnicas."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{r.name}</span>
                  <Badge tone="slate">v{r.version}</Badge>
                  {!r.active && <Badge tone="red">Inativa</Badge>}
                </p>
                <p className="truncate text-xs text-slate-400">{r.products?.name ?? "—"} · rende {fmtQty(r.yield_quantity, r.products?.units?.code)}{portionsOf(r) ? ` · ${fmtQty(portionsOf(r))} porções` : ""}</p>
                <p className="text-xs text-slate-300">
                  <CostValue c={costs[r.id]} kind="total" unit={r.products?.units?.code ?? ""} /> <span className="text-slate-500">·</span> <CostValue c={costs[r.id]} kind="unit" unit={r.products?.units?.code ?? ""} />
                </p>
              </div>
              <Icon name="chevronRight" className="text-slate-600" />
            </div>
          )}
        />
      )}
    </div>
  );
}
