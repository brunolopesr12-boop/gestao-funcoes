"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { toOpsError } from "@/lib/ops/errors";
import { useCategories, useEquipment, useSuppliers } from "@/lib/ops/hooks";
import { fmtDateTime } from "@/lib/ops/format";
import { rangeLabel } from "@/lib/ops/modules/gestao";
import {
  cellText, computeTotals, defaultFilters, EXPORT_MAX, exportCsv, exportPdf, exportXlsx, fetchAllRows, isNumeric, resolveColumns,
  type AllRows, type ExportMeta, type FilterKey, type Report, type ReportColumn, type ReportCtx, type ReportFilters, type ReportMode, type ReportRow,
} from "@/lib/ops/modules/reports";
import { Badge, Button, DataTable, EmptyState, ErrorBox, Field, InlineAlert, PageHeader, Select, Tabs, TextInput, usePagination, useDebounced, useToast, type Column } from "@/components/ops/ui";
import { CategorySelect, ProductPicker, SupplierSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { PeriodPicker } from "./PeriodPicker";
import { ReportDetailDrawer } from "./ReportDetail";

type Row = ReportRow & { id?: string };
const PAGE = 50;

function EquipmentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const q = useEquipment();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
      <option value="">Todos os equipamentos</option>
      {(q.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
  );
}

/** Página genérica de relatório: filtros, abas (modos), tabela paginada, totais e exportação. */
export function ReportPage({ report }: { report: Report }) {
  const { store, company, can, displayName } = useSession();
  const notify = useToast();
  const router = useRouter();
  const [modeKey, setModeKey] = useState(report.modes[0].key);
  const mode: ReportMode = useMemo(() => report.modes.find((m) => m.key === modeKey) ?? report.modes[0], [report, modeKey]);
  const [filters, setFilters] = useState<ReportFilters>(() => defaultFilters(report.modes[0]));
  const dTerm = useDebounced(filters.term, 350);
  const dUser = useDebounced(filters.user, 350);
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  const [detail, setDetail] = useState<Row | null>(null);
  const [exporting, setExporting] = useState<{ kind: string; loaded: number; total: number } | null>(null);
  const [allTotals, setAllTotals] = useState<AllRows | null>(null);

  const categories = useCategories();
  const suppliers = useSuppliers();
  const equipment = useEquipment();

  const effective: ReportFilters = useMemo(() => ({ ...filters, term: dTerm, user: dUser }), [filters, dTerm, dUser]);
  const cols = useMemo(() => resolveColumns(mode, effective), [mode, effective]);
  const ctx: ReportCtx | null = store && company ? { storeId: store.id, companyId: company.id } : null;
  const filterKey = JSON.stringify({ ...effective, product: effective.product?.id ?? null });

  useEffect(() => setPage(0), [filterKey, modeKey, setPage]);
  useEffect(() => setAllTotals(null), [filterKey, modeKey]);

  const switchMode = (k: string) => {
    const m = report.modes.find((x) => x.key === k);
    setModeKey(k);
    if (m) setFilters((f) => ({ ...f, sel: defaultFilters(m).sel }));
  };

  const waitingProduct = Boolean(mode.requiresProduct && !effective.product);

  const q = useQuery({
    queryKey: ["report", report.key, mode.key, ctx?.storeId, filterKey, mode.fetchAll ? "all" : pg.page],
    enabled: Boolean(ctx) && !waitingProduct,
    queryFn: async () => {
      if (mode.fetchAll) {
        const rows = await mode.fetchAll(ctx!, effective);
        return { rows: rows as Row[], total: rows.length };
      }
      const r = await mode.fetchPage!(ctx!, effective, pg.range.from, pg.range.to);
      return { rows: r.rows as Row[], total: r.total };
    },
  });

  const pageRows: Row[] = useMemo(() => {
    const rows = q.data?.rows ?? [];
    return mode.fetchAll ? rows.slice(pg.range.from, pg.range.to + 1) : rows;
  }, [q.data, mode.fetchAll, pg.range]);
  const total = q.data?.total ?? 0;

  const tableColumns: Column<Row>[] = useMemo(
    () =>
      cols.map((c) => ({
        key: c.key,
        label: c.label,
        align: isNumeric(c) ? "right" : undefined,
        hideOnMobile: c.hideOnMobile,
        className: isNumeric(c) ? "tabular-nums whitespace-nowrap" : c.kind === "datetime" || c.kind === "date" ? "whitespace-nowrap" : undefined,
        render: (r) => renderCell(c, r),
      })),
    [cols],
  );

  const totalsCols = cols.filter((c) => c.total);
  const pageTotals = useMemo(() => computeTotals(cols, pageRows), [cols, pageRows]);
  const totalsRows = mode.fetchAll ? (q.data?.rows ?? []) : allTotals?.rows ?? null;
  const grandTotals = useMemo(() => (totalsRows ? computeTotals(cols, totalsRows) : null), [cols, totalsRows]);

  const filterDescription = useCallback((): string[] => {
    const out: string[] = [];
    if (effective.product) out.push(`Produto: ${effective.product.name}`);
    if (effective.category) out.push(`Categoria: ${(categories.data ?? []).find((c) => c.id === effective.category)?.name ?? "—"}`);
    if (effective.supplier) out.push(`Fornecedor: ${(suppliers.data ?? []).find((s) => s.id === effective.supplier)?.name ?? "—"}`);
    if (effective.equipment) out.push(`Equipamento: ${(equipment.data ?? []).find((e) => e.id === effective.equipment)?.name ?? "—"}`);
    if (effective.user.trim()) out.push(`Funcionário: ${effective.user.trim()}`);
    if (effective.term.trim()) out.push(`Busca: ${effective.term.trim()}`);
    for (const s of mode.selects ?? []) {
      const v = effective.sel[s.key];
      if (v) out.push(`${s.label}: ${s.options.find((o) => o.value === v)?.label ?? v}`);
    }
    return out;
  }, [effective, categories.data, suppliers.data, equipment.data, mode.selects]);

  const meta = (): ExportMeta => ({
    title: report.modes.length > 1 ? `${report.title} — ${mode.label}` : report.title,
    store: store?.name ?? "",
    period: mode.filters.includes("period") ? rangeLabel({ from: effective.from, to: effective.to }) : undefined,
    user: displayName,
    filters: filterDescription(),
  });

  async function loadAll(kind: string): Promise<AllRows | null> {
    if (!ctx) return null;
    setExporting({ kind, loaded: 0, total: 0 });
    try {
      const all = await fetchAllRows(mode, ctx, effective, (loaded, t) => setExporting({ kind, loaded, total: t }));
      if (all.truncated) notify(`O relatório tem ${all.total.toLocaleString("pt-BR")} linhas; só as primeiras ${EXPORT_MAX.toLocaleString("pt-BR")} foram incluídas. Use filtros para reduzir.`, "info");
      return all;
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
      return null;
    } finally {
      setExporting(null);
    }
  }

  async function doExport(kind: "csv" | "xlsx" | "pdf") {
    const all = await loadAll(kind);
    if (!all) return;
    if (all.rows.length === 0) return notify("Nada para exportar com esses filtros.", "info");
    const m = { ...meta(), truncated: all.truncated };
    try {
      if (kind === "csv") exportCsv(cols, all.rows, m);
      else if (kind === "xlsx") await exportXlsx(cols, all.rows, m);
      else await exportPdf(cols, all.rows, m, mode.landscape);
      notify(`${kind.toUpperCase()} gerado com ${all.rows.length.toLocaleString("pt-BR")} linha(s)`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  async function sumAll() {
    const all = await loadAll("totais");
    if (all) setAllTotals(all);
  }

  const clearFilters = () => setFilters(defaultFilters(mode));
  const canExport = can("relatorios.exportar");
  const has = (k: FilterKey) => mode.filters.includes(k);

  if (!store) return <ErrorBox error="Escolha uma unidade para ver os relatórios." />;
  if (!can("relatorios.ver")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={report.title} backHref="/relatorios" icon={report.icon} />
        <EmptyState emoji="🔒" title="Sem permissão" description="Seu perfil não tem a permissão relatorios.ver nesta unidade. Fale com o gerente." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={report.title}
        subtitle={report.description}
        backHref="/relatorios"
        icon={report.icon}
        actions={canExport ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" disabled={Boolean(exporting) || waitingProduct} onClick={() => void doExport("csv")}><Icon name="download" size={16} /> CSV</Button>
            <Button variant="soft" disabled={Boolean(exporting) || waitingProduct} onClick={() => void doExport("xlsx")}><Icon name="download" size={16} /> Excel</Button>
            <Button variant="primary" disabled={Boolean(exporting) || waitingProduct} onClick={() => void doExport("pdf")}><Icon name="printer" size={16} /> PDF</Button>
          </div>
        ) : undefined}
      />

      {report.modes.length > 1 && <Tabs value={mode.key} onChange={switchMode} tabs={report.modes.map((m) => ({ value: m.key, label: m.label }))} />}
      {mode.note && <p className="mb-3 text-sm text-slate-400">{mode.note}</p>}
      {mode.perm && !can(mode.perm) && (
        <InlineAlert tone="amber">Seu perfil não tem a permissão <span className="font-mono">{mode.perm}</span> nesta unidade — este relatório pode aparecer vazio.</InlineAlert>
      )}

      {/* filtros */}
      <section className="card mb-4 p-4">
        {has("period") && (
          <div className="mb-3">
            <p className="mb-1.5 text-sm font-semibold text-slate-300">Período</p>
            <PeriodPicker value={{ from: filters.from, to: filters.to }} onChange={(r) => setFilters((f) => ({ ...f, ...r }))} />
          </div>
        )}
        {has("product") && (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-300">Produto{mode.requiresProduct ? "" : " (opcional)"}</p>
            <ProductPicker value={filters.product} onChange={(p) => setFilters((f) => ({ ...f, product: p }))} />
          </div>
        )}
        <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
          {has("category") && <Field label="Categoria"><CategorySelect value={filters.category} onChange={(v) => setFilters((f) => ({ ...f, category: v }))} /></Field>}
          {has("supplier") && <Field label="Fornecedor"><SupplierSelect value={filters.supplier} onChange={(v) => setFilters((f) => ({ ...f, supplier: v }))} placeholder="Todos os fornecedores" /></Field>}
          {has("equipment") && <Field label="Equipamento"><EquipmentSelect value={filters.equipment} onChange={(v) => setFilters((f) => ({ ...f, equipment: v }))} /></Field>}
          {(mode.selects ?? []).map((s) => (
            <Field key={s.key} label={s.label}>
              <Select value={filters.sel[s.key] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, sel: { ...f.sel, [s.key]: e.target.value } }))}>
                {s.allLabel !== undefined && <option value="">{s.allLabel}</option>}
                {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          ))}
          {has("user") && <Field label="Funcionário"><TextInput value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} placeholder="Nome de quem registrou" /></Field>}
          {has("term") && <Field label="Busca"><TextInput type="search" value={filters.term} onChange={(e) => setFilters((f) => ({ ...f, term: e.target.value }))} placeholder="Produto, código, lote…" /></Field>}
        </div>
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {q.isFetching ? "Consultando…" : q.data ? `${total.toLocaleString("pt-BR")} registro(s)` : ""}
          </p>
          <Button size="sm" variant="ghost" onClick={clearFilters}>Limpar filtros</Button>
        </div>
      </section>

      {exporting && (
        <InlineAlert tone="blue" icon="download">
          {exporting.kind === "totais" ? "Somando todas as linhas" : `Preparando ${exporting.kind.toUpperCase()}`}… {exporting.loaded.toLocaleString("pt-BR")}{exporting.total > 0 ? ` de ${Math.min(exporting.total, EXPORT_MAX).toLocaleString("pt-BR")}` : ""} linhas.
        </InlineAlert>
      )}

      {waitingProduct ? (
        <EmptyState emoji="🔎" title="Escolha um produto" description="Este relatório compara os fornecedores de um produto. Busque o produto no filtro acima." />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <DataTable<Row>
            columns={tableColumns}
            rows={pageRows}
            loading={q.isLoading || (q.isFetching && pageRows.length === 0)}
            emptyTitle="Nenhum registro com esses filtros"
            emptyDescription="Tente ampliar o período ou limpar os filtros."
            page={pg.page}
            pageSize={pg.pageSize}
            total={total}
            onPage={pg.setPage}
            keyFn={(r, i) => mode.rowKey?.(r, i) ?? r.id ?? String(i)}
            onRowClick={mode.detail ? (r) => setDetail(r) : mode.rowHref ? (r) => { const h = mode.rowHref!(r); if (h) router.push(h); } : undefined}
            mobileCard={(r) => <MobileCard mode={mode} cols={cols} row={r} />}
          />

          {totalsCols.length > 0 && pageRows.length > 0 && (
            <section className="card mt-3 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {grandTotals ? `Totais de todas as ${(totalsRows?.length ?? 0).toLocaleString("pt-BR")} linhas${allTotals?.truncated ? " (limitado)" : ""}` : "Totais desta página"}
                </h2>
                {!mode.fetchAll && !grandTotals && total > pageRows.length && (
                  <Button size="sm" variant="soft" disabled={Boolean(exporting)} onClick={() => void sumAll()}>Somar todas as {total.toLocaleString("pt-BR")} linhas</Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {totalsCols.map((c) => {
                  const v = (grandTotals ?? pageTotals)[c.key] ?? 0;
                  return (
                    <div key={c.key} className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
                      <p className="text-lg font-extrabold tabular-nums">{cellText({ ...c, value: () => v, unit: undefined }, {})}</p>
                    </div>
                  );
                })}
              </div>
              {!grandTotals && total > pageRows.length && <p className="mt-2 text-xs text-slate-500">Os totais acima consideram só os {pageRows.length} registros desta página.</p>}
            </section>
          )}
        </>
      )}

      <p className="mt-4 text-center text-xs text-slate-600">Unidade {store.name} · {fmtDateTime(new Date().toISOString())} · <Link href="/relatorios" className="text-[var(--accent)]">todos os relatórios</Link></p>

      <ReportDetailDrawer kind={mode.detail ?? null} row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function renderCell(c: ReportColumn, r: Row): React.ReactNode {
  if (c.kind === "badge" && c.badge) {
    const b = c.badge(r);
    return <Badge tone={b.tone}>{b.label}</Badge>;
  }
  if (c.kind === "bool") {
    const v = c.value ? c.value(r) : r[c.key];
    return v === null || v === undefined ? "—" : v ? <Badge tone="green">Sim</Badge> : <span className="text-slate-500">Não</span>;
  }
  if (c.kind === "pct" && c.delta) {
    const v = Number(c.value ? c.value(r) : r[c.key]);
    const txt = cellText(c, r);
    if (!Number.isFinite(v) || txt === "—") return <span className="text-slate-500">—</span>;
    return <span className={v > 0 ? "text-rose-300" : v < 0 ? "text-emerald-300" : ""}>{v > 0 ? "▲ " : v < 0 ? "▼ " : ""}{txt}</span>;
  }
  const txt = cellText(c, r);
  return txt === "" || txt === "—" ? <span className="text-slate-500">—</span> : txt;
}

function MobileCard({ mode, cols, row }: { mode: ReportMode; cols: ReportColumn[]; row: Row }) {
  const byKey = (k: string) => cols.find((c) => c.key === k);
  const m = mode.mobile ?? { title: cols[0]?.key ?? "", subtitle: cols.slice(1, 4).map((c) => c.key), value: cols.find((c) => c.kind === "money" || c.kind === "qty")?.key };
  const titleCol = byKey(m.title);
  const valueCol = m.value ? byKey(m.value) : undefined;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{titleCol ? cellText(titleCol, row) : "—"}</p>
        <p className="truncate text-xs text-slate-500">
          {m.subtitle.map((k) => byKey(k)).filter((c): c is ReportColumn => Boolean(c)).map((c) => cellText(c, row)).filter((t) => t && t !== "—").join(" · ")}
        </p>
      </div>
      {valueCol && <div className="shrink-0 text-right font-bold tabular-nums">{renderCell(valueCol, row)}</div>}
    </div>
  );
}
