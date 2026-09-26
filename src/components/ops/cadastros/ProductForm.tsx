"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { OpsError, toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { fmtDateTime, fmtMoney, newId } from "@/lib/ops/format";
import { PRODUCT_KIND_LABEL, type StorageType } from "@/lib/ops/types";
import {
  emptyProductForm, LOCATION_KIND_OPTIONS, nextInternalCode, PRODUCT_KIND_OPTIONS, productPayload, productToForm, STORAGE_TYPE_OPTIONS, useAllUnits, useProductStoreSettings,
  useProductUnits, useSupplierProducts, validateProductForm, type ProductForm as ProductFormState, type ProductRow,
} from "@/lib/ops/modules/cadastros";
import { Badge, Button, Choice, ConfirmSheet, ErrorBox, Field, InlineAlert, NumberInput, PageHeader, Select, Sheet, Skeleton, Tabs, TextArea, TextInput, Toggle, useToast } from "@/components/ops/ui";
import { CategorySelect, ProductThumb } from "@/components/ops/pickers";
import { PhotoUpload } from "@/components/ops/PhotoUpload";
import { QrScanner } from "@/components/ops/QrScanner";
import { Icon } from "@/components/ops/Icon";
import { ProductUnitsSection, type ExtraConversion } from "./ProductUnitsSection";
import { ProductStoreSettingsSection, emptyStoreDraft, type StoreDraft } from "./ProductStoreSettingsSection";
import { ProductSuppliersSection, type SupplierLink } from "./ProductSuppliersSection";
import { ProductMovementsTab, ProductPricesTab, ProductStockTab } from "./ProductConsultTabs";
import { PriceComparisonSheet } from "./PriceComparisonSheet";

type Tab = "identificacao" | "unidades" | "custos" | "estoque" | "validade" | "fornecedores" | "saldo" | "precos" | "movimentacoes";

const COST_METHOD_LABEL: Record<string, string> = { medio: "média ponderada (custo atual × saldo + compra nova)", ultimo: "último preço de compra" };

/**
 * Formulário completo de produto. `product` null = criar.
 * Na criação, conversões/fornecedores ficam pendentes e são gravados junto com o produto.
 */
