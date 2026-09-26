"use client";

import { useEffect, useMemo, useState } from "react";
import { useCategories, useLocations, useMembers, useProductLots, useProductSearch, useSuppliers, useUnits } from "@/lib/ops/hooks";
import { fmtDate, fmtQty } from "@/lib/ops/format";
import type { Product, StockBalance, Unit } from "@/lib/ops/types";
import { Icon } from "./Icon";
import { Badge, SearchInput, Sheet, useDebounced } from "./ui";
import { EXPIRY_META } from "@/lib/ops/format";

/* ------------------------------------------------------------------ */
/* Seleção de produto (busca no banco + leitura de código)             */
/* ------------------------------------------------------------------ */
export function ProductPicker({
  value, onChange, placeholder = "Buscar produto por nome, código ou código de barras", autoFocus, kind, disabled, onScan,
}: {
  value: Product | null; onChange: (p: Product | null) => void; placeholder?: string; autoFocus?: boolean; kind?: string; disabled?: boolean; onScan?: () => void;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term, 250);
  const q = useProductSearch(debounced, { kind, limit: 30 });

  // código de barras digitado/lido por leitor: se casar exatamente, seleciona
  useEffect(() => {
    if (!q.data || !term.trim()) return;
    const exact = q.data.find((p) => p.barcode && p.barcode === term.trim());
    if (exact && q.data.length >= 1) {
      onChange(exact);
      setTerm("");
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  if (value) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2.5">
        <ProductThumb product={value} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{value.name}</p>
          <p className="text-xs text-slate-400">
            {value.internal_code && <span className="mr-2 font-mono">{value.internal_code}</span>}
            {value.units?.code && <span>unidade: {value.units.code}</span>}
            {value.categories?.name && <span> · {value.categories.name}</span>}
          </p>
        </div>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} aria-label="Trocar produto" className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-slate-300">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative mb-4">
      <div className="flex gap-2">
        <SearchInput value={term} onChange={(v) => { setTerm(v); setOpen(true); }} placeholder={placeholder} autoFocus={autoFocus} className="flex-1" />
        {onScan && (
          <button type="button" onClick={onScan} aria-label="Ler código" className="grid h-[46px] w-12 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-200">
            <Icon name="scan" />
          </button>
        )}
      </div>
      {(open || term) && (
        <div className="card mt-2 max-h-80 overflow-y-auto">
          {q.isLoading ? (
            <p className="px-4 py-3 text-sm text-slate-400">Buscando…</p>
          ) : (q.data ?? []).length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Nenhum produto encontrado.</p>
          ) : (
            (q.data ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p); setTerm(""); setOpen(false); }}
                className="flex w-full items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 text-left last:border-0 hover:bg-white/5 active:bg-white/10"
              >
                <ProductThumb product={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block text-xs text-slate-500">
                    {p.internal_code && <span className="mr-2 font-mono">{p.internal_code}</span>}
                    {p.categories?.name ?? ""}{p.units?.code ? ` · ${p.units.code}` : ""}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className="text-slate-600" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ProductThumb({ product, size = 40 }: { product: Pick<Product, "name" | "photo_url"> & { categories?: { emoji?: string } | null }; size?: number }) {
  if (product.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.photo_url} alt="" width={size} height={size} className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-white/5 text-lg" style={{ width: size, height: size }}>
      {product.categories?.emoji ?? "📦"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Seleção de lote (ordem FEFO, com aviso)                             */
/* ------------------------------------------------------------------ */
export function LotPicker({
  productId, value, onChange, storeId, locationId, allowNone, includeExpired = false,
}: { productId: string | null; value: string | null; onChange: (lot: StockBalance | null) => void; storeId?: string; locationId?: string | null; allowNone?: boolean; includeExpired?: boolean }) {
  const q = useProductLots(productId, storeId, includeExpired);
  const lots = useMemo(() => (q.data ?? []).filter((l) => !locationId || l.location_id === locationId), [q.data, locationId]);
  const first = lots[0];
  if (!productId) return null;
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-sm font-semibold text-slate-300">Lote</p>
      {q.isLoading ? (
        <p className="text-sm text-slate-400">Carregando lotes…</p>
      ) : lots.length === 0 ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Este produto não tem saldo{locationId ? " neste local" : ""}.</p>
      ) : (
        <div className="space-y-1.5">
          {allowNone && (
            <button type="button" onClick={() => onChange(null)} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${value === null ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--line)] bg-white/5"}`}>
              <Icon name="sparkles" size={16} className="text-[var(--accent)]" />
              <span className="font-semibold">Automático (FEFO: vence primeiro, sai primeiro)</span>
            </button>
          )}
          {lots.map((l) => {
            const active = value === l.id || (value === l.lot_id && !allowNone);
            const meta = EXPIRY_META[l.expiry_status];
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onChange(l)}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${active ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--line)] bg-white/5"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{l.lot_code}</span>
                    {first && first.lot_id === l.lot_id && <Badge tone="green">sair primeiro</Badge>}
                  </span>
                  <span className="block text-xs text-slate-400">{l.location_name} · validade {fmtDate(l.expires_at)}</span>
                </span>
                <span className="text-right">
                  <span className="block font-bold tabular-nums">{fmtQty(l.quantity, l.unit)}</span>
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold ${meta.className}`}>{meta.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Selects simples                                                     */
/* ------------------------------------------------------------------ */
function BaseSelect({ value, onChange, options, placeholder, disabled, allowEmpty }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean; allowEmpty?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="field">
      {(allowEmpty || !value) && <option value="">{placeholder ?? "Selecione…"}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function LocationSelect({ value, onChange, storeId, placeholder = "Local de estoque", allowEmpty }: { value: string; onChange: (v: string) => void; storeId?: string; placeholder?: string; allowEmpty?: boolean }) {
  const q = useLocations(storeId);
  return <BaseSelect value={value} onChange={onChange} options={(q.data ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder={placeholder} allowEmpty={allowEmpty} />;
}

export function UnitSelect({ value, onChange, kinds, placeholder = "Unidade", allowEmpty, units }: { value: string; onChange: (v: string) => void; kinds?: Unit["kind"][]; placeholder?: string; allowEmpty?: boolean; units?: Unit[] }) {
  const q = useUnits();
  const list = (units ?? q.data ?? []).filter((u) => !kinds || kinds.includes(u.kind));
  return <BaseSelect value={value} onChange={onChange} options={list.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))} placeholder={placeholder} allowEmpty={allowEmpty} />;
}

export function CategorySelect({ value, onChange, allowEmpty = true, placeholder = "Todas as categorias" }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean; placeholder?: string }) {
  const q = useCategories();
  const cats = q.data ?? [];
  const parents = cats.filter((c) => !c.parent_id);
  const options = parents.flatMap((p) => [
    { value: p.id, label: `${p.emoji} ${p.name}` },
    ...cats.filter((c) => c.parent_id === p.id).map((c) => ({ value: c.id, label: `${p.emoji} ${p.name} › ${c.name}` })),
  ]);
  return <BaseSelect value={value} onChange={onChange} options={options} placeholder={placeholder} allowEmpty={allowEmpty} />;
}

export function SupplierSelect({ value, onChange, allowEmpty = true, placeholder = "Fornecedor" }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean; placeholder?: string }) {
  const q = useSuppliers();
  return <BaseSelect value={value} onChange={onChange} options={(q.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder={placeholder} allowEmpty={allowEmpty} />;
}

export function MemberSelect({ value, onChange, placeholder = "Responsável", allowEmpty = true }: { value: string; onChange: (v: string) => void; placeholder?: string; allowEmpty?: boolean }) {
  const q = useMembers();
  const opts = (q.data ?? []).filter((m) => m.user_id && m.active).map((m) => ({ value: m.user_id!, label: m.profiles?.full_name || m.profiles?.email || m.invited_email || "—" }));
  return <BaseSelect value={value} onChange={onChange} options={opts} placeholder={placeholder} allowEmpty={allowEmpty} />;
}

/* ------------------------------------------------------------------ */
/* Folha de busca de produto (para leitura/consulta rápida)            */
/* ------------------------------------------------------------------ */
export function ProductSheet({ open, onClose, onPick, title = "Escolher produto" }: { open: boolean; onClose: () => void; onPick: (p: Product) => void; title?: string }) {
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term, 250);
  const q = useProductSearch(debounced, { limit: 40 });
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <SearchInput value={term} onChange={setTerm} autoFocus placeholder="Nome, código ou código de barras" />
      <div className="mt-3 divide-y divide-[var(--line)]">
        {(q.data ?? []).map((p) => (
          <button key={p.id} type="button" onClick={() => { onPick(p); onClose(); }} className="flex w-full items-center gap-3 py-2.5 text-left">
            <ProductThumb product={p} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{p.name}</span>
              <span className="block text-xs text-slate-500">{p.internal_code} {p.categories?.name ? `· ${p.categories.name}` : ""}</span>
            </span>
          </button>
        ))}
        {q.data && q.data.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Nenhum produto.</p>}
      </div>
    </Sheet>
  );
}
