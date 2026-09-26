"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { SupplierSelect } from "@/components/ops/pickers";
import { Button, ErrorBox, Field, InlineAlert, PageHeader, SectionCard, TextArea, TextInput, useToast } from "@/components/ops/ui";

export default function NewPurchaseOrderPage() {
  const { store, can } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [supplierId, setSupplierId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = can("compras.criar");

  async function save() {
    if (!store) return;
    setBusy(true);
    setError(null);
    try {
      const res = await supabaseBrowser()
        .from("purchase_orders")
        .insert({ company_id: store.company_id, store_id: store.id, supplier_id: supplierId || null, expected_at: expectedAt || null, notes: notes.trim() })
        .select("id")
        .single();
      if (res.error) throw toOpsError(res.error);
      invalidate("purchase_orders");
      notify("Pedido criado. Agora adicione os itens.");
      router.replace(`/compras/${(res.data as { id: string }).id}`);
    } catch (e) {
      setError(toOpsError(e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Novo pedido de compra" subtitle={store?.name} backHref="/compras" icon="file" />
      {!allowed && <InlineAlert tone="amber">Você não tem permissão para criar pedidos de compra nesta unidade.</InlineAlert>}
      {error && <ErrorBox error={error} />}
      <SectionCard title="Dados do pedido" className="mb-4">
        <Field label="Fornecedor" hint="Pode ficar em branco e ser definido depois">
          <SupplierSelect value={supplierId} onChange={setSupplierId} placeholder="Sem fornecedor" />
        </Field>
        <Field label="Previsão de entrega">
          <TextInput type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </Field>
        <Field label="Observação">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
        </Field>
      </SectionCard>
      <Button variant="primary" size="lg" full disabled={busy || !allowed || !store} onClick={() => void save()}>
        {busy ? "Criando…" : "Criar pedido e adicionar itens"}
      </Button>
    </div>
  );
}
