"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { rpc } from "@/lib/ops/rpc";
import { fmtMoney } from "@/lib/ops/format";
import type { DashboardData } from "@/lib/ops/types";
import { ActionTile, KpiCard, SectionCard } from "@/components/ops/ui";
import { MOBILE_TILES, itemAllowed } from "@/components/ops/nav";
import { Icon } from "@/components/ops/Icon";

/**
 * Tela inicial: no celular/tablet mostra os atalhos de operação;
 * no computador redireciona para o painel gerencial.
 */
export default function HomePage() {
  const { store, can, displayName, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "sem_acesso") router.replace("/inicio");
    else if (typeof window !== "undefined" && window.innerWidth >= 1024 && can("painel.ver")) router.replace("/painel");
  }, [router, can, status]);

  const dash = useQuery({
    queryKey: ["dashboard", "home", store?.id],
    enabled: Boolean(store?.id) && can("painel.ver"),
    queryFn: () => rpc<DashboardData>("ops_dashboard", { p_store: store!.id }),
    staleTime: 30_000,
  });
  const c = dash.data?.cards;
  const tiles = MOBILE_TILES.filter((t) => itemAllowed(t, can));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <p className="text-sm text-slate-400">Olá, {displayName.split(" ")[0] || "equipe"} 👋</p>
        <h1 className="text-2xl font-extrabold">{store?.name ?? "Sua unidade"}</h1>
      </div>

      {c && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <KpiCard label="Vencidos" value={c.expired} tone={c.expired > 0 ? "red" : "green"} href="/validades?f=vencido" />
          <KpiCard label="Vencem em 3 dias" value={c.expiring_3d} tone={c.expiring_3d > 0 ? "amber" : "green"} href="/validades?f=3dias" />
          <KpiCard label="Abaixo do mínimo" value={c.below_min} tone={c.below_min > 0 ? "red" : "green"} href="/reposicao" />
          <KpiCard label="Alertas abertos" value={c.open_alerts} tone={c.critical_alerts > 0 ? "red" : c.open_alerts > 0 ? "amber" : "green"} href="/alertas" />
          <KpiCard label="Checklists de hoje" value={c.pending_checklists} tone={c.late_checklists > 0 ? "red" : c.pending_checklists > 0 ? "amber" : "green"} href="/checklists" />
          <KpiCard label="Valor em estoque" value={fmtMoney(c.stock_value)} tone="slate" href="/estoque" />
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tiles.map((t) => (
          <ActionTile key={t.href} href={t.href} label={t.label} description={t.description} icon={t.icon} tone={t.tone} />
        ))}
      </div>

      {dash.data && dash.data.series.expiring_products.length > 0 && (
        <SectionCard title="Vencendo primeiro" action={<Link href="/validades" className="text-xs font-semibold text-[var(--accent)]">ver tudo</Link>}>
          <ul className="divide-y divide-[var(--line)]">
            {dash.data.series.expiring_products.slice(0, 6).map((e) => (
              <li key={e.lot_id} className="flex items-center gap-3 py-2 text-sm">
                <Link href={`/lote/${e.lot_id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{e.product_name}</span>
                  <span className="block text-xs text-slate-500">Lote {e.lot_code} · {e.quantity} {e.unit} · {e.locations}</span>
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.days_to_expire < 0 ? "bg-rose-500/20 text-rose-300" : e.days_to_expire <= 1 ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {e.days_to_expire < 0 ? "vencido" : e.days_to_expire === 0 ? "hoje" : `${e.days_to_expire} d`}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="mt-6 hidden text-center text-xs text-slate-500 lg:block">
        <Link href="/painel" className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]">Abrir painel gerencial <Icon name="chevronRight" size={14} /></Link>
      </div>
    </div>
  );
}
