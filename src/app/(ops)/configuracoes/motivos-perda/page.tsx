"use client";

import { useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import type { LossReason } from "@/lib/ops/types";
import { useLossReasonsAll } from "@/lib/ops/modules/configuracoes";
import { Badge, Button, ConfirmSheet, EmptyState, ErrorBox, IconButton, PageHeader, Skeleton, Toggle, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NoPermission } from "@/components/ops/usuarios/Common";
import { LossReasonSheet } from "@/components/ops/configuracoes/LossReasonSheet";

export default function MotivosPerdaPage() {
  const { company, canCompany } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("configuracoes.editar");
  const q = useLossReasonsAll();
  const [showInactive, setShowInactive] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; reason: LossReason | null }>({ open: false, reason: null });
  const [toDelete, setToDelete] = useState<LossReason | null>(null);
  const [busy, setBusy] = useState(false);
  useRealtimeInvalidate(["loss_reasons"]);

  const all = [...(q.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const rows = all.filter((r) => showInactive || r.active);

  async function toggle(r: LossReason) {
    setBusy(true);
    try {
      unwrap(await supabaseBrowser().from("loss_reasons").update({ active: !r.active }).eq("id", r.id));
      notify(r.active ? "Motivo inativado" : "Motivo reativado");
      invalidate("loss_reasons");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  async function move(r: LossReason, dir: -1 | 1) {
    const i = all.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const order = all.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      const results = await Promise.all(order.map((id, pos) => sb.from("loss_reasons").update({ position: pos }).eq("id", id)));
      const err = results.find((x) => x.error)?.error;
      if (err) throw toOpsError(err);
      invalidate("loss_reasons");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      unwrap(await supabaseBrowser().from("loss_reasons").delete().eq("id", toDelete.id));
      notify("Motivo excluído");
      invalidate("loss_reasons");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  }

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Motivos de perda" backHref="/configuracoes" />
        <NoPermission perm="configuracoes.editar" what="alterar motivos de perda" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Motivos de perda"
        subtitle={company ? `${company.emoji} ${company.name}` : undefined}
        backHref="/configuracoes"
        icon="trash"
        actions={<Button variant="primary" onClick={() => setSheet({ open: true, reason: null })}><Icon name="plus" size={18} /> Novo motivo</Button>}
      />
      <p className="mb-3 text-sm text-slate-400">A equipe escolhe um destes motivos ao registrar uma perda. Motivos com “exige foto” só aceitam o registro com evidência.</p>
      <Toggle checked={showInactive} onChange={setShowInactive} label="Mostrar inativos" />

      {q.isError ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🗑️" title={showInactive ? "Nenhum motivo cadastrado" : "Nenhum motivo ativo"} description="Cadastre motivos como Vencimento, Quebra, Erro de produção… para a equipe classificar as perdas." action={<Button variant="primary" size="lg" onClick={() => setSheet({ open: true, reason: null })}>Novo motivo</Button>} />
      ) : (
        <div className="card divide-y divide-[var(--line)] overflow-hidden">
          {rows.map((r) => {
            const i = all.findIndex((x) => x.id === r.id);
            return (
              <div key={r.id} className={`flex items-center gap-2 px-3 py-2.5 ${r.active ? "" : "opacity-60"}`}>
                <div className="hidden flex-col sm:flex">
                  <button type="button" disabled={busy || i === 0} onClick={() => void move(r, -1)} aria-label="Subir" className="rounded p-0.5 text-slate-400 hover:bg-white/10 disabled:opacity-30"><Icon name="chevronDown" size={14} className="rotate-180" /></button>
                  <button type="button" disabled={busy || i === all.length - 1} onClick={() => void move(r, 1)} aria-label="Descer" className="rounded p-0.5 text-slate-400 hover:bg-white/10 disabled:opacity-30"><Icon name="chevronDown" size={14} /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold"><span className="truncate">{r.name}</span>{!r.active && <Badge tone="red">inativo</Badge>}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-mono">{r.code}</span>
                    {r.requires_photo && <Badge tone="amber" dot="📷">exige foto</Badge>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton icon="edit" label="Editar" onClick={() => setSheet({ open: true, reason: r })} disabled={busy} />
                  <IconButton icon={r.active ? "eye" : "refresh"} label={r.active ? "Inativar" : "Reativar"} onClick={() => void toggle(r)} disabled={busy} />
                  <IconButton icon="trash" label="Excluir" tone="danger" onClick={() => setToDelete(r)} disabled={busy} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LossReasonSheet open={sheet.open} reason={sheet.reason} nextPosition={all.length} onClose={() => setSheet({ open: false, reason: null })} />
      <ConfirmSheet
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Excluir motivo?"
        message={`"${toDelete?.name ?? ""}" será removido da lista. Perdas já registradas com ele continuam no histórico. Se preferir manter o cadastro, apenas inative.`}
        confirmLabel="Excluir"
        onConfirm={() => void remove()}
      />
    </div>
  );
}
