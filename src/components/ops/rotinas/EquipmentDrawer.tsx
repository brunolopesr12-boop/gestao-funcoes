"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import type { EquipmentKind, TemperatureEquipment } from "@/lib/ops/types";
import { DEFAULT_RANGE, EQUIPMENT_KIND_OPTIONS, fmtTemp } from "@/lib/ops/modules/rotinas";
import { Button, Choice, Drawer, Field, InlineAlert, NumberInput, TextInput, Toggle, useToast } from "@/components/ops/ui";

type Form = { name: string; kind: EquipmentKind; location_text: string; min_temp: number | null; max_temp: number | null; check_interval_min: number | null; active: boolean; position: number | null };

const empty = (position: number): Form => ({ name: "", kind: "geladeira", location_text: "", min_temp: DEFAULT_RANGE.geladeira.min, max_temp: DEFAULT_RANGE.geladeira.max, check_interval_min: 240, active: true, position });

/** Cadastro/edição de um equipamento de temperatura (geladeira, freezer, câmara…). */
export function EquipmentDrawer({ open, onClose, equipment, nextPosition = 0 }: { open: boolean; onClose: () => void; equipment: TemperatureEquipment | null; nextPosition?: number }) {
  const { store } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(empty(nextPosition));
  const [rangeTouched, setRangeTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (equipment) {
      setF({
        name: equipment.name, kind: equipment.kind, location_text: equipment.location_text, min_temp: Number(equipment.min_temp), max_temp: Number(equipment.max_temp),
        check_interval_min: equipment.check_interval_min, active: equipment.active, position: equipment.position,
      });
      setRangeTouched(true);
    } else {
      setF(empty(nextPosition));
      setRangeTouched(false);
    }
  }, [open, equipment, nextPosition]);

  function setKind(kind: EquipmentKind) {
    setF((s) => (rangeTouched ? { ...s, kind } : { ...s, kind, min_temp: DEFAULT_RANGE[kind].min, max_temp: DEFAULT_RANGE[kind].max }));
  }

  const valid = f.name.trim().length > 0 && f.min_temp !== null && f.max_temp !== null && f.min_temp < f.max_temp && (f.check_interval_min ?? 0) > 0;

  async function save() {
    if (!store || !valid) return;
    setBusy(true);
    try {
      const payload = {
        store_id: store.id, name: f.name.trim(), kind: f.kind, location_text: f.location_text.trim(), min_temp: f.min_temp, max_temp: f.max_temp,
        check_interval_min: Math.round(f.check_interval_min ?? 240), active: f.active, position: Math.round(f.position ?? 0),
      };
      const sb = supabaseBrowser();
      const res = equipment ? await sb.from("temperature_equipment").update(payload).eq("id", equipment.id) : await sb.from("temperature_equipment").insert(payload);
      if (res.error) throw toOpsError(res.error);
      notify(equipment ? "Equipamento atualizado" : "Equipamento cadastrado");
      invalidate("temperature_equipment", "stock_locations");
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={equipment ? "Editar equipamento" : "Novo equipamento"}
      footer={
        <div className="flex gap-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy || !valid} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      }
    >
      <Field label="Nome" hint="Como a equipe chama: Geladeira 1, Freezer do salão, Câmara de carnes…">
        <TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="Ex.: Geladeira 1" />
      </Field>
      <p className="mb-1.5 text-sm font-semibold text-slate-300">Tipo</p>
      <Choice value={f.kind} onChange={setKind} options={EQUIPMENT_KIND_OPTIONS} columns={2} />
      <Field label="Localização" hint="Opcional. Onde fica: cozinha, salão, estoque…">
        <TextInput value={f.location_text} onChange={(e) => setF({ ...f, location_text: e.target.value })} placeholder="Ex.: Cozinha quente" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Temperatura mínima">
          <NumberInput value={f.min_temp} onChange={(v) => { setRangeTouched(true); setF({ ...f, min_temp: v }); }} suffix="°C" />
        </Field>
        <Field label="Temperatura máxima">
          <NumberInput value={f.max_temp} onChange={(v) => { setRangeTouched(true); setF({ ...f, max_temp: v }); }} suffix="°C" />
        </Field>
      </div>
      {!rangeTouched && (
        <InlineAlert tone="blue" icon="info">
          Faixa sugerida para {EQUIPMENT_KIND_OPTIONS.find((o) => o.value === f.kind)?.label.toLowerCase()}: {fmtTemp(DEFAULT_RANGE[f.kind].min)} a {fmtTemp(DEFAULT_RANGE[f.kind].max)}. Você pode alterar.
        </InlineAlert>
      )}
      {f.min_temp !== null && f.max_temp !== null && f.min_temp >= f.max_temp && <InlineAlert tone="red">A temperatura mínima precisa ser menor que a máxima.</InlineAlert>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Medir a cada (min)" hint="Depois desse tempo o cartão fica âmbar.">
          <NumberInput value={f.check_interval_min} onChange={(v) => setF({ ...f, check_interval_min: v })} inputMode="numeric" min={1} suffix="min" />
        </Field>
        <Field label="Ordem" hint="Ordem na tela e no registro rápido.">
          <NumberInput value={f.position} onChange={(v) => setF({ ...f, position: v })} inputMode="numeric" min={0} />
        </Field>
      </div>
      <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Ativo" hint="Inativos não aparecem no painel nem no registro rápido, mas mantêm o histórico." />
    </Drawer>
  );
}
