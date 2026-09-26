"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { fmtRelative } from "@/lib/ops/format";
import type { TemperatureEquipment } from "@/lib/ops/types";
import { EQUIPMENT_KIND_LABEL } from "@/lib/ops/types";
import { EQUIPMENT_STATUS_META, fmtTemp, useEquipmentStatus, type EquipmentStatusRow } from "@/lib/ops/modules/rotinas";
import { Badge, Button, ConfirmSheet, DataTable, EmptyState, ErrorBox, IconButton, InlineAlert, PageHeader, Skeleton, Toggle, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { RotinasSubnav } from "@/components/ops/rotinas/Subnav";
import { EquipmentDrawer } from "@/components/ops/rotinas/EquipmentDrawer";

export default function EquipamentosPage() {
  const { store, can } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = can("temperaturas.editar");
  const [showInactive, setShowInactive] = useState(false);
  const q = useEquipmentStatus(store?.id, true);
  const rows = useMemo(() => (q.data ?? []).filter((r) => showInactive || r.active), [q.data, showInactive]);
  useRealtimeInvalidate(["temperature_equipment", "temperature_logs"]);

  const [editing, setEditing] = useState<TemperatureEquipment | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<EquipmentStatusRow | null>(null);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(r: TemperatureEquipment) {
    setEditing(r);
    setOpen(true);
  }

  async function toggleActive(r: EquipmentStatusRow) {
    setBusy(true);
    try {
      const res = await supabaseBrowser().from("temperature_equipment").update({ active: !r.active }).eq("id", r.id);
      if (res.error) throw toOpsError(res.error);
      notify(r.active ? "Equipamento inativado" : "Equipamento reativado");
      invalidate("temperature_equipment");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function move(r: EquipmentStatusRow, dir: -1 | 1) {
    const all = [...(q.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const i = all.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      // renumera todos para garantir posições distintas e troca os dois vizinhos
      const order = all.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      const results = await Promise.all(order.map((id, pos) => sb.from("temperature_equipment").update({ position: pos }).eq("id", id)));
      const err = results.find((x) => x.error)?.error;
      if (err) throw toOpsError(err);
      invalidate("temperature_equipment");
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
      const res = await supabaseBrowser().from("temperature_equipment").delete().eq("id", toDelete.id);
      if (res.error) throw toOpsError(res.error);
      notify("Equipamento excluído");
      invalidate("temperature_equipment", "temperature_logs");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  }

  const columns: Column<EquipmentStatusRow>[] = [
    { key: "position", label: "#", className: "w-10 text-slate-500", render: (r) => <span className="tabular-nums">{r.position}</span> },
    { key: "name", label: "Nome", render: (r) => <span className="font-semibold">{r.name}{!r.active && <Badge tone="slate" className="ml-2">inativo</Badge>}</span> },
    { key: "kind", label: "Tipo", render: (r) => EQUIPMENT_KIND_LABEL[r.kind] },
    { key: "location_text", label: "Localização", hideOnMobile: true, render: (r) => r.location_text || <span className="text-slate-500">—</span> },
    { key: "range", label: "Faixa", render: (r) => <span className="tabular-nums">{fmtTemp(r.min_temp)} a {fmtTemp(r.max_temp)}</span> },
    { key: "check_interval_min", label: "Intervalo", hideOnMobile: true, render: (r) => `${r.check_interval_min} min` },
    { key: "status", label: "Última medição", render: (r) => (
      <span className="flex items-center gap-2">
        <Badge tone={EQUIPMENT_STATUS_META[r.status].tone} dot={EQUIPMENT_STATUS_META[r.status].dot}>{EQUIPMENT_STATUS_META[r.status].label}</Badge>
        {r.last_measured_at && <span className="text-xs text-slate-400">{fmtTemp(r.last_temperature)} · {fmtRelative(r.last_measured_at)}</span>}
      </span>
    ) },
    ...(canEdit
      ? [{ key: "actions", label: "", align: "right" as const, render: (r: EquipmentStatusRow) => renderActions(r) }]
      : []),
  ];

  // função de renderização (não um componente interno) para não remontar os botões a cada render
  function renderActions(r: EquipmentStatusRow) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="[&>*]:rotate-180"><IconButton icon="chevronDown" label="Mover para cima" size={34} disabled={busy} onClick={() => void move(r, -1)} /></span>
        <IconButton icon="chevronDown" label="Mover para baixo" size={34} disabled={busy} onClick={() => void move(r, 1)} />
        <IconButton icon="edit" label="Editar" size={34} disabled={busy} onClick={() => openEdit(r)} />
        <IconButton icon={r.active ? "eye" : "refresh"} label={r.active ? "Inativar" : "Reativar"} size={34} disabled={busy} onClick={() => void toggleActive(r)} />
        {/* só sem medições: excluir apagaria o histórico junto */}
        {r.last_log_id === null && <IconButton icon="trash" label="Excluir" tone="danger" size={34} disabled={busy} onClick={() => setToDelete(r)} />}
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Equipamentos"
        subtitle={store ? `${store.name} · geladeiras, freezers, câmaras, balcões e estufas` : undefined}
        backHref="/temperaturas"
        icon="thermometer"
        actions={canEdit ? <Button variant="primary" onClick={openNew}><Icon name="plus" size={16} /> Novo equipamento</Button> : undefined}
      />
      <RotinasSubnav area="temperaturas" />
      {!canEdit && <InlineAlert tone="blue" icon="info">Você pode consultar os equipamentos. Para cadastrar ou alterar, é preciso a permissão “temperaturas.editar”.</InlineAlert>}

      <div className="mb-3 max-w-sm">
        <Toggle checked={showInactive} onChange={setShowInactive} label="Mostrar inativos" />
      </div>

      {q.isLoading ? (
        <Skeleton rows={3} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🌡️"
          title={showInactive ? "Nenhum equipamento" : "Nenhum equipamento ativo"}
          description="Cadastre cada geladeira, freezer, câmara fria, balcão ou estufa que precisa ter a temperatura controlada."
          action={canEdit ? <Button variant="primary" size="lg" onClick={openNew}><Icon name="plus" size={18} /> Cadastrar equipamento</Button> : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={canEdit ? openEdit : undefined}
          mobileCard={(r) => (
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.name} {!r.active && <Badge tone="slate">inativo</Badge>}</p>
                  <p className="text-xs text-slate-400">{EQUIPMENT_KIND_LABEL[r.kind]}{r.location_text ? ` · ${r.location_text}` : ""} · a cada {r.check_interval_min} min</p>
                  <p className="text-xs tabular-nums text-slate-300">{fmtTemp(r.min_temp)} a {fmtTemp(r.max_temp)}</p>
                </div>
                <Badge tone={EQUIPMENT_STATUS_META[r.status].tone} dot={EQUIPMENT_STATUS_META[r.status].dot}>{EQUIPMENT_STATUS_META[r.status].label}</Badge>
              </div>
              {canEdit && <div className="mt-2">{renderActions(r)}</div>}
            </div>
          )}
        />
      )}

      <EquipmentDrawer open={open} onClose={() => setOpen(false)} equipment={editing} nextPosition={(q.data ?? []).length} />
      <ConfirmSheet
        open={Boolean(toDelete)}
        title="Excluir equipamento?"
        message={`“${toDelete?.name ?? ""}” ainda não tem medições e será excluído. Equipamentos com histórico não podem ser excluídos — inative-os.`}
        confirmLabel="Excluir"
        onConfirm={() => void remove()}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
