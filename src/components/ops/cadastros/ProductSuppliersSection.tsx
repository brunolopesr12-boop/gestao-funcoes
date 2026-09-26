"use client";

import Link from "next/link";
import { useState } from "react";
import { useSuppliers } from "@/lib/ops/hooks";
import { fmtDate, fmtMoney } from "@/lib/ops/format";
import type { Unit } from "@/lib/ops/types";
import type { ProductForm } from "@/lib/ops/modules/cadastros";
import { Badge, Button, Field, IconButton, NumberInput, TextInput, Toggle, useToast } from "@/components/ops/ui";
import { SupplierSelect, UnitSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";

/** Vínculo produto × fornecedor (linha de supplier_products ou pendente). */
export type SupplierLink = { id: string; supplier_id: string; supplier_name?: string; supplier_code: string; unit_id: string; last_price: number; last_purchase_at: string | null; preferred: boolean };

/**
 * Seção "Fornecedores" do produto: fornecedor padrão + fornecedores alternativos.
 */
export function ProductSuppliersSection({
  form, set, units, links, onAdd, onRemove, onTogglePreferred, canEdit, onCompare, compareEnabled,
}: {
  form: ProductForm; set: (patch: Partial<ProductForm>) => void; units: Unit[]; links: SupplierLink[];
  onAdd: (link: Omit<SupplierLink, "id" | "last_purchase_at">) => Promise<void>; onRemove: (id: string) => Promise<void>; onTogglePreferred: (id: string, preferred: boolean) => Promise<void>;
  canEdit: boolean; onCompare: () => void; compareEnabled: boolean;
}) {
  const notify = useToast();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [code, setCode] = useState("");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [preferred, setPreferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string, fallback?: string) => fallback ?? suppliers.data?.find((s) => s.id === id)?.name ?? "Fornecedor";
  const unitCode = (id: string) => units.find((u) => u.id === id)?.code ?? "";

  async function add() {
    if (!supplierId) return notify("Escolha o fornecedor.", "erro");
    if (links.some((l) => l.supplier_id === supplierId)) return notify("Esse fornecedor já está vinculado ao produto.", "erro");
    setBusy(true);
    try {
      await onAdd({ supplier_id: supplierId, supplier_name: nameOf(supplierId), supplier_code: code.trim(), unit_id: unitId, last_price: price ?? 0, preferred });
      setSupplierId("");
      setCode("");
      setUnitId("");
      setPrice(null);
      setPreferred(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Fornecedor padrão</h2>
        <p className="mb-3 text-sm text-slate-400">Sugerido automaticamente nos pedidos de compra e na reposição.</p>
        <Field label="Fornecedor padrão">
          <SupplierSelect value={form.default_supplier_id} onChange={(v) => set({ default_supplier_id: v })} placeholder="Nenhum" />
        </Field>
      </section>

      <section className="card p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Fornecedores alternativos</h2>
          <Button variant="soft" size="sm" onClick={onCompare} disabled={!compareEnabled} title={compareEnabled ? "" : "Disponível depois de salvar o produto"}>
            <Icon name="scale" size={16} /> Comparar preços
          </Button>
        </div>
        <p className="mb-3 text-sm text-slate-400">Quem mais vende este produto. O último preço e a data são atualizados a cada recebimento finalizado.</p>
        {links.length === 0 ? (
          <p className="mb-3 rounded-xl border border-dashed border-[var(--line)] px-3 py-3 text-center text-sm text-slate-500">Nenhum fornecedor vinculado ainda.</p>
        ) : (
          <ul className="mb-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <Link href={`/fornecedores/${l.supplier_id}`} className="hover:underline">{nameOf(l.supplier_id, l.supplier_name)}</Link>
                    {l.preferred && <Badge tone="blue">preferido</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {l.supplier_code && <span className="mr-2 font-mono">cód. {l.supplier_code}</span>}
                    {l.unit_id && <span className="mr-2">vende em {unitCode(l.unit_id)}</span>}
                    {l.last_purchase_at ? `última compra ${fmtDate(l.last_purchase_at)}` : "sem compras"}
                  </p>
                </div>
                <span className="font-bold tabular-nums">{Number(l.last_price) > 0 ? fmtMoney(l.last_price) : "—"}</span>
                {canEdit && (
                  <>
                    <IconButton icon="star" label={l.preferred ? "Tirar preferência" : "Marcar como preferido"} tone={l.preferred ? "primary" : "soft"} size={36} onClick={() => void onTogglePreferred(l.id, !l.preferred)} />
                    <IconButton icon="trash" label="Remover fornecedor" tone="danger" size={36} onClick={() => void onRemove(l.id)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="rounded-xl border border-[var(--line)] bg-white/5 p-3">
            <p className="mb-2 text-sm font-semibold">Adicionar fornecedor</p>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="Fornecedor"><SupplierSelect value={supplierId} onChange={setSupplierId} placeholder="Escolha…" /></Field>
              <Field label="Código no fornecedor" hint="Como o produto aparece na nota dele (opcional)."><TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: AB-1234" /></Field>
              <Field label="Unidade em que ele vende"><UnitSelect value={unitId} onChange={setUnitId} units={units.filter((u) => u.active)} placeholder="Mesma do estoque" allowEmpty /></Field>
              <Field label="Último preço (por unidade de estoque)"><NumberInput value={price} onChange={setPrice} min={0} suffix="R$" placeholder="0,00" /></Field>
            </div>
            <Toggle checked={preferred} onChange={setPreferred} label="Fornecedor preferido" hint="Aparece primeiro na comparação e nos pedidos." />
            <Button variant="primary" size="lg" full disabled={busy || !supplierId} onClick={() => void add()}>
              <Icon name="plus" size={18} /> Vincular fornecedor
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
