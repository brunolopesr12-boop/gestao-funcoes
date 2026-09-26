"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { useProduct, useProductLots } from "@/lib/ops/hooks";
import { daysLabel, EXPIRY_META, fmtDate, fmtDateTime, fmtMoney, fmtQty, LEVEL_META } from "@/lib/ops/format";
import { LOT_ORIGIN_LABEL, LOT_STATUS_LABEL, MOVEMENT_LABEL, PRODUCT_KIND_LABEL, STORAGE_TYPE_LABEL, type Movement, type StockBalance, type StockByProduct } from "@/lib/ops/types";
import { movementTone } from "@/lib/ops/modules/estoque";
import { Badge, Button, DataTable, EmptyState, ErrorBox, InlineAlert, KpiCard, LevelDot, PageHeader, Row, SectionCard, Skeleton, toneFor, type Column } from "@/components/ops/ui";
import { ProductThumb } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { ConsumeDrawer } from "@/components/ops/estoque/ConsumeDrawer";
import { AdjustDrawer } from "@/components/ops/estoque/AdjustDrawer";
import { ManualEntryDrawer } from "@/components/ops/estoque/ManualEntryDrawer";
import { LotActionLinks } from "@/components/ops/estoque/LotActionLinks";

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <ProductStockPage />
    </Suspense>
  );
}

