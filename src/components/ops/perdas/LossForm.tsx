"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { callOfflineable } from "@/lib/ops/offline";
import { toOpsError } from "@/lib/ops/errors";
import { useLossReasons, useProduct } from "@/lib/ops/hooks";
import { daysLabel, fmtDate, fmtMoney, fmtQty } from "@/lib/ops/format";
import type { Product, StockBalance } from "@/lib/ops/types";
import { estimateLossCost, useLossLotSummary } from "@/lib/ops/modules/perdas";
import { fetchProductByCode, fetchScannedLot, useProductUnitOptions } from "@/lib/ops/modules/inventario";
import { Badge, Button, Choice, ConfirmSheet, ErrorBox, Field, InlineAlert, Skeleton, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { LocationSelect, LotPicker, ProductPicker } from "@/components/ops/pickers";
import { PhotoUpload } from "@/components/ops/PhotoUpload";
import { parseLotQr } from "@/components/ops/QrCode";
import { ScanSheet } from "@/components/ops/inventario/ScanSheet";
import { QtyUnitInput } from "@/components/ops/inventario/QtyUnitInput";

/**
 * Formulário de perda (celular): produto (busca/leitura) ou lote fixo (QR),
 * lote FEFO/escolhido, local, quantidade + unidade, motivo (foto quando o
 * motivo exige), observação, custo estimado e confirmação. Funciona offline.
 */
export function LossForm({ lotId, productId }: { lotId?: string | null; productId?: string | null }) {
  const { store, company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const reasons = useLossReasons();
  const lotQ = useLossLotSummary(lotId);
  const fixedLot = lotQ.data ?? null;
  const paramProductId = lotId ? fixedLot?.lot.product_id : productId;
  const paramProduct = useProduct(paramProductId ?? null);

  const [product, setProduct] = useState<Product | null>(null);
  const [lotRow, setLotRow] = useState<StockBalance | null>(null);
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [photo, setPhoto] = useState("");
  const [notes, setNotes] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ queued: boolean; label: string } | null>(null);

  // produto vindo da URL (?product=) ou do lote fixo (?lot=)
  useEffect(() => {
    if (paramProduct.data && !product) setProduct(paramProduct.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramProduct.data]);

  const { options } = useProductUnitOptions(product);
  const factor = options.find((o) => o.id === unit)?.factor ?? 1;
  const selectedReason = (reasons.data ?? []).find((r) => r.id === reason) ?? null;
  const requiresPhoto = Boolean(selectedReason?.requires_photo);
  const noReasons = reasons.data && reasons.data.length === 0;

  const unitCost = fixedLot ? Number(fixedLot.lot.unit_cost) : lotRow ? Number(lotRow.unit_cost) : Number(product?.cost ?? 0);
  const cost = useMemo(() => estimateLossCost(qty, factor, unitCost), [qty, factor, unitCost]);
  const available = fixedLot ? Number(fixedLot.balance) : lotRow ? Number(lotRow.quantity) : null;
  const stockUnitCode = product?.units?.code ?? fixedLot?.product.unit ?? "";

  function reset() {
    setProduct(lotId ? product : null);
    setLotRow(null);
    if (!lotId) setLocation("");
    setQty(null);
    setUnit("");
    setReason("");
    setReasonText("");
    setPhoto("");
    setNotes("");
    setDone(null);
  }

  async function handleScan(text: string) {
    setScanOpen(false);
    if (!company) return;
    try {
      const id = parseLotQr(text);
      if (id) {
        const s = await fetchScannedLot(id);
        if (!s) return notify("Lote não encontrado.", "erro");
        if (s.lot.store_id !== store?.id) return notify("Este lote é de outra unidade.", "erro");
        setProduct(s.product);
        const b = s.balances[0] ?? null;
        setLotRow(b);
        if (b) setLocation(b.location_id);
        return;
      }
      const ps = await fetchProductByCode(company.id, text);
      if (ps.length === 0) return notify(`Código "${text}" não encontrado.`, "erro");
      if (ps.length > 1) return notify("Mais de um produto com esse código. Escolha pela busca.", "info");
      setProduct(ps[0]);
      setLotRow(null);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  function validate(): string | null {
    if (!store || !product) return "Escolha o produto.";
    if (qty === null || qty <= 0) return "Informe a quantidade perdida.";
    if (!noReasons && !reason) return "Escolha o motivo da perda.";
    if (noReasons && !reasonText.trim()) return "Descreva o motivo da perda.";
    if (requiresPhoto && !photo) return `O motivo "${selectedReason?.name}" exige foto.`;
    return null;
  }

  async function submit() {
    const err = validate();
    if (err || !store || !product) return notify(err ?? "Dados incompletos.", "erro");
    setBusy(true);
    const label = `Perda · ${product.name} · ${fmtQty(qty)} ${options.find((o) => o.id === unit)?.code ?? stockUnitCode}`;
    try {
      const r = await callOfflineable<string>(
        "ops_register_loss",
        {
          p_store: store.id,
          p_product: product.id,
          p_quantity: qty,
          p_loss_reason: reason || null,
          p_lot: fixedLot ? fixedLot.lot.id : (lotRow?.lot_id ?? null),
          p_location: location || null,
          p_notes: notes.trim(),
          p_photo_url: photo,
          p_unit: unit || null,
          p_reason_text: noReasons ? reasonText.trim() : "",
        },
        label,
      );
      invalidate("losses", "stock_items", "stock_lots", "stock_movements", "dashboard", "alerts");
      setDone({ queued: r.queued, label });
      notify(r.queued ? "Sem conexão: a perda ficou na fila e será enviada quando a internet voltar." : "Perda registrada", r.queued ? "info" : "ok");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  if (lotId && lotQ.isLoading) return <Skeleton rows={3} />;
  if (lotId && lotQ.error) return <ErrorBox error={toOpsError(lotQ.error as Error).message} onRetry={() => void lotQ.refetch()} />;
  if (lotId && !lotQ.isLoading && !fixedLot) return <ErrorBox error="Lote não encontrado. Ele pode ter sido removido ou ser de outra unidade." />;

  if (done) {
    return (
      <div className="card p-5 text-center">
        <div className="mb-2 text-5xl">{done.queued ? "📶" : "✅"}</div>
        <h2 className="text-xl font-extrabold">{done.queued ? "Perda na fila" : "Perda registrada"}</h2>
        <p className="mt-1 text-sm text-slate-400">{done.label}</p>
        {done.queued && <p className="mt-2 text-sm text-amber-200">Sem internet agora. O registro será enviado automaticamente quando a conexão voltar (veja em Sincronização).</p>}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" size="lg" full onClick={reset}>Registrar outra</Button>
          <Link href="/perdas" className="inline-flex items-center justify-center rounded-2xl border border-[var(--line)] bg-white/5 px-5 py-3.5 text-base font-semibold text-slate-100">Ver perdas</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {fixedLot ? (
        <div className="card mb-4 p-3.5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-xl">📦</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{fixedLot.product.name}</p>
              <p className="text-xs text-slate-400">
                Lote <span className="font-mono font-semibold text-slate-200">{fixedLot.lot.lot_code}</span> · validade {fmtDate(fixedLot.lot.expires_at)} · {daysLabel(fixedLot.days_to_expire)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Saldo: <span className="font-semibold text-slate-200">{fmtQty(fixedLot.balance, fixedLot.product.unit)}</span>
                {fixedLot.balances.length > 0 && <span> · {fixedLot.balances.map((b) => `${b.location} ${fmtQty(b.quantity)}`).join(" · ")}</span>}
              </p>
            </div>
            <Badge tone={Number(fixedLot.balance) > 0 ? "green" : "red"}>{fixedLot.lot.status}</Badge>
          </div>
          {Number(fixedLot.balance) <= 0 && <InlineAlert tone="red">Este lote está sem saldo. A perda será recusada pelo sistema.</InlineAlert>}
        </div>
      ) : (
        <>
          <p className="mb-1.5 text-sm font-semibold text-slate-300">Produto</p>
          <ProductPicker value={product} onChange={(p) => { setProduct(p); setLotRow(null); }} autoFocus={!product} onScan={() => setScanOpen(true)} />
        </>
      )}

      {product && (
        <>
          {!fixedLot && (
            <LotPicker
              productId={product.id}
              value={lotRow?.id ?? null}
              allowNone
              includeExpired
              onChange={(l) => { setLotRow(l); if (l) setLocation(l.location_id); }}
            />
          )}
          {!fixedLot && (
            <Field label="Local (opcional)" hint="Deixe em branco para o sistema baixar de onde há saldo.">
              <LocationSelect value={location} onChange={setLocation} allowEmpty placeholder="Qualquer local" />
            </Field>
          )}
          {fixedLot && fixedLot.balances.length > 1 && (
            <Field label="Local" hint="De qual local o lote foi perdido.">
              <LocationSelect value={location} onChange={setLocation} allowEmpty placeholder="Onde houver saldo" />
            </Field>
          )}

          <QtyUnitInput
            product={product}
            quantity={qty}
            onQuantity={setQty}
            unitId={unit}
            onUnitId={setUnit}
            label="Quantidade perdida"
            autoFocus={Boolean(product)}
            hint={available !== null ? `Disponível: ${fmtQty(available, stockUnitCode)}` : undefined}
          />

          <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5">
            <span className="text-sm text-rose-100">Custo estimado</span>
            <span className="text-lg font-extrabold tabular-nums text-rose-200">{cost === null ? "—" : fmtMoney(cost)}</span>
          </div>
          <p className="-mt-3 mb-4 text-xs text-slate-500">
            {fixedLot || lotRow ? `Custo do lote: ${fmtMoney(unitCost)} por ${stockUnitCode}.` : `Custo médio do produto: ${fmtMoney(unitCost)} por ${stockUnitCode}. O valor final usa o custo do lote baixado.`}
          </p>

          <p className="mb-1.5 text-sm font-semibold text-slate-300">Motivo da perda</p>
          {reasons.isLoading ? (
            <p className="mb-4 text-sm text-slate-400">Carregando motivos…</p>
          ) : reasons.error ? (
            <ErrorBox error={toOpsError(reasons.error as Error).message} onRetry={() => void reasons.refetch()} />
          ) : noReasons ? (
            <>
              <InlineAlert tone="amber">Nenhum motivo de perda cadastrado para a empresa. Peça ao gerente para cadastrar em Configurações. Enquanto isso, descreva o motivo abaixo.</InlineAlert>
              <Field label="Motivo">
                <TextInput value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Ex.: vencimento" />
              </Field>
            </>
          ) : (
            <Choice
              value={reason}
              onChange={setReason}
              columns={2}
              options={(reasons.data ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.requires_photo ? "exige foto" : undefined }))}
            />
          )}

          <PhotoUpload value={photo} onChange={setPhoto} folder="perdas" label={requiresPhoto ? "Foto (obrigatória para este motivo)" : "Foto (opcional)"} required={requiresPhoto} hint="Tire a foto do produto perdido como evidência." />

          <Field label="Observação (opcional)">
            <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: encontrado fora da geladeira pela manhã" />
          </Field>

          <Button variant="danger" size="lg" full disabled={busy} onClick={() => { const e = validate(); if (e) notify(e, "erro"); else setConfirmOpen(true); }}>
            Registrar perda
          </Button>
        </>
      )}
      {!product && !fixedLot && (
        <p className="text-sm text-slate-500">Busque pelo nome ou leia o código de barras / QR da etiqueta do lote.</p>
      )}

      <ScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onResult={(t) => void handleScan(t)} />
      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar perda"
        message={`Dar baixa de ${fmtQty(qty)} ${options.find((o) => o.id === unit)?.code ?? stockUnitCode} de "${product?.name ?? ""}"${selectedReason ? ` por ${selectedReason.name.toLowerCase()}` : ""}${cost !== null ? ` (≈ ${fmtMoney(cost)})` : ""}. Isso sai do estoque e fica registrado; não pode ser desfeito.`}
        confirmLabel="Registrar perda"
        onConfirm={() => void submit()}
      />
    </>
  );
}
