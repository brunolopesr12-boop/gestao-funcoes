"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtRelative } from "@/lib/ops/format";
import { cnpjLikePattern, likeTerm, waLink, type SupplierRow } from "@/lib/ops/modules/cadastros";
import { Badge, DataTable, ErrorBox, PageHeader, SearchInput, Select, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { CadastrosSubnav } from "@/components/ops/cadastros/Subnav";

const PAGE = 50;

/** Fornecedores da empresa (v_suppliers: com última compra). */
export default function FornecedoresPage() {
  const { company, canCompany } = useSession();
  const [term, setTerm] = useState("");
  const t = useDebounced(term.trim(), 300);
  const [active, setActive] = useState<"ativos" | "inativos" | "todos">("ativos");
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [t, active, setPage]);

  const q = useQuery({
    queryKey: ["suppliers", "list", company?.id, t, active, pg.page],
    enabled: Boolean(company?.id),
    queryFn: async () => {
      let qb = supabaseBrowser().from("v_suppliers").select("*", { count: "exact" }).eq("company_id", company!.id).order("name").range(pg.range.from, pg.range.to);
      if (t) {
        const like = likeTerm(t);
        const cnpj = cnpjLikePattern(t);
        qb = qb.or(`name.ilike.${like},trade_name.ilike.${like},contact_name.ilike.${like},cnpj.ilike.${like}${cnpj ? `,cnpj.ilike.${cnpj}` : ""}`);
      }
      if (active !== "todos") qb = qb.eq("active", active === "ativos");
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: (res.data ?? []) as SupplierRow[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["suppliers"], [["supplier_price_history"]]);

  const rows = q.data?.rows ?? [];
  const hasFilter = Boolean(t || active !== "ativos");

  const columns: Column<SupplierRow>[] = [
    {
      key: "name", label: "Nome",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{r.name}</p>
          {r.trade_name && <p className="truncate text-xs text-slate-500">{r.trade_name}</p>}
        </div>
      ),
    },
    { key: "cnpj", label: "CNPJ", hideOnMobile: true, render: (r) => <span className="font-mono text-slate-300">{r.cnpj || "—"}</span> },
    { key: "contact_name", label: "Contato", render: (r) => <span className="text-slate-300">{r.contact_name || "—"}</span> },
    {
      key: "phone", label: "Telefone / WhatsApp",
      render: (r) => {
        const wa = waLink(r.whatsapp || r.phone);
        return (
          <span className="flex items-center gap-2 text-slate-300">
            <span className="tabular-nums">{r.phone || r.whatsapp || "—"}</span>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Abrir WhatsApp" className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600/80 text-white">
                <Icon name="send" size={14} />
              </a>
            )}
          </span>
        );
      },
    },
    { key: "last_purchase_at", label: "Última compra", render: (r) => <span className="tabular-nums text-slate-300" title={fmtDate(r.last_purchase_at)}>{r.last_purchase_at ? fmtRelative(r.last_purchase_at) : "—"}</span> },
    { key: "products_count", label: "Produtos", align: "center", hideOnMobile: true, render: (r) => <span className="tabular-nums">{r.products_count}</span> },
    { key: "active", label: "Ativo", align: "center", render: (r) => <Badge tone={r.active ? "green" : "red"}>{r.active ? "Sim" : "Não"}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        subtitle={company ? `Fornecedores de ${company.name}` : "Fornecedores da empresa"}
        icon="building"
        actions={
          canCompany("fornecedores.editar") ? (
            <Link href="/fornecedores/novo" className="inline-flex items-center gap-2 rounded-xl border border-blue-500/60 bg-blue-600 px-4 py-2.5 text-[15px] font-medium text-white shadow-lg shadow-blue-900/30 hover:bg-blue-500">
              <Icon name="plus" size={18} /> Novo fornecedor
            </Link>
          ) : undefined
        }
      />
      <CadastrosSubnav />

      <div className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr]">
          <SearchInput value={term} onChange={setTerm} placeholder="Nome, nome fantasia, CNPJ ou contato" />
          <Select value={active} onChange={(e) => setActive(e.target.value as "ativos" | "inativos" | "todos")}>
            <option value="ativos">Somente ativos</option>
            <option value="inativos">Somente inativos</option>
            <option value="todos">Ativos e inativos</option>
          </Select>
        </div>
        {hasFilter && (
          <div className="mt-2 flex justify-end">
            <button type="button" className="text-xs font-semibold text-[var(--accent)]" onClick={() => { setTerm(""); setActive("ativos"); }}>Limpar filtros</button>
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
          rowHref={(r) => `/fornecedores/${r.id}`}
          emptyTitle={hasFilter ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}
          emptyDescription={hasFilter ? "Tente outra busca ou limpe os filtros." : canCompany("fornecedores.editar") ? "Clique em “Novo fornecedor” para cadastrar o primeiro. Os fornecedores são usados nos pedidos de compra e nos recebimentos." : "Peça a um gerente para cadastrar os fornecedores."}
          mobileCard={(r) => {
            const wa = waLink(r.whatsapp || r.phone);
            return (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.name}</p>
                  <p className="truncate text-xs text-slate-500">{r.contact_name || r.trade_name || r.cnpj || "—"}{r.phone ? ` · ${r.phone}` : ""}</p>
                  <p className="text-xs text-slate-400">{r.last_purchase_at ? `Última compra ${fmtRelative(r.last_purchase_at)}` : "Sem compras registradas"}</p>
                </div>
                {!r.active && <Badge tone="red">inativo</Badge>}
                {wa && (
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(wa, "_blank", "noopener"); }} aria-label="Abrir WhatsApp" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600/80 text-white active:scale-95">
                    <Icon name="send" size={16} />
                  </button>
                )}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
