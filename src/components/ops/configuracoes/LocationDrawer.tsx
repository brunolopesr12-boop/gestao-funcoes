"use client";

import { useEffect, useState } from "react";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import type { LocationKind, StockLocation, StorageType } from "@/lib/ops/types";
import { EQUIPMENT_KIND_LABEL, LOCATION_KIND_LABEL, STORAGE_TYPE_LABEL } from "@/lib/ops/types";
import { useStoreEquipmentAll } from "@/lib/ops/modules/configuracoes";
import { Button, Choice, Drawer, Field, Select, TextInput, Toggle, useToast } from "@/components/ops/ui";
import { Label } from "@/components/ops/usuarios/Common";

const KIND_OPTIONS = (Object.keys(LOCATION_KIND_LABEL) as LocationKind[]).map((k) => ({ value: k, label: LOCATION_KIND_LABEL[k] }));
const STORAGE_OPTIONS: { value: StorageType; label: string; hint: string }[] = [
  { value: "ambiente", label: STORAGE_TYPE_LABEL.ambiente, hint: "Seco, temperatura ambiente" },
  { value: "refrigerado", label: STORAGE_TYPE_LABEL.refrigerado, hint: "0 a 5 °C" },
  { value: "congelado", label: STORAGE_TYPE_LABEL.congelado, hint: "−18 °C" },
];
/** Tipo de armazenamento sugerido a partir do tipo do local. */
const STORAGE_BY_KIND: Record<LocationKind, StorageType> = {
  estoque_seco: "ambiente", camara_fria: "refrigerado", freezer: "congelado", geladeira: "refrigerado", cozinha: "ambiente", producao: "ambiente", bar: "refrigerado", outro: "ambiente",
};

type Form = { name: string; kind: LocationKind; storage_type: StorageType; temperature_equipment_id: string; active: boolean };

/** Criar / editar local de estoque de uma unidade. */
export function LocationDrawer({ open, onClose, storeId, location, nextPosition }: { open: boolean; onClose: () => void; storeId: string; location: StockLocation | null; nextPosition: number }) {
  const notify = useToast();
  const invalidate = useInvalidate();
  const equipment = useStoreEquipmentAll(open ? storeId : null);
  const [f, setF] = useState<Form>({ name: "", kind: "estoque_seco", storage_type: "ambiente", temperature_equipment_id: "", active: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(
      location
        ? { name: location.name, kind: location.kind, storage_type: location.storage_type, temperature_equipment_id: location.temperature_equipment_id ?? "", active: location.active }
        : { name: "", kind: "estoque_seco", storage_type: "ambiente", temperature_equipment_id: "", active: true },
    );
  }, [open, location]);

  async function save() {
    if (f.name.trim().length < 2) return notify("Informe o nome do local.", "erro");
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const data = { name: f.name.trim(), kind: f.kind, storage_type: f.storage_type, temperature_equipment_id: f.temperature_equipment_id || null, active: f.active };
      if (location) unwrap(await sb.from("stock_locations").update(data).eq("id", location.id));
      else unwrap(await sb.from("stock_locations").insert({ ...data, store_id: storeId, position: nextPosition }));
      notify(location ? "Local salvo" : "Local criado");
      invalidate("stock_locations");
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const eq = equipment.data ?? [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={location ? "Editar local de estoque" : "Novo local de estoque"}
      footer={
        <div className="flex gap-2 pb-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : location ? "Salvar" : "Criar local"}</Button>
        </div>
      }
    >
      <Field label="Nome" hint="Como a equipe chama o lugar: “Geladeira 2”, “Câmara de carnes”, “Prateleira A”."><TextInput value={f.name} autoFocus onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
      <Label>Tipo do local</Label>
      <Choice<LocationKind> value={f.kind} onChange={(k) => setF((s) => ({ ...s, kind: k, storage_type: STORAGE_BY_KIND[k] }))} options={KIND_OPTIONS} columns={2} />
      <Label hint="Usado para sugerir onde guardar cada produto e para alertas de temperatura.">Tipo de armazenamento</Label>
      <Choice<StorageType> value={f.storage_type} onChange={(v) => setF((s) => ({ ...s, storage_type: v }))} options={STORAGE_OPTIONS} columns={3} />
      <Field label="Equipamento de temperatura" hint={eq.length === 0 ? "Nenhum equipamento cadastrado nesta unidade (Temperaturas → Equipamentos)." : "Vincule para relacionar as medições de temperatura a este local."}>
        <Select value={f.temperature_equipment_id} onChange={(e) => setF((s) => ({ ...s, temperature_equipment_id: e.target.value }))}>
          <option value="">Nenhum</option>
          {eq.map((e) => <option key={e.id} value={e.id}>{e.name} · {EQUIPMENT_KIND_LABEL[e.kind]}{e.active ? "" : " (inativo)"}</option>)}
        </Select>
      </Field>
      <Toggle checked={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} label="Local ativo" hint="Local inativo não aparece para novas operações; o histórico é mantido." />
    </Drawer>
  );
}
