"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "@/lib/ops/session";
import { EmptyState, PageHeader, Skeleton } from "@/components/ops/ui";
import { LossForm } from "@/components/ops/perdas/LossForm";

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl"><Skeleton rows={3} /></div>}>
      <NovaPerdaPage />
    </Suspense>
  );
}

/** Registrar uma perda (celular). Aceita ?lot=<id> (QR do lote) e ?product=<id>. */
function NovaPerdaPage() {
  const { store, can } = useSession();
  const sp = useSearchParams();
  const lot = sp.get("lot");
  const product = sp.get("product");

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Registrar perda" subtitle={store ? `Dá baixa no estoque de ${store.name}` : "Dá baixa no estoque"} backHref="/perdas" icon="trash" />
      {!can("perdas.registrar") ? (
        <EmptyState emoji="🔒" title="Sem permissão para registrar perdas" description="Peça ao gerente a permissão “Perdas: registrar”." />
      ) : (
        <LossForm key={`${lot ?? ""}-${product ?? ""}`} lotId={lot} productId={product} />
      )}
    </div>
  );
}
