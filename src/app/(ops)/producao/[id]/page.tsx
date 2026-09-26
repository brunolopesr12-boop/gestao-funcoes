"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { useOfflineQueue } from "@/lib/ops/offline";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, newId } from "@/lib/ops/format";
import { buildConsumeItems, effectiveShortages, useProduction, useProductionItems, useProductionPlan, type FinishValues, type PlanOverrides, type ProduceResult } from "@/lib/ops/modules/producao";
import { Icon } from "@/components/ops/Icon";
import { Button, Drawer, ErrorBox, InlineAlert, PageHeader, Row, SectionCard, Skeleton, useToast } from "@/components/ops/ui";
import { ProductionPlanTable } from "@/components/ops/producao/ProductionPlanTable";
import { FinishProductionForm } from "@/components/ops/producao/FinishProductionForm";
import { ProductionResultView } from "@/components/ops/producao/ProductionResultView";
import { ConfirmActionSheet, LinkButton, ProductionStatusBadge, ProductionTimeline, ReasonSheet, StepsList, YieldBadge } from "@/components/ops/producao/shared";

export default function ProductionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { store, can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const { online } = useOfflineQueue();

  const q = useProduction(id);
  const items = useProductionItems(id);
  useRealtimeInvalidate(["productions"]);

  const [startOpen, setStartOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProduceResult | null>(null);
  const [overrides, setOverrides] = useState<PlanOverrides>({});
  const [clientOpId] = useState(() => newId());

  const p = q.data;
  const open = p?.status === "planejada" || p?.status === "em_andamento";
  const unit = p?.products?.units?.code ?? "";
  const canCreate = can("producao.criar");
  const canFinish = can("producao.finalizar");

  // plano (ingredientes previstos) para produções ainda abertas
  const plan = useProductionPlan(open ? store?.id : null, p?.recipe_id, p ? Number(p.planned_quantity) : null);
  const shortages = plan.data ? effectiveShortages(plan.data, overrides) : [];

  useEffect(() => {
    if (!finishOpen) setOverrides({});
  }, [finishOpen]);

  async function start() {
    setBusy(true);
    try {
      await rpc("ops_production_start", { p_production: id });
      invalidate("productions");
      notify("Produção iniciada");
      setStartOpen(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(reason: string) {
    setBusy(true);
    try {
      await rpc("ops_production_cancel", { p_production: id, p_reason: reason });
      invalidate("productions", "alerts");
      notify("Produção cancelada");
      setCancelOpen(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function finish(v: FinishValues) {
    if (!p || !plan.data) return;
    if (!online) return notify("Sem conexão. A conclusão da produção exige internet.", "erro");
    setBusy(true);
    try {
      const r = await rpc<ProduceResult>("ops_production_finish", {
        p_production: id,
        p_produced: v.produced,
        p_location: v.locationId || null,
        p_lot_code: v.lotCode,
        p_expires_at: v.expiresAt || null,
        p_items: buildConsumeItems(plan.data, overrides),
        p_notes: v.notes,
        p_client_op_id: clientOpId,
      });
      invalidate("productions", "production_items", "stock_items", "stock_lots", "stock_movements", "v_stock_balances", "alerts", "production_plan");
      notify(r.duplicated ? "Esta produção já estava concluída." : "Produção concluída e lote criado");
      setFinishOpen(false);
      setResult(r);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
      void plan.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Produção" backHref="/producao" icon="flame" />
        <Skeleton rows={4} />
      </div>
    );
  }
  if (q.error || !p) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Produção" backHref="/producao" icon="flame" />
        <ErrorBox error={q.error ? toOpsError(q.error as Error).message : "Produção não encontrada."} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const productName = p.products?.name ?? "Produto";
  const planned = Number(p.planned_quantity);
  const noRecipe = !p.recipe_id;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Produção ${p.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ProductionStatusBadge status={p.status} />
            <span>{productName}</span>
          </span>
        }
        backHref="/producao"
        icon="flame"
        actions={
          open ? (
            <>
              {p.status === "planejada" && canCreate && <Button variant="soft" onClick={() => setStartOpen(true)} disabled={busy}><Icon name="clock" size={16} /> Iniciar</Button>}
              {canFinish && <Button variant="success" onClick={() => setFinishOpen(true)} disabled={busy || noRecipe}><Icon name="check" size={16} /> Concluir</Button>}
              {canCreate && <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={busy}><Icon name="x" size={16} /> Cancelar</Button>}
            </>
          ) : p.status === "concluida" ? (
            <>
              {p.lot_id && can("etiquetas.imprimir") && <LinkButton href={`/etiquetas/imprimir?lot=${encodeURIComponent(p.lot_id)}&kind=producao`} variant="soft" icon="printer">Etiqueta</LinkButton>}
              {(canCreate || canFinish) && <LinkButton href={p.recipe_id ? `/producao/nova?recipe=${p.recipe_id}` : "/producao/nova"} icon="flame">Nova produção</LinkButton>}
            </>
          ) : undefined
        }
      />

      {result && (
        <div className="mb-4">
          <ProductionResultView result={result} planned={planned} unit={unit} productName={productName} />
        </div>
      )}

      {open && noRecipe && <InlineAlert tone="red">Esta produção não tem ficha técnica vinculada (a ficha foi excluída). Não é possível calcular os ingredientes; cancele e crie uma nova produção.</InlineAlert>}
      {open && !online && <InlineAlert tone="amber" icon="wifiOff">Sem conexão. Iniciar, concluir ou cancelar a produção exige internet.</InlineAlert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <SectionCard title="Resumo">
            <div className="divide-y divide-[var(--line)]">
              <Row label="Produto">
                <span>{productName}</span>
                {p.products?.internal_code && <span className="ml-2 font-mono text-xs text-slate-500">{p.products.internal_code}</span>}
              </Row>
              <Row label="Ficha técnica">
                {p.recipes ? (
                  <Link href={`/fichas/${p.recipes.id}`} className="inline-flex items-center gap-1 text-[var(--accent)]">{p.recipes.name} · v{p.recipes.version} <Icon name="chevronRight" size={14} /></Link>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </Row>
              <Row label="Planejado">{fmtQty(p.planned_quantity, unit)}</Row>
              <Row label="Produzido">{p.produced_quantity !== null && p.produced_quantity !== undefined ? fmtQty(p.produced_quantity, unit) : <span className="text-slate-500">—</span>}</Row>
              <Row label="Rendimento real"><YieldBadge pct={p.actual_yield_pct} /></Row>
              <Row label="Lote">
                {p.lot_id ? (
                  <Link href={`/lote/${p.lot_id}`} className="inline-flex items-center gap-1 font-mono text-[var(--accent)]">{p.lot?.lot_code || p.lot_code} <Icon name="chevronRight" size={14} /></Link>
                ) : (
                  <span className="text-slate-500">{p.lot_code || "—"}</span>
                )}
              </Row>
              <Row label="Validade">{fmtDate(p.expires_at)}</Row>
              <Row label="Local de destino">{p.stock_locations?.name ?? <span className="text-slate-500">local padrão</span>}</Row>
              {p.status === "concluida" && (
                <>
                  <Row label="Custo total">{fmtMoney(p.total_cost)}</Row>
                  <Row label="Custo unitário">{fmtMoney(p.unit_cost)}{unit ? `/${unit}` : ""}</Row>
                </>
              )}
              <Row label="Responsável">{p.produced_by_name || p.created_by_name || "—"}</Row>
              {p.scheduled_for && <Row label="Data prevista">{fmtDate(p.scheduled_for)}</Row>}
              <Row label="Criada em">{fmtDateTime(p.created_at)}{p.created_by_name ? ` · ${p.created_by_name}` : ""}</Row>
            </div>
            {p.notes && (
              <div className="mt-3 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Observações</p>
                <p className="whitespace-pre-line text-slate-200">{p.notes}</p>
              </div>
            )}
          </SectionCard>

          {open && !noRecipe && (
            <SectionCard title="Ingredientes previstos">
              {plan.isLoading ? (
                <Skeleton rows={2} />
              ) : plan.error ? (
                <ErrorBox error={toOpsError(plan.error as Error).message} onRetry={() => void plan.refetch()} />
              ) : plan.data && store ? (
                <ProductionPlanTable plan={plan.data} overrides={{}} onChange={() => undefined} editable={false} storeId={store.id} />
              ) : null}
            </SectionCard>
          )}

          {p.status === "concluida" && !result && (
            <SectionCard title="Ingredientes consumidos">
              {items.isLoading ? (
                <Skeleton rows={2} />
              ) : items.error ? (
                <ErrorBox error={toOpsError(items.error as Error).message} onRetry={() => void items.refetch()} />
              ) : (items.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum ingrediente foi baixado nesta produção.</p>
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {(items.data ?? []).map((it) => (
                    <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{it.products?.name ?? "Produto"}</p>
                        <p className="text-xs text-slate-500">
                          {it.lot_id ? (
                            <Link href={`/lote/${it.lot_id}`} className="font-mono text-[var(--accent)]">Lote {it.stock_lots?.lot_code ?? ""}</Link>
                          ) : (
                            "Lote —"
                          )}
                          {it.stock_locations?.name ? ` · ${it.stock_locations.name}` : ""}
                          {it.stock_lots?.expires_at ? ` · vence ${fmtDate(it.stock_lots.expires_at)}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold tabular-nums">{fmtQty(it.consumed_quantity, it.products?.units?.code)}</p>
                        <p className="text-xs text-slate-500 tabular-nums">{fmtMoney(it.unit_cost)}/{it.products?.units?.code ?? "un"} · {fmtMoney(it.total_cost)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard title="Linha do tempo">
            <ProductionTimeline p={p} />
          </SectionCard>
          {p.recipes?.instructions && (
            <SectionCard title="Modo de preparo">
              <StepsList instructions={p.recipes.instructions} />
            </SectionCard>
          )}
        </div>
      </div>

      {/* Iniciar */}
      <ConfirmActionSheet
        open={startOpen}
        onClose={() => setStartOpen(false)}
        title="Iniciar produção"
        confirmLabel="Iniciar"
        busy={busy}
        onConfirm={start}
        message={<p>Marcar a produção <strong>{p.number}</strong> ({fmtQty(p.planned_quantity, unit)} de {productName}) como em andamento? O estoque só é baixado ao concluir.</p>}
      />

      {/* Cancelar */}
      <ReasonSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar produção"
        message={`A produção ${p.number} será cancelada. Nenhum estoque é alterado. Informe o motivo.`}
        confirmLabel="Cancelar produção"
        busy={busy}
        onConfirm={cancel}
      />

      {/* Concluir */}
      <Drawer open={finishOpen} onClose={() => !busy && setFinishOpen(false)} title={`Concluir produção ${p.number}`} wide>
        {!online && <InlineAlert tone="red" icon="wifiOff">Sem conexão. A conclusão exige internet porque baixa o estoque e cria o lote.</InlineAlert>}
        <p className="mb-3 text-sm text-slate-300">
          <strong>{productName}</strong> · planejado {fmtQty(p.planned_quantity, unit)}
          {p.recipes ? ` · ficha ${p.recipes.name} v${p.recipes.version}` : ""}
        </p>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Ingredientes a consumir</h3>
        {plan.isLoading ? (
          <Skeleton rows={2} />
        ) : plan.error ? (
          <ErrorBox error={toOpsError(plan.error as Error).message} onRetry={() => void plan.refetch()} />
        ) : plan.data && store ? (
          <ProductionPlanTable plan={plan.data} overrides={overrides} onChange={setOverrides} editable storeId={store.id} />
        ) : null}
        <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Resultado</h3>
        {plan.data && store && (
          <FinishProductionForm
            planned={planned}
            unit={unit}
            productName={productName}
            suggestedExpiresAt={p.expires_at ?? plan.data.suggested_expires_at}
            shelfLifeDays={plan.data.shelf_life_days}
            initialLocationId={p.location_id}
            storeId={store.id}
            busy={busy}
            blockedReason={
              !online
                ? "Sem conexão com a internet."
                : shortages.length > 0
                  ? `Falta estoque: ${shortages.map((s) => `${s.name} (${fmtQty(s.missing, s.unit)})`).join(", ")}. Ajuste a quantidade a consumir ou troque o lote.`
                  : null
            }
            onSubmit={finish}
          />
        )}
      </Drawer>
    </div>
  );
}
