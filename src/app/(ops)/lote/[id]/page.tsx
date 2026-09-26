"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { useProduct } from "@/lib/ops/hooks";
import { daysLabel, EXPIRY_META, fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/ops/format";
import { LOT_ORIGIN_LABEL, LOT_STATUS_LABEL, MOVEMENT_LABEL, STORAGE_TYPE_LABEL } from "@/lib/ops/types";
import { expiryStatusFromDays, movementTone, useLotSummary } from "@/lib/ops/modules/estoque";
import type { LotSummaryMovement } from "@/lib/ops/modules/estoque-types";
import { Badge, Button, DataTable, EmptyState, ErrorBox, InlineAlert, PageHeader, Row, SectionCard, Skeleton, toneFor, type Column } from "@/components/ops/ui";
import { ProductThumb } from "@/components/ops/pickers";
import { QrSvg, lotQrValue } from "@/components/ops/QrCode";
import { Icon } from "@/components/ops/Icon";
import { ConsumeDrawer } from "@/components/ops/estoque/ConsumeDrawer";
import { AdjustDrawer } from "@/components/ops/estoque/AdjustDrawer";
import { LotEventButtons } from "@/components/ops/estoque/LotEventButtons";
import { LotActionLinks } from "@/components/ops/estoque/LotActionLinks";

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <LotePage />
    </Suspense>
  );
}

