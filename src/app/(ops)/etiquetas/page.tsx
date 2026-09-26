"use client";

import Link from "next/link";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate, fmtQty, fmtRelative } from "@/lib/ops/format";
import { LOT_ORIGIN_LABEL, LOT_STATUS_LABEL } from "@/lib/ops/types";
import { kindFromOrigin, useRecentLots, type RecentLotRow } from "@/lib/ops/modules/labels";
import { Badge, DataTable, EmptyState, ErrorBox, IconButton, PageHeader, SectionCard, toneFor, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { BigTile, LinkButton, PrintHelp } from "@/components/ops/etiquetas/shared";

/** Hub de etiquetas: atalhos grandes + últimos lotes da unidade para imprimir. */
export default function EtiquetasHub() {
  const { store, can, canCompany } = useSession();
  const canPrint = can("etiquetas.imprimir");
  const canEdit = canCompany("etiquetas.editar_modelos");
  const recent = useRecentLots(store?.id, 20);
  useRealtimeInvalidate(["stock_lots"]);

  const printHref = (r: RecentLotRow) => `/etiquetas/imprimir?lot=${r.id}&kind=${kindFromOrigin(r.origin)}`;
  const columns: Column<RecentLotRow>[] = [
    {
      key: "product", label: "Produto",
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{r.products?.name ?? "—"}</span>
          <span className="block text-xs text-slate-500">{r.products?.internal_code}</span>
        </span>
      ),
    },
    { key: "lot_code", label: "Lote", render: (r) => <Link href={`/lote/${r.id}`} className="font-mono font-semibold hover:underline">{r.lot_code || "—"}</Link> },
    { key: "origin", label: "Origem", hideOnMobile: true, render: (r) => <span className="text-slate-300">{LOT_ORIGIN_LABEL[r.origin] ?? r.origin}</span> },
    { key: "initial_quantity", label: "Qtd. inicial", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums">{fmtQty(r.initial_quantity, r.products?.units?.code)}</span> },
    { key: "expires_at", label: "Validade", render: (r) => <span className="tabular-nums">{fmtDate(r.expires_at)}</span> },
    { key: "status", label: "Situação", hideOnMobile: true, render: (r) => <Badge tone={toneFor(r.status)}>{LOT_STATUS_LABEL[r.status]}</Badge> },
    { key: "created_at", label: "Criado", hideOnMobile: true, render: (r) => <span className="text-slate-400">{fmtRelative(r.created_at)}</span> },
    { key: "actions", label: "", align: "right", render: (r) => (canPrint ? <IconButton icon="printer" label="Imprimir etiqueta" href={printHref(r)} tone="primary" /> : null) },
  ];

  if (!canPrint && !canEdit) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Etiquetas" icon="tag" />
        <EmptyState emoji="🔒" title="Sem permissão para etiquetas" description="Peça ao gerente a permissão “Imprimir etiquetas” para usar esta tela." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Etiquetas" subtitle="Impressão de etiquetas de produção, abertura, congelamento, recebimento e avulsas" icon="tag" />
      <PrintHelp />

      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {canPrint && <BigTile href="/etiquetas/imprimir" label="Imprimir etiqueta de lote" description="Escolha o produto e o lote, ou leia o QR Code" icon="printer" tone="bg-cyan-600" />}
        {canPrint && <BigTile href="/etiquetas/imprimir?avulsa=1" label="Etiqueta avulsa (sem lote)" description="Digite produto, quantidade e datas" icon="tag" tone="bg-violet-600" />}
        <BigTile href="/etiquetas/modelos" label="Modelos" description={canEdit ? "Tamanho, campos, QR, logo e padrão por tipo" : "Ver os modelos da empresa"} icon="layers" tone="bg-emerald-600" />
        <BigTile href="/etiquetas/historico" label="Histórico de impressão" description="Quem imprimiu o quê, e reimpressão" icon="history" tone="bg-slate-600" />
      </div>

      <SectionCard title="Últimos lotes criados nesta unidade" action={<Link href="/estoque/lotes" className="text-xs font-semibold text-[var(--accent)]">ver todos os lotes</Link>}>
        {recent.error ? (
          <ErrorBox error={toOpsError(recent.error as Error).message} onRetry={() => void recent.refetch()} />
        ) : !recent.isLoading && (recent.data ?? []).length === 0 ? (
          <EmptyState
            emoji="🏷️"
            title="Nenhum lote nesta unidade ainda"
            description="Os lotes surgem ao finalizar um recebimento ou uma produção. Você também pode imprimir uma etiqueta avulsa."
            action={canPrint ? <LinkButton href="/etiquetas/imprimir?avulsa=1" variant="soft"><Icon name="tag" size={18} /> Etiqueta avulsa</LinkButton> : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={recent.data ?? []}
            loading={recent.isLoading}
            mobileCard={(r) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.products?.name ?? "—"}</p>
                  <p className="text-xs text-slate-400">
                    Lote <span className="font-mono">{r.lot_code || "—"}</span> · {LOT_ORIGIN_LABEL[r.origin] ?? r.origin} · val. {fmtDate(r.expires_at)}
                  </p>
                  <p className="text-[11px] text-slate-500">{fmtQty(r.initial_quantity, r.products?.units?.code)} · {fmtRelative(r.created_at)}</p>
                </div>
                {canPrint && <IconButton icon="printer" label="Imprimir etiqueta" href={printHref(r)} tone="primary" size={44} />}
              </div>
            )}
          />
        )}
      </SectionCard>
    </div>
  );
}
