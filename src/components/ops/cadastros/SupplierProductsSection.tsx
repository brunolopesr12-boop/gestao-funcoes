"use client";

import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtMoney } from "@/lib/ops/format";
import type { Product } from "@/lib/ops/types";
import { useAllUnits, useSupplierProducts, type SupplierProductRow } from "@/lib/ops/modules/cadastros";
import { Badge, Button, ConfirmSheet, DataTable, ErrorBox, Field, IconButton, NumberInput, Sheet, TextInput, Toggle, useToast, type Column } from "@/components/ops/ui";
import { ProductPicker, UnitSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { PriceComparisonSheet } from "./PriceComparisonSheet";

/** Produtos fornecidos por um fornecedor (supplier_products) com adicionar/editar/remover e comparação de preços. */
export function SupplierProductsSection({ supplierId, canEdit }: { supplierId: string; canEdit: boolean }) {
  const notify = useToast();
  const invalidate = useInvalidate();
  const q = useSupplierProducts({ supplierId });
  const unitsQ = useAllUnits();
  const units = unitsQ.data ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierProductRow | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [code, setCode] = useState("");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [preferred, setPreferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<SupplierProductRow | null>(null);

  function openAdd() {
    setEditing(null);
    setProduct(null);
    setCode("");
    setUnitId("");
    setPrice(null);
    setPreferred(false);
    setAddOpen(true);
  }
  function openEdit(r: SupplierProductRow) {
    setEditing(r);
    setProduct(null);
    setCode(r.supplier_code);
    setUnitId(r.unit_id ?? "");
    setPrice(Number(r.last_price));
    setPreferred(r.preferred);
    setAddOpen(true);
  }

  async function save() {
    const productId = editing ? editing.product_id : product?.id;
    if (!productId) return notify("Escolha o produto.", "erro");
    if (!editing && (q.data ?? []).some((r) => r.product_id === productId)) return notify("Esse produto já está vinculado a este fornecedor.", "erro");
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      if (preferred) await sb.from("supplier_products").update({ preferred: false }).eq("product_id", productId);
      const payload = { supplier_id: supplierId, product_id: productId, supplier_code: code.trim(), unit_id: unitId || null, last_price: price ?? 0, preferred };
      const r = editing ? await sb.from("supplier_products").update(payload).eq("id", editing.id).select("id") : await sb.from("supplier_products").insert(payload).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error("Você não tem permissão para editar fornecedores.");
      invalidate("supplier_products");
      notify(editing ? "Produto atualizado" : "Produto vinculado");
      setAddOpen(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: SupplierProductRow) {
    setBusy(true);
    try {
      const x = await supabaseBrowser().from("supplier_products").delete().eq("id", r.id).select("id");
      if (x.error) throw x.error;
      if (!x.data?.length) throw new Error("Você não tem permissão para editar fornecedores.");
      invalidate("supplier_products");
      notify("Produto removido do fornecedor");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SupplierProductRow>[] = [
    {
      key: "product", label: "Produto",
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/produtos/${r.product_id}`} className="block truncate font-semibold hover:underline">{r.products?.name ?? "—"}</Link>
          <p className="text-xs text-slate-500">{r.products?.internal_code && <span className="mr-2 font-mono">{r.products.internal_code}</span>}{r.supplier_code && <span>cód. fornecedor {r.supplier_code}</span>}</p>
        </div>
      ),
    },
    { key: "unit", label: "Vende em", align: "center", hideOnMobile: true, render: (r) => <span>{r.units?.code ?? "—"}</span> },
    { key: "last_price", label: "Último preço", align: "right", render: (r) => <span className="font-bold tabular-nums">{Number(r.last_price) > 0 ? fmtMoney(r.last_price) : "—"}</span> },
    { key: "last_purchase_at", label: "Última compra", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtDate(r.last_purchase_at)}</span> },
    { key: "preferred", label: "Preferido", align: "center", render: (r) => (r.preferred ? <Badge tone="blue">sim</Badge> : <span className="text-slate-600">—</span>) },
    {
      key: "actions", label: "", align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="scale" label="Comparar preços" size={34} onClick={() => setCompare({ id: r.product_id, name: r.products?.name ?? "" })} />
          {canEdit && <IconButton icon="edit" label="Editar" size={34} onClick={() => openEdit(r)} />}
          {canEdit && <IconButton icon="trash" label="Remover" tone="danger" size={34} disabled={busy} onClick={() => setRemoving(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Produtos que este fornecedor vende. O preço e a data são atualizados a cada recebimento finalizado.</p>
        {canEdit && <Button variant="primary" onClick={openAdd}><Icon name="plus" size={18} /> Adicionar produto</Button>}
      </div>
      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          loading={q.isLoading}
          emptyTitle="Nenhum produto vinculado"
          emptyDescription={canEdit ? "Clique em “Adicionar produto” ou finalize um recebimento deste fornecedor: o vínculo é criado automaticamente." : "Os vínculos são criados automaticamente ao finalizar recebimentos."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Link href={`/produtos/${r.product_id}`} className="block truncate font-semibold">{r.products?.name ?? "—"} {r.preferred && <Badge tone="blue">preferido</Badge>}</Link>
                <p className="text-xs text-slate-500">{r.supplier_code && `cód. ${r.supplier_code} · `}{r.units?.code ? `vende em ${r.units.code} · ` : ""}{r.last_purchase_at ? `última ${fmtDate(r.last_purchase_at)}` : "sem compras"}</p>
              </div>
              <span className="font-bold tabular-nums">{Number(r.last_price) > 0 ? fmtMoney(r.last_price) : "—"}</span>
              <IconButton icon="scale" label="Comparar preços" size={34} onClick={() => setCompare({ id: r.product_id, name: r.products?.name ?? "" })} />
              {canEdit && <IconButton icon="edit" label="Editar" size={34} onClick={() => openEdit(r)} />}
              {canEdit && <IconButton icon="trash" label="Remover" tone="danger" size={34} disabled={busy} onClick={() => setRemoving(r)} />}
            </div>
          )}
        />
      )}

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remover produto do fornecedor"
        message={removing ? `Remover “${removing.products?.name ?? "este produto"}” da lista de produtos deste fornecedor? O histórico de compras continua guardado; o vínculo volta sozinho no próximo recebimento.` : ""}
        confirmLabel="Remover"
        onConfirm={() => { if (removing) void remove(removing); }}
      />

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={editing ? "Editar produto fornecido" : "Adicionar produto fornecido"}
        footer={
          <div className="flex gap-2 pb-3">
            <Button variant="soft" size="lg" full onClick={() => setAddOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy || (!editing && !product)}>{busy ? "Salvando…" : "Salvar"}</Button>
          </div>
        }
      >
        {editing ? (
          <p className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 font-semibold">{editing.products?.name}</p>
        ) : (
          <>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">Produto</span>
            <ProductPicker value={product} onChange={setProduct} autoFocus />
          </>
        )}
        <Field label="Código no fornecedor" hint="Como o produto aparece na nota dele (opcional)."><TextInput value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Unidade em que ele vende"><UnitSelect value={unitId} onChange={setUnitId} units={units.filter((u) => u.active)} placeholder="Mesma do estoque" allowEmpty /></Field>
        <Field label="Último preço (por unidade de estoque)"><NumberInput value={price} onChange={setPrice} min={0} suffix="R$" placeholder="0,00" /></Field>
        <Toggle checked={preferred} onChange={setPreferred} label="Fornecedor preferido para este produto" hint="Aparece primeiro na comparação e nos pedidos." />
      </Sheet>

      <PriceComparisonSheet open={compare !== null} onClose={() => setCompare(null)} productId={compare?.id ?? null} productName={compare?.name} />
    </div>
  );
}
