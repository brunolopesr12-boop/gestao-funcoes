"use client";

import Link from "next/link";
import { fmtDate, fmtMoney, fmtPct, fmtQty } from "@/lib/ops/format";
import { toOpsError } from "@/lib/ops/errors";
import { useSession } from "@/lib/ops/session";
import { useProductionItems, yieldPct, type ProduceResult } from "@/lib/ops/modules/producao";
import { Icon } from "@/components/ops/Icon";
import { ErrorBox, InlineAlert, KpiCard, SectionCard, Skeleton } from "@/components/ops/ui";
import { LinkButton, YieldBadge } from "./shared";

/**
 * Tela de resultado após concluir uma produção: lote criado, rendimento real,
 * custo e ingredientes consumidos, com atalhos para etiqueta e nova produção.
 */
export function ProductionResultView({
  result, planned, unit, productName, onNew,
}: { result: ProduceResult; planned: number; unit: string; productName: string; onNew?: () => void }) {
  const { can } = useSession();
  const items = useProductionItems(result.production_id);
  const produced = result.produced ?? null;
  const pct = yieldPct(produced, planned);
  const printHref = result.lot_id ? `/etiquetas/imprimir?lot=${encodeURIComponent(result.lot_id)}&kind=producao` : null;
  const consumedTotal = (items.data ?? []).reduce((a, it) => a + Number(it.total_cost), 0);

  return (
    <div className="space-y-4">
      <div className="card border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <span className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white"><Icon name="check" size={28} /></span>
        <h2 className="text-xl font-extrabold">Produção registrada</h2>
        <p className="mt-1 text-sm text-emerald-100/90">{productName}{produced !== null ? ` · ${fmtQty(produced, unit)}` : ""}</p>
        {result.lot_id && (
          <p className="mt-2 text-sm">
            Lote{" "}
            <Link href={`/lote/${result.lot_id}`} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 font-mono font-bold text-emerald-100">
              {result.lot_code ?? "ver lote"} <Icon name="chevronRight" size={14} />
            </Link>
            {result.expires_at ? <span className="text-emerald-100/80"> · validade {fmtDate(result.expires_at)}</span> : <span className="text-emerald-100/80"> · sem validade</span>}
          </p>
        )}
      </div>

      {result.duplicated && (
        <InlineAlert tone="blue" icon="info">Esta produção já havia sido registrada antes (envio repetido). Nada foi duplicado no estoque.</InlineAlert>
      )}

      {!result.duplicated && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KpiCard label="Planejado" value={fmtQty(planned, unit)} tone="slate" />
          <KpiCard label="Produzido" value={produced !== null ? fmtQty(produced, unit) : "—"} tone="blue" />
          <KpiCard label="Rendimento real" value={<YieldBadge pct={pct} />} hint={pct !== null ? `esperado 100% · diferença ${fmtPct(pct - 100)}` : undefined} tone="slate" />
          <KpiCard
            label="Custo"
            value={fmtMoney(result.total_cost ?? consumedTotal)}
            hint={result.unit_cost !== undefined && result.unit_cost !== null ? `${fmtMoney(result.unit_cost)}/${unit}` : undefined}
            tone="violet"
          />
        </div>
      )}

      <SectionCard title="Ingredientes consumidos">
        {items.isLoading ? (
          <Skeleton rows={2} />
        ) : items.error ? (
          <ErrorBox error={toOpsError(items.error as Error).message} onRetry={() => void items.refetch()} />
        ) : (items.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum ingrediente foi baixado nesta produção.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {(items.data ?? []).map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{it.products?.name ?? "Produto"}</p>
                  <p className="text-xs text-slate-500">
                    Lote <span className="font-mono">{it.stock_lots?.lot_code ?? "—"}</span>
                    {it.stock_locations?.name ? ` · ${it.stock_locations.name}` : ""}
                    {it.stock_lots?.expires_at ? ` · vence ${fmtDate(it.stock_lots.expires_at)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">{fmtQty(it.consumed_quantity, it.products?.units?.code)}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{fmtMoney(it.total_cost)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid gap-2 sm:grid-cols-2">
        {printHref && can("etiquetas.imprimir") && <LinkButton href={printHref} size="lg" full icon="printer">Imprimir etiqueta</LinkButton>}
        <LinkButton href={`/producao/${result.production_id}`} variant="soft" size="lg" full icon="file">Ver produção</LinkButton>
        {onNew ? (
          <button type="button" onClick={onNew} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/5 px-5 py-3.5 text-base font-semibold text-slate-100 transition hover:bg-white/10 active:scale-[0.98] sm:col-span-2">
            <Icon name="flame" size={18} /> Nova produção
          </button>
        ) : (
          <LinkButton href="/producao/nova" variant="soft" size="lg" full icon="flame" className="sm:col-span-2">Nova produção</LinkButton>
        )}
      </div>
    </div>
  );
}
