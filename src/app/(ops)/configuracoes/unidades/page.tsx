"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import type { StockLocation, Store } from "@/lib/ops/types";
import { LOCATION_KIND_LABEL, STORAGE_TYPE_LABEL } from "@/lib/ops/types";
import { seedDefaultLocations, updateStore, useCompanyStores, useStoreEquipmentAll, useStoreLocationsAll } from "@/lib/ops/modules/configuracoes";
import { Badge, Button, ConfirmSheet, EmptyState, ErrorBox, IconButton, InlineAlert, PageHeader, Select, Skeleton, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NoPermission } from "@/components/ops/usuarios/Common";
import { StoreDrawer } from "@/components/ops/configuracoes/StoreDrawer";
import { LocationDrawer } from "@/components/ops/configuracoes/LocationDrawer";

const STORAGE_TONE = { ambiente: "amber", refrigerado: "blue", congelado: "cyan" } as const;

export default function UnidadesPage() {
  const { company, store: current, canCompany, can, refresh } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("configuracoes.editar");
  const stores = useCompanyStores();
  const [selected, setSelected] = useState<string>("");
  useEffect(() => {
    if (selected || !stores.data?.length) return;
    setSelected(current && stores.data.some((s) => s.id === current.id) ? current.id : stores.data[0].id);
  }, [stores.data, current, selected]);
  const store = useMemo(() => (stores.data ?? []).find((s) => s.id === selected) ?? null, [stores.data, selected]);
  const locations = useStoreLocationsAll(store?.id);
  const equipment = useStoreEquipmentAll(store?.id);
  useRealtimeInvalidate(["stores", "stock_locations", "temperature_equipment"]);

  const [storeDrawer, setStoreDrawer] = useState<{ open: boolean; store: Store | null }>({ open: false, store: null });
  const [locDrawer, setLocDrawer] = useState<{ open: boolean; location: StockLocation | null }>({ open: false, location: null });
  const [toDelete, setToDelete] = useState<StockLocation | null>(null);
  const [busy, setBusy] = useState(false);

  const canEditLocations = Boolean(store && can("configuracoes.editar", store.id));
  const eqName = (id: string | null) => (id ? (equipment.data ?? []).find((e) => e.id === id)?.name ?? "—" : "");

  async function moveStore(s: Store, dir: -1 | 1) {
    const all = [...(stores.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const i = all.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    setBusy(true);
    try {
      const order = all.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      await Promise.all(order.map((id, pos) => updateStore(id, { position: pos })));
      invalidate("stores");
      await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function moveLocation(l: StockLocation, dir: -1 | 1) {
    const all = [...(locations.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const i = all.findIndex((x) => x.id === l.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const order = all.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      const results = await Promise.all(order.map((id, pos) => sb.from("stock_locations").update({ position: pos }).eq("id", id)));
      const err = results.find((r) => r.error)?.error;
      if (err) throw toOpsError(err);
      invalidate("stock_locations");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLocation(l: StockLocation) {
    setBusy(true);
    try {
      unwrap(await supabaseBrowser().from("stock_locations").update({ active: !l.active }).eq("id", l.id));
      notify(l.active ? "Local inativado" : "Local reativado");
      invalidate("stock_locations");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function removeLocation() {
    if (!toDelete) return;
    setBusy(true);
    try {
      unwrap(await supabaseBrowser().from("stock_locations").delete().eq("id", toDelete.id));
      notify("Local excluído");
      invalidate("stock_locations");
    } catch (e) {
      const err = toOpsError(e as Error);
      notify(err.code === "23503" ? "Este local já tem movimentações ou saldo e não pode ser excluído. Inative-o." : err.message, "erro");
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  }

  async function seed() {
    if (!store) return;
    setBusy(true);
    try {
      await seedDefaultLocations(store.id);
      notify("Locais padrão criados");
      invalidate("stock_locations");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Unidades e locais de estoque" backHref="/configuracoes" />
        <NoPermission perm="configuracoes.editar" what="alterar unidades e locais" />
      </div>
    );
  }

  const list = [...(stores.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const locs = [...(locations.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Unidades e locais de estoque"
        subtitle={company ? `${company.emoji} ${company.name}` : undefined}
        backHref="/configuracoes"
        icon="warehouse"
        actions={<Button variant="primary" onClick={() => setStoreDrawer({ open: true, store: null })}><Icon name="plus" size={18} /> Nova unidade</Button>}
      />

      {stores.isError ? (
        <ErrorBox error={toOpsError(stores.error as Error).message} onRetry={() => void stores.refetch()} />
      ) : stores.isLoading ? (
        <Skeleton rows={3} />
      ) : list.length === 0 ? (
        <EmptyState emoji="🏬" title="Nenhuma unidade" description="Crie a primeira unidade (loja) da empresa. Os locais de estoque padrão são criados junto." action={<Button variant="primary" size="lg" onClick={() => setStoreDrawer({ open: true, store: null })}>Nova unidade</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* seletor no celular */}
          <div className="lg:hidden">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Unidade">
              {list.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (inativa)"}</option>)}
            </Select>
          </div>
          {/* lista no desktop */}
          <aside className="hidden lg:block">
            <div className="card divide-y divide-[var(--line)] overflow-hidden">
              {list.map((s, i) => (
                <div key={s.id} className={`flex items-center gap-2 px-3 py-2.5 ${s.id === selected ? "bg-[var(--accent)]/15" : ""}`}>
                  <button type="button" onClick={() => setSelected(s.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2"><span className="truncate font-semibold">{s.name}</span>{!s.active && <Badge tone="red">inativa</Badge>}</span>
                    <span className="block truncate text-xs text-slate-500">{s.code || "sem código"}{s.address ? ` · ${s.address}` : ""}</span>
                  </button>
                  <div className="flex flex-col">
                    <button type="button" disabled={busy || i === 0} onClick={() => void moveStore(s, -1)} aria-label="Subir" className="rounded p-0.5 text-slate-400 hover:bg-white/10 disabled:opacity-30"><Icon name="chevronDown" size={14} className="rotate-180" /></button>
                    <button type="button" disabled={busy || i === list.length - 1} onClick={() => void moveStore(s, 1)} aria-label="Descer" className="rounded p-0.5 text-slate-400 hover:bg-white/10 disabled:opacity-30"><Icon name="chevronDown" size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section>
            {store && (
              <>
                <div className="card mb-4 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-2 text-lg font-bold"><span className="truncate">{store.name}</span>{store.code && <Badge tone="slate">{store.code}</Badge>}<Badge tone={store.active ? "green" : "red"}>{store.active ? "ativa" : "inativa"}</Badge></h2>
                      <p className="text-sm text-slate-400">{store.address || "Sem endereço"}{store.phone ? ` · ${store.phone}` : ""}</p>
                      <p className="text-xs text-slate-500">Fuso: {store.timezone}</p>
                    </div>
                    <Button variant="soft" onClick={() => setStoreDrawer({ open: true, store })}><Icon name="edit" size={16} /> Editar unidade</Button>
                  </div>
                </div>

                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Locais de estoque desta unidade</h3>
                  {canEditLocations && <Button variant="primary" size="sm" onClick={() => setLocDrawer({ open: true, location: null })}><Icon name="plus" size={16} /> Novo local</Button>}
                </div>
                {!canEditLocations && <InlineAlert tone="amber" icon="lock">Você não tem permissão de configuração nesta unidade; os locais aparecem apenas para consulta.</InlineAlert>}

                {locations.isError ? (
                  <ErrorBox error={toOpsError(locations.error as Error).message} onRetry={() => void locations.refetch()} />
                ) : locations.isLoading ? (
                  <Skeleton rows={3} />
                ) : locs.length === 0 ? (
                  <EmptyState
                    emoji="📦"
                    title="Nenhum local de estoque"
                    description="Sem locais não é possível receber mercadoria nem contar estoque nesta unidade."
                    action={canEditLocations ? <Button variant="primary" size="lg" disabled={busy} onClick={() => void seed()}>Criar locais padrão (Estoque seco, Geladeira, Freezer, Cozinha)</Button> : undefined}
                  />
                ) : (
                  <div className="card divide-y divide-[var(--line)] overflow-hidden">
                    {locs.map((l, i) => (
                      <div key={l.id} className={`flex items-center gap-2 px-3 py-2.5 ${l.active ? "" : "opacity-60"}`}>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 font-semibold"><span className="truncate">{l.name}</span>{!l.active && <Badge tone="red">inativo</Badge>}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                            <Badge tone="slate">{LOCATION_KIND_LABEL[l.kind]}</Badge>
                            <Badge tone={STORAGE_TONE[l.storage_type]}>{STORAGE_TYPE_LABEL[l.storage_type]}</Badge>
                            {l.temperature_equipment_id && <span className="inline-flex items-center gap-1"><Icon name="thermometer" size={12} /> {eqName(l.temperature_equipment_id)}</span>}
                          </p>
                        </div>
                        {canEditLocations && (
                          <div className="flex items-center gap-1">
                            <div className="hidden flex-col sm:flex">
                              <button type="button" disabled={busy || i === 0} onClick={() => void moveLocation(l, -1)} aria-label="Subir" className="rounded p-0.5 text-slate-400 hover:bg-white/10 disabled:opacity-30"><Icon name="chevronDown" size={14} className="rotate-180" /></button>
                              <button type="button" disabled={busy || i === locs.length - 1} onClick={() => void moveLocation(l, 1)} aria-label="Descer" className="rounded p-0.5 text-slate-400 hover:bg-white/10 disabled:opacity-30"><Icon name="chevronDown" size={14} /></button>
                            </div>
                            <IconButton icon="edit" label="Editar" onClick={() => setLocDrawer({ open: true, location: l })} disabled={busy} />
                            <IconButton icon={l.active ? "eye" : "refresh"} label={l.active ? "Inativar" : "Reativar"} onClick={() => void toggleLocation(l)} disabled={busy} />
                            <IconButton icon="trash" label="Excluir" tone="danger" onClick={() => setToDelete(l)} disabled={busy} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <StoreDrawer open={storeDrawer.open} store={storeDrawer.store} onClose={() => setStoreDrawer({ open: false, store: null })} onSaved={(id) => setSelected(id)} />
      {store && <LocationDrawer open={locDrawer.open} storeId={store.id} location={locDrawer.location} nextPosition={locs.length} onClose={() => setLocDrawer({ open: false, location: null })} />}
      <ConfirmSheet
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Excluir local?"
        message={`"${toDelete?.name ?? ""}" será removido. Locais com histórico de estoque não podem ser excluídos — nesse caso, inative.`}
        confirmLabel="Excluir"
        onConfirm={() => void removeLocation()}
      />
    </div>
  );
}
