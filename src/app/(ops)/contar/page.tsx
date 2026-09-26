"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { callOfflineable, useOfflineQueue } from "@/lib/ops/offline";
import { toOpsError } from "@/lib/ops/errors";
import { useLocations } from "@/lib/ops/hooks";
import { fmtQty, fmtTime, todayISO } from "@/lib/ops/format";
import { LOCATION_KIND_LABEL, type Product, type StockLocation } from "@/lib/ops/types";
import {
  DIFF_REASONS, ensureQuickCount, fetchProduct, fetchProductByCode, fetchScannedLot, useCount, useLocationBalances, useOpenQuickCounts,
  useProductUnitOptions, useRecentCountItems, useUnitCode, type CountItemRow, type CountRow,
} from "@/lib/ops/modules/inventario";
import { Badge, Button, Choice, EmptyState, ErrorBox, Field, InlineAlert, PageHeader, Skeleton, TextInput, useToast } from "@/components/ops/ui";
import { ProductPicker } from "@/components/ops/pickers";
import { parseLotQr } from "@/components/ops/QrCode";
import { Icon } from "@/components/ops/Icon";
import { ScanSheet } from "@/components/ops/inventario/ScanSheet";
import { QtyUnitInput } from "@/components/ops/inventario/QtyUnitInput";
import { CountItemSheet } from "@/components/ops/inventario/CountItemSheet";
import { FinalizeCountSheet } from "@/components/ops/inventario/FinalizeCountSheet";
import { CountLotPicker, CountPreview, DiffValue } from "@/components/ops/inventario/shared";

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl"><Skeleton rows={3} /></div>}>
      <ContarPage />
    </Suspense>
  );
}

type Pending = { product: Product; lotId: string | null; locationId: string | null };
type LocalRecent = { id: string; name: string; lot: string; counted: number; theoretical: number | null; unit: string; queued: boolean; at: string };

const storageKey = (storeId: string) => `vr.contar.${storeId}`;

function loadStored(storeId: string): CountRow | null {
  try {
    const raw = window.localStorage.getItem(storageKey(storeId));
    if (!raw) return null;
    const row = JSON.parse(raw) as CountRow;
    // só vale a contagem aberta hoje (fuso do aparelho), igual à regra de ensureQuickCount
    if (row.status !== "aberta" || !row.created_at || new Date(row.created_at) < new Date(`${todayISO()}T00:00:00`)) return null;
    return row;
  } catch {
    return null;
  }
}
function saveStored(storeId: string, row: CountRow | null) {
  try {
    if (row) window.localStorage.setItem(storageKey(storeId), JSON.stringify(row));
    else window.localStorage.removeItem(storageKey(storeId));
  } catch {
    /* ignora */
  }
}

/**
 * MODO CONTAGEM RÁPIDA (celular)
 * 1) escolher o local  2) ler/buscar produto → quantidade → confirmar, em sequência.
 * Cada item vai para a contagem rápida do dia daquele local (aberta na hora, se
 * não existir). Contar funciona offline (fila); abrir a contagem exige internet.
 */
