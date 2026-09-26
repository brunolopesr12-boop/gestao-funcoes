"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/ops/format";
import { PO_STATUS_LABEL, RECEIPT_STATUS_LABEL, type PurchaseOrderStatus, type ReceiptStatus } from "@/lib/ops/types";
import { PO_EDITABLE_STATUSES, PO_ITEM_SELECT, copyText, purchaseOrderText, whatsappLink, type PurchaseOrderDetail, type PurchaseOrderItemRow } from "@/lib/ops/modules/recebimento";
import { SupplierSelect } from "@/components/ops/pickers";
import { Icon } from "@/components/ops/Icon";
import { Badge, Button, ConfirmSheet, ErrorBox, Field, IconButton, InlineAlert, PageHeader, ProgressBar, Row, SectionCard, Sheet, Skeleton, TextArea, TextInput, toneFor, useToast } from "@/components/ops/ui";
import { PoItemDrawer } from "@/components/ops/recebimento/PoItemDrawer";
import { ConfirmActionSheet, LinkChip, PoStatusBadge, PoTimeline, ReasonSheet } from "@/components/ops/recebimento/shared";

type LinkedReceipt = { id: string; number: string; status: ReceiptStatus; received_at: string };
type Action = "solicitado" | "aprovado" | "pedido" | "rascunho" | "receber";

const ACTION_TEXT: Record<Action, { title: string; message: string; confirm: string; variant: "primary" | "success" }> = {
  solicitado: { title: "Solicitar pedido?", message: "O pedido vai para aprovação. Até ser aprovado, os itens ainda podem ser ajustados.", confirm: "Solicitar", variant: "primary" },
  aprovado: { title: "Aprovar pedido?", message: "Confirma a aprovação? Depois de aprovado o pedido pode ser enviado ao fornecedor e recebido.", confirm: "Aprovar", variant: "success" },
  pedido: { title: "Marcar como enviado ao fornecedor?", message: "Use “Copiar texto” ou “WhatsApp” para mandar o pedido. Depois, confirme aqui que ele foi enviado.", confirm: "Marcar como pedido", variant: "primary" },
  rascunho: { title: "Voltar a rascunho?", message: "O pedido volta para rascunho para ser revisado e solicitado de novo.", confirm: "Voltar a rascunho", variant: "primary" },
  receber: { title: "Receber este pedido?", message: "Vai abrir um recebimento já preenchido com o que falta chegar deste pedido. Na próxima tela você confere item por item e finaliza a entrada no estoque.", confirm: "Ir para a conferência", variant: "success" },
};

