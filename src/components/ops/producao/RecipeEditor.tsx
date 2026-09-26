"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { fmtPct, fmtQty } from "@/lib/ops/format";
import { PRODUCT_KIND_LABEL, type Product } from "@/lib/ops/types";
import { duplicateRecipe, portionsOf, useRecipe, useRecipeCost, useRecipeItems, type RecipeItemRow, type RecipeRow } from "@/lib/ops/modules/producao";
import { ProductPicker, ProductThumb } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import {
  Badge, Button, ConfirmSheet, EmptyState, ErrorBox, Field, IconButton, InlineAlert, NumberInput, PageHeader, SectionCard, Skeleton, TextArea, TextInput, Toggle, useToast,
} from "@/components/ops/ui";
import { RecipeCostTable } from "./RecipeCostTable";
import { RecipeItemDrawer } from "./RecipeItemDrawer";
import { ConfirmActionSheet, FieldBlock, LinkButton } from "./shared";

type RecipeForm = {
  name: string;
  version: number | null;
  yield_quantity: number | null;
  portion_quantity: number | null;
  prep_time_min: number | null;
  shelf_life_days: number | null;
  instructions: string;
  notes: string;
  active: boolean;
};

const EMPTY: RecipeForm = { name: "", version: 1, yield_quantity: null, portion_quantity: null, prep_time_min: null, shelf_life_days: null, instructions: "", notes: "", active: true };

function fromRecipe(r: RecipeRow): RecipeForm {
  return {
    name: r.name,
    version: Number(r.version),
    yield_quantity: Number(r.yield_quantity),
    portion_quantity: r.portion_quantity !== null && r.portion_quantity !== undefined ? Number(r.portion_quantity) : null,
    prep_time_min: r.prep_time_min ?? null,
    shelf_life_days: r.shelf_life_days ?? null,
    instructions: r.instructions ?? "",
    notes: r.notes ?? "",
    active: r.active,
  };
}

