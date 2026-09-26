"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { apiCreateUser, exactTerm, generatePassword, isValidEmail, useAccessRoles, useServiceRole } from "@/lib/ops/modules/usuarios";
import { Button, Choice, Field, InlineAlert, Select, Sheet, TextInput, useToast } from "@/components/ops/ui";
import { CopyButton, Label } from "./Common";
import { PasswordField } from "./PasswordField";
import { StoreAccess } from "./StoreAccess";

type Mode = "senha" | "convite";
type Done = { mode: Mode; membershipId: string; email: string; password: string; name: string; createdUser: boolean };

/**
 * Novo usuário: (a) criar com senha (precisa da chave de serviço no servidor)
 * ou (b) convidar por e-mail (a pessoa cria a conta em /login → "Fui convidado").
 */
export function NewUserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { company, user, isAdmin } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const svc = useServiceRole();
  const roles = useAccessRoles();
  const serviceRole = svc.data === true;

  const [mode, setMode] = useState<Mode>("convite");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState("");
  const [allStores, setAllStores] = useState(true);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const roleOptions = useMemo(() => (roles.data ?? []).filter((r) => isAdmin || r.code !== "admin"), [roles.data, isAdmin]);

  useEffect(() => {
    if (!open) return;
    setMode(serviceRole ? "senha" : "convite");
    setName(""); setEmail(""); setPhone("");
    setAllStores(true); setStoreIds([]); setPassword(generatePassword(10)); setDone(null);
    const def = (roles.data ?? []).find((r) => r.code === "funcionario") ?? roleOptions[0];
    setRoleId(def?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serviceRole, roles.data]);

  const validate = (): string | null => {
    if (!isValidEmail(email)) return "Informe um e-mail válido.";
    if (!roleId) return "Escolha o perfil de acesso.";
    if (!allStores && storeIds.length === 0) return "Escolha pelo menos uma unidade.";
    if (mode === "senha") {
      if (name.trim().length < 2) return "Informe o nome da pessoa.";
      if (password.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
    }
    return null;
  };

  async function alreadyMember(): Promise<string | null> {
    const rows = unwrap(
      await supabaseBrowser().from("v_memberships").select("id, email, invited_email").eq("company_id", company!.id).or(`email.ilike.${exactTerm(email)},invited_email.ilike.${exactTerm(email)}`).limit(1),
    ) as { id: string }[];
    return rows[0]?.id ?? null;
  }

  async function submit() {
    if (!company || !user) return;
    const err = validate();
    if (err) return notify(err, "erro");
    setBusy(true);
    try {
      const mail = email.trim().toLowerCase();
      const existing = await alreadyMember();
      if (existing) throw new Error("Esta pessoa já tem acesso ou convite nesta empresa. Edite o vínculo dela na lista.");
      if (mode === "senha") {
        const r = await apiCreateUser({ company_id: company.id, email: mail, password, full_name: name.trim(), phone: phone.trim(), access_role_id: roleId, all_stores: allStores, store_ids: storeIds });
        setDone({ mode, membershipId: r.membership_id, email: mail, password, name: name.trim(), createdUser: r.created_user });
        notify(r.created_user ? "Usuário criado" : "Usuário já existia: acesso liberado");
      } else {
        const sb = supabaseBrowser();
        const ins = unwrap(
          await sb.from("memberships").insert({ company_id: company.id, invited_email: mail, access_role_id: roleId, all_stores: allStores, created_by: user.id }).select("id").single(),
        ) as { id: string };
        if (!allStores && storeIds.length) unwrap(await sb.from("membership_stores").insert(storeIds.map((store_id) => ({ membership_id: ins.id, store_id }))));
        setDone({ mode, membershipId: ins.id, email: mail, password: "", name: name.trim(), createdUser: false });
        notify("Convite registrado");
      }
      invalidate("memberships", "membership_stores", "profiles");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={done ? "Pronto" : "Novo usuário"}
      footer={
        done ? (
          <div className="flex gap-2 pb-2">
            <Button variant="soft" size="lg" full onClick={onClose}>Fechar</Button>
            <Link href={`/usuarios/${done.membershipId}`} onClick={onClose} className="inline-flex flex-1 items-center justify-center rounded-2xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white">Abrir usuário</Link>
          </div>
        ) : (
          <div className="flex gap-2 pb-2">
            <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full disabled={busy || !company} onClick={() => void submit()}>
              {busy ? "Salvando…" : mode === "senha" ? "Criar usuário" : "Registrar convite"}
            </Button>
          </div>
        )
      }
    >
      {done ? (
        <div>
          {done.mode === "senha" ? (
            <>
              <InlineAlert tone="green" icon="check">
                {done.createdUser ? "Conta criada. " : "Este e-mail já tinha conta; o acesso à empresa foi liberado. "}
                Entregue os dados abaixo para a pessoa entrar em <span className="font-mono">{loginUrl}</span>.
              </InlineAlert>
              <div className="card mb-3 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">E-mail</p>
                <div className="mt-1 flex items-center justify-between gap-2"><span className="break-all font-mono text-sm">{done.email}</span><CopyButton text={done.email} size="sm" /></div>
                {done.createdUser && (
                  <>
                    <p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-400">Senha inicial</p>
                    <div className="mt-1 flex items-center justify-between gap-2"><span className="font-mono text-lg font-bold tracking-wide">{done.password}</span><CopyButton text={done.password} size="sm" /></div>
                    <p className="mt-2 text-xs text-slate-500">A senha não fica salva aqui: se perder, redefina na tela do usuário.</p>
                  </>
                )}
                {!done.createdUser && <p className="mt-2 text-xs text-slate-500">A senha informada não foi aplicada porque a conta já existia. Se precisar, redefina na tela do usuário.</p>}
              </div>
              <CopyButton text={`Acesso ao sistema Vila Rica\nEndereço: ${loginUrl}\nE-mail: ${done.email}${done.createdUser ? `\nSenha: ${done.password}` : ""}`} label="Copiar tudo para enviar" />
            </>
          ) : (
            <>
              <InlineAlert tone="green" icon="check">Convite registrado para <strong>{done.email}</strong>.</InlineAlert>
              <div className="card mb-3 p-4 text-sm text-slate-300">
                <p className="font-semibold text-slate-100">O que a pessoa precisa fazer</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Abrir <span className="font-mono">{loginUrl}</span></li>
                  <li>Tocar em <strong>“Fui convidado”</strong></li>
                  <li>Criar a conta com o e-mail <strong className="break-all">{done.email}</strong> e uma senha</li>
                </ol>
                <p className="mt-2 text-xs text-slate-500">Assim que a conta for criada com esse e-mail, o acesso é liberado automaticamente com o perfil escolhido.</p>
              </div>
              <CopyButton text={`Você foi convidado(a) para o sistema Vila Rica.\n1) Abra ${loginUrl}\n2) Toque em "Fui convidado"\n3) Crie sua conta com o e-mail ${done.email}`} label="Copiar instruções para enviar" />
            </>
          )}
        </div>
      ) : (
        <div>
          {svc.isLoading ? null : serviceRole ? (
            <>
              <Label>Como criar</Label>
              <Choice<Mode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: "senha", label: "Criar com senha", hint: "Você define a senha inicial", icon: "lock" },
                  { value: "convite", label: "Convidar por e-mail", hint: "A pessoa cria a própria conta", icon: "send" },
                ]}
              />
            </>
          ) : (
            <InlineAlert tone="amber" icon="info">
              <strong>Criar com senha está desativado.</strong> Configure a variável <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> na Vercel (Settings → Environment Variables) e faça o Redeploy.
              Enquanto isso, use o convite por e-mail.
            </InlineAlert>
          )}

          <Field label="E-mail" hint={mode === "convite" ? "A pessoa vai criar a conta com este e-mail exatamente." : undefined}>
            <TextInput type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com" autoFocus />
          </Field>
          <Field label={mode === "senha" ? "Nome completo" : "Nome (opcional)"} hint={mode === "convite" ? "Só para você identificar; a pessoa informa o nome ao criar a conta." : undefined}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maria da Silva" />
          </Field>
          {mode === "senha" && (
            <>
              <Field label="Telefone (opcional)"><TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" /></Field>
              <PasswordField value={password} onChange={setPassword} />
            </>
          )}
          <Field label="Perfil de acesso" hint={roleOptions.find((r) => r.id === roleId)?.description || "Define o que a pessoa pode fazer. Ajustes finos ficam na tela do usuário."}>
            <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roleOptions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.system ? "" : " (da empresa)"}</option>)}
            </Select>
          </Field>
          <StoreAccess allStores={allStores} storeIds={storeIds} onChange={(a, s) => { setAllStores(a); setStoreIds(s); }} />
        </div>
      )}
    </Sheet>
  );
}
