"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { toOpsError } from "@/lib/ops/errors";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { useProductDetail } from "@/lib/ops/modules/cadastros";
import { EmptyState, ErrorBox, Skeleton } from "@/components/ops/ui";
import { ProductForm } from "@/components/ops/cadastros/ProductForm";

/** Edição / consulta de um produto. */
export default function ProdutoPage() {
  const { id } = useParams<{ id: string }>();
  const q = useProductDetail(id);
  useRealtimeInvalidate(["products", "product_units", "supplier_products", "product_store_settings"]);

  if (q.isLoading) return <div className="mx-auto max-w-5xl"><Skeleton rows={5} /></div>;
  if (q.error) return <div className="mx-auto max-w-5xl"><ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState emoji="🔎" title="Produto não encontrado" description="Ele pode ter sido excluído ou pertencer a outra empresa." action={<Link href="/produtos" className="text-sm font-semibold text-[var(--accent)]">Voltar para produtos</Link>} />
      </div>
    );
  }
  return <ProductForm key={q.data.id} product={q.data} />;
}
