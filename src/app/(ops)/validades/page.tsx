"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { daysLabel, EXPIRY_META, fmtDate, fmtMoney, fmtQty } from "@/lib/ops/format";
import { LOT_STATUS_LABEL, type ExpiringLot, type ExpiryStatus } from "@/lib/ops/types";
import { LOT_EVENT_META } from "@/lib/ops/modules/estoque";
import { Badge, Button, DataTable, ErrorBox, Field, IconButton, PageHeader, Sheet, Skeleton, Tabs, TextArea, toneFor, usePagination, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { EstoqueSubnav } from "@/components/ops/estoque/Subnav";

type Tab = "vencido" | "hoje" | "3dias" | "7dias" | "todos";
const TAB_STATUSES: Record<Tab, ExpiryStatus[] | null> = {
  vencido: ["vencido"],
  hoje: ["hoje"],
  "3dias": ["hoje", "3dias"],
  "7dias": ["hoje", "3dias", "7dias"],
  todos: null,
};
const PAGE = 50;
type Row = ExpiringLot & { id: string };

function parseTab(f: string | null): Tab {
  if (!f) return "7dias";
  const x = f.toLowerCase();
  if (x.startsWith("vencido")) return "vencido";
  if (x === "hoje") return "hoje";
  if (x === "3dias" || x === "3") return "3dias";
  if (x === "7dias" || x === "7") return "7dias";
  return "todos";
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <ValidadesPage />
    </Suspense>
  );
}

