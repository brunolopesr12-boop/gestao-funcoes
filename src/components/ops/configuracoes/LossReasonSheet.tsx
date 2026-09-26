"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { slug } from "@/lib/ops/format";
import type { LossReason } from "@/lib/ops/types";
import { Button, Field, Sheet, TextInput, Toggle, useToast } from "@/components/ops/ui";

/** Criar / editar motivo de perda. */
export function LossReasonSheet({ open, onClose, reason, nextPosition }: { open: boolean; onClose: () => void; reason: LossReason | null; nextPosition: number }) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(reason?.name ?? "");
    setCode(reason?.code ?? "");
    setCodeTouched(Boolean(reason));
    setRequiresPhoto(reason?.requires_photo ?? false);
    setActive(reason?.active ?? true);
  }, [open, reason]);

  async function save() {
    if (!company) return;
    const c = slug(code || name).replace(/-/g, "_");
    if (name.trim().length < 2) return notify("Informe o nome do motivo.", "erro");
    if (!c) return notify("Informe um código válido.", "erro");
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const data = { name: name.trim(), code: c, requires_photo: requiresPhoto, active };
      if (reason) unwrap(await sb.from("loss_reasons").update(data).eq("id", reason.id));
      else unwrap(await sb.from("loss_reasons").insert({ ...data, company_id: company.id, position: nextPosition }));
      notify(reason ? "Motivo salvo" : "Motivo criado");
      invalidate("loss_reasons");
      onClose();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={reason ? "Editar motivo de perda" : "Novo motivo de perda"}
      footer={
        <div className="flex gap-2 pb-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : reason ? "Salvar" : "Criar motivo"}</Button>
        </div>
      }
    >
      <Field label="Nome" hint="Como aparece para a equipe na hora de registrar a perda.">
        <TextInput value={name} autoFocus onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(slug(e.target.value).replace(/-/g, "_")); }} placeholder="Ex.: Queimou no forno" />
      </Field>
      <Field label="Código" hint="Identificador interno (relatórios e integrações). Gerado a partir do nome.">
        <TextInput value={code} onChange={(e) => { setCodeTouched(true); setCode(slug(e.target.value).replace(/-/g, "_")); }} className="font-mono" />
      </Field>
      <Toggle checked={requiresPhoto} onChange={setRequiresPhoto} label="Exige foto" hint="A perda só pode ser registrada com uma foto de evidência." />
      <Toggle checked={active} onChange={setActive} label="Ativo" hint="Motivos inativos não aparecem para novas perdas; o histórico é mantido." />
    </Sheet>
  );
}