/* ------------------------------------------------------------------ */
/* Linha de ingrediente                                                */
/* ------------------------------------------------------------------ */
function IngredientRow({ it, editable, first, last, onEdit, onRemove, onMove }: { it: RecipeItemRow; editable: boolean; first: boolean; last: boolean; onEdit: () => void; onRemove: () => void; onMove: (dir: -1 | 1) => void }) {
  const p = it.products;
  const unit = it.units?.code ?? p?.units?.code ?? "";
  const hasNet = it.net_quantity !== null && it.net_quantity !== undefined;
  const loss = hasNet && Number(it.gross_quantity) > 0 ? ((Number(it.gross_quantity) - Number(it.net_quantity)) / Number(it.gross_quantity)) * 100 : null;
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${editable ? "cursor-pointer active:bg-white/5" : ""}`} onClick={editable ? onEdit : undefined}>
      {p && <ProductThumb product={p} size={36} />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{p?.name ?? "Produto"}</p>
        <p className="text-sm text-slate-300 tabular-nums">
          <strong>{fmtQty(it.gross_quantity, unit)}</strong>
          {hasNet && <span className="text-slate-400"> · líquido {fmtQty(it.net_quantity, unit)}{loss !== null ? ` (perda ${fmtPct(loss)})` : ""}</span>}
        </p>
        {it.notes && <p className="truncate text-xs text-slate-500">{it.notes}</p>}
      </div>
      {editable && (
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-0.5">
            <button type="button" disabled={first} onClick={() => onMove(-1)} aria-label="Mover para cima" className="grid h-5 w-8 place-items-center rounded-md border border-[var(--line)] bg-white/5 text-slate-300 disabled:opacity-30">
              <Icon name="chevronDown" size={14} className="rotate-180" />
            </button>
            <button type="button" disabled={last} onClick={() => onMove(1)} aria-label="Mover para baixo" className="grid h-5 w-8 place-items-center rounded-md border border-[var(--line)] bg-white/5 text-slate-300 disabled:opacity-30">
              <Icon name="chevronDown" size={14} />
            </button>
          </div>
          <span className="hidden sm:block"><IconButton icon="edit" label="Editar ingrediente" onClick={onEdit} /></span>
          <IconButton icon="trash" label="Remover ingrediente" tone="danger" onClick={onRemove} />
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */
export function RecipeEditor({ recipeId }: { recipeId: string | null }) {
  const { company, user, can, canCompany } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const editable = canCompany("fichas.editar");
  const canProduce = can("producao.criar") || can("producao.finalizar");

  const rq = useRecipe(recipeId);
  const itemsQ = useRecipeItems(recipeId);
  const costQ = useRecipeCost(recipeId);

  const [product, setProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<RecipeForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemDrawer, setItemDrawer] = useState<{ open: boolean; item: RecipeItemRow | null }>({ open: false, item: null });
  const [removing, setRemoving] = useState<RecipeItemRow | null>(null);
  const [dupOpen, setDupOpen] = useState(false);

  // carrega a ficha no formulário
  useEffect(() => {
    if (!rq.data) return;
    setForm(fromRecipe(rq.data));
    setProduct(rq.data.products ? (rq.data.products as unknown as Product) : null);
  }, [rq.data]);

  const set = <K extends keyof RecipeForm>(k: K, v: RecipeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function pickProduct(p: Product | null) {
    setProduct(p);
    if (!p) return;
    setForm((f) => ({
      ...f,
      name: f.name.trim() ? f.name : p.name,
      shelf_life_days: f.shelf_life_days ?? p.shelf_life_days ?? null,
    }));
  }

  const unit = product?.units?.code ?? "";
  const items = itemsQ.data ?? [];
  const portions = useMemo(() => portionsOf({ yield_quantity: form.yield_quantity ?? 0, portion_quantity: form.portion_quantity }), [form.yield_quantity, form.portion_quantity]);

  async function save() {
    if (!company) return;
    if (!product) return notify("Escolha o produto que esta ficha produz.", "erro");
    if (!form.name.trim()) return notify("Informe o nome da ficha.", "erro");
    if (!form.yield_quantity || form.yield_quantity <= 0) return notify("Informe o rendimento (maior que zero).", "erro");
    if (form.portion_quantity !== null && form.portion_quantity <= 0) return notify("O tamanho da porção precisa ser maior que zero (ou vazio).", "erro");
    setBusy(true);
    setError(null);
    try {
      const payload = {
        product_id: product.id,
        name: form.name.trim(),
        version: Math.max(1, Math.round(form.version ?? 1)),
        yield_quantity: form.yield_quantity,
        portion_quantity: form.portion_quantity,
        prep_time_min: form.prep_time_min !== null ? Math.round(form.prep_time_min) : null,
        shelf_life_days: form.shelf_life_days !== null ? Math.round(form.shelf_life_days) : null,
        instructions: form.instructions,
        notes: form.notes.trim(),
        active: form.active,
      };
      const sb = supabaseBrowser();
      if (recipeId) {
        const res = await sb.from("recipes").update(payload).eq("id", recipeId);
        if (res.error) throw toOpsError(res.error);
        invalidate("recipes", "recipe_cost", "production_plan");
        notify("Ficha salva");
      } else {
        const res = await sb.from("recipes").insert({ ...payload, company_id: company.id, created_by: user?.id ?? null }).select("id").single();
        if (res.error) throw toOpsError(res.error);
        invalidate("recipes");
        notify("Ficha criada. Agora adicione os ingredientes.");
        router.replace(`/fichas/${(res.data as { id: string }).id}`);
        return;
      }
    } catch (e) {
      setError(toOpsError(e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(it: RecipeItemRow) {
    try {
      const res = await supabaseBrowser().from("recipe_items").delete().eq("id", it.id);
      if (res.error) throw toOpsError(res.error);
      invalidate("recipe_items", "recipe_cost", "production_plan");
      notify("Ingrediente removido");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  async function moveItem(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const ordered = [...items];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    try {
      const sb = supabaseBrowser();
      const updates = ordered.map((it, i) => (Number(it.position) === i ? null : sb.from("recipe_items").update({ position: i }).eq("id", it.id)));
      const results = await Promise.all(updates.filter((u): u is NonNullable<typeof u> => u !== null));
      const failed = results.find((r) => r.error);
      if (failed?.error) throw toOpsError(failed.error);
      invalidate("recipe_items", "recipe_cost");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  async function duplicate() {
    if (!rq.data) return;
    setBusy(true);
    try {
      const id = await duplicateRecipe(rq.data, items, user?.id);
      invalidate("recipes");
      notify(`Nova versão criada (v${Math.max(Number(rq.data.version), 0) + 1}). A anterior continua ativa — inative-a se quiser.`);
      setDupOpen(false);
      router.push(`/fichas/${id}`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  if (recipeId && rq.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Ficha técnica" backHref="/fichas" icon="book" />
        <Skeleton rows={4} />
      </div>
    );
  }
  if (recipeId && rq.error) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Ficha técnica" backHref="/fichas" icon="book" />
        <ErrorBox error={toOpsError(rq.error as Error).message} onRetry={() => void rq.refetch()} />
      </div>
    );
  }

  const title = recipeId ? rq.data?.name || "Ficha técnica" : "Nova ficha técnica";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={title}
        subtitle={
          recipeId && rq.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="slate">versão {rq.data.version}</Badge>
              <Badge tone={rq.data.active ? "green" : "red"}>{rq.data.active ? "Ativa" : "Inativa"}</Badge>
              {rq.data.products && <span>produz {rq.data.products.name}</span>}
            </span>
          ) : (
            "Cadastre o que a receita produz, o rendimento e os ingredientes"
          )
        }
        backHref="/fichas"
        icon="book"
        actions={
          recipeId ? (
            <>
              {canProduce && rq.data?.active && <LinkButton href={`/producao/nova?recipe=${recipeId}`} icon="flame">Produzir agora</LinkButton>}
              {editable && <Button variant="soft" onClick={() => setDupOpen(true)} disabled={busy}><Icon name="layers" size={16} /> Duplicar como nova versão</Button>}
            </>
          ) : undefined
        }
      />

      {!editable && <InlineAlert tone="amber">Você pode consultar esta ficha, mas não tem permissão para editá-la.</InlineAlert>}
      {error && <ErrorBox error={error} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <SectionCard title="Dados da ficha">
            <FieldBlock label="Produto que a ficha produz" required hint="Normalmente um semipronto, produzido ou produto final. O rendimento é medido na unidade de estoque dele.">
              <ProductPicker value={product} onChange={pickProduct} disabled={!editable} autoFocus={!recipeId} />
            </FieldBlock>
            {product && (
              <p className="-mt-2 mb-4 text-xs text-slate-500">
                {PRODUCT_KIND_LABEL[product.product_kind] ?? product.product_kind} · unidade de estoque: <strong className="text-slate-300">{unit || "—"}</strong>
                {product.shelf_life_days ? ` · validade padrão ${product.shelf_life_days} dias` : ""}
              </p>
            )}

            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[1fr_120px]">
              <Field label="Nome da ficha">
                <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={product ? product.name : "Ex.: Molho de tomate da casa"} disabled={!editable} />
              </Field>
              <Field label="Versão">
                <NumberInput value={form.version} onChange={(v) => set("version", v)} inputMode="numeric" min={1} disabled={!editable} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="Rendimento" hint={unit ? `Quanto a receita rende, em ${unit}` : "Escolha o produto para ver a unidade"}>
                <NumberInput big value={form.yield_quantity} onChange={(v) => set("yield_quantity", v)} placeholder="0" min={0} suffix={unit || undefined} disabled={!editable} />
              </Field>
              <Field label="Tamanho da porção" hint={portions ? `= ${fmtQty(portions)} porções` : unit ? `Opcional, em ${unit}` : "Opcional"}>
                <NumberInput big value={form.portion_quantity} onChange={(v) => set("portion_quantity", v)} placeholder="Opcional" min={0} suffix={unit || undefined} disabled={!editable} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="Tempo de preparo">
                <NumberInput value={form.prep_time_min} onChange={(v) => set("prep_time_min", v)} placeholder="Opcional" min={0} inputMode="numeric" suffix="min" disabled={!editable} />
              </Field>
              <Field label="Validade após produção" hint={product?.shelf_life_days ? `Sugestão do produto: ${product.shelf_life_days} dias` : "Dias até vencer o lote produzido"}>
                <NumberInput value={form.shelf_life_days} onChange={(v) => set("shelf_life_days", v)} placeholder={product?.shelf_life_days ? String(product.shelf_life_days) : "Opcional"} min={0} inputMode="numeric" suffix="dias" disabled={!editable} />
              </Field>
            </div>

            <Toggle checked={form.active} onChange={(v) => set("active", v)} label="Ficha ativa" hint="Só fichas ativas aparecem na hora de produzir" disabled={!editable} />
          </SectionCard>

          <SectionCard title="Modo de preparo">
            <Field label="Instruções" hint="Escreva um passo por linha. Na produção, os passos aparecem numerados.">
              <TextArea value={form.instructions} onChange={(e) => set("instructions", e.target.value)} rows={10} placeholder={"Higienizar os tomates\nCortar em cubos\nRefogar com azeite por 5 min\n…"} disabled={!editable} />
            </Field>
            <Field label="Observações">
              <TextArea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Ex.: usar a panela grande; conservar refrigerado" disabled={!editable} />
            </Field>
          </SectionCard>

          {editable && (
            <Button variant="primary" size="lg" full disabled={busy} onClick={() => void save()}>
              {busy ? "Salvando…" : recipeId ? "Salvar ficha" : "Criar ficha e continuar"}
            </Button>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard
            title={`Ingredientes${items.length ? ` (${items.length})` : ""}`}
            action={editable && recipeId ? <Button size="sm" variant="primary" onClick={() => setItemDrawer({ open: true, item: null })}><Icon name="plus" size={16} /> Adicionar</Button> : undefined}
            className="!p-0"
          >
            {!recipeId ? (
              <div className="px-4 pb-4">
                <InlineAlert tone="blue" icon="info">Salve a ficha para começar a adicionar os ingredientes.</InlineAlert>
              </div>
            ) : itemsQ.isLoading ? (
              <div className="px-4 pb-4"><Skeleton rows={2} /></div>
            ) : itemsQ.error ? (
              <div className="px-4 pb-4"><ErrorBox error={toOpsError(itemsQ.error as Error).message} onRetry={() => void itemsQ.refetch()} /></div>
            ) : items.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState emoji="🥕" title="Nenhum ingrediente" description={editable ? "Toque em Adicionar e informe o peso bruto de cada ingrediente." : "Esta ficha ainda não tem ingredientes."} />
              </div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {items.map((it, i) => (
                  <IngredientRow
                    key={it.id}
                    it={it}
                    editable={editable}
                    first={i === 0}
                    last={i === items.length - 1}
                    onEdit={() => setItemDrawer({ open: true, item: it })}
                    onRemove={() => setRemoving(it)}
                    onMove={(dir) => void moveItem(i, dir)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {recipeId && (
        <SectionCard title="Custo e rendimento" className="mt-4">
          {costQ.isLoading ? (
            <Skeleton rows={2} />
          ) : costQ.error ? (
            <ErrorBox error={toOpsError(costQ.error as Error).message} onRetry={() => void costQ.refetch()} />
          ) : costQ.data && costQ.data.items.length > 0 ? (
            <RecipeCostTable cost={costQ.data} />
          ) : (
            <p className="text-sm text-slate-400">Adicione ingredientes para ver o custo da ficha, o custo por {unit || "unidade"} e por porção.</p>
          )}
          {recipeId && rq.data && (Number(rq.data.yield_quantity) !== form.yield_quantity || (rq.data.portion_quantity ?? null) !== (form.portion_quantity ?? null)) && (
            <p className="mt-2 text-xs text-amber-300">Você alterou o rendimento ou a porção: salve a ficha para recalcular.</p>
          )}
        </SectionCard>
      )}

      {recipeId && (
        <RecipeItemDrawer
          open={itemDrawer.open}
          onClose={() => setItemDrawer({ open: false, item: null })}
          recipeId={recipeId}
          item={itemDrawer.item}
          nextPosition={items.length}
          onSaved={() => void itemsQ.refetch()}
        />
      )}

      <ConfirmSheet
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remover ingrediente?"
        message={`${removing?.products?.name ?? "Este ingrediente"} será removido da ficha. O custo será recalculado.`}
        confirmLabel="Remover"
        onConfirm={() => { if (removing) void removeItem(removing); }}
      />

      <ConfirmActionSheet
        open={dupOpen}
        onClose={() => setDupOpen(false)}
        title="Duplicar como nova versão"
        message={
          <>
            Será criada uma cópia desta ficha com todos os ingredientes, como <strong>versão {Math.max(Number(rq.data?.version ?? 1), 0) + 1}</strong>, já ativa.
            A versão atual continua como está — você pode inativá-la depois, se quiser.
          </>
        }
        confirmLabel="Criar nova versão"
        busy={busy}
        onConfirm={duplicate}
      />
    </div>
  );
}
