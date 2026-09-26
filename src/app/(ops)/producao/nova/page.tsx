"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { useOfflineQueue } from "@/lib/ops/offline";
import { fmtDate, fmtMoney, fmtQty, newId, todayISO } from "@/lib/ops/format";
import type { ProductionPlan } from "@/lib/ops/types";
import {
  buildConsumeItems, effectiveShortages, estimatedCost, portionsOf, useActiveRecipes, useProductionPlan, useRecipe,
  type FinishValues, type PlanOverrides, type ProduceResult, type RecipeRow,
} from "@/lib/ops/modules/producao";
import { LocationSelect, ProductThumb } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import {
  Badge, Button, Choice, EmptyState, ErrorBox, Field, InlineAlert, NumberInput, PageHeader, SearchInput, SectionCard, Skeleton, TextArea, TextInput, useDebounced, useToast,
} from "@/components/ops/ui";
import { ProductionPlanTable } from "@/components/ops/producao/ProductionPlanTable";
import { FinishProductionForm } from "@/components/ops/producao/FinishProductionForm";
import { ProductionResultView } from "@/components/ops/producao/ProductionResultView";
import { ConfirmActionSheet, FieldBlock, LinkButton, StepBar, StepsList } from "@/components/ops/producao/shared";

const STEPS = ["Ficha técnica", "Quantidade e ingredientes", "Concluir"];

export default function NewProductionPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl"><Skeleton rows={3} /></div>}>
      <NewProduction />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Passo 1: escolher a ficha                                           */