/** FICHA DO LOTE — é a tela que o QR Code da etiqueta abre. */
function LotePage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const acao = sp.get("acao");
  const { store, can, setStore, stores } = useSession();

  const q = useLotSummary(id);
  const s = q.data ?? null;
  const product = useProduct(s?.product.id ?? null);
  useRealtimeInvalidate(["stock_items", "stock_lots"], [["stock_items"], ["stock_lots"], ["stock_movements"]]);

  const [consume, setConsume] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [qrValue, setQrValue] = useState("");
  useEffect(() => setQrValue(lotQrValue(id)), [id]);

  // ação vinda do QR (/qr?next=consumir) — só quando o lote é da unidade selecionada,
  // porque consumo/ajuste são lançados na unidade da sessão
  useEffect(() => {
    if (!s || !store || s.lot.store_id !== store.id) return;
    if (acao === "consumir" && can("estoque.movimentar")) setConsume(true);
    else if (acao === "ajustar" && can("estoque.ajustar")) setAdjust(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao, s?.lot.id, store?.id]);

  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.error) return <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!s) {
    return (
      <EmptyState
        emoji="🔎"
        title="Lote não encontrado"
        description="Este QR Code não corresponde a um lote desta empresa, ou o lote foi removido."
        action={<Link href="/qr" className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white">Ler outro código</Link>}
      />
    );
  }

  const lot = s.lot;
  /** Lote de outra unidade: consumo, ajuste, transferência e contagem usam a unidade da sessão, então ficam bloqueados até trocar. */
  const otherStore = Boolean(store && lot.store_id !== store.id);
  const canSwitch = stores.some((x) => x.id === lot.store_id);
  const expiry = expiryStatusFromDays(s.days_to_expire);
  const expired = expiry === "vencido";
  const blocked = lot.status === "bloqueado";
  const hasBalance = Number(s.balance) > 0;
  const canConsume = !otherStore && can("estoque.movimentar", lot.store_id) && hasBalance && !blocked && !expired;
  const canAdjust = !otherStore && can("estoque.ajustar", lot.store_id);

  const movColumns: Column<LotSummaryMovement>[] = [
    { key: "created_at", label: "Data", render: (r) => <span className="whitespace-nowrap tabular-nums text-slate-300">{fmtDateTime(r.created_at)}</span> },
    { key: "type", label: "Tipo", render: (r) => <Badge tone={movementTone(r.type, Number(r.quantity))}>{MOVEMENT_LABEL[r.type] ?? r.type}</Badge> },
    { key: "location", label: "Local", hideOnMobile: true },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className={`font-bold tabular-nums ${Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(r.quantity) >= 0 ? "+" : ""}{fmtQty(r.quantity, s.product.unit)}</span> },
    { key: "balance_after", label: "Saldo após", align: "right", render: (r) => <span className="tabular-nums text-slate-300">{fmtQty(r.balance_after, s.product.unit)}</span> },
    { key: "user", label: "Usuário", hideOnMobile: true, render: (r) => <span className="text-slate-300">{r.user || "—"}</span> },
    { key: "reason", label: "Motivo", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.reason || r.notes || "—"}</span> },
  ];

  return (
    <div>
      <PageHeader
        backHref="/estoque/lotes"
        title={`Lote ${lot.lot_code || "sem código"}`}
        subtitle={<Link href={`/estoque/produto/${s.product.id}`} className="hover:underline">{s.product.name}</Link>}
        icon="qr"
        actions={
          <div className="flex items-center gap-1.5">
            {s.fefo_first && hasBalance && <Badge tone="green" dot="⭐">Deveria sair primeiro (FEFO)</Badge>}
            <Badge tone={toneFor(lot.status)}>{LOT_STATUS_LABEL[lot.status]}</Badge>
          </div>
        }
      />

      {otherStore && (
        <InlineAlert tone="blue" icon="building">
          Este lote é da unidade <strong>{s.store?.name}</strong>, não da unidade selecionada ({store?.name}). Para consumir, ajustar ou transferir, troque de unidade.
          {canSwitch ? (
            <button type="button" className="ml-2 font-semibold underline" onClick={() => setStore(lot.store_id)}>Trocar para {s.store?.name}</button>
          ) : (
            <span className="ml-1">Você não tem acesso a essa unidade.</span>
          )}
        </InlineAlert>
      )}
      {blocked && <InlineAlert tone="red" icon="lock">Lote bloqueado: não pode ser consumido nem transferido. Só perda, ajuste ou desbloqueio.</InlineAlert>}
      {expired && !blocked && <InlineAlert tone="red">Lote vencido há {Math.abs(s.days_to_expire ?? 0)} dia(s). Registre como perda ou bloqueie.</InlineAlert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          {/* produto + validade */}
          <SectionCard>
            <div className="flex items-start gap-4">
              <ProductThumb product={{ name: s.product.name, photo_url: s.product.photo_url, categories: null }} size={72} />
              <div className="min-w-0 flex-1">
                <Link href={`/estoque/produto/${s.product.id}`} className="block truncate text-lg font-extrabold hover:underline">{s.product.name}</Link>
                <p className="text-sm text-slate-400">
                  {s.product.internal_code && <span className="mr-2 font-mono">{s.product.internal_code}</span>}
                  {s.product.category && <span>{s.product.category} · </span>}
                  unidade: {s.product.unit} · {STORAGE_TYPE_LABEL[s.product.storage_type]}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold ${EXPIRY_META[expiry].className}`}>
                    <Icon name="clock" size={16} />
                    {lot.expires_at ? `${fmtDate(lot.expires_at)} · ${daysLabel(s.days_to_expire)}` : "Sem validade"}
                  </span>
                  {lot.original_expires_at && lot.original_expires_at !== lot.expires_at && (
                    <span className="text-xs text-slate-500">validade original {fmtDate(lot.original_expires_at)}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Saldo total" value={fmtQty(s.balance, s.product.unit)} strong />
              <Stat label="Custo unitário" value={fmtMoney(lot.unit_cost)} />
              <Stat label="Valor em estoque" value={fmtMoney(Number(s.balance) * Number(lot.unit_cost))} />
              <Stat label="Quantidade inicial" value={fmtQty(lot.initial_quantity, s.product.unit)} />
            </div>
          </SectionCard>

          {/* saldo por local */}
          <SectionCard title="Saldo por local">
            {s.balances.length === 0 ? (
              <p className="text-sm text-slate-400">Este lote não tem saldo em nenhum local (esgotado).</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {s.balances.map((b) => (
                  <li key={b.location_id} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2 text-slate-200"><Icon name="warehouse" size={16} className="text-slate-500" />{b.location}</span>
                    <span className="font-bold tabular-nums">{fmtQty(b.quantity, s.product.unit)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* dados do lote */}
          <SectionCard title="Dados do lote">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Row label="Origem">{LOT_ORIGIN_LABEL[lot.origin]}</Row>
              <Row label="Fornecedor">{s.supplier?.name ?? "—"}</Row>
              <Row label="Unidade">{s.store?.name ?? "—"}</Row>
              <Row label="Recebido em">{fmtDateTime(lot.received_at)}</Row>
              <Row label="Produzido em">{fmtDateTime(lot.produced_at)}</Row>
              <Row label="Aberto em">{fmtDateTime(lot.opened_at)}</Row>
              <Row label="Congelado em">{fmtDateTime(lot.frozen_at)}</Row>
              <Row label="Descongelado em">{fmtDateTime(lot.thawed_at)}</Row>
              <Row label="Criado por">{s.created_by_name || "—"}</Row>
              <Row label="Criado em">{fmtDateTime(lot.created_at)}</Row>
              {lot.receipt_id && can("recebimento.ver", lot.store_id) && <Row label="Recebimento"><Link href={`/recebimento/${lot.receipt_id}`} className="text-[var(--accent)]">abrir</Link></Row>}
              {lot.production_id && can("producao.ver", lot.store_id) && <Row label="Produção"><Link href={`/producao/${lot.production_id}`} className="text-[var(--accent)]">abrir</Link></Row>}
              {lot.origin_lot_id && <Row label="Lote de origem"><Link href={`/lote/${lot.origin_lot_id}`} className="text-[var(--accent)]">ver lote original</Link></Row>}
            </div>
            {lot.notes && <p className="mt-2 whitespace-pre-line rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300">{lot.notes}</p>}
          </SectionCard>

          {/* histórico */}
          <SectionCard title="Histórico de movimentações">
            <DataTable
              columns={movColumns}
              rows={s.movements}
              emptyTitle="Nenhuma movimentação"
              mobileCard={(r) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2"><Badge tone={movementTone(r.type, Number(r.quantity))}>{MOVEMENT_LABEL[r.type] ?? r.type}</Badge><span className="text-xs text-slate-500">{r.location}</span></p>
                    <p className="text-xs text-slate-500">{fmtDateTime(r.created_at)} · {r.user || "—"}{r.reason ? ` · ${r.reason}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold tabular-nums ${Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(r.quantity) >= 0 ? "+" : ""}{fmtQty(r.quantity, s.product.unit)}</p>
                    <p className="text-xs text-slate-500">saldo {fmtQty(r.balance_after)}</p>
                  </div>
                </div>
              )}
            />
          </SectionCard>
        </div>

        {/* QR + ações */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <SectionCard title="QR Code do lote">
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 text-slate-900">
              {qrValue && <QrSvg value={qrValue} size={200} />}
              <span className="font-mono text-sm font-bold">{lot.lot_code}</span>
              <span className="text-center text-[11px] text-slate-600">{s.product.name}{lot.expires_at ? ` · val. ${fmtDate(lot.expires_at)}` : ""}</span>
            </div>
            {can("etiquetas.imprimir", lot.store_id) && (
              <Link href={`/etiquetas/imprimir?lot=${lot.id}`} className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/5 px-4 py-3 text-sm font-semibold">
                <Icon name="printer" size={18} /> Imprimir etiqueta
              </Link>
            )}
          </SectionCard>

          <SectionCard title="Ações">
            {otherStore ? (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-sm text-blue-100">
                Consumo, ajuste, transferência e contagem são feitos na unidade do lote (<strong>{s.store?.name}</strong>).
                {canSwitch ? (
                  <Button variant="primary" size="lg" full className="mt-3" onClick={() => setStore(lot.store_id)}>
                    <Icon name="building" size={18} /> Trocar para {s.store?.name}
                  </Button>
                ) : (
                  <span className="block pt-1">Você não tem acesso a essa unidade.</span>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  {can("estoque.movimentar", lot.store_id) && (
                    <Button variant="primary" size="lg" full disabled={!canConsume} onClick={() => setConsume(true)}>
                      <Icon name="minus" size={18} /> Consumir
                    </Button>
                  )}
                  {canAdjust && (
                    <Button variant="soft" size="lg" full onClick={() => setAdjust(true)} disabled={!hasBalance}>
                      <Icon name="edit" size={18} /> Ajustar saldo
                    </Button>
                  )}
                </div>
                <div className="mt-3">
                  <LotActionLinks lotId={lot.id} productId={s.product.id} compact />
                </div>
              </>
            )}
            <div className="mt-3">
              <LotEventButtons lot={lot} product={product.data} onDone={() => void q.refetch()} />
            </div>
          </SectionCard>
        </aside>
      </div>

      {product.data && !otherStore && (
        <>
          <ConsumeDrawer open={consume} onClose={() => setConsume(false)} product={product.data} initialLotId={lot.id} onDone={() => void q.refetch()} />
          <AdjustDrawer open={adjust} onClose={() => setAdjust(false)} product={product.data} initialLotId={lot.id} onDone={() => void q.refetch()} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? "text-xl font-extrabold" : "text-base font-semibold"}`}>{value}</p>
    </div>
  );
}