/** Ficha de estoque de um produto na unidade: saldos por lote × local, movimentações e ações. */
function ProductStockPage() {
  const { productId } = useParams<{ productId: string }>();
  const sp = useSearchParams();
  const acao = sp.get("acao");
  const { store, can } = useSession();

  const product = useProduct(productId);
  const summary = useQuery({
    queryKey: ["stock_items", "by_product", store?.id, "one", productId],
    enabled: Boolean(store?.id && productId),
    queryFn: async () => {
      const res = await supabaseBrowser().from("v_stock_by_product").select("*").eq("store_id", store!.id).eq("product_id", productId).maybeSingle();
      if (res.error) throw toOpsError(res.error);
      return (res.data ?? null) as StockByProduct | null;
    },
  });
  const lots = useProductLots(productId);
  const movements = useQuery({
    queryKey: ["stock_movements", "product", store?.id, productId],
    enabled: Boolean(store?.id && productId),
    queryFn: async () => {
      const res = await supabaseBrowser().from("v_movements").select("*").eq("store_id", store!.id).eq("product_id", productId).order("created_at", { ascending: false }).limit(20);
      if (res.error) throw toOpsError(res.error);
      return (res.data ?? []) as Movement[];
    },
  });
  useRealtimeInvalidate(["stock_items", "stock_lots"], [["stock_items"], ["stock_lots"], ["stock_movements"]]);

  const [consume, setConsume] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [entry, setEntry] = useState(false);

  // ação vinda do QR (/qr?next=consumir) ou de outro atalho
  useEffect(() => {
    if (!product.data) return;
    if (acao === "consumir" && can("estoque.movimentar")) setConsume(true);
    else if (acao === "ajustar" && can("estoque.ajustar")) setAdjust(true);
    else if (acao === "entrada" && can("estoque.ajustar")) setEntry(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao, product.data?.id]);

  if (product.isLoading || summary.isLoading) return <Skeleton rows={4} />;
  if (product.error) return <ErrorBox error={toOpsError(product.error as Error).message} onRetry={() => void product.refetch()} />;
  if (!product.data) return <EmptyState emoji="🔎" title="Produto não encontrado" description="Ele pode ter sido removido ou pertencer a outra empresa." action={<Link href="/estoque" className="text-sm font-semibold text-[var(--accent)]">Voltar ao estoque</Link>} />;

  const p = product.data;
  const s = summary.data;
  const unit = p.units?.code ?? s?.unit ?? "";
  const lotRows = lots.data ?? [];
  const hasBalance = lotRows.length > 0;

  const lotColumns: Column<StockBalance>[] = [
    {
      key: "lot_code",
      label: "Lote",
      render: (r) => (
        <div>
          <Link href={`/lote/${r.lot_id}`} className="font-mono font-semibold text-[var(--accent)]" onClick={(e) => e.stopPropagation()}>{r.lot_code || "—"}</Link>
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
    { key: "unit_cost", label: "Custo", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.unit_cost)}</span> },
    { key: "total_value", label: "Valor", align: "right", render: (r) => <span className="tabular-nums">{fmtMoney(r.total_value)}</span> },
  ];

  const movColumns: Column<Movement>[] = [
    { key: "created_at", label: "Data", render: (r) => <span className="whitespace-nowrap tabular-nums text-slate-300">{fmtDateTime(r.created_at)}</span> },
    { key: "movement_type", label: "Tipo", render: (r) => <Badge tone={movementTone(r.movement_type, Number(r.quantity))}>{MOVEMENT_LABEL[r.movement_type]}</Badge> },
    { key: "lot_code", label: "Lote", render: (r) => <Link href={`/lote/${r.lot_id}`} className="font-mono text-[var(--accent)]">{r.lot_code || "—"}</Link> },
    { key: "location_name", label: "Local", hideOnMobile: true },
    {
      key: "quantity",
      label: "Quantidade",
      align: "right",
      render: (r) => <span className={`font-bold tabular-nums ${Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(r.quantity) >= 0 ? "+" : ""}{fmtQty(r.quantity, r.unit)}</span>,
    },
    { key: "balance_after", label: "Saldo após", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtQty(r.balance_after, r.unit)}</span> },
    { key: "created_by_name", label: "Usuário", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.created_by_name || "—"}</span> },
    { key: "reason", label: "Motivo", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.reason || r.notes || "—"}</span> },
  ];

  return (
    <div>
      <PageHeader
        backHref="/estoque"
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2">
            {p.internal_code && <span className="font-mono">{p.internal_code}</span>}
            <span>{PRODUCT_KIND_LABEL[p.product_kind]}</span>
            {p.categories?.name && <span>· {p.categories.emoji} {p.categories.name}</span>}
            <span>· unidade: {unit}</span>
            <span>· {STORAGE_TYPE_LABEL[p.storage_type]}</span>
          </span>
        }
      />

      {!p.active && <InlineAlert tone="amber">Este produto está inativo no cadastro. Ele ainda pode ter saldo, mas não aparece nas buscas.</InlineAlert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {/* resumo */}
          <div className="mb-4 flex items-start gap-3">
            <ProductThumb product={p} size={56} />
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="Saldo" value={fmtQty(s?.quantity ?? 0, unit)} tone={s ? (s.level === "normal" ? "green" : s.level === "atencao" ? "amber" : "red") : "slate"} />
              <KpiCard label="Valor total" value={fmtMoney(s?.total_value ?? 0)} />
              <KpiCard label="Custo unitário" value={fmtMoney(s?.cost ?? p.cost)} hint={p.last_purchase_price > 0 ? `última compra ${fmtMoney(p.last_purchase_price)}` : undefined} />
              <KpiCard
                label="Nível"
                value={s ? <span className="text-base"><LevelDot level={s.level} /> {LEVEL_META[s.level].short}</span> : "—"}
                hint={s ? LEVEL_META[s.level].label : undefined}
              />
            </div>
          </div>

          {s && (Number(s.expired_quantity) > 0 || Number(s.blocked_quantity) > 0) && (
            <InlineAlert tone="red">
              {Number(s.expired_quantity) > 0 && <span className="block">Há <strong>{fmtQty(s.expired_quantity, unit)}</strong> em lotes vencidos — registre como perda ou ajuste.</span>}
              {Number(s.blocked_quantity) > 0 && <span className="block">Há <strong>{fmtQty(s.blocked_quantity, unit)}</strong> em lotes bloqueados (não entram no saldo disponível).</span>}
            </InlineAlert>
          )}

          <SectionCard title="Saldos por lote e local" className="mb-4" action={s?.next_expiry ? <span className="text-xs text-slate-400">próxima validade {fmtDate(s.next_expiry)}</span> : undefined}>
            {lots.error ? (
              <ErrorBox error={toOpsError(lots.error as Error).message} onRetry={() => void lots.refetch()} />
            ) : (
              <DataTable
                columns={lotColumns}
                rows={lotRows}
                loading={lots.isLoading}
                keyFn={(r) => r.id}
                rowHref={(r) => `/lote/${r.lot_id}`}
                emptyTitle="Sem saldo nesta unidade"
                emptyDescription={can("estoque.ajustar") ? "Use “Entrada manual” para lançar o estoque inicial ou registre um Recebimento." : "Registre um Recebimento para dar entrada."}
                mobileCard={(r) => (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono font-semibold">{r.lot_code || "—"} <Badge tone={toneFor(r.lot_status)} className="ml-1">{LOT_STATUS_LABEL[r.lot_status]}</Badge></p>
                      <p className="text-xs text-slate-400">{r.location_name} · {fmtDate(r.expires_at)}</p>
                      <span className={`mt-1 inline-block rounded-full border px-2 text-[11px] font-semibold ${EXPIRY_META[r.expiry_status].className}`}>{r.expires_at ? daysLabel(r.days_to_expire) : "sem validade"}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</p>
                      <p className="text-xs text-slate-400">{fmtMoney(r.total_value)}</p>
                    </div>
                  </div>
                )}
              />
            )}
          </SectionCard>

          <SectionCard title="Movimentações recentes" action={<Link href={`/estoque/movimentacoes?product=${p.id}`} className="text-xs font-semibold text-[var(--accent)]">ver todas</Link>}>
            {movements.error ? (
              <ErrorBox error={toOpsError(movements.error as Error).message} onRetry={() => void movements.refetch()} />
            ) : (
              <DataTable
                columns={movColumns}
                rows={movements.data ?? []}
                loading={movements.isLoading}
                emptyTitle="Nenhuma movimentação ainda"
                emptyDescription="Entradas, consumos, perdas e ajustes deste produto aparecem aqui."
                mobileCard={(r) => (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2"><Badge tone={movementTone(r.movement_type, Number(r.quantity))}>{MOVEMENT_LABEL[r.movement_type]}</Badge><span className="font-mono text-xs text-slate-400">{r.lot_code}</span></p>
                      <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)} · {r.location_name} · {r.created_by_name || "—"}</p>
                    </div>
                    <span className={`font-bold tabular-nums ${Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(r.quantity) >= 0 ? "+" : ""}{fmtQty(r.quantity, r.unit)}</span>
                  </div>
                )}
              />
            )}
          </SectionCard>
        </div>

        {/* ações */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <SectionCard title="Ações">
            <div className="grid gap-2">
              {can("estoque.movimentar") && (
                <Button variant="primary" size="lg" full disabled={!hasBalance} onClick={() => setConsume(true)}>
                  <Icon name="minus" size={18} /> Consumir
                </Button>
              )}
              {can("estoque.ajustar") && (
                <Button variant="soft" size="lg" full disabled={!hasBalance} onClick={() => setAdjust(true)}>
                  <Icon name="edit" size={18} /> Ajustar saldo
                </Button>
              )}
              {can("estoque.ajustar") && (
                <Button variant="soft" size="lg" full onClick={() => setEntry(true)}>
                  <Icon name="plus" size={18} /> Entrada manual
                </Button>
              )}
            </div>
            <div className="mt-3">
              <LotActionLinks productId={p.id} compact />
            </div>
            {!hasBalance && <p className="mt-3 text-xs text-slate-500">Consumo, ajuste e transferência ficam disponíveis quando o produto tiver saldo.</p>}
          </SectionCard>

          <SectionCard title="Parâmetros na unidade">
            <Row label="Mínimo">{Number(s?.min_stock) > 0 ? fmtQty(s?.min_stock, unit) : "—"}</Row>
            <Row label="Máximo">{Number(s?.max_stock) > 0 ? fmtQty(s?.max_stock, unit) : "—"}</Row>
            <Row label="Ponto de reposição">{Number(s?.reorder_point) > 0 ? fmtQty(s?.reorder_point, unit) : "—"}</Row>
            <Row label="Estoque ideal">{Number(s?.ideal_stock) > 0 ? fmtQty(s?.ideal_stock, unit) : "—"}</Row>
            {s && Number(s.suggested_purchase) > 0 && <Row label="Sugestão de compra"><span className="text-amber-300">{fmtQty(s.suggested_purchase, unit)}</span></Row>}
            <Row label="Validade padrão">{p.shelf_life_days ? `${p.shelf_life_days} dias` : "—"}</Row>
            {p.shelf_life_open_days !== null && <Row label="Após abrir">{p.shelf_life_open_days} dias</Row>}
            {p.shelf_life_frozen_days !== null && <Row label="Congelado">{p.shelf_life_frozen_days} dias</Row>}
            {p.shelf_life_thawed_days !== null && <Row label="Descongelado">{p.shelf_life_thawed_days} dias</Row>}
            {p.suppliers?.name && <Row label="Fornecedor padrão">{p.suppliers.name}</Row>}
            {can("produtos.editar") && (
              <Link href={`/produtos/${p.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                Editar cadastro do produto <Icon name="chevronRight" size={14} />
              </Link>
            )}
          </SectionCard>
        </aside>
      </div>

      <ConsumeDrawer open={consume} onClose={() => setConsume(false)} product={p} onDone={() => void summary.refetch()} />
      <AdjustDrawer open={adjust} onClose={() => setAdjust(false)} product={p} onDone={() => void summary.refetch()} />
      <ManualEntryDrawer open={entry} onClose={() => setEntry(false)} product={p} onDone={() => void summary.refetch()} />
    </div>
  );
}
