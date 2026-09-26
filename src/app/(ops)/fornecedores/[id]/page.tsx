"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { OpsError, toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/ops/format";
import { PO_STATUS_LABEL, RECEIPT_RESULT_LABEL, RECEIPT_STATUS_LABEL } from "@/lib/ops/types";
import { emptySupplierForm, supplierPayload, supplierToForm, useSupplierDetail, useSupplierOrders, useSupplierReceipts, validateSupplierForm, waLink, type SupplierForm } from "@/lib/ops/modules/cadastros";
import { Badge, Button, ConfirmSheet, EmptyState, ErrorBox, InlineAlert, KpiCard, PageHeader, Sheet, Skeleton, Tabs, toneFor, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { SupplierFormFields } from "@/components/ops/cadastros/SupplierForm";
import { SupplierProductsSection } from "@/components/ops/cadastros/SupplierProductsSection";
import { PriceHistoryTable } from "@/components/ops/cadastros/PriceHistoryTable";

type Tab = "dados" | "produtos" | "historico" | "recebimentos" | "pedidos";

/** Edição / consulta de um fornecedor com produtos, histórico de compras, recebimentos e pedidos. */
export default function FornecedorPage() {
  const { id } = useParams<{ id: string }>();
  const { company, canCompany } = useSession();
  const canEdit = canCompany("fornecedores.editar");
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const q = useSupplierDetail(id);
  useRealtimeInvalidate(["suppliers", "supplier_products"], [["receipts"], ["purchase_orders"], ["supplier_price_history"]]);

  const [tab, setTab] = useState<Tab>("dados");
  const [form, setForm] = useState<SupplierForm>(emptySupplierForm);
  const set = useCallback((patch: Partial<SupplierForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const [busy, setBusy] = useState(false);
  const [activeConfirm, setActiveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setForm(supplierToForm(q.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.id]);

  const receipts = useSupplierReceipts(tab === "recebimentos" ? id : null);
  const orders = useSupplierOrders(tab === "pedidos" ? id : null);

  async function save() {
    if (!company || !q.data) return;
    const err = validateSupplierForm(form);
    if (err) return notify(err, "erro");
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("suppliers").update(supplierPayload(form, company.id)).eq("id", q.data.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar fornecedores.");
      invalidate("suppliers");
      notify("Fornecedor salvo");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  async function setActive(active: boolean) {
    if (!q.data) return;
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("suppliers").update({ active }).eq("id", q.data.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para editar fornecedores.");
      set({ active });
      invalidate("suppliers");
      notify(active ? "Fornecedor reativado" : "Fornecedor inativado");
      setDeleteFailed(null);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!q.data) return;
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("suppliers").delete().eq("id", q.data.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new OpsError("Você não tem permissão para excluir fornecedores.");
      invalidate("suppliers");
      notify("Fornecedor excluído");
      router.replace("/fornecedores");
    } catch (e) {
      const er = toOpsError(e as Error);
      setDeleteFailed(er.code === "23503" || /em uso|imut|foreign key|violates/i.test(er.message) ? "Este fornecedor já tem histórico (compras, recebimentos ou pedidos) e não pode ser excluído. Você pode inativá-lo: ele some das listas de escolha, mas o histórico continua." : er.message);
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <div className="mx-auto max-w-5xl"><Skeleton rows={5} /></div>;
  if (q.error) return <div className="mx-auto max-w-5xl"><ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState emoji="🔎" title="Fornecedor não encontrado" description="Ele pode ter sido excluído ou pertencer a outra empresa." action={<Link href="/fornecedores" className="text-sm font-semibold text-[var(--accent)]">Voltar para fornecedores</Link>} />
      </div>
    );
  }
  const s = q.data;
  const wa = waLink(s.whatsapp || s.phone);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={s.name}
        backHref="/fornecedores"
        icon="building"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {s.trade_name && <span>{s.trade_name}</span>}
            {s.cnpj && <span className="font-mono">{s.cnpj}</span>}
            <Badge tone={form.active ? "green" : "red"}>{form.active ? "Ativo" : "Inativo"}</Badge>
          </span>
        }
        actions={
          <>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/60 bg-emerald-600 px-4 py-2.5 text-[15px] font-medium text-white hover:bg-emerald-500">
                <Icon name="send" size={18} /> WhatsApp
              </a>
            )}
            {canEdit && (
              <>
                <Button variant="soft" disabled={busy} onClick={() => setActiveConfirm(true)}><Icon name={form.active ? "eye" : "check"} size={18} /> {form.active ? "Inativar" : "Reativar"}</Button>
                <Button variant="danger" disabled={busy} onClick={() => setDeleteConfirm(true)}><Icon name="trash" size={18} /> Excluir</Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Última compra" value={s.last_purchase_at ? fmtDate(s.last_purchase_at) : "—"} tone="slate" icon="calendar" />
        <KpiCard label="Compras registradas" value={s.purchases_count} tone="blue" icon="truck" onClick={() => setTab("historico")} />
        <KpiCard label="Produtos fornecidos" value={s.products_count} tone="cyan" icon="box" onClick={() => setTab("produtos")} />
        <KpiCard label="Prazo de entrega" value={`${s.lead_time_days} d`} tone="slate" icon="clock" hint={s.payment_terms || undefined} />
      </div>

      {!canEdit && <InlineAlert tone="slate" icon="lock">Você pode consultar este cadastro, mas não alterá-lo (fornecedores.editar).</InlineAlert>}
      {!form.active && <InlineAlert tone="amber">Fornecedor inativo: não aparece para escolher em pedidos e recebimentos. Use “Reativar” para voltar a usá-lo.</InlineAlert>}

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "dados", label: "Dados" },
        { value: "produtos", label: "Produtos fornecidos", count: Number(s.products_count) || undefined },
        { value: "historico", label: "Histórico de compras", count: Number(s.purchases_count) || undefined },
        { value: "recebimentos", label: "Recebimentos" },
        { value: "pedidos", label: "Pedidos de compra" },
      ]} />

      {tab === "dados" && (
        <>
          <SupplierFormFields form={form} set={(p) => { if (canEdit) set(p); }} disabled={!canEdit || busy} />
          <p className="mt-3 text-xs text-slate-500">Cadastrado em {fmtDateTime(s.created_at)} · última alteração {fmtDateTime(s.updated_at)}</p>
          {canEdit && (
            <div className="sticky bottom-20 z-20 mt-4 flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/95 p-2 backdrop-blur lg:bottom-4">
              <Button variant="soft" size="lg" onClick={() => router.push("/fornecedores")} disabled={busy}>Voltar</Button>
              <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy}><Icon name="check" size={18} /> {busy ? "Salvando…" : "Salvar"}</Button>
            </div>
          )}
        </>
      )}

      {tab === "produtos" && <SupplierProductsSection supplierId={s.id} canEdit={canEdit} />}

      {tab === "historico" && (
        <div>
          <p className="mb-3 text-sm text-slate-400">Cada linha é um item recebido deste fornecedor, com o preço pago por unidade de estoque.</p>
          <PriceHistoryTable supplierId={s.id} />
        </div>
      )}

      {tab === "recebimentos" && (
        receipts.isLoading ? <Skeleton rows={3} /> : receipts.error ? <ErrorBox error={toOpsError(receipts.error as Error).message} onRetry={() => void receipts.refetch()} /> : (receipts.data ?? []).length === 0 ? (
          <EmptyState emoji="🚚" title="Nenhum recebimento deste fornecedor" description="Os recebimentos aparecem aqui assim que forem criados na tela Recebimento." action={<Link href="/recebimento" className="text-sm font-semibold text-[var(--accent)]">Ir para Recebimento</Link>} />
        ) : (
          <div className="card divide-y divide-[var(--line)] overflow-hidden">
            {(receipts.data ?? []).map((r) => (
              <Link key={r.id} href={`/recebimento/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span>{r.number || "Recebimento"}</span>
                    {r.invoice_number && <span className="text-xs font-normal text-slate-400">NF {r.invoice_number}</span>}
                    <Badge tone={toneFor(r.status)}>{RECEIPT_STATUS_LABEL[r.status]}</Badge>
                    {r.result && <Badge tone={toneFor(r.result)}>{RECEIPT_RESULT_LABEL[r.result]}</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{fmtDateTime(r.received_at)}{r.stores?.name ? ` · ${r.stores.name}` : ""}{r.received_by_name ? ` · ${r.received_by_name}` : ""}</p>
                </div>
                <span className="font-bold tabular-nums">{fmtMoney(r.total)}</span>
                <Icon name="chevronRight" className="text-slate-600" />
              </Link>
            ))}
            <p className="px-4 py-2 text-xs text-slate-500">Últimos 20 recebimentos.</p>
          </div>
        )
      )}

      {tab === "pedidos" && (
        orders.isLoading ? <Skeleton rows={3} /> : orders.error ? <ErrorBox error={toOpsError(orders.error as Error).message} onRetry={() => void orders.refetch()} /> : (orders.data ?? []).length === 0 ? (
          <EmptyState emoji="🧾" title="Nenhum pedido de compra para este fornecedor" description="Os pedidos aparecem aqui quando forem criados na tela Compras ou pela Reposição." action={<Link href="/compras" className="text-sm font-semibold text-[var(--accent)]">Ir para Pedidos de compra</Link>} />
        ) : (
          <div className="card divide-y divide-[var(--line)] overflow-hidden">
            {(orders.data ?? []).map((o) => (
              <Link key={o.id} href={`/compras/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span>{o.number || "Pedido"}</span>
                    <Badge tone={toneFor(o.status)}>{PO_STATUS_LABEL[o.status]}</Badge>
                  </p>
                  <p className="text-xs text-slate-500">Criado {fmtDateTime(o.created_at)}{o.stores?.name ? ` · ${o.stores.name}` : ""}{o.expected_at ? ` · previsto para ${fmtDate(o.expected_at)}` : ""}</p>
                </div>
                <span className="font-bold tabular-nums">{fmtMoney(o.total)}</span>
                <Icon name="chevronRight" className="text-slate-600" />
              </Link>
            ))}
            <p className="px-4 py-2 text-xs text-slate-500">Últimos 20 pedidos.</p>
          </div>
        )
      )}

      <ConfirmSheet
        open={activeConfirm}
        onClose={() => setActiveConfirm(false)}
        title={form.active ? "Inativar fornecedor" : "Reativar fornecedor"}
        message={form.active ? `“${s.name}” deixará de aparecer para escolher em pedidos e recebimentos. O histórico continua.` : `“${s.name}” voltará a aparecer nas listas.`}
        confirmLabel={form.active ? "Inativar" : "Reativar"}
        onConfirm={() => void setActive(!form.active)}
      />
      <ConfirmSheet open={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Excluir fornecedor" message={`Excluir “${s.name}” definitivamente? Só é possível quando não há histórico. Se preferir manter o histórico, use “Inativar”.`} confirmLabel="Excluir" onConfirm={() => void remove()} />
      <Sheet
        open={deleteFailed !== null}
        onClose={() => setDeleteFailed(null)}
        title="Não foi possível excluir"
        footer={
          <div className="flex gap-2 pb-3">
            <Button variant="soft" size="lg" full onClick={() => setDeleteFailed(null)}>Fechar</Button>
            {form.active && <Button variant="primary" size="lg" full disabled={busy} onClick={() => void setActive(false)}>Inativar fornecedor</Button>}
          </div>
        }
      >
        <p className="text-slate-300">{deleteFailed}</p>
      </Sheet>
    </div>
  );
}