/* ------------------------------------------------------------------ */
function RecipeStep({ onPick }: { onPick: (r: RecipeRow) => void }) {
  const { canCompany } = useSession();
  const [term, setTerm] = useState("");
  const t = useDebounced(term, 250);
  const q = useActiveRecipes(t);
  const rows = q.data ?? [];
  return (
    <SectionCard title="Qual ficha técnica você vai produzir?">
      <SearchInput value={term} onChange={setTerm} placeholder="Buscar pelo nome da ficha ou do produto" autoFocus className="mb-3" />
      {q.isLoading ? (
        <Skeleton rows={3} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📖"
          title={t ? "Nenhuma ficha encontrada" : "Nenhuma ficha técnica ativa"}
          description={t ? "Tente outro nome." : "Cadastre uma ficha técnica com ingredientes e rendimento para poder produzir."}
          action={!t && canCompany("fichas.editar") ? <LinkButton href="/fichas/nova" icon="plus">Nova ficha</LinkButton> : undefined}
        />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r)} className="flex w-full items-center gap-3 py-3 text-left active:bg-white/5">
                {r.products && <ProductThumb product={r.products} size={44} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold">{r.name}</span>
                    <Badge tone="slate">v{r.version}</Badge>
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {r.products?.name ?? "—"} · rende {fmtQty(r.yield_quantity, r.products?.units?.code)}
                    {portionsOf(r) ? ` · ${fmtQty(portionsOf(r))} porções` : ""}{r.prep_time_min ? ` · ${r.prep_time_min} min` : ""}
                  </span>
                </span>
                <Icon name="chevronRight" className="text-slate-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Fluxo                                                               */
/* ------------------------------------------------------------------ */
function NewProduction() {
  const { store, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const recipeParam = params.get("recipe");
  const notify = useToast();
  const invalidate = useInvalidate();
  const { online } = useOfflineQueue();

  const canPlan = can("producao.criar");
  const canFinish = can("producao.finalizar");

  const [step, setStep] = useState(0);
  const [recipe, setRecipe] = useState<RecipeRow | null>(null);
  const [planned, setPlanned] = useState<number | null>(null);
  const plannedDeb = useDebounced(planned, 400);
  const [overrides, setOverrides] = useState<PlanOverrides>({});
  const [mode, setMode] = useState<"agora" | "planejar">(canFinish ? "agora" : "planejar");
  const [scheduledFor, setScheduledFor] = useState(todayISO());
  const [planLocation, setPlanLocation] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProduceResult | null>(null);
  const [clientOpId, setClientOpId] = useState(() => newId());

  // ficha vinda da URL (?recipe=)
  const fromParam = useRecipe(recipeParam);
  useEffect(() => {
    if (fromParam.data && !recipe && step === 0) chooseRecipe(fromParam.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam.data]);

  function chooseRecipe(r: RecipeRow) {
    setRecipe(r);
    setPlanned(Number(r.yield_quantity));
    setOverrides({});
    setStep(1);
  }

  const plan = useProductionPlan(store?.id, recipe?.id, plannedDeb);
  const planData: ProductionPlan | undefined = plan.data ?? undefined;

  // ao mudar a quantidade planejada, os ajustes de quantidade perdem sentido (mantém só o lote escolhido)
  useEffect(() => {
    setOverrides((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { lot: v.lot }])));
  }, [planData?.planned]);

  const unit = recipe?.products?.units?.code ?? planData?.unit ?? "";
  const productName = recipe?.products?.name ?? planData?.product_name ?? "";
  const shortages = planData ? effectiveShortages(planData, overrides) : [];
  const plannedOk = Boolean(planned && planned > 0);

  async function createPlanned() {
    if (!store || !recipe || !plannedDeb) return;
    setBusy(true);
    try {
      const id = await rpc<string>("ops_production_create", {
        p_store: store.id, p_recipe: recipe.id, p_planned: plannedDeb, p_notes: planNotes.trim(), p_scheduled_for: scheduledFor || null, p_location: planLocation || null,
      });
      invalidate("productions", "alerts");
      notify("Produção planejada");
      setConfirmPlan(false);
      router.push(`/producao/${id}`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
      setBusy(false);
    }
  }

  async function produceNow(v: FinishValues) {
    if (!store || !recipe || !planData || !plannedDeb) return;
    if (!online) return notify("Sem conexão. A produção exige internet.", "erro");
    setBusy(true);
    try {
      const r = await rpc<ProduceResult>("ops_produce_now", {
        p_store: store.id,
        p_recipe: recipe.id,
        p_planned: plannedDeb,
        p_produced: v.produced,
        p_location: v.locationId || null,
        p_lot_code: v.lotCode,
        p_expires_at: v.expiresAt || null,
        p_items: buildConsumeItems(planData, overrides),
        p_notes: v.notes,
        p_client_op_id: clientOpId,
      });
      invalidate("productions", "production_items", "stock_items", "stock_lots", "stock_movements", "v_stock_balances", "alerts", "production_plan");
      notify(r.duplicated ? "Esta produção já estava registrada." : "Produção registrada e lote criado");
      setResult(r);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
      void plan.refetch();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setRecipe(null);
    setPlanned(null);
    setOverrides({});
    setStep(0);
    setPlanNotes("");
    setClientOpId(newId());
    if (recipeParam) router.replace("/producao/nova");
  }

  if (!canPlan && !canFinish) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Nova produção" backHref="/producao" icon="flame" />
        <InlineAlert tone="amber">Você não tem permissão para criar produções nesta unidade.</InlineAlert>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Produção concluída" subtitle={store?.name} backHref="/producao" icon="flame" />
        <ProductionResultView result={result} planned={plannedDeb ?? 0} unit={unit} productName={productName} onNew={reset} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Nova produção" subtitle={store?.name} backHref="/producao" icon="flame" />
      <StepBar step={step} steps={STEPS} onStep={setStep} />

      {step === 0 && (
        recipeParam && fromParam.isLoading ? (
          <Skeleton rows={2} />
        ) : recipeParam && fromParam.error ? (
          <>
            <ErrorBox error={toOpsError(fromParam.error as Error).message} />
            <div className="mt-3"><RecipeStep onPick={chooseRecipe} /></div>
          </>
        ) : (
          <RecipeStep onPick={chooseRecipe} />
        )
      )}

      {step >= 1 && recipe && (
        <div className="card mb-4 flex items-center gap-3 p-3">
          {recipe.products && <ProductThumb product={recipe.products} size={44} />}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-bold"><span className="truncate">{recipe.name}</span><Badge tone="slate">v{recipe.version}</Badge></p>
            <p className="truncate text-xs text-slate-400">{productName} · ficha rende {fmtQty(recipe.yield_quantity, unit)}</p>
          </div>
          {step === 1 && <Button size="sm" variant="ghost" onClick={() => { setStep(0); setRecipe(null); }}>Trocar</Button>}
        </div>
      )}

      {step === 1 && recipe && store && (
        <>
          <SectionCard title="Quanto você vai produzir?" className="mb-4">
            <NumberInput big value={planned} onChange={setPlanned} min={0} suffix={unit} placeholder="0" autoFocus />
            <p className="mt-1 text-xs text-slate-500">
              A ficha rende {fmtQty(recipe.yield_quantity, unit)}; os ingredientes são calculados na proporção.
              {planData && planData.scale !== 1 ? ` Escala: ${fmtQty(planData.scale, null, 2)}×.` : ""}
            </p>
          </SectionCard>

          <SectionCard title="Ingredientes necessários" className="mb-4">
            {!plannedOk ? (
              <p className="text-sm text-slate-400">Informe a quantidade para ver os ingredientes.</p>
            ) : plan.isLoading || (plan.isFetching && !planData) ? (
              <Skeleton rows={3} />
            ) : plan.error ? (
              <ErrorBox error={toOpsError(plan.error as Error).message} onRetry={() => void plan.refetch()} />
            ) : planData ? (
              <ProductionPlanTable plan={planData} overrides={overrides} onChange={setOverrides} editable storeId={store.id} />
            ) : null}
          </SectionCard>

          {recipe.instructions && (
            <details className="card mb-4 p-4">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-400">Modo de preparo</summary>
              <div className="mt-3"><StepsList instructions={recipe.instructions} /></div>
            </details>
          )}

          <div className="flex gap-3">
            <Button variant="soft" size="lg" onClick={() => setStep(0)}>Voltar</Button>
            <Button variant="primary" size="lg" full disabled={!plannedOk || !planData || plan.isFetching} onClick={() => setStep(2)}>
              Continuar <Icon name="chevronRight" size={18} />
            </Button>
          </div>
        </>
      )}

      {step === 2 && recipe && store && planData && (
        <>
          <SectionCard title="O que fazer agora?" className="mb-4">
            <Choice
              value={mode}
              onChange={setMode}
              options={[
                ...(canFinish ? [{ value: "agora" as const, label: "Produzir agora", hint: "Baixa os ingredientes e cria o lote", icon: "flame" as const }] : []),
                ...(canPlan ? [{ value: "planejar" as const, label: "Só planejar", hint: "Fica agendada para produzir depois", icon: "calendar" as const }] : []),
              ]}
            />
            <p className="-mt-2 text-xs text-slate-500">
              {fmtQty(planData.planned, unit)} de {productName} · {planData.items.length} ingrediente(s) · custo estimado {fmtMoney(estimatedCost(planData, overrides))}
              {planData.suggested_expires_at ? ` · validade sugerida ${fmtDate(planData.suggested_expires_at)}` : ""}
            </p>
          </SectionCard>

          {mode === "planejar" && canPlan && (
            <SectionCard title="Planejamento" className="mb-4">
              {shortages.length > 0 && (
                <InlineAlert tone="amber">Hoje falta estoque para {shortages.length === 1 ? "1 ingrediente" : `${shortages.length} ingredientes`}. Você pode planejar mesmo assim e produzir quando a mercadoria chegar.</InlineAlert>
              )}
              <Field label="Data prevista">
                <TextInput type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
              </Field>
              <Field label="Local de destino (opcional)" hint="Onde o lote produzido será guardado">
                <LocationSelect value={planLocation} onChange={setPlanLocation} storeId={store.id} allowEmpty placeholder="Local padrão" />
              </Field>
              <Field label="Observações">
                <TextArea value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} rows={2} placeholder="Ex.: para o evento de sábado" />
              </Field>
              <FieldBlock label="Resumo">
                <p className="text-sm text-slate-300">{fmtQty(plannedDeb ?? 0, unit)} de <strong>{productName}</strong>, previsto para {fmtDate(scheduledFor)}.</p>
              </FieldBlock>
              <Button variant="primary" size="lg" full disabled={busy} onClick={() => setConfirmPlan(true)}>Salvar planejamento</Button>
            </SectionCard>
          )}

          {mode === "agora" && canFinish && (
            <SectionCard title="Produzir agora" className="mb-4">
              {!online && <InlineAlert tone="red" icon="wifiOff">Sem conexão. A produção exige internet porque baixa o estoque e cria o lote na hora. Você pode <strong>só planejar</strong> e concluir depois.</InlineAlert>}
              <FinishProductionForm
                planned={plannedDeb ?? 0}
                unit={unit}
                productName={productName}
                suggestedExpiresAt={planData.suggested_expires_at}
                shelfLifeDays={planData.shelf_life_days}
                storeId={store.id}
                busy={busy}
                blockedReason={
                  !online
                    ? "Sem conexão com a internet."
                    : shortages.length > 0
                      ? `Falta estoque: ${shortages.map((s) => `${s.name} (${fmtQty(s.missing, s.unit)})`).join(", ")}. Volte e ajuste a quantidade a consumir ou troque o lote.`
                      : null
                }
                submitLabel="Produzir e criar lote"
                onSubmit={produceNow}
              />
            </SectionCard>
          )}

          <div className="flex gap-3">
            <Button variant="soft" size="lg" onClick={() => setStep(1)} disabled={busy}>Voltar</Button>
          </div>

          <ConfirmActionSheet
            open={confirmPlan}
            onClose={() => setConfirmPlan(false)}
            title="Salvar planejamento"
            confirmLabel="Salvar"
            busy={busy}
            onConfirm={createPlanned}
            message={<p>Planejar <strong>{fmtQty(plannedDeb ?? 0, unit)}</strong> de <strong>{productName}</strong> para {fmtDate(scheduledFor)}? Nada será baixado do estoque agora.</p>}
          />
        </>
      )}
    </div>
  );
}
