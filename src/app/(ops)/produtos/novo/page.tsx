"use client";

import { useSession } from "@/lib/ops/session";
import { EmptyState, InlineAlert } from "@/components/ops/ui";
import { ProductForm } from "@/components/ops/cadastros/ProductForm";
import Link from "next/link";

/** Cadastro de um novo produto. */
export default function NovoProdutoPage() {
  const { canCompany, status } = useSession();
  if (status === "pronto" && !canCompany("produtos.editar")) {
    return (
      <div className="mx-auto max-w-xl">
        <InlineAlert tone="amber" icon="lock">Você não tem permissão para cadastrar produtos (produtos.editar).</InlineAlert>
        <EmptyState emoji="🔒" title="Sem permissão" description="Peça a um gerente ou administrador para cadastrar o produto." action={<Link href="/produtos" className="text-sm font-semibold text-[var(--accent)]">Voltar para produtos</Link>} />
      </div>
    );
  }
  return <ProductForm product={null} />;
}