function ContarPage() {
  const { store, company, can } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const lotParam = sp.get("lot");
  const productParam = sp.get("product");
  const notify = useToast();
  const invalidate = useInvalidate();
  const { online, queue } = useOfflineQueue();
  const unitCode = useUnitCode();
  const locations = useLocations();
  const openCounts = useOpenQuickCounts(store?.id);

  const [count, setCount] = useState<CountRow | null>(null);
  const [restored, setRestored] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [paramsDone, setParamsDone] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [lot, setLot] = useState<string | null>(null);
  const [lotTouched, setLotTouched] = useState(false);
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [editing, setEditing] = useState<CountItemRow | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [localRecent, setLocalRecent] = useState<LocalRecent[]>([]);

  // restaura a contagem do dia salva no aparelho (funciona offline)
  useEffect(() => {
    if (!store || restored) return;
    const row = loadStored(store.id);
    if (row && row.store_id === store.id) setCount(row);
    setRestored(true);
  }, [store, restored]);

  const live = useCount(count?.id);
  const current = live.data && live.data.id === count?.id ? live.data : count;
  const recent = useRecentCountItems(count?.id, 100);
  const balances = useLocationBalances(store?.id, product?.id, current?.location_id ?? null);
  const { options } = useProductUnitOptions(product);
  const factor = options.find((o) => o.id === unit)?.factor ?? 1;
  useRealtimeInvalidate(["inventory_items", "inventory_counts"]);

  // a contagem do dia foi finalizada/cancelada em outro aparelho: volta para o passo 1
  useEffect(() => {
    if (live.data && count && live.data.id === count.id && live.data.status !== "aberta") {
      saveStored(count.store_id, null);
      setCount(null);
      notify(`A contagem ${live.data.number} já foi ${live.data.status}. Escolha o local para abrir outra.`, "info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data?.status]);

  const chooseLocation = useCallback(
    async (locationId: string): Promise<CountRow | null> => {
      if (!store) return null;
      setOpening(locationId);
      try {
        const row = await ensureQuickCount(store.id, locationId);
        setCount(row);
        saveStored(store.id, row);
        setLocalRecent([]);
        invalidate("inventory_counts");
        return row;
      } catch (e) {
        const err = toOpsError(e as Error);
        notify(err.network ? "Para abrir a contagem do dia é preciso internet. Conecte-se e tente de novo." : err.message, "erro");
        return null;
      } finally {
        setOpening(null);
      }
    },
    [store, invalidate, notify],
  );

  // ?lot= / ?product= vindos do QR Code
  useEffect(() => {
    if (!store || !company || paramsDone || !restored) return;
    setParamsDone(true);
    if (!lotParam && !productParam) return;
    void (async () => {
      try {
        if (lotParam) {
          const s = await fetchScannedLot(lotParam);
          if (!s || s.lot.store_id !== store.id) return notify("Lote não encontrado nesta unidade.", "erro");
          const withBalance = s.balances.filter((b) => Number(b.quantity) > 0);
          const here = count && withBalance.find((b) => b.location_id === count.location_id);
          const loc = here?.location_id ?? withBalance[0]?.location_id ?? count?.location_id ?? null;
          setPending({ product: s.product, lotId: s.lot.id, locationId: loc });
          if (loc && (!count || count.location_id !== loc)) await chooseLocation(loc);
          return;
        }
        if (productParam) {
          const p = await fetchProduct(productParam);
          if (!p) return notify("Produto não encontrado.", "erro");
          setPending({ product: p, lotId: null, locationId: count?.location_id ?? null });
        }
      } catch (e) {
        notify(toOpsError(e as Error).message, "erro");
      }
    })();
  }, [store, company, paramsDone, restored, lotParam, productParam, count, chooseLocation, notify]);

  // aplica o produto/lote pendente assim que houver contagem aberta
  useEffect(() => {
    if (!pending || !count) return;
    if (pending.locationId && pending.locationId !== count.location_id) return;
    setProduct(pending.product);
    setLot(pending.lotId);
    setLotTouched(Boolean(pending.lotId));
    setPending(null);
  }, [pending, count]);

  // um só lote no local: usa direto (mesma regra do banco)
  useEffect(() => {
    if (lotTouched || !balances.data) return;
    setLot(balances.data.length === 1 ? balances.data[0].lot_id : null);
  }, [lotTouched, balances.data]);

  const stockUnit = product ? unitCode(product.stock_unit_id) : "";
  const theoretical = useMemo(() => {
    if (!balances.data) return null;
    if (lot) return balances.data.filter((b) => b.lot_id === lot).reduce((s, b) => s + Number(b.quantity), 0);
    return balances.data.reduce((s, b) => s + Number(b.quantity), 0);
  }, [balances.data, lot]);
  const countedInStock = qty === null ? null : qty * factor;
  const hasDiff = theoretical !== null && countedInStock !== null && Math.abs(countedInStock - theoretical) > 1e-9;

  function resetItem() {
    setProduct(null);
    setLot(null);
    setLotTouched(false);
    setQty(null);
    setUnit("");
    setReason("");
    setReasonText("");
  }

  async function handleScan(text: string) {
    setScanOpen(false);
    if (!company || !current) return;
    try {
      const lotId = parseLotQr(text);
      if (lotId) {
        const s = await fetchScannedLot(lotId);
        if (!s) return notify("Lote não encontrado.", "erro");
        if (s.lot.store_id !== store?.id) return notify("Este lote é de outra unidade.", "erro");
        setProduct(s.product);
        setLot(s.lot.id);
        setLotTouched(true);
        return;
      }
      const ps = await fetchProductByCode(company.id, text);
      if (ps.length === 0) return notify(`Código "${text}" não encontrado.`, "erro");
      if (ps.length > 1) return notify("Mais de um produto com esse código. Escolha pela busca.", "info");
      setProduct(ps[0]);
      setLot(null);
      setLotTouched(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  async function confirm() {
    if (!store || !current || !product) return;
    if (qty === null || qty < 0) return notify("Informe a quantidade contada (pode ser zero).", "erro");
    const finalReason = reason === "outro" ? reasonText.trim() || "outro" : reason;
    setBusy(true);
    try {
      const r = await callOfflineable<string>(
        "ops_count_set_item",
        { p_count: current.id, p_product: product.id, p_location: current.location_id, p_counted: qty, p_lot: lot, p_reason: finalReason, p_notes: "", p_unit: unit || null },
        `Contagem ${current.number} · ${product.name} · ${fmtQty(qty)}`,
      );
      invalidate("inventory_items", "inventory_counts");
      const lotCode = lot ? (balances.data?.find((b) => b.lot_id === lot)?.lot_code ?? "") : "";
      setLocalRecent((l) => [{ id: r.queued ? r.id : r.data, name: product.name, lot: lotCode, counted: countedInStock ?? qty, theoretical, unit: stockUnit, queued: r.queued, at: new Date().toISOString() }, ...l].slice(0, 50));
      notify(r.queued ? `${product.name}: na fila (sem internet)` : `${product.name}: ${fmtQty(countedInStock ?? qty, stockUnit)} registrado`, r.queued ? "info" : "ok");
      resetItem();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  function changeLocation() {
    if (!store) return;
    saveStored(store.id, null);
    setCount(null);
    resetItem();
  }

  if (!can("inventario.contar")) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Contar" backHref="/" icon="clipboard" />
        <EmptyState emoji="🔒" title="Sem permissão para contar" description="Peça ao gerente a permissão “Inventário: contar” para usar a contagem rápida." />
      </div>
    );
  }

  /* ---------------- passo 1: local ---------------- */
  if (!current) {
    const openByLoc = new Map((openCounts.data ?? []).filter((c) => c.location_id).map((c) => [c.location_id as string, c] as const));
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Contar" subtitle="Escolha o local onde você está" backHref="/" icon="clipboard" />
        {!online && <InlineAlert tone="amber" icon="wifiOff">Sem internet. Para abrir a contagem do dia é preciso conexão; depois de aberta, você conta offline.</InlineAlert>}
        {pending && <InlineAlert tone="blue" icon="info">Produto lido: <strong>{pending.product.name}</strong>. Escolha o local para contar.</InlineAlert>}
        {locations.isLoading ? (
          <Skeleton rows={4} />
        ) : locations.error ? (
          <ErrorBox error={toOpsError(locations.error as Error).message} onRetry={() => void locations.refetch()} />
        ) : (locations.data ?? []).length === 0 ? (
          <EmptyState emoji="📍" title="Nenhum local de estoque cadastrado" description="Peça ao gerente para cadastrar os locais (estoque seco, geladeira, freezer…) em Configurações." />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(locations.data ?? []).map((l: StockLocation) => {
              const oc = openByLoc.get(l.id);
              const busyHere = opening === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={opening !== null}
                  onClick={() => void chooseLocation(l.id)}
                  className="card card-hover flex min-h-[72px] items-center gap-3 p-4 text-left disabled:opacity-60"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white"><Icon name="warehouse" size={24} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold leading-tight">{l.name}</span>
                    <span className="block text-xs text-slate-400">
                      {LOCATION_KIND_LABEL[l.kind] ?? l.kind}
                      {oc && <> · <span className="text-amber-300">{oc.items_count} contado(s) hoje ({oc.number})</span></>}
                    </span>
                  </span>
                  {busyHere ? <span className="text-xs text-slate-400">abrindo…</span> : <Icon name="chevronRight" className="text-slate-600" />}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-center text-xs text-slate-500">
          Precisa de uma contagem completa ou por categoria? <Link href="/inventario" className="font-semibold text-[var(--accent)]">Abra em Inventário</Link>.
        </p>
      </div>
    );
  }

  /* ---------------- passo 2: contagem contínua ---------------- */
  const recentRows = recent.data ?? [];
  // só mostra como "na fila" o que ainda está na fila offline; depois de enviado, a linha do servidor aparece em `recentRows`
  const queuedLocal = localRecent.filter((l) => l.queued && queue.some((q) => q.id === l.id));
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={current.stock_locations?.name ?? "Contagem"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{current.number}</span>
            <Badge tone="cyan">rápida</Badge>
            <span>{current.items_count} item(ns) · {current.differences} diferença(s)</span>
          </span>
        }
        icon="clipboard"
        actions={
          <>
            <Button variant="soft" onClick={changeLocation}><Icon name="swap" size={16} /> Trocar local</Button>
            {can("inventario.finalizar") && (
              <Button variant="success" onClick={() => setFinalizeOpen(true)} disabled={!online || (current.items_count === 0 && localRecent.length === 0)}>
                <Icon name="check" size={16} /> Finalizar
              </Button>
            )}
          </>
        }
      />
      {!online && <InlineAlert tone="amber" icon="wifiOff">Sem internet: cada item contado fica na fila e será enviado quando a conexão voltar. Finalizar exige conexão.</InlineAlert>}

      <div className="card mb-4 p-4">
        {!product ? (
          <>
            <p className="mb-1.5 text-sm font-semibold text-slate-300">Leia o código ou busque o produto</p>
            <ProductPicker value={product} onChange={(p) => { setProduct(p); setLot(null); setLotTouched(false); }} autoFocus onScan={() => setScanOpen(true)} />
            <Button variant="soft" size="lg" full onClick={() => setScanOpen(true)}><Icon name="scan" size={20} /> Ler QR Code / código de barras</Button>
          </>
        ) : (
          <>
            <ProductPicker value={product} onChange={(p) => { setProduct(p); setLot(null); setLotTouched(false); setQty(null); }} />
            <CountLotPicker balances={balances.data ?? []} loading={balances.isLoading} value={lot} onChange={(l) => { setLot(l); setLotTouched(true); }} />
            {balances.error && <InlineAlert tone="amber">Não foi possível carregar o saldo do sistema ({toOpsError(balances.error as Error).message}). Você ainda pode contar.</InlineAlert>}
            <QtyUnitInput product={product} quantity={qty} onQuantity={setQty} unitId={unit} onUnitId={setUnit} label="Quantidade encontrada" autoFocus />
            <CountPreview theoretical={theoretical} counted={countedInStock} unit={stockUnit} />
            {hasDiff && (
              <>
                <p className="mb-1.5 text-sm font-semibold text-slate-300">Motivo da diferença (opcional)</p>
                <Choice value={reason} onChange={setReason} columns={2} options={DIFF_REASONS.map((r) => ({ value: r.value, label: r.label }))} />
                {reason === "outro" && (
                  <Field label="Descreva o motivo">
                    <TextInput value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Ex.: embalagem trocada" />
                  </Field>
                )}
              </>
            )}
            <div className="flex gap-2">
              <Button variant="soft" size="lg" onClick={resetItem} disabled={busy}>Cancelar</Button>
              <Button variant="primary" size="lg" full disabled={busy || qty === null} onClick={() => void confirm()}>{busy ? "Gravando…" : "Confirmar"}</Button>
            </div>
          </>
        )}
      </div>

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Contados agora</h2>
          <Link href={`/inventario/${current.id}`} className="text-xs font-semibold text-[var(--accent)]">ver contagem completa</Link>
        </div>
        {recent.isLoading && recentRows.length === 0 && queuedLocal.length === 0 ? (
          <Skeleton rows={2} />
        ) : recentRows.length === 0 && queuedLocal.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nenhum item contado ainda neste local hoje. Leia o primeiro código acima.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {queuedLocal.map((l) => (
              <li key={`q-${l.id}`} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.name}</p>
                  <p className="text-xs text-slate-500">{l.lot ? `lote ${l.lot}` : "todos os lotes"} · {fmtTime(l.at)} · <span className="text-amber-300">na fila</span></p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">{fmtQty(l.counted, l.unit)}</p>
                  {l.theoretical !== null && <DiffValue diff={l.counted - l.theoretical} unit={l.unit} className="text-xs" />}
                </div>
              </li>
            ))}
            {recentRows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setEditing(r)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm active:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.products?.name ?? "—"}</p>
                    <p className="text-xs text-slate-500">
                      {r.stock_lots ? `lote ${r.stock_lots.lot_code}` : "todos os lotes"} · {fmtTime(r.counted_at)} · sistema {fmtQty(r.theoretical_quantity, unitCode(r.products?.stock_unit_id))}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums">{fmtQty(r.counted_quantity, unitCode(r.products?.stock_unit_id))}</p>
                    <DiffValue diff={r.difference === null ? null : Number(r.difference)} unit={unitCode(r.products?.stock_unit_id)} className="text-xs" />
                  </div>
                  <Icon name="edit" size={16} className="text-slate-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {recent.error && <p className="mt-2 text-xs text-amber-300">Lista sem atualizar: {toOpsError(recent.error as Error).message}</p>}
      </section>

      <ScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onResult={(t) => void handleScan(t)} />
      <CountItemSheet open={Boolean(editing)} onClose={() => setEditing(null)} count={current} item={editing} />
      <FinalizeCountSheet
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        count={current}
        uncounted={0}
        onFinalized={() => {
          if (store) saveStored(store.id, null);
          const id = current.id;
          setCount(null);
          resetItem();
          router.push(`/inventario/${id}`);
        }}
      />
    </div>
  );
}