export function ProductForm({ product }: { product: ProductRow | null }) {
  const isNew = !product;
  const { company, store, stores, can, canCompany } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("produtos.editar");
  const sb = supabaseBrowser;

  const unitsQ = useAllUnits();
  const units = useMemo(() => unitsQ.data ?? [], [unitsQ.data]);
  const companyStores = useMemo(() => stores.filter((s) => s.company_id === company?.id), [stores, company?.id]);

  /* ---------------- estado do formulário ---------------- */
  const [form, setForm] = useState<ProductFormState>(() => (product ? productToForm(product) : emptyProductForm()));
  const set = useCallback((patch: Partial<ProductFormState>) => setForm((f) => ({ ...f, ...patch })), []);
  const [tab, setTab] = useState<Tab>("identificacao");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (product) setForm(productToForm(product));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // código interno sugerido ao criar
  const [suggesting, setSuggesting] = useState(false);
  const suggestCode = useCallback(async () => {
    if (!company) return;
    setSuggesting(true);
    try {
      const code = await nextInternalCode(company.id);
      if (code) set({ internal_code: code });
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setSuggesting(false);
    }
  }, [company, notify, set]);
  useEffect(() => {
    if (isNew && company && !form.internal_code) void suggestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, company?.id]);

  // unidade de estoque padrão (kg) ao criar
  useEffect(() => {
    if (isNew && !form.stock_unit_id && units.length > 0) {
      const kg = units.find((u) => u.code === "kg") ?? units.find((u) => u.code === "un") ?? units[0];
      set({ stock_unit_id: kg.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, units.length]);

  /* ---------------- conversões adicionais ---------------- */
  const puQ = useProductUnits(product?.id);
  const [pendingExtras, setPendingExtras] = useState<ExtraConversion[]>([]);
  const extras: ExtraConversion[] = isNew ? pendingExtras : (puQ.data ?? []).map((r) => ({ id: r.id, unit_id: r.unit_id, factor: Number(r.factor) }));
  const addExtra = async (unitId: string, factor: number) => {
    if (isNew) return setPendingExtras((l) => [...l, { id: newId(), unit_id: unitId, factor }]);
    try {
      const r = await sb().from("product_units").insert({ product_id: product!.id, unit_id: unitId, factor }).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar produtos.");
      invalidate("product_units");
      notify("Conversão adicionada");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  };
  const removeExtra = async (id: string) => {
    if (isNew) return setPendingExtras((l) => l.filter((e) => e.id !== id));
    try {
      const r = await sb().from("product_units").delete().eq("id", id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar produtos.");
      invalidate("product_units");
      notify("Conversão removida");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  };

  /* ---------------- fornecedores alternativos ---------------- */
  const spQ = useSupplierProducts({ productId: product?.id });
  const [pendingLinks, setPendingLinks] = useState<SupplierLink[]>([]);
  const links: SupplierLink[] = isNew
    ? pendingLinks
    : (spQ.data ?? []).map((r) => ({ id: r.id, supplier_id: r.supplier_id, supplier_name: r.suppliers?.name, supplier_code: r.supplier_code, unit_id: r.unit_id ?? "", last_price: Number(r.last_price), last_purchase_at: r.last_purchase_at, preferred: r.preferred }));
  const addLink = async (l: Omit<SupplierLink, "id" | "last_purchase_at">) => {
    // só um fornecedor preferido por produto (mesma regra aplicada no banco ao editar)
    if (isNew) return setPendingLinks((x) => [...x.map((p) => (l.preferred ? { ...p, preferred: false } : p)), { ...l, id: newId(), last_purchase_at: null }]);
    try {
      if (l.preferred) await sb().from("supplier_products").update({ preferred: false }).eq("product_id", product!.id);
      const r = await sb().from("supplier_products").insert({ supplier_id: l.supplier_id, product_id: product!.id, supplier_code: l.supplier_code, unit_id: l.unit_id || null, last_price: l.last_price, preferred: l.preferred }).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar fornecedores.");
      invalidate("supplier_products");
      notify("Fornecedor vinculado");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  };
  const removeLink = async (id: string) => {
    if (isNew) return setPendingLinks((x) => x.filter((l) => l.id !== id));
    try {
      const r = await sb().from("supplier_products").delete().eq("id", id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar fornecedores.");
      invalidate("supplier_products");
      notify("Fornecedor removido do produto");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  };
  const togglePreferred = async (id: string, preferred: boolean) => {
    if (isNew) return setPendingLinks((x) => x.map((l) => ({ ...l, preferred: l.id === id ? preferred : preferred ? false : l.preferred })));
    try {
      if (preferred) await sb().from("supplier_products").update({ preferred: false }).eq("product_id", product!.id);
      const r = await sb().from("supplier_products").update({ preferred }).eq("id", id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar fornecedores.");
      invalidate("supplier_products");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  };
  const [compareOpen, setCompareOpen] = useState(false);

  /* ---------------- ajustes por unidade ---------------- */
  const pssQ = useProductStoreSettings(product?.id);
  const [drafts, setDrafts] = useState<Record<string, StoreDraft>>({});
  const [initialDrafts, setInitialDrafts] = useState<Record<string, StoreDraft>>({});
  useEffect(() => {
    if (!pssQ.data) return;
    const map: Record<string, StoreDraft> = {};
    for (const r of pssQ.data) {
      map[r.store_id] = {
        min_stock: r.min_stock === null ? null : Number(r.min_stock), max_stock: r.max_stock === null ? null : Number(r.max_stock),
        reorder_point: r.reorder_point === null ? null : Number(r.reorder_point), ideal_stock: r.ideal_stock === null ? null : Number(r.ideal_stock),
        default_location_id: r.default_location_id ?? "", active: r.active,
      };
    }
    setDrafts(map);
    setInitialDrafts(map);
  }, [pssQ.data]);
  const setDraft = useCallback((storeId: string, patch: Partial<StoreDraft>) => setDrafts((d) => ({ ...d, [storeId]: { ...(d[storeId] ?? emptyStoreDraft()), ...patch } })), []);
  const dirtyStoreRows = (productId: string) =>
    Object.entries(drafts)
      .filter(([sid, d]) => JSON.stringify(d) !== JSON.stringify(initialDrafts[sid] ?? null) && (initialDrafts[sid] || JSON.stringify(d) !== JSON.stringify(emptyStoreDraft())))
      .map(([sid, d]) => ({ product_id: productId, store_id: sid, min_stock: d.min_stock, max_stock: d.max_stock, reorder_point: d.reorder_point, ideal_stock: d.ideal_stock, default_location_id: d.default_location_id || null, active: d.active }));

  /* ---------------- histórico (aviso ao trocar unidade) ---------------- */
  const lotsCount = useQuery({
    queryKey: ["stock_lots", "count", product?.id],
    enabled: Boolean(product?.id),
    queryFn: async () => {
      const r = await sb().from("stock_lots").select("id", { count: "exact", head: true }).eq("product_id", product!.id);
      if (r.error) throw toOpsError(r.error);
      return r.count ?? 0;
    },
  });
  const hasHistory = (lotsCount.data ?? 0) > 0;

  /* ---------------- método de custo ---------------- */
  const costMethod = useQuery({
    queryKey: ["settings", "estoque.metodo_custo", store?.id],
    enabled: Boolean(store?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const v = await rpc<unknown>("ops_setting", { p_store: store!.id, p_key: "estoque.metodo_custo", p_default: "medio" });
      return typeof v === "string" ? v : "medio";
    },
  });

  /* ---------------- salvar ---------------- */
  async function save() {
    if (!company) return;
    const err = validateProductForm(form);
    if (err) {
      notify(err, "erro");
      return;
    }
    setBusy(true);
    try {
      let id = product?.id ?? "";
      const warnings: string[] = [];
      if (isNew) {
        const r = await sb().from("products").insert(productPayload(form, company.id, true)).select("id").single();
        if (r.error) throw r.error;
        id = r.data.id as string;
        if (pendingExtras.length > 0) {
          const x = await sb().from("product_units").insert(pendingExtras.map((e) => ({ product_id: id, unit_id: e.unit_id, factor: e.factor })));
          if (x.error) warnings.push(`conversões: ${toOpsError(x.error).message}`);
        }
        if (pendingLinks.length > 0) {
          const x = await sb().from("supplier_products").insert(pendingLinks.map((l) => ({ supplier_id: l.supplier_id, product_id: id, supplier_code: l.supplier_code, unit_id: l.unit_id || null, last_price: l.last_price, preferred: l.preferred })));
          if (x.error) warnings.push(`fornecedores: ${toOpsError(x.error).message}`);
        }
      } else {
        const r = await sb().from("products").update(productPayload(form, company.id, false)).eq("id", product.id).select("id");
        if (r.error) throw r.error;
        if (!r.data?.length) throw new OpsError("Você não tem permissão para editar produtos.");
      }
      const rows = dirtyStoreRows(id);
      if (rows.length > 0) {
        const x = await sb().from("product_store_settings").upsert(rows, { onConflict: "product_id,store_id" });
        if (x.error) warnings.push(`ajustes por unidade: ${toOpsError(x.error).message}`);
        else setInitialDrafts({ ...drafts });
      }
      invalidate("products", "product_units", "product_store_settings", "supplier_products", "stock_items", "v_stock_by_product");
      if (warnings.length > 0) notify(`Produto salvo, mas houve erro em: ${warnings.join("; ")}`, "erro");
      else notify(isNew ? "Produto criado" : "Produto salvo");
      if (isNew) router.replace(`/produtos/${id}`);
    } catch (e) {
      const er = toOpsError(e as Error);
      notify(er.code === "23505" ? "Já existe um produto com este código interno nesta empresa." : er.message, "erro");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- custo manual ---------------- */
  const [costOpen, setCostOpen] = useState(false);
  const [costConfirm, setCostConfirm] = useState(false);
  const [newCost, setNewCost] = useState<number | null>(null);
  async function applyCost() {
    if (!product || newCost === null || newCost < 0) return;
    setBusy(true);
    try {
      const r = await sb().from("products").update({ cost: newCost }).eq("id", product.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar produtos.");
      set({ cost: newCost });
      invalidate("products", "stock_items");
      notify("Custo atualizado");
      setCostOpen(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- inativar / excluir ---------------- */
  const [activeConfirm, setActiveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  async function setActive(active: boolean) {
    if (!product) return;
    setBusy(true);
    try {
      const r = await sb().from("products").update({ active }).eq("id", product.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar produtos.");
      set({ active });
      invalidate("products", "stock_items");
      notify(active ? "Produto reativado" : "Produto inativado");
      setDeleteFailed(null);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!product) return;
    setBusy(true);
    try {
      const r = await sb().from("products").delete().eq("id", product.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para excluir produtos.");
      invalidate("products", "stock_items");
      notify("Produto excluído");
      router.replace("/produtos");
    } catch (e) {
      const er = toOpsError(e as Error);
      setDeleteFailed(er.code === "23503" || /em uso|imut|foreign key|violates/i.test(er.message) ? "Este produto já tem histórico (lotes, movimentações, compras ou fichas técnicas) e não pode ser excluído. Você pode inativá-lo: ele some das buscas, mas o histórico continua." : er.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- leitura de código de barras ---------------- */
  const [scanOpen, setScanOpen] = useState(false);
  const onScan = useCallback((text: string) => {
    set({ barcode: text.trim() });
    setScanOpen(false);
    notify("Código de barras lido");
  }, [set, notify]);

  /* ---------------- render ---------------- */
  const stockUnit = units.find((u) => u.id === form.stock_unit_id);
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "identificacao", label: "Identificação" },
    { value: "unidades", label: "Unidades", count: extras.length || undefined },
    { value: "custos", label: "Custos" },
    { value: "estoque", label: "Estoque" },
    { value: "validade", label: "Validade" },
    { value: "fornecedores", label: "Fornecedores", count: links.length || undefined },
    ...(isNew ? [] : ([{ value: "saldo", label: "Saldo" }, { value: "precos", label: "Preços" }, { value: "movimentacoes", label: "Movimentações" }] as { value: Tab; label: string }[])),
  ];
  const disabled = !canEdit || busy;
  const catEmoji = product?.categories?.emoji;

  if (unitsQ.isLoading) return <Skeleton rows={4} />;
  if (unitsQ.error) return <div className="mx-auto max-w-5xl"><ErrorBox error={toOpsError(unitsQ.error as Error).message} onRetry={() => void unitsQ.refetch()} /></div>;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={isNew ? "Novo produto" : product.name}
        backHref="/produtos"
        subtitle={
          isNew ? "Preencha a identificação e a unidade de estoque; o resto pode ser ajustado depois." : (
            <span className="flex flex-wrap items-center gap-2">
              {product.internal_code && <span className="font-mono">{product.internal_code}</span>}
              <span>{PRODUCT_KIND_LABEL[product.product_kind]}</span>
              {product.categories?.name && <span>· {product.categories.name}</span>}
              <Badge tone={form.active ? "green" : "red"}>{form.active ? "Ativo" : "Inativo"}</Badge>
            </span>
          )
        }
        actions={
          !isNew && canEdit ? (
            <>
              <Button variant="soft" disabled={busy} onClick={() => setActiveConfirm(true)}>
                <Icon name={form.active ? "eye" : "check"} size={18} /> {form.active ? "Inativar" : "Reativar"}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setDeleteConfirm(true)}>
                <Icon name="trash" size={18} /> Excluir
              </Button>
            </>
          ) : undefined
        }
      />

      {!canEdit && <InlineAlert tone="slate" icon="lock">Você pode consultar este cadastro, mas não tem permissão para alterá-lo (produtos.editar).</InlineAlert>}
      {!isNew && !form.active && <InlineAlert tone="amber">Produto inativo: não aparece nas buscas de recebimento, produção e contagem. Use “Reativar” para voltar a usá-lo.</InlineAlert>}

      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {tab === "identificacao" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section className="card p-4">
            <Field label="Nome do produto">
              <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Peito de frango congelado" disabled={disabled} autoFocus={isNew} />
            </Field>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="Código interno" hint="Identificação curta usada nas etiquetas e buscas. Precisa ser único.">
                <div className="flex gap-2">
                  <TextInput value={form.internal_code} onChange={(e) => set({ internal_code: e.target.value })} placeholder="00001" className="font-mono" disabled={disabled} />
                  {canEdit && (
                    <Button variant="soft" onClick={() => void suggestCode()} disabled={suggesting || busy} title="Sugerir o próximo código livre">
                      <Icon name="sparkles" size={16} /> <span className="hidden sm:inline">Sugerir</span>
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="SKU" hint="Código do sistema de vendas ou ERP (opcional).">
                <TextInput value={form.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="" disabled={disabled} />
              </Field>
            </div>
            <Field label="Código de barras" hint="Use a câmera para ler o código da embalagem.">
              <div className="flex gap-2">
                <TextInput value={form.barcode} onChange={(e) => set({ barcode: e.target.value.replace(/\s/g, "") })} placeholder="7891234567890" inputMode="numeric" className="font-mono" disabled={disabled} />
                {canEdit && (
                  <button type="button" onClick={() => setScanOpen(true)} aria-label="Ler código de barras" className="grid h-[46px] w-14 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-200 active:scale-95">
                    <Icon name="scan" />
                  </button>
                )}
              </div>
            </Field>
            <Field label="Categoria" hint="Cadastre categorias e subcategorias em Produtos › Categorias.">
              {canEdit ? <CategorySelect value={form.category_id} onChange={(v) => set({ category_id: v })} placeholder="Sem categoria" /> : <span className="field block">{product?.categories?.name ?? "Sem categoria"}</span>}
            </Field>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Tipo de produto</span>
            <Choice value={form.product_kind} onChange={(v) => { if (canEdit) set({ product_kind: v }); }} options={PRODUCT_KIND_OPTIONS} columns={2} />
            <Field label="Observações" hint="Cuidados no manuseio, marca preferida, alergênicos…">
              <TextArea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} disabled={disabled} />
            </Field>
            <Toggle checked={form.active} onChange={(v) => set({ active: v })} label="Produto ativo" hint="Inativo: some das buscas de recebimento, produção e contagem." disabled={disabled} />
          </section>
          <section className="card p-4">
            {canEdit ? (
              <PhotoUpload value={form.photo_url} onChange={(url) => set({ photo_url: url })} folder="produtos" label="Foto do produto" hint="Ajuda a equipe a reconhecer o item na contagem e no recebimento." />
            ) : (
              <div className="mb-4"><ProductThumb product={{ name: form.name, photo_url: form.photo_url, categories: catEmoji ? { emoji: catEmoji } : null }} size={96} /></div>
            )}
            {!isNew && (
              <div className="space-y-1 border-t border-[var(--line)] pt-3 text-xs text-slate-500">
                <p>Criado em {fmtDateTime(product.created_at)}</p>
                <p>Última alteração {fmtDateTime(product.updated_at)}</p>
                <Link href={`/estoque/produto/${product.id}`} className="inline-flex items-center gap-1 pt-1 font-semibold text-[var(--accent)]">Abrir no estoque <Icon name="chevronRight" size={14} /></Link>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "unidades" && (
        <ProductUnitsSection form={form} set={(p) => { if (canEdit) set(p); }} units={units} extras={extras} onAddExtra={addExtra} onRemoveExtra={removeExtra} canEdit={canEdit} hasHistory={hasHistory} />
      )}

      {tab === "custos" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Custo atual</h2>
            <p className="mb-3 text-sm text-slate-400">Por {stockUnit?.code ?? "unidade de estoque"}. Usado para valorizar o estoque, as fichas técnicas e as perdas.</p>
            {isNew ? (
              <Field label="Custo inicial" hint="Se deixar 0, o primeiro recebimento define o custo.">
                <NumberInput big value={form.cost} onChange={(v) => set({ cost: v })} min={0} suffix="R$" placeholder="0,00" disabled={disabled} />
              </Field>
            ) : (
              <>
                <p className="mb-3 text-3xl font-extrabold tabular-nums">{fmtMoney(form.cost ?? 0)}<span className="ml-1 text-base font-semibold text-slate-400">/ {stockUnit?.code ?? "un"}</span></p>
                {canEdit && (
                  <Button variant="soft" size="lg" full onClick={() => { setNewCost(form.cost ?? 0); setCostOpen(true); }} disabled={busy}>
                    <Icon name="edit" size={18} /> Alterar custo manualmente
                  </Button>
                )}
              </>
            )}
          </section>
          <section className="card p-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Último preço de compra</h2>
            <p className="mb-3 text-3xl font-extrabold tabular-nums text-slate-200">{fmtMoney(product?.last_purchase_price ?? 0)}<span className="ml-1 text-base font-semibold text-slate-400">/ {stockUnit?.code ?? "un"}</span></p>
            <InlineAlert tone="slate" icon="info">
              <p className="font-semibold">Atualizados automaticamente pelo recebimento.</p>
              <p className="mt-1">
                Ao finalizar um recebimento, o último preço é o valor pago (já convertido para a unidade de estoque) e o custo atual é recalculado pelo método configurado
                {costMethod.data ? <>: <span className="font-semibold text-slate-200">{COST_METHOD_LABEL[costMethod.data] ?? costMethod.data}</span></> : ""}. O método é definido em Configurações.
              </p>
            </InlineAlert>
            {!isNew && <button type="button" onClick={() => setTab("precos")} className="text-sm font-semibold text-[var(--accent)]">Ver histórico de preços</button>}
          </section>
        </div>
      )}

      {tab === "estoque" && (
        <ProductStoreSettingsSection form={form} set={(p) => { if (canEdit) set(p); }} stores={companyStores} drafts={drafts} setDraft={setDraft} canEditCompany={canEdit} canEditStore={(sid) => can("produtos.editar", sid)} unit={stockUnit?.code} />
      )}

      {tab === "validade" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Validade (em dias)</h2>
            <p className="mb-3 text-sm text-slate-400">O sistema calcula a data de validade dos lotes com estes prazos. Deixe em branco quando não se aplica.</p>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="Após produção / recebimento" hint="Prazo padrão quando a embalagem não informa validade.">
                <NumberInput value={form.shelf_life_days} onChange={(v) => set({ shelf_life_days: v })} min={0} inputMode="numeric" suffix="dias" placeholder="—" disabled={disabled} />
              </Field>
              <Field label="Após abertura" hint="Usado ao marcar um lote como aberto.">
                <NumberInput value={form.shelf_life_open_days} onChange={(v) => set({ shelf_life_open_days: v })} min={0} inputMode="numeric" suffix="dias" placeholder="—" disabled={disabled} />
              </Field>
              <Field label="Após congelamento" hint="Usado ao congelar um lote.">
                <NumberInput value={form.shelf_life_frozen_days} onChange={(v) => set({ shelf_life_frozen_days: v })} min={0} inputMode="numeric" suffix="dias" placeholder="—" disabled={disabled} />
              </Field>
              <Field label="Após descongelamento" hint="Nunca ultrapassa a validade original.">
                <NumberInput value={form.shelf_life_thawed_days} onChange={(v) => set({ shelf_life_thawed_days: v })} min={0} inputMode="numeric" suffix="dias" placeholder="—" disabled={disabled} />
              </Field>
            </div>
          </section>
          <section className="card p-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Armazenamento</h2>
            <p className="mb-3 text-sm text-slate-400">Onde e em que temperatura o produto deve ficar.</p>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Tipo de armazenamento</span>
            <Choice value={form.storage_type} onChange={(v: StorageType) => { if (canEdit) set({ storage_type: v }); }} options={STORAGE_TYPE_OPTIONS} columns={3} />
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="Temperatura mínima">
                <NumberInput value={form.storage_temp_min} onChange={(v) => set({ storage_temp_min: v })} suffix="°C" placeholder="—" disabled={disabled} />
              </Field>
              <Field label="Temperatura máxima">
                <NumberInput value={form.storage_temp_max} onChange={(v) => set({ storage_temp_max: v })} suffix="°C" placeholder="—" disabled={disabled} />
              </Field>
            </div>
            <Field label="Local padrão (tipo)" hint="Ao receber, o sistema sugere um local deste tipo. O local exato por unidade fica na aba Estoque.">
              <Select value={form.default_location_kind} onChange={(e) => set({ default_location_kind: e.target.value })} disabled={disabled}>
                <option value="">Sem preferência</option>
                {LOCATION_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          </section>
        </div>
      )}

      {tab === "fornecedores" && (
        <ProductSuppliersSection form={form} set={(p) => { if (canEdit) set(p); }} units={units} links={links} onAdd={addLink} onRemove={removeLink} onTogglePreferred={togglePreferred} canEdit={canEdit && canCompany("fornecedores.editar")} onCompare={() => setCompareOpen(true)} compareEnabled={!isNew && canCompany("fornecedores.ver")} />
      )}

      {tab === "saldo" && product && <ProductStockTab productId={product.id} unit={stockUnit?.code} />}
      {tab === "precos" && product && <ProductPricesTab productId={product.id} />}
      {tab === "movimentacoes" && product && <ProductMovementsTab productId={product.id} />}

      {canEdit && !["saldo", "precos", "movimentacoes"].includes(tab) && (
        <div className="sticky bottom-20 z-20 mt-4 flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/95 p-2 backdrop-blur lg:bottom-4">
          <Button variant="soft" size="lg" onClick={() => router.push("/produtos")} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy}>
            <Icon name="check" size={18} /> {busy ? "Salvando…" : isNew ? "Criar produto" : "Salvar"}
          </Button>
        </div>
      )}

      {/* leitor de código de barras */}
      <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title="Ler código de barras">
        {scanOpen && <QrScanner onResult={onScan} onClose={() => setScanOpen(false)} hint="Aponte a câmera para o código de barras da embalagem" />}
      </Sheet>

      {/* custo manual */}
      <Sheet
        open={costOpen}
        onClose={() => setCostOpen(false)}
        title="Alterar custo manualmente"
        footer={
          <div className="flex gap-2 pb-3">
            <Button variant="soft" size="lg" full onClick={() => setCostOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full onClick={() => setCostConfirm(true)} disabled={busy || newCost === null || newCost < 0}>Continuar</Button>
          </div>
        }
      >
        <InlineAlert tone="amber">O custo manual vale até o próximo recebimento, que recalcula pelo método configurado. Lotes já em estoque mantêm o custo com que entraram.</InlineAlert>
        <Field label={`Novo custo por ${stockUnit?.code ?? "unidade"}`}>
          <NumberInput big value={newCost} onChange={setNewCost} min={0} suffix="R$" autoFocus />
        </Field>
        <p className="text-sm text-slate-400">Custo atual: <span className="font-semibold text-slate-200">{fmtMoney(form.cost ?? 0)}</span></p>
      </Sheet>
      <ConfirmSheet open={costConfirm} onClose={() => setCostConfirm(false)} title="Confirmar novo custo" message={`Alterar o custo de ${fmtMoney(form.cost ?? 0)} para ${fmtMoney(newCost ?? 0)} por ${stockUnit?.code ?? "unidade"}? A alteração fica registrada na auditoria.`} confirmLabel="Alterar custo" onConfirm={() => void applyCost()} />

      {/* inativar / reativar */}
      <ConfirmSheet
        open={activeConfirm}
        onClose={() => setActiveConfirm(false)}
        title={form.active ? "Inativar produto" : "Reativar produto"}
        message={form.active ? `O produto “${form.name}” deixará de aparecer nas buscas de recebimento, produção e contagem. O histórico e os saldos continuam.` : `O produto “${form.name}” voltará a aparecer nas buscas.`}
        confirmLabel={form.active ? "Inativar" : "Reativar"}
        onConfirm={() => void setActive(!form.active)}
      />

      {/* excluir */}
      <ConfirmSheet open={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Excluir produto" message={`Excluir “${form.name}” definitivamente? Só é possível quando o produto não tem histórico. Se preferir manter o histórico, use “Inativar”.`} confirmLabel="Excluir" onConfirm={() => void remove()} />
      <Sheet
        open={deleteFailed !== null}
        onClose={() => setDeleteFailed(null)}
        title="Não foi possível excluir"
        footer={
          <div className="flex gap-2 pb-3">
            <Button variant="soft" size="lg" full onClick={() => setDeleteFailed(null)}>Fechar</Button>
            {form.active && <Button variant="primary" size="lg" full disabled={busy} onClick={() => void setActive(false)}>Inativar produto</Button>}
          </div>
        }
      >
        <p className="text-slate-300">{deleteFailed}</p>
      </Sheet>

      {product && <PriceComparisonSheet open={compareOpen} onClose={() => setCompareOpen(false)} productId={product.id} productName={product.name} unit={stockUnit?.code} />}
    </div>
  );
}
