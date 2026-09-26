"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toOpsError } from "@/lib/ops/errors";
import { Button, Field, TextInput } from "@/components/ui";
import { PageHeader, SectionCard, useToast, Row, Badge } from "@/components/ops/ui";

export default function ProfilePage() {
  const { profile, user, refresh, memberships, stores, signOut } = useSession();
  const notify = useToast();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile]);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().from("profiles").upsert({ id: user.id, email: user.email ?? "", full_name: name.trim(), phone: phone.trim() });
      if (error) throw error;
      await supabaseBrowser().auth.updateUser({ data: { full_name: name.trim() } });
      notify("Perfil salvo");
      await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (pass.length < 6) return notify("A senha precisa ter pelo menos 6 caracteres.", "erro");
    if (pass !== pass2) return notify("As senhas não conferem.", "erro");
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password: pass });
      if (error) throw error;
      notify("Senha alterada");
      setPass("");
      setPass2("");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Meu perfil" subtitle={user?.email} icon="users" />
      <SectionCard title="Dados" className="mb-4">
        <Field label="Nome completo" hint="Aparece em todos os registros que você fizer (recebimentos, produções, perdas…).">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefone">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
        </Field>
        <Button variant="primary" full disabled={busy} onClick={() => void save()}>Salvar</Button>
      </SectionCard>

      <SectionCard title="Senha" className="mb-4">
        <Field label="Nova senha"><TextInput type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirmar nova senha"><TextInput type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field>
        <Button variant="soft" full disabled={busy || !pass} onClick={() => void changePassword()}>Alterar senha</Button>
      </SectionCard>

      <SectionCard title="Meus acessos" className="mb-4">
        {memberships.map((m) => (
          <Row key={m.id} label={m.companies?.name ?? "Empresa"}>
            <Badge tone="blue">{m.access_roles?.name}</Badge>{" "}
            <span className="text-xs text-slate-400">{m.all_stores ? "todas as unidades" : `${stores.filter((s) => s.company_id === m.company_id).length} unidade(s)`}</span>
          </Row>
        ))}
      </SectionCard>
      <Button variant="ghost" full className="!text-rose-300" onClick={() => void signOut()}>Sair da conta</Button>
    </div>
  );
}
