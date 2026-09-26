"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import type { Store } from "@/lib/ops/types";
import { TIMEZONES, createStore, updateStore, type StoreInput } from "@/lib/ops/modules/configuracoes";
import { Button, Drawer, Field, InlineAlert, Select, TextInput, Toggle, useToast } from "@/components/ops/ui";

/** Criar / editar unidade (loja). Ao criar, o banco também cria os 4 locais de estoque padrão. */
export function StoreDrawer({ open, onClose, store, onSaved }: { open: boolean; onClose: () => void; store: Store | null; onSaved?: (id: string) => void }) {
  const { company, refresh } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<StoreInput>({ name: "", code: "", address: "", phone: "", timezone: "America/Sao_Paulo", active: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(store ? { name: store.name, code: store.code, address: store.address, phone: store.phone, timezone: store.timezone || "America/Sao_Paulo", active: store.active } : { name: "", code: "", address: "", phone: "", timezone: "America/Sao_Paulo", active: true });
  }, [open, store]);

  const set = <K extends keyof StoreInput>(k: K, v: StoreInput[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!company) return;
    if (f.name.trim().length < 2) return notify("Informe o nome da unidade.", "erro");
    setBusy(true);
    try {
      let id = store?.id ?? "";
      if (store) {
        await updateStore(store.id, { name: f.name.trim(), code: f.code.trim(), address: f.address.trim(), phone: f.phone.trim(), timezone: f.timezone, active: f.active });
        notify("Unidade salva");
      } else {
        id = await createStore(company.id, f);
        notify("Unidade criada com os locais de estoque padrão");
      }
      invalidate("stores", "stock_locations");
      await refresh();
      onSaved?.(id);
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
      title={store ? "Editar unidade" : "Nova unidade"}
      footer={
        <div className="flex gap-2 pb-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : store ? "Salvar" : "Criar unidade"}</Button>
        </div>
      }
    >
      {!store && <InlineAlert tone="blue" icon="info">Junto com a unidade serão criados 4 locais de estoque: Estoque seco, Geladeira, Freezer e Cozinha. Você pode ajustá-los depois.</InlineAlert>}
      <Field label="Nome"><TextInput value={f.name} autoFocus onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Filial Centro" /></Field>
      <Field label="Código" hint="Curto, para etiquetas e relatórios (ex.: U1, CENTRO)."><TextInput value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} className="font-mono" /></Field>
      <Field label="Endereço"><TextInput value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
      <Field label="Telefone"><TextInput inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(00) 0000-0000" /></Field>
      <Field label="Fuso horário" hint="Usado para horários de checklists e relatórios.">
        <Select value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>
          {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          {!TIMEZONES.some((t) => t.value === f.timezone) && <option value={f.timezone}>{f.timezone}</option>}
        </Select>
      </Field>
      {store && <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Unidade ativa" hint="Unidade inativa some do seletor e não recebe operações." />}
    </Drawer>
  );
}
