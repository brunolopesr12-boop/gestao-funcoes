"use client";

import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import type { Unit, UnitKind } from "@/lib/ops/types";
import { UNIT_KIND_BASE, UNIT_KIND_HELP, UNIT_KIND_LABEL, unitBaseText, useAllUnits } from "@/lib/ops/modules/cadastros";
import { Badge, Button, ConfirmSheet, DataTable, EmptyState, ErrorBox, IconButton, InlineAlert, PageHeader, SectionCard, Sheet, Skeleton, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { CadastrosSubnav } from "@/components/ops/cadastros/Subnav";
import { UnitEditorSheet } from "@/components/ops/cadastros/UnitEditorSheet";

const KIND_TONE: Record<UnitKind, "blue" | "cyan" | "violet" | "amber"> = { massa: "blue", volume: "cyan", contagem: "violet", embalagem: "amber" };

/** Unidades de medida: padrão do sistema (somente leitura) e da empresa (CRUD). */
export default function UnidadesPage() {
  const { company, canCompany } = useSession();
  const canEdit = canCompany("produtos.editar");
  const notify = useToast();
  const invalidate = useInvalidate();
  const q = useAllUnits();
  useRealtimeInvalidate(["units"]);

  const system = useMemo(() => (q.data ?? []).filter((u) => u.company_id === null), [q.data]);
  const mine = useMemo(() => (q.data ?? []).filter((u) => u.company_id !== null), [q.data]);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Unit | null>(null);
  const [deleteFailed, setDeleteFailed] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);

  async function setActive(u: Unit, active: boolean) {
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("units").update({ active }).eq("id", u.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error("Você não tem permissão para editar unidades.");
      invalidate("units");
      notify(active ? "Unidade reativada" : "Unidade inativada");
      setDeleteFailed(null);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: Unit) {
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("units").delete().eq("id", u.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error("Você não tem permissão para excluir unidades.");
      invalidate("units");
      notify("Unidade excluída");
    } catch (e) {
      const er = toOpsError(e as Error);
      if (er.code === "23503" || /em uso/i.test(er.message)) setDeleteFailed(u);
      else notify(er.message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const baseColumns: Column<Unit>[] = [
    { key: "code", label: "Sigla", render: (u) => <span className="font-mono text-base font-bold">{u.code}</span> },
    { key: "name", label: "Nome", render: (u) => <span className="font-semibold">{u.name}</span> },
    { key: "kind", label: "Natureza", render: (u) => <Badge tone={KIND_TONE[u.kind]}>{UNIT_KIND_LABEL[u.kind]}</Badge> },
    { key: "base_factor", label: "Conversão para a base", render: (u) => <span className="text-slate-300">{unitBaseText(u)}</span> },
    { key: "decimals", label: "Decimais", align: "center", hideOnMobile: true, render: (u) => <span className="tabular-nums text-slate-400">{u.decimals}</span> },
  ];
  const mineColumns: Column<Unit>[] = [
    ...baseColumns,
    { key: "active", label: "Ativa", align: "center", render: (u) => <Badge tone={u.active ? "green" : "red"}>{u.active ? "Sim" : "Não"}</Badge> },
    ...(canEdit
      ? [{
          key: "actions", label: "", align: "right" as const,
          render: (u: Unit) => (
            <div className="flex justify-end gap-1">
              <IconButton icon="edit" label="Editar" size={34} onClick={() => setEditing(u)} />
              <IconButton icon={u.active ? "eye" : "check"} label={u.active ? "Inativar" : "Reativar"} size={34} disabled={busy} onClick={() => void setActive(u, !u.active)} />
              <IconButton icon="trash" label="Excluir" tone="danger" size={34} disabled={busy} onClick={() => setDeleting(u)} />
            </div>
          ),
        }]
      : []),
  ];
  const mobile = (u: Unit, editable: boolean) => (
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-14 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 font-mono text-sm font-bold">{u.code}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-semibold"><span className="truncate">{u.name}</span>{!u.active && <Badge tone="red">inativa</Badge>}</p>
        <p className="text-xs text-slate-500"><Badge tone={KIND_TONE[u.kind]}>{UNIT_KIND_LABEL[u.kind]}</Badge> <span className="ml-1">{unitBaseText(u)}</span></p>
      </div>
      {editable && canEdit && (
        <div className="flex shrink-0 gap-1">
          <IconButton icon="edit" label="Editar" size={34} onClick={() => setEditing(u)} />
          <IconButton icon="trash" label="Excluir" tone="danger" size={34} disabled={busy} onClick={() => setDeleting(u)} />
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Unidades de medida"
        subtitle="Como os produtos são contados, pesados e comprados"
        backHref="/produtos"
        icon="scale"
        actions={canEdit ? <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} /> Nova unidade</Button> : undefined}
      />
      <CadastrosSubnav />

      <SectionCard title="Como funciona" className="mb-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(UNIT_KIND_LABEL) as UnitKind[]).map((k) => (
            <div key={k} className="rounded-xl border border-[var(--line)] bg-white/5 p-3 text-sm">
              <p className="mb-1 flex items-center gap-2 font-bold"><Badge tone={KIND_TONE[k]}>{UNIT_KIND_LABEL[k]}</Badge> <span className="text-xs text-slate-500">base: {UNIT_KIND_BASE[k]}</span></p>
              <p className="text-slate-400">{UNIT_KIND_HELP[k]}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Unidades da mesma natureza convertem entre si sozinhas (kg ↔ g, L ↔ ml). Embalagens (caixa, pacote…) precisam do fator em cada produto: 1 caixa = 10 kg.</p>
      </SectionCard>

      {q.isLoading ? (
        <Skeleton rows={4} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Unidades de {company?.name ?? "da empresa"}</h2>
          {mine.length === 0 ? (
            <div className="mb-5">
              <EmptyState emoji="📏" title="Nenhuma unidade própria" description="As unidades padrão abaixo atendem a maioria dos casos. Crie uma unidade própria quando precisar de algo específico (ex.: “caixa com 12”, “balde 20 L”)." action={canEdit ? <Button variant="primary" onClick={() => setCreating(true)}>Criar unidade</Button> : undefined} />
            </div>
          ) : (
            <div className="mb-5"><DataTable columns={mineColumns} rows={mine} mobileCard={(u) => mobile(u, true)} /></div>
          )}
          {!canEdit && <InlineAlert tone="slate" icon="lock">Você pode consultar as unidades, mas não alterá-las (produtos.editar).</InlineAlert>}

          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Unidades padrão do sistema <span className="ml-1 font-normal normal-case text-slate-500">(somente leitura)</span></h2>
          <DataTable columns={baseColumns} rows={system} mobileCard={(u) => mobile(u, false)} emptyTitle="Nenhuma unidade padrão" emptyDescription="O banco de dados parece desatualizado: rode o supabase/install.sql." />
        </>
      )}

      <UnitEditorSheet open={creating || editing !== null} onClose={() => { setCreating(false); setEditing(null); }} unit={editing} nextPosition={mine.reduce((m, u) => Math.max(m, u.position + 1), 100)} />
      <ConfirmSheet open={deleting !== null} onClose={() => setDeleting(null)} title="Excluir unidade" message={deleting ? `Excluir a unidade “${deleting.code} — ${deleting.name}”? Só é possível se nenhum produto a usar.` : ""} confirmLabel="Excluir" onConfirm={() => { if (deleting) void remove(deleting); }} />
      <Sheet
        open={deleteFailed !== null}
        onClose={() => setDeleteFailed(null)}
        title="Não foi possível excluir"
        footer={
          <div className="flex gap-2 pb-3">
            <Button variant="soft" size="lg" full onClick={() => setDeleteFailed(null)}>Fechar</Button>
            {deleteFailed?.active && <Button variant="primary" size="lg" full disabled={busy} onClick={() => { if (deleteFailed) void setActive(deleteFailed, false); }}>Inativar unidade</Button>}
          </div>
        }
      >
        <p className="text-slate-300">A unidade “{deleteFailed?.code}” está em uso em produtos, conversões ou movimentações e não pode ser excluída. Você pode inativá-la: ela deixa de aparecer para escolher, mas continua válida onde já foi usada.</p>
      </Sheet>
    </div>
  );
}
