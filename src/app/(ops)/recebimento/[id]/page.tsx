"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { useLocations, useMembers } from "@/lib/ops/hooks";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/ops/format";
import { ITEM_RESULT_LABEL, PACKAGE_LABEL, RECEIPT_RESULT_LABEL, RECEIPT_STATUS_LABEL, REJECTION_LABEL } from "@/lib/ops/types";
import { RECEIPT_ITEM_SELECT, fromLocalInput, temperatureIssue, toLocalInput, type ReceiptDetail, type ReceiptItemRow, type ReceiveResult } from "@/lib/ops/modules/recebimento";
import { SupplierSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { Badge, Button, ConfirmSheet, ErrorBox, Field, IconButton, InlineAlert, PageHeader, Row, SectionCard, Sheet, Skeleton, TextArea, TextInput, toneFor, useToast } from "@/components/ops/ui";
import { ReceiptItemDrawer } from "@/components/ops/recebimento/ReceiptItemDrawer";
import { ReceiptResultView } from "@/components/ops/recebimento/ReceiptResultView";
import { ConfirmActionSheet, LinkButton, LinkChip, ReasonSheet } from "@/components/ops/recebimento/shared";

/* ------------------------------------------------------------------ */
/* Cartão de item                                                      */
/* ------------------------------------------------------------------ */
function ItemCard({ it, editable, finalized, onEdit, onRemove }: { it: ReceiptItemRow; editable: boolean; finalized: boolean; onEdit: () => void; onRemove: () => void }) {
  const p = it.products;
  const stockUnit = p?.units?.code ?? "";
  const unit = it.units?.code ?? stockUnit;
  const converted = Boolean(it.unit_id && p?.stock_unit_id && it.unit_id !== p.stock_unit_id);
  const temp = temperatureIssue(p, it.temperature);
  const tone = it.result === "aprovado" ? "green" : it.result === "ressalva" ? "amber" : "red";
  return (
    <li className={`px-4 py-3 ${editable ? "cursor-pointer active:bg-white/5" : ""}`} onClick={editable ? onEdit : undefined}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{p?.name ?? "Produto"}</p>
            {p?.internal_code && <span className="font-mono text-xs text-slate-500">{p.internal_code}</span>}
            <Badge tone={tone}>{ITEM_RESULT_LABEL[it.result]}</Badge>
          </div>
          <p className="text-sm text-slate-300 tabular-nums">
            <strong>{fmtQty(it.quantity, unit)}</strong>
            {converted && <span className="text-slate-400"> = {fmtQty(it.quantity_stock, stockUnit)}</span>}
            <span className="text-slate-500"> · </span>
            {fmtMoney(it.unit_price)}/{unit || "un"} → <strong>{fmtMoney(it.total_price)}</strong>
          </p>
          <p className="text-xs text-slate-500">
            Lote {it.lot_code ? <span className="font-mono">{it.lot_code}</span> : "automático"} · validade {fmtDate(it.expires_at)} · {it.stock_locations?.name ?? "local padrão"}
            {it.temperature !== null && it.temperature !== undefined ? ` · ${fmtQty(it.temperature)} °C` : ""}
            {it.package_condition !== "ok" ? ` · embalagem ${PACKAGE_LABEL[it.package_condition].toLowerCase()}` : ""}
            {it.weight !== null && it.weight !== undefined ? ` · pesado ${fmtQty(it.weight, "kg")}` : ""}
          </p>
          {temp.outOfRange && <p className="text-xs font-semibold text-rose-300">Temperatura fora da faixa ({temp.rangeLabel})</p>}
          {it.result === "recusado" && <p className="text-xs text-rose-300">Motivo: {REJECTION_LABEL[it.rejection_reason] ?? it.rejection_reason}</p>}
          {it.notes && <p className="mt-0.5 text-xs text-slate-400">{it.notes}</p>}
          {finalized && it.lot_id && (
            <div className="mt-1.5">
              <LinkChip href={`/lote/${it.lot_id}`} icon="package">Lote {it.stock_lots?.lot_code ?? ""}</LinkChip>
            </div>
          )}
        </div>
        {editable && (
          <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
            <IconButton icon="edit" label="Editar item" onClick={onEdit} />
            <IconButton icon="trash" label="Remover item" tone="danger" onClick={onRemove} />
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Edição do cabeçalho (enquanto rascunho)                             */
/* ------------------------------------------------------------------ */
function HeaderSheet({ open, onClose, receipt, onSaved }: { open: boolean; onClose: () => void; receipt: ReceiptDetail; onSaved: () => void }) {
  const notify = useToast();
  const [supplierId, setSupplierId] = useState(receipt.supplier_id ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(receipt.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(receipt.invoice_date ?? "");
  const [receivedAt, setReceivedAt] = useState(toLocalInput(receipt.received_at));
  const [notes, setNotes] = useState(receipt.notes ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSupplierId(receipt.supplier_id ?? "");
    setInvoiceNumber(receipt.invoice_number ?? "");
    setInvoiceDate(receipt.invoice_date ?? "");
    setReceivedAt(toLocalInput(receipt.received_at));
    setNotes(receipt.notes ?? "");
  }, [open, receipt]);

  async function save() {
    setBusy(true);
    try {
      const res = await supabaseBrowser()
        .from("receipts")
        .update({
          supplier_id: supplierId || null,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate || null,
          received_at: fromLocalInput(receivedAt) ?? receipt.received_at,
          notes: notes.trim(),
        })
        .eq("id", receipt.id);
      if (res.error) throw toOpsError(res.error);
      notify("Dados atualizados");
      onSaved();
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Dados do recebimento" footer={<Button variant="primary" size="lg" full disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button>}>
      <Field label="Fornecedor"><SupplierSelect value={supplierId} onChange={setSupplierId} placeholder="Sem fornecedor" /></Field>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Nº da nota fiscal"><TextInput value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Data da nota"><TextInput type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
      </div>
      <Field label="Data e hora do recebimento"><TextInput type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
      <Field label="Observação"><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const members = useMembers();

  const rq = useQuery({
    queryKey: ["receipts", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await supabaseBrowser().from("receipts").select("*, suppliers(id, name, whatsapp, phone), purchase_orders(id, number, status)").eq("id", id).single();
      if (res.error) throw toOpsError(res.error);
      return res.data as ReceiptDetail;
    },
  });
  const iq = useQuery({
    queryKey: ["receipt_items", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await supabaseBrowser().from("receipt_items").select(RECEIPT_ITEM_SELECT).eq("receipt_id", id).order("position").order("created_at");
      if (res.error) throw toOpsError(res.error);
      return (res.data ?? []) as ReceiptItemRow[];
    },
  });
  useRealtimeInvalidate(["receipts"], [["receipt_items", id]]);
  const receipt = rq.data ?? null;
  const items = useMemo(() => iq.data ?? [], [iq.data]);
  const locations = useLocations(receipt?.store_id);

  const [drawer, setDrawer] = useState<{ open: boolean; item: ReceiptItemRow | null }>({ open: false, item: null });
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ReceiptItemRow | null>(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finalResult, setFinalResult] = useState<ReceiveResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const isDraft = receipt?.status === "rascunho";
  const canEdit = Boolean(isDraft && receipt && can("recebimento.criar", receipt.store_id));
  const canFinalize = Boolean(isDraft && receipt && can("recebimento.finalizar", receipt.store_id));

  const summary = useMemo(() => {
    let total = 0, aprovado = 0, ressalva = 0, recusado = 0;
    for (const it of items) {
      if (it.result === "recusado") recusado++;
      else {
        total += Number(it.total_price) || 0;
        if (it.result === "ressalva") ressalva++;
        else aprovado++;
      }
    }
    return { total, aprovado, ressalva, recusado };
  }, [items]);

  const lotIds = useMemo(() => items.filter((i) => i.lot_id).map((i) => i.lot_id as string), [items]);
  const finalizerName = useMemo(() => {
    if (!receipt?.finalized_by) return "";
    const m = members.data?.find((x) => x.user_id === receipt.finalized_by);
    return m?.profiles?.full_name || m?.profiles?.email || "";
  }, [members.data, receipt?.finalized_by]);

  async function finalize() {
    setBusy(true);
    try {
      const r = await rpc<ReceiveResult>("ops_receive", { p_receipt: id });
      invalidate("receipts", "receipt_items", "stock_items", "stock_lots", "alerts", "purchase_orders", "purchase_order_items", "products", "supplier_products", "v_replenishment_ranked", "dashboard");
      setFinalResult(r);
      setShowResult(true);
      setConfirmFinish(false);
      notify("Recebimento finalizado");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function cancelDraft(reason: string) {
    setBusy(true);
    try {
      await rpc("ops_receipt_cancel", { p_receipt: id, p_reason: reason });
      invalidate("receipts", "receipt_items");
      notify("Rascunho cancelado");
      setCancelOpen(false);
      router.push("/recebimento");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(it: ReceiptItemRow) {
    try {
      const res = await supabaseBrowser().from("receipt_items").delete().eq("id", it.id);
      if (res.error) throw toOpsError(res.error);
      invalidate("receipt_items", "receipts");
      notify("Item removido");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }

  /* ---------------- estados de carregamento / erro ---------------- */
  if (rq.error) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Recebimento" backHref="/recebimento" icon="truck" />
        <ErrorBox error={toOpsError(rq.error as Error).message} onRetry={() => void rq.refetch()} />
      </div>
    );
  }
  if (!receipt) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Recebimento" backHref="/recebimento" icon="truck" />
        <Skeleton rows={4} />
      </div>
    );
  }
  if (showResult && finalResult) {
    return <ReceiptResultView receipt={receipt} result={finalResult} items={items} onViewReceipt={() => setShowResult(false)} />;
  }

  const statusBadge =
    receipt.status === "finalizado" && receipt.result ? (
      <Badge tone={toneFor(receipt.result === "aprovado_ressalva" ? "ressalva" : receipt.result)}>{RECEIPT_RESULT_LABEL[receipt.result]}</Badge>
    ) : (
      <Badge tone={receipt.status === "rascunho" ? "amber" : toneFor(receipt.status)}>{RECEIPT_STATUS_LABEL[receipt.status]}</Badge>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Recebimento ${receipt.number}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{statusBadge}<span>{receipt.suppliers?.name ?? "Sem fornecedor"} · {fmtDateTime(receipt.received_at)}</span></span>}
        backHref="/recebimento"
        icon="truck"
        actions={canEdit ? <Button variant="primary" onClick={() => setDrawer({ open: true, item: null })}><Icon name="plus" size={18} /> Adicionar item</Button> : undefined}
      />

      {isDraft && locations.data && locations.data.length === 0 && (
        <InlineAlert tone="red">Esta unidade não tem local de estoque cadastrado. Cadastre um local em Configurações antes de finalizar o recebimento.</InlineAlert>
      )}
      {receipt.status === "cancelado" && <InlineAlert tone="slate" icon="info">Este recebimento foi cancelado e não gerou entrada no estoque.</InlineAlert>}

      {/* cabeçalho */}
      <SectionCard
        title="Dados"
        className="mb-4"
        action={canEdit ? <button type="button" onClick={() => setHeaderOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]"><Icon name="edit" size={14} /> Editar</button> : undefined}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6">
          <Row label="Fornecedor">{receipt.suppliers?.name ?? "—"}</Row>
          <Row label="Nota fiscal">{receipt.invoice_number || "—"}{receipt.invoice_date ? <span className="ml-1 text-xs font-normal text-slate-400">({fmtDate(receipt.invoice_date)})</span> : null}</Row>
          <Row label="Recebido em">{fmtDateTime(receipt.received_at)}</Row>
          <Row label="Recebido por">{receipt.received_by_name || "—"}</Row>
          {receipt.purchase_orders && (
            <Row label="Pedido de compra"><LinkChip href={`/compras/${receipt.purchase_orders.id}`} icon="file">{receipt.purchase_orders.number}</LinkChip></Row>
          )}
          {receipt.status === "finalizado" && (
            <Row label="Finalizado">{fmtDateTime(receipt.finalized_at)}{finalizerName ? <span className="ml-1 text-xs font-normal text-slate-400">por {finalizerName}</span> : null}</Row>
          )}
        </div>
        {receipt.notes && <p className="mt-2 whitespace-pre-line rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300">{receipt.notes}</p>}
      </SectionCard>

      {/* itens */}
      <section className="card mb-4 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Itens conferidos ({items.length})</h2>
          {canEdit && items.length > 0 && (
            <button type="button" onClick={() => setDrawer({ open: true, item: null })} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]"><Icon name="plus" size={14} /> Adicionar</button>
          )}
        </div>
        {iq.isLoading ? (
          <div className="p-4"><Skeleton rows={2} /></div>
        ) : iq.error ? (
          <div className="p-4"><ErrorBox error={toOpsError(iq.error as Error).message} onRetry={() => void iq.refetch()} /></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="mb-2 text-4xl">📦</div>
            <p className="font-semibold text-slate-200">Nenhum item conferido ainda</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
              {canEdit ? "Toque em “Adicionar item”, escolha o produto (ou leia o código de barras) e informe quantidade, lote, validade e preço." : "Este recebimento não tem itens."}
            </p>
            {canEdit && <Button variant="primary" size="lg" className="mt-4" onClick={() => setDrawer({ open: true, item: null })}><Icon name="plus" /> Adicionar item</Button>}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((it) => (
              <ItemCard key={it.id} it={it} editable={canEdit} finalized={receipt.status === "finalizado"} onEdit={() => setDrawer({ open: true, item: it })} onRemove={() => setRemoveTarget(it)} />
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-white/[0.03] px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green">{summary.aprovado} aprovado(s)</Badge>
              <Badge tone="amber">{summary.ressalva} com ressalva</Badge>
              <Badge tone="red">{summary.recusado} recusado(s)</Badge>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total (sem recusados)</p>
              <p className="text-xl font-extrabold tabular-nums">{fmtMoney(summary.total)}</p>
            </div>
          </div>
        )}
      </section>

      {/* ações */}
      {isDraft && (
        <div className="mb-6 flex flex-col gap-2">
          {canFinalize ? (
            <Button variant="success" size="lg" full disabled={busy || items.length === 0} onClick={() => setConfirmFinish(true)}>
              <Icon name="check" /> Finalizar recebimento
            </Button>
          ) : (
            <InlineAlert tone="slate" icon="lock">Quem tem a permissão “Finalizar recebimento” conclui a entrada no estoque.</InlineAlert>
          )}
          {canEdit && (
            <Button variant="ghost" size="lg" full className="!text-rose-300" disabled={busy} onClick={() => setCancelOpen(true)}>
              Cancelar rascunho
            </Button>
          )}
        </div>
      )}
      {receipt.status === "finalizado" && (
        <div className="mb-6 flex flex-col gap-2 sm:flex-row">
          {lotIds.length > 0 && can("etiquetas.imprimir", receipt.store_id) && (
            <LinkButton href={`/etiquetas/imprimir?lots=${encodeURIComponent(lotIds.join(","))}&kind=recebimento`} size="lg" full>
              <Icon name="printer" /> Imprimir etiquetas
            </LinkButton>
          )}
          {can("recebimento.criar", receipt.store_id) && (
            <LinkButton href="/recebimento/novo" variant="soft" size="lg" full><Icon name="plus" /> Novo recebimento</LinkButton>
          )}
        </div>
      )}

      {/* folhas */}
      <ReceiptItemDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, item: null })}
        receipt={receipt}
        item={drawer.item}
        nextPosition={items.length}
        onSaved={(keepOpen) => { if (!keepOpen) setDrawer({ open: false, item: null }); }}
      />
      <HeaderSheet open={headerOpen} onClose={() => setHeaderOpen(false)} receipt={receipt} onSaved={() => invalidate("receipts")} />
      <ConfirmActionSheet
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title="Finalizar recebimento?"
        confirmLabel="Finalizar e dar entrada"
        variant="success"
        busy={busy}
        onConfirm={finalize}
        message={
          <div className="space-y-2 text-sm">
            <p>Ao finalizar, o sistema vai:</p>
            <ul className="list-disc space-y-1 pl-5 text-slate-300">
              <li>criar <strong>{summary.aprovado + summary.ressalva} lote(s)</strong> e dar entrada no estoque (itens aprovados e com ressalva);</li>
              <li>registrar o preço pago no histórico do fornecedor e atualizar o custo dos produtos;</li>
              {summary.recusado > 0 && <li>manter <strong>{summary.recusado} item(ns) recusado(s)</strong> fora do estoque e abrir um alerta;</li>}
              {receipt.purchase_orders && <li>atualizar o pedido de compra {receipt.purchase_orders.number}.</li>}
            </ul>
            <p className="text-slate-400">Depois de finalizado, o recebimento não pode ser editado. Total: <strong className="text-slate-100">{fmtMoney(summary.total)}</strong>.</p>
          </div>
        }
      />
      <ReasonSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar rascunho"
        message="O recebimento será marcado como cancelado e nada entra no estoque. Informe o motivo (opcional)."
        confirmLabel="Cancelar recebimento"
        required={false}
        busy={busy}
        onConfirm={cancelDraft}
      />
      <ConfirmSheet
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Remover item?"
        message={`Remover “${removeTarget?.products?.name ?? "item"}” da conferência?`}
        confirmLabel="Remover"
        onConfirm={() => { if (removeTarget) void removeItem(removeTarget); }}
      />
      <div className="h-4" />
      {receipt.status === "finalizado" && (
        <p className="mb-4 text-center text-xs text-slate-500">
          Precisa corrigir algo? Recebimentos finalizados não são editados: registre um <Link href="/estoque" className="underline">ajuste ou perda</Link> no estoque.
        </p>
      )}
    </div>
  );
}