function ItemCard({ it, editable, showReceived, onEdit, onRemove }: { it: PurchaseOrderItemRow; editable: boolean; showReceived: boolean; onEdit: () => void; onRemove: () => void }) {
  const p = it.products;
  const stockUnit = p?.units?.code ?? "";
  const unit = it.units?.code ?? stockUnit;
  const converted = Boolean(it.unit_id && p?.stock_unit_id && it.unit_id !== p.stock_unit_id);
  const ordered = Number(it.quantity_stock) || 0;
  const received = Number(it.received_quantity) || 0;
  const pct = ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
  return (
    <li className={`px-4 py-3 ${editable ? "cursor-pointer active:bg-white/5" : ""}`} onClick={editable ? onEdit : undefined}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{p?.name ?? "Produto"}</p>
            {p?.internal_code && <span className="font-mono text-xs text-slate-500">{p.internal_code}</span>}
          </div>
          <p className="text-sm text-slate-300 tabular-nums">
            <strong>{fmtQty(it.quantity, unit)}</strong>
            {converted && <span className="text-slate-400"> = {fmtQty(it.quantity_stock, stockUnit)}</span>}
            <span className="text-slate-500"> · </span>
            {fmtMoney(it.estimated_price)}/{unit || "un"} → <strong>{fmtMoney(it.total)}</strong>
          </p>
          {it.notes && <p className="text-xs text-slate-400">{it.notes}</p>}
          {(showReceived || received > 0) && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <ProgressBar value={pct} tone={pct >= 100 ? "green" : pct > 0 ? "amber" : "red"} className="flex-1" />
              <span className="shrink-0 tabular-nums text-slate-400">recebido {fmtQty(received, stockUnit)} de {fmtQty(ordered, stockUnit)}</span>
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

function HeaderSheet({ open, onClose, po, onSaved }: { open: boolean; onClose: () => void; po: PurchaseOrderDetail; onSaved: () => void }) {
  const notify = useToast();
  const [supplierId, setSupplierId] = useState(po.supplier_id ?? "");
  const [expectedAt, setExpectedAt] = useState(po.expected_at ?? "");
  const [notes, setNotes] = useState(po.notes ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSupplierId(po.supplier_id ?? "");
    setExpectedAt(po.expected_at ?? "");
    setNotes(po.notes ?? "");
  }, [open, po]);
  async function save() {
    setBusy(true);
    try {
      const res = await supabaseBrowser().from("purchase_orders").update({ supplier_id: supplierId || null, expected_at: expectedAt || null, notes: notes.trim() }).eq("id", po.id);
      if (res.error) throw toOpsError(res.error);
      notify("Pedido atualizado");
      onSaved();
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Dados do pedido" footer={<Button variant="primary" size="lg" full disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button>}>
      <Field label="Fornecedor"><SupplierSelect value={supplierId} onChange={setSupplierId} placeholder="Sem fornecedor" /></Field>
      <Field label="Previsão de entrega"><TextInput type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
      <Field label="Observação"><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
    </Sheet>
  );
}

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { store, can } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();

  const pq = useQuery({
    queryKey: ["purchase_orders", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await supabaseBrowser().from("purchase_orders").select("*, suppliers(id, name, whatsapp, phone, email, contact_name, lead_time_days)").eq("id", id).single();
      if (res.error) throw toOpsError(res.error);
      return res.data as PurchaseOrderDetail;
    },
  });
  const iq = useQuery({
    queryKey: ["purchase_order_items", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await supabaseBrowser().from("purchase_order_items").select(PO_ITEM_SELECT).eq("purchase_order_id", id).order("position").order("created_at");
      if (res.error) throw toOpsError(res.error);
      return (res.data ?? []) as PurchaseOrderItemRow[];
    },
  });
  const rq = useQuery({
    queryKey: ["receipts", "by_po", id],
    enabled: Boolean(id) && Boolean(store && can("recebimento.ver")),
    queryFn: async () => {
      const res = await supabaseBrowser().from("receipts").select("id, number, status, received_at").eq("purchase_order_id", id).order("created_at");
      if (res.error) throw toOpsError(res.error);
      return (res.data ?? []) as LinkedReceipt[];
    },
  });
  // purchase_orders, purchase_order_items e receipts estão na publicação Realtime (0010)
  useRealtimeInvalidate(["purchase_orders", "purchase_order_items", "receipts"]);

  const po = pq.data ?? null;
  const items = useMemo(() => iq.data ?? [], [iq.data]);

  const [drawer, setDrawer] = useState<{ open: boolean; item: PurchaseOrderItemRow | null }>({ open: false, item: null });
  const [action, setAction] = useState<Action | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PurchaseOrderItemRow | null>(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const sid = po?.store_id;
  const canCreate = Boolean(po && can("compras.criar", sid));
  const canApprove = Boolean(po && can("compras.aprovar", sid));
  const canReceive = Boolean(po && can("recebimento.criar", sid));
  const editable = Boolean(po && PO_EDITABLE_STATUSES.has(po.status) && canCreate);
  const text = useMemo(() => (po ? purchaseOrderText(po, items, store?.name ?? "") : ""), [po, items, store?.name]);
  const wa = po ? whatsappLink(po.suppliers?.whatsapp || po.suppliers?.phone, text) : null;

  async function setStatus(status: PurchaseOrderStatus, reason = "") {
    setBusy(true);
    try {
      await rpc("ops_po_set_status", { p_po: id, p_status: status, p_reason: reason });
      invalidate("purchase_orders");
      notify(`Pedido ${PO_STATUS_LABEL[status].toLowerCase()}`);
      setAction(null);
      setCancelOpen(false);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  async function receive() {
    setBusy(true);
    try {
      const rid = await rpc<string>("ops_receipt_from_po", { p_po: id });
      invalidate("receipts", "purchase_orders");
      setAction(null);
      router.push(`/recebimento/${rid}`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
      setBusy(false);
    }
  }
  async function removeItem(it: PurchaseOrderItemRow) {
    try {
      const res = await supabaseBrowser().from("purchase_order_items").delete().eq("id", it.id);
      if (res.error) throw toOpsError(res.error);
      invalidate("purchase_order_items", "purchase_orders");
      notify("Item removido");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    }
  }
  async function copy() {
    if (await copyText(text)) notify("Texto do pedido copiado");
    else notify("Não foi possível copiar. Selecione o texto abaixo e copie manualmente.", "erro");
  }

  if (pq.error) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Pedido de compra" backHref="/compras" icon="file" />
        <ErrorBox error={toOpsError(pq.error as Error).message} onRetry={() => void pq.refetch()} />
      </div>
    );
  }
  if (!po) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Pedido de compra" backHref="/compras" icon="file" />
        <Skeleton rows={4} />
      </div>
    );
  }

  const st = po.status;
  const showReceived = st === "pedido" || st === "recebido";
  const actions: { key: Action | "cancelar"; label: string; variant: "primary" | "success" | "soft" | "ghost"; show: boolean }[] = [
    { key: "solicitado", label: "Solicitar aprovação", variant: "primary", show: st === "rascunho" && canCreate },
    { key: "aprovado", label: "Aprovar", variant: "success", show: (st === "solicitado" || st === "rascunho") && canApprove },
    { key: "pedido", label: "Enviado ao fornecedor", variant: "primary", show: st === "aprovado" && canCreate },
    { key: "receber", label: "Receber mercadoria", variant: "success", show: (st === "aprovado" || st === "pedido") && canReceive },
    { key: "rascunho", label: "Voltar a rascunho", variant: "soft", show: st === "solicitado" && canCreate },
    { key: "cancelar", label: "Cancelar pedido", variant: "ghost", show: st !== "recebido" && st !== "cancelado" && canCreate },
  ];
  const visible = actions.filter((a) => a.show);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Pedido ${po.number}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><PoStatusBadge status={st} /><span>{po.suppliers?.name ?? "Sem fornecedor"}</span></span>}
        backHref="/compras"
        icon="file"
        actions={editable ? <Button variant="primary" onClick={() => setDrawer({ open: true, item: null })}><Icon name="plus" size={18} /> Adicionar item</Button> : undefined}
      />

      {st === "cancelado" && <InlineAlert tone="red" icon="info">Pedido cancelado{po.cancel_reason ? `: ${po.cancel_reason}` : "."}</InlineAlert>}
      {st === "solicitado" && !canApprove && <InlineAlert tone="amber" icon="clock">Aguardando aprovação de quem tem a permissão “Aprovar pedido de compra”.</InlineAlert>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <SectionCard
            title="Dados"
            className="mb-4"
            action={editable ? <button type="button" onClick={() => setHeaderOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]"><Icon name="edit" size={14} /> Editar</button> : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6">
              <Row label="Fornecedor">{po.suppliers?.name ?? "—"}{po.suppliers?.contact_name ? <span className="ml-1 text-xs font-normal text-slate-400">({po.suppliers.contact_name})</span> : null}</Row>
              <Row label="Previsão de entrega">{fmtDate(po.expected_at)}</Row>
              <Row label="Criado">{fmtDateTime(po.created_at)}{po.created_by_name ? <span className="ml-1 text-xs font-normal text-slate-400">por {po.created_by_name}</span> : null}</Row>
              <Row label="Total estimado"><span className="text-lg">{fmtMoney(po.total)}</span></Row>
            </div>
            {po.notes && <p className="mt-2 whitespace-pre-line rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300">{po.notes}</p>}
          </SectionCard>

          <section className="card mb-4 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Itens ({items.length})</h2>
              {editable && items.length > 0 && (
                <button type="button" onClick={() => setDrawer({ open: true, item: null })} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]"><Icon name="plus" size={14} /> Adicionar</button>
              )}
            </div>
            {iq.isLoading ? (
              <div className="p-4"><Skeleton rows={2} /></div>
            ) : iq.error ? (
              <div className="p-4"><ErrorBox error={toOpsError(iq.error as Error).message} onRetry={() => void iq.refetch()} /></div>
            ) : items.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="mb-2 text-4xl">🛒</div>
                <p className="font-semibold text-slate-200">Nenhum item no pedido</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">{editable ? "Adicione os produtos, quantidades e preços estimados. Você também pode gerar itens pela tela de Reposição." : "Este pedido está vazio."}</p>
                {editable && <Button variant="primary" size="lg" className="mt-4" onClick={() => setDrawer({ open: true, item: null })}><Icon name="plus" /> Adicionar item</Button>}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {items.map((it) => (
                  <ItemCard key={it.id} it={it} editable={editable} showReceived={showReceived} onEdit={() => setDrawer({ open: true, item: it })} onRemove={() => setRemoveTarget(it)} />
                ))}
              </ul>
            )}
            {items.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] bg-white/[0.03] px-4 py-3">
                <span className="text-sm text-slate-400">{items.length} item(ns)</span>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Total estimado</p>
                  <p className="text-xl font-extrabold tabular-nums">{fmtMoney(po.total)}</p>
                </div>
              </div>
            )}
          </section>

          {visible.length > 0 && (
            <SectionCard title="Ações" className="mb-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {visible.map((a) => (
                  <Button
                    key={a.key}
                    variant={a.variant}
                    size="lg"
                    full
                    className={`sm:w-auto sm:flex-1 ${a.key === "cancelar" ? "!text-rose-300" : ""}`}
                    disabled={busy || (a.key === "solicitado" && items.length === 0)}
                    onClick={() => (a.key === "cancelar" ? setCancelOpen(true) : setAction(a.key))}
                  >
                    {a.key === "receber" && <Icon name="truck" size={18} />}
                    {a.label}
                  </Button>
                ))}
              </div>
              {st === "rascunho" && items.length === 0 && canCreate && <p className="mt-2 text-xs text-slate-500">Adicione pelo menos um item para solicitar o pedido.</p>}
            </SectionCard>
          )}

          <SectionCard title="Enviar ao fornecedor" className="mb-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="soft" size="lg" full onClick={() => void copy()} disabled={items.length === 0}><Icon name="file" size={18} /> Copiar texto do pedido</Button>
              {wa ? (
                <a href={wa} target="_blank" rel="noreferrer" className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/60 bg-emerald-600 px-5 py-3.5 text-base font-semibold text-white ${items.length === 0 ? "pointer-events-none opacity-50" : ""}`}>
                  <Icon name="send" size={18} /> Enviar por WhatsApp
                </a>
              ) : (
                <div className="flex-1 rounded-2xl border border-[var(--line)] bg-white/5 px-4 py-3 text-sm text-slate-400">
                  {po.suppliers ? "Cadastre o WhatsApp do fornecedor para enviar direto." : "Defina o fornecedor para enviar por WhatsApp."}
                </div>
              )}
            </div>
            {items.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-400">Ver texto do pedido</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-xs text-slate-200">{text}</pre>
              </details>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0">
          <SectionCard title="Linha do tempo" className="mb-4">
            <PoTimeline po={po} />
          </SectionCard>
          {rq.data && rq.data.length > 0 && (
            <SectionCard title="Recebimentos" className="mb-4">
              <ul className="space-y-2">
                {rq.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <LinkChip href={`/recebimento/${r.id}`} icon="truck">{r.number}</LinkChip>
                    <Badge tone={r.status === "rascunho" ? "amber" : toneFor(r.status)}>{RECEIPT_STATUS_LABEL[r.status]}</Badge>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      </div>

      <PoItemDrawer open={drawer.open} onClose={() => setDrawer({ open: false, item: null })} po={po} item={drawer.item} nextPosition={items.length} onSaved={(keep) => { if (!keep) setDrawer({ open: false, item: null }); }} />
      <HeaderSheet open={headerOpen} onClose={() => setHeaderOpen(false)} po={po} onSaved={() => invalidate("purchase_orders")} />
      {action && (
        <ConfirmActionSheet
          open
          onClose={() => setAction(null)}
          title={ACTION_TEXT[action].title}
          message={ACTION_TEXT[action].message}
          confirmLabel={ACTION_TEXT[action].confirm}
          variant={ACTION_TEXT[action].variant}
          busy={busy}
          onConfirm={() => (action === "receber" ? receive() : setStatus(action))}
        />
      )}
      <ReasonSheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar pedido" message="Informe o motivo do cancelamento. O pedido fica registrado como cancelado." confirmLabel="Cancelar pedido" busy={busy} onConfirm={(r) => setStatus("cancelado", r)} />
      <ConfirmSheet open={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)} title="Remover item?" message={`Remover “${removeTarget?.products?.name ?? "item"}” do pedido?`} confirmLabel="Remover" onConfirm={() => { if (removeTarget) void removeItem(removeTarget); }} />
    </div>
  );
}