/** Controle de validades: lotes vencidos e vencendo (view v_expiring_lots). */
function ValidadesPage() {
  const { store, can } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = parseTab(sp.get("f"));
  const setTab = (t: Tab) => router.replace(`/validades?f=${t}`);
  const notify = useToast();
  const invalidate = useInvalidate();
  const pg = usePagination(PAGE);
  const { setPage } = pg;
  useEffect(() => setPage(0), [tab, setPage]);

  const counts = useQuery({
    queryKey: ["stock_lots", "expiring_counts", store?.id],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      const sb = supabaseBrowser();
      const head = (statuses: ExpiryStatus[] | null) => {
        let qb = sb.from("v_expiring_lots").select("lot_id", { count: "exact", head: true }).eq("store_id", store!.id);
        if (statuses) qb = qb.in("expiry_status", statuses);
        return qb;
      };
      const [v, h, d3, d7, all] = await Promise.all([head(TAB_STATUSES.vencido), head(TAB_STATUSES.hoje), head(TAB_STATUSES["3dias"]), head(TAB_STATUSES["7dias"]), head(null)]);
      for (const r of [v, h, d3, d7, all]) if (r.error) throw toOpsError(r.error);
      return { vencido: v.count ?? 0, hoje: h.count ?? 0, "3dias": d3.count ?? 0, "7dias": d7.count ?? 0, todos: all.count ?? 0 } as Record<Tab, number>;
    },
  });

  const q = useQuery({
    queryKey: ["stock_lots", "expiring", store?.id, tab, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      let qb = supabaseBrowser()
        .from("v_expiring_lots")
        .select("*", { count: "exact" })
        .eq("store_id", store!.id)
        .order("expires_at", { ascending: true })
        .order("product_name")
        .range(pg.range.from, pg.range.to);
      const st = TAB_STATUSES[tab];
      if (st) qb = qb.in("expiry_status", st);
      const res = await qb;
      if (res.error) throw toOpsError(res.error);
      return { rows: ((res.data ?? []) as ExpiringLot[]).map((r) => ({ ...r, id: r.lot_id })) as Row[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["stock_items", "stock_lots"], [["stock_items"], ["stock_lots"]]);

  // bloqueio rápido
  const [blocking, setBlocking] = useState<Row | null>(null);
  const [blockNotes, setBlockNotes] = useState("");
  const [busy, setBusy] = useState(false);
  async function block() {
    if (!blocking) return;
    setBusy(true);
    try {
      await rpc("ops_lot_event", { p_lot: blocking.lot_id, p_event: "bloqueio", p_notes: blockNotes.trim() });
      notify(`Lote ${blocking.lot_code} bloqueado`);
      invalidate("stock_items", "stock_lots", "alerts", "dashboard");
      setBlocking(null);
      setBlockNotes("");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const c = counts.data;
  const rows = q.data?.rows ?? [];
  const canLoss = can("perdas.registrar");
  const canBlock = can(LOT_EVENT_META.bloqueio.perm);

  const actions = (r: Row) => (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {canLoss && <IconButton icon="trash" label="Registrar perda" tone="danger" href={`/perdas/nova?lot=${r.lot_id}&product=${r.product_id}`} />}
      {canBlock && r.lot_status !== "bloqueado" && <IconButton icon="lock" label="Bloquear lote" onClick={() => setBlocking(r)} />}
      <IconButton icon="qr" label="Abrir ficha do lote" href={`/lote/${r.lot_id}`} />
    </div>
  );

  const columns: Column<Row>[] = [
    {
      key: "product_name",
      label: "Produto",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{r.product_name}</p>
          <p className="text-xs text-slate-500">
            {r.internal_code && <span className="mr-2 font-mono">{r.internal_code}</span>}
            {r.category_name ?? ""}
          </p>
        </div>
      ),
    },
    {
      key: "lot_code",
      label: "Lote",
      render: (r) => (
        <div>
          <p className="font-mono font-semibold">{r.lot_code || "—"}</p>
          {r.lot_status !== "ativo" && <Badge tone={toneFor(r.lot_status)}>{LOT_STATUS_LABEL[r.lot_status]}</Badge>}
        </div>
      ),
    },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => <span className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</span> },
    { key: "locations", label: "Locais", render: (r) => <span className="text-slate-300">{r.locations}</span> },
    {
      key: "expires_at",
      label: "Validade",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="tabular-nums">{fmtDate(r.expires_at)}</span>
          <Badge className={EXPIRY_META[r.expiry_status].className}>{daysLabel(r.days_to_expire)}</Badge>
        </div>
      ),
    },
    { key: "total_value", label: "Valor", align: "right", hideOnMobile: true, render: (r) => <span className="tabular-nums text-slate-300">{fmtMoney(r.total_value)}</span> },
    { key: "supplier_name", label: "Fornecedor", hideOnMobile: true, render: (r) => <span className="text-slate-400">{r.supplier_name ?? "—"}</span> },
    { key: "actions", label: "", align: "right", render: actions },
  ];

  const emptyByTab: Record<Tab, string> = {
    vencido: "Nenhum lote vencido. Ótimo trabalho!",
    hoje: "Nada vence hoje.",
    "3dias": "Nada vence nos próximos 3 dias.",
    "7dias": "Nada vence nos próximos 7 dias.",
    todos: "Nenhum lote com validade cadastrada tem saldo nesta unidade.",
  };

  return (
    <div>
      <PageHeader title="Validades" subtitle={store ? `Lotes vencidos e vencendo · ${store.name}` : "Vencidos e vencendo"} icon="clock" />
      <EstoqueSubnav />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "vencido", label: "Vencidos", count: c?.vencido },
          { value: "hoje", label: "Hoje", count: c?.hoje },
          { value: "3dias", label: "3 dias", count: c?.["3dias"] },
          { value: "7dias", label: "7 dias", count: c?.["7dias"] },
          { value: "todos", label: "Todos com validade", count: c?.todos },
        ]}
      />

      {tab === "vencido" && rows.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-100">
          <Icon name="alert" size={18} className="mt-0.5" />
          <span>Lotes vencidos não podem ser consumidos. Registre a <strong>perda</strong> para tirar do estoque, ou <strong>bloqueie</strong> enquanto aguarda decisão.</span>
        </div>
      )}

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={q.isLoading || q.isFetching}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          rowHref={(r) => `/lote/${r.lot_id}`}
          emptyTitle={emptyByTab[tab]}
          emptyDescription="A validade dos lotes vem do Recebimento, da Produção ou da Entrada manual."
          mobileCard={(r) => (
            <div>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.product_name}</p>
                  <p className="text-xs text-slate-400"><span className="font-mono">{r.lot_code || "—"}</span> · {r.locations}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge className={EXPIRY_META[r.expiry_status].className}>{fmtDate(r.expires_at)} · {daysLabel(r.days_to_expire)}</Badge>
                    {r.lot_status !== "ativo" && <Badge tone={toneFor(r.lot_status)}>{LOT_STATUS_LABEL[r.lot_status]}</Badge>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">{fmtQty(r.quantity, r.unit)}</p>
                  <p className="text-xs text-slate-500">{fmtMoney(r.total_value)}</p>
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                {canLoss && (
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/perdas/nova?lot=${r.lot_id}&product=${r.product_id}`); }} className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200">Perda</button>
                )}
                {canBlock && r.lot_status !== "bloqueado" && (
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBlocking(r); }} className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200">Bloquear</button>
                )}
                <span className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200">Abrir ficha</span>
              </div>
            </div>
          )}
        />
      )}

      <Sheet open={blocking !== null} onClose={() => setBlocking(null)} title={blocking ? `Bloquear o lote ${blocking.lot_code}?` : ""}>
        <p className="mb-4 text-sm text-slate-300">{LOT_EVENT_META.bloqueio.help}</p>
        <Field label="Motivo do bloqueio">
          <TextArea rows={3} value={blockNotes} onChange={(e) => setBlockNotes(e.target.value)} placeholder="Ex.: vencido, aguardando descarte" autoFocus />
        </Field>
        <div className="flex gap-3">
          <Button variant="soft" size="lg" full onClick={() => setBlocking(null)} disabled={busy}>Cancelar</Button>
          <Button variant="danger" size="lg" full disabled={busy || !blockNotes.trim()} onClick={() => void block()}>{busy ? "Bloqueando…" : "Bloquear"}</Button>
        </div>
      </Sheet>
    </div>
  );
}
