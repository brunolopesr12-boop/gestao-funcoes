"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import type { Unit, UnitKind } from "@/lib/ops/types";
import { UNIT_KIND_BASE, UNIT_KIND_HELP, UNIT_KIND_OPTIONS } from "@/lib/ops/modules/cadastros";
import { Button, Choice, Field, InlineAlert, NumberInput, Sheet, TextInput, Toggle, useToast } from "@/components/ops/ui";

/** Criar/editar unidade de medida da empresa. */
export function UnitEditorSheet({ open, onClose, unit, nextPosition }: { open: boolean; onClose: () => void; unit: Unit | null; nextPosition: number }) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<UnitKind>("contagem");
  const [baseFactor, setBaseFactor] = useState<number | null>(1);
  const [decimals, setDecimals] = useState<number | null>(0);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(unit?.code ?? "");
    setName(unit?.name ?? "");
    setKind(unit?.kind ?? "contagem");
    setBaseFactor(unit?.base_factor ?? 1);
    setDecimals(unit?.decimals ?? 0);
    setActive(unit?.active ?? true);
  }, [open, unit]);

  async function save() {
    if (!company) return;
    if (!code.trim()) return notify("Informe a sigla da unidade (ex.: cx, pct, kg).", "erro");
    if (!name.trim()) return notify("Informe o nome da unidade.", "erro");
    if (kind !== "embalagem" && (!baseFactor || baseFactor <= 0)) return notify(`Informe quantos ${UNIT_KIND_BASE[kind]} cabem em 1 ${code.trim()}.`, "erro");
    setBusy(true);
    try {
      const payload = {
        company_id: company.id, code: code.trim(), name: name.trim(), kind,
        base_factor: kind === "embalagem" ? null : baseFactor,
        decimals: Math.max(0, Math.min(6, Math.round(decimals ?? 0))), active,
      };
      if (unit) {
        const r = await supabaseBrowser().from("units").update(payload).eq("id", unit.id).select("id");
        if (r.error) throw r.error;
        if (!r.data?.length) throw new Error("Você não tem permissão para editar unidades.");
        notify("Unidade salva");
      } else {
        const { error } = await supabaseBrowser().from("units").insert({ ...payload, position: nextPosition });
        if (error) throw error;
        notify("Unidade criada");
      }
      invalidate("units");
      onClose();
    } catch (e) {
      const err = toOpsError(e as Error);
      notify(err.code === "23505" ? "Já existe uma unidade com essa sigla na empresa." : err.message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={unit ? "Editar unidade" : "Nova unidade de medida"}
      footer={
        <div className="flex gap-2 pb-3">
          <Button variant="soft" size="lg" full onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      }
    >
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="Sigla"><TextInput value={code} onChange={(e) => setCode(e.target.value.slice(0, 8))} placeholder="cx" autoFocus /></Field>
        <Field label="Nome"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Caixa com 12" /></Field>
      </div>
      <span className="mb-1.5 block text-sm font-semibold text-slate-300">Natureza</span>
      <Choice value={kind} onChange={setKind} options={UNIT_KIND_OPTIONS} columns={2} />
      <InlineAlert tone="slate" icon="info">{UNIT_KIND_HELP[kind]}</InlineAlert>
      {kind !== "embalagem" && (
        <Field label={`Quantos ${UNIT_KIND_BASE[kind]} cabem em 1 ${code.trim() || "unidade"}?`} hint={`Ex.: kg = 1000 (g) · L = 1000 (ml) · dúzia = 12 (un). Permite converter automaticamente entre unidades da mesma natureza.`}>
          <NumberInput value={baseFactor} onChange={setBaseFactor} min={0} suffix={UNIT_KIND_BASE[kind]} placeholder="1" />
        </Field>
      )}
      <Field label="Casas decimais" hint="Quantas casas mostrar nas quantidades (0 para peças inteiras, 3 para kg).">
        <NumberInput value={decimals} onChange={setDecimals} min={0} inputMode="numeric" placeholder="0" />
      </Field>
      <Toggle checked={active} onChange={setActive} label="Unidade ativa" hint="Unidades inativas não aparecem para escolher, mas continuam nos produtos que já as usam." />
    </Sheet>
  );
}
