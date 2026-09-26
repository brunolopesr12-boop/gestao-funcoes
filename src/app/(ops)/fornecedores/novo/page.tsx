"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { emptySupplierForm, supplierPayload, validateSupplierForm, type SupplierForm } from "@/lib/ops/modules/cadastros";
import { Button, EmptyState, InlineAlert, PageHeader, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { SupplierFormFields } from "@/components/ops/cadastros/SupplierForm";

/** Cadastro de um novo fornecedor. */
export default function NovoFornecedorPage() {
  const { company, canCompany, status } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<SupplierForm>(emptySupplierForm);
  const set = useCallback((patch: Partial<SupplierForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const [busy, setBusy] = useState(false);

  if (status === "pronto" && !canCompany("fornecedores.editar")) {
    return (
      <div className="mx-auto max-w-xl">
        <InlineAlert tone="amber" icon="lock">Você não tem permissão para cadastrar fornecedores (fornecedores.editar).</InlineAlert>
        <EmptyState emoji="🔒" title="Sem permissão" description="Peça a um gerente ou administrador para cadastrar o fornecedor." action={<Link href="/fornecedores" className="text-sm font-semibold text-[var(--accent)]">Voltar para fornecedores</Link>} />
      </div>
    );
  }

  async function save() {
    if (!company) return;
    const err = validateSupplierForm(form);
    if (err) return notify(err, "erro");
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("suppliers").insert(supplierPayload(form, company.id)).select("id").single();
      if (r.error) throw r.error;
      invalidate("suppliers");
      notify("Fornecedor criado");
      router.replace(`/fornecedores/${r.data.id as string}`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Novo fornecedor" subtitle="Só o nome é obrigatório; complete o resto quando puder." backHref="/fornecedores" icon="building" />
      <SupplierFormFields form={form} set={set} disabled={busy} />
      <div className="sticky bottom-20 z-20 mt-4 flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/95 p-2 backdrop-blur lg:bottom-4">
        <Button variant="soft" size="lg" onClick={() => router.push("/fornecedores")} disabled={busy}>Cancelar</Button>
        <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy}>
          <Icon name="check" size={18} /> {busy ? "Salvando…" : "Criar fornecedor"}
        </Button>
      </div>
    </div>
  );
}
