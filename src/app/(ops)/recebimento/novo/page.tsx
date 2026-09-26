"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { rpc } from "@/lib/ops/rpc";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { todayISO } from "@/lib/ops/format";
import { fromLocalInput, nowLocalInput } from "@/lib/ops/modules/recebimento";
import { SupplierSelect } from "@/components/ops/pickers";
import { Button, ErrorBox, Field, InlineAlert, PageHeader, SectionCard, Skeleton, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { LinkButton } from "@/components/ops/recebimento/shared";

export default function NewReceiptPage() {
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <NewReceipt />
    </Suspense>
  );
}

function NewReceipt() {
  const { store, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const po = params.get("po");
  const notify = useToast();
  const invalidate = useInvalidate();

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [receivedAt, setReceivedAt] = useState(nowLocalInput());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poError, setPoError] = useState<string | null>(null);
  const started = useRef(false);

  // vindo de um pedido de compra: cria o rascunho pré-preenchido e vai para a conferência
  useEffect(() => {
    if (!po || started.current) return;
    started.current = true;
    (async () => {
      try {
        const id = await rpc<string>("ops_receipt_from_po", { p_po: po });
        invalidate("receipts", "purchase_orders");
        router.replace(`/recebimento/${id}`);
      } catch (e) {
        setPoError(toOpsError(e as Error).message);
      }
    })();
  }, [po, router, invalidate]);

  if (po) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Receber pedido de compra" backHref={`/compras/${po}`} icon="truck" />
        {poError ? (
          <>
            <ErrorBox error={poError} />
            <div className="mt-3 flex gap-2">
              <LinkButton href={`/compras/${po}`} variant="soft">Voltar ao pedido</LinkButton>
              <LinkButton href="/recebimento/novo" variant="soft">Recebimento avulso</LinkButton>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-400">Preparando a conferência com os itens do pedido…</p>
            <Skeleton rows={3} />
          </>
        )}
      </div>
    );
  }

  async function save() {
    if (!store) return;
    setBusy(true);
    setError(null);
    try {
      const res = await supabaseBrowser()
        .from("receipts")
        .insert({
          company_id: store.company_id,
          store_id: store.id,
          supplier_id: supplierId || null,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate || null,
          received_at: fromLocalInput(receivedAt) ?? new Date().toISOString(),
          notes: notes.trim(),
        })
        .select("id")
        .single();
      if (res.error) throw toOpsError(res.error);
      invalidate("receipts");
      notify("Recebimento criado. Agora confira os itens.");
      router.replace(`/recebimento/${(res.data as { id: string }).id}`);
    } catch (e) {
      setError(toOpsError(e as Error).message);
      setBusy(false);
    }
  }

  const allowed = can("recebimento.criar");

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Novo recebimento" subtitle={store?.name} backHref="/recebimento" icon="truck" />
      {!allowed && <InlineAlert tone="amber">Você não tem permissão para registrar recebimentos nesta unidade.</InlineAlert>}
      {error && <ErrorBox error={error} />}
      <SectionCard title="Dados da entrega" className="mb-4">
        <Field label="Fornecedor" hint="Opcional, mas ajuda no histórico de preços">
          <SupplierSelect value={supplierId} onChange={setSupplierId} placeholder="Sem fornecedor" />
        </Field>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Nº da nota fiscal">
            <TextInput value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Ex.: 12345" inputMode="numeric" />
          </Field>
          <Field label="Data da nota">
            <TextInput type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Data e hora do recebimento">
          <TextInput type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </Field>
        <Field label="Observação">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
        </Field>
      </SectionCard>
      <Button variant="primary" size="lg" full disabled={busy || !allowed || !store} onClick={() => void save()}>
        {busy ? "Criando…" : "Começar conferência"}
      </Button>
      <p className="mt-2 text-center text-xs text-slate-500">Na próxima tela você adiciona os itens conferidos e finaliza a entrada no estoque.</p>
    </div>
  );
}
