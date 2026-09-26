"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime } from "@/lib/ops/format";
import type { Permission } from "@/lib/ops/types";
import {
  apiResetPassword, groupPermissions, isPending, memberLabel, roleTone, setMembershipOverride, syncMembershipStores, updateProfileByAdmin,
  useAccessRoles, useMembershipPermissions, useMembershipRow, usePermissionsCatalog, useRolePermissions, useServiceRole, type OverrideValue,
} from "@/lib/ops/modules/usuarios";
import { Badge, Button, ConfirmSheet, ErrorBox, Field, InlineAlert, PageHeader, SectionCard, Select, Skeleton, TextInput, Toggle, useToast, EmptyState } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NoPermission } from "@/components/ops/usuarios/Common";
import { StoreAccess } from "@/components/ops/usuarios/StoreAccess";
import { PasswordField } from "@/components/ops/usuarios/PasswordField";
import { MembershipMatrix } from "@/components/ops/usuarios/PermissionMatrix";

export default function EditarUsuarioPage() {
  const params = useParams<{ membershipId: string }>();
  const id = params?.membershipId ?? "";
  const router = useRouter();
  const { user, canCompany, isAdmin, refresh } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canManage = canCompany("usuarios.gerenciar");

  const rowQ = useMembershipRow(id);
  const row = rowQ.data ?? null;
  const roles = useAccessRoles();
  const perms = usePermissionsCatalog();
  const rolePerms = useRolePermissions(row?.access_role_id);
  const overridesQ = useMembershipPermissions(id);
  const svc = useServiceRole();
  useRealtimeInvalidate(["memberships", "membership_stores", "membership_permissions", "profiles", "role_permissions"]);

  // formulário (dados da pessoa)
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // formulário (acesso)
  const [roleId, setRoleId] = useState("");
  const [allStores, setAllStores] = useState(true);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  // senha
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"desativar" | "senha" | "limpar" | "cancelar_convite" | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setName(row.full_name);
    setPhone(row.phone);
    setRoleId(row.access_role_id);
    setAllStores(row.all_stores);
    setStoreIds(row.store_ids ?? []);
    setActive(row.active);
  }, [row]);

  const isSelf = Boolean(row?.user_id && row.user_id === user?.id);
  const savedIsAdmin = row?.role_code === "admin";
  const formRole = (roles.data ?? []).find((r) => r.id === roleId);
  const formIsAdmin = formRole?.code === "admin";
  const lockAdminEdit = savedIsAdmin && !isAdmin; // só admin altera outro admin
  const lockSelfAdmin = isSelf && savedIsAdmin;
  const groups = useMemo(() => groupPermissions(perms.data ?? []), [perms.data]);
  const inherited = useMemo(() => new Set((rolePerms.data ?? []).map((r) => r.permission_code)), [rolePerms.data]);
  const overrides = useMemo(() => {
    const m = new Map<string, OverrideValue>();
    for (const o of overridesQ.data ?? []) m.set(o.permission_code, o.granted ? "permitir" : "negar");
    return m;
  }, [overridesQ.data]);

  const accessDirty = row ? roleId !== row.access_role_id || allStores !== row.all_stores || active !== row.active || JSON.stringify([...storeIds].sort()) !== JSON.stringify([...(row.store_ids ?? [])].sort()) : false;
  const profileDirty = row ? name.trim() !== row.full_name || phone.trim() !== row.phone : false;

  async function saveProfile() {
    if (!row?.user_id) return;
    if (name.trim().length < 2) return notify("Informe o nome da pessoa.", "erro");
    setBusy("perfil");
    try {
      await updateProfileByAdmin(row.user_id, { full_name: name, phone });
      notify("Dados salvos");
      invalidate("memberships", "profiles");
      if (isSelf) await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function saveAccess() {
    if (!row) return;
    if (!roleId) return notify("Escolha o perfil de acesso.", "erro");
    if (!formIsAdmin && !allStores && storeIds.length === 0) return notify("Escolha pelo menos uma unidade ou marque “todas”.", "erro");
    setBusy("acesso");
    try {
      const sb = supabaseBrowser();
      unwrap(await sb.from("memberships").update({ access_role_id: roleId, all_stores: formIsAdmin ? true : allStores, active }).eq("id", row.id));
      await syncMembershipStores(row.id, formIsAdmin || allStores ? [] : storeIds);
      notify(active ? "Acesso salvo" : "Acesso desativado");
      invalidate("memberships", "membership_stores");
      if (isSelf) await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    if (!row?.user_id) return;
    setBusy("senha");
    try {
      await apiResetPassword(row.user_id, password);
      notify("Senha redefinida. Informe a nova senha à pessoa.");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function changeOverride(p: Permission, value: OverrideValue) {
    if (!row) return;
    setBusyCode(p.code);
    try {
      await setMembershipOverride(row.id, p.code, value);
      invalidate("membership_permissions", "memberships");
      if (isSelf) await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusyCode(null);
    }
  }

  async function clearOverrides() {
    if (!row) return;
    setBusy("limpar");
    try {
      unwrap(await supabaseBrowser().from("membership_permissions").delete().eq("membership_id", row.id));
      notify("Ajustes removidos: valem as permissões do perfil");
      invalidate("membership_permissions", "memberships");
      if (isSelf) await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function cancelInvite() {
    if (!row) return;
    setBusy("cancelar");
    try {
      unwrap(await supabaseBrowser().from("memberships").delete().eq("id", row.id));
      notify("Convite cancelado");
      invalidate("memberships", "membership_stores", "membership_permissions");
      router.replace("/usuarios");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Usuário" backHref="/usuarios" />
        <NoPermission perm="usuarios.gerenciar" what="gerenciar usuários" />
      </div>
    );
  }
  if (rowQ.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Usuário" backHref="/usuarios" />
        <Skeleton rows={4} />
      </div>
    );
  }
  if (rowQ.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Usuário" backHref="/usuarios" />
        <ErrorBox error={toOpsError(rowQ.error as Error).message} onRetry={() => void rowQ.refetch()} />
      </div>
    );
  }
  if (!row) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Usuário" backHref="/usuarios" />
        <EmptyState emoji="🔍" title="Vínculo não encontrado" description="Ele pode ter sido removido ou pertencer a outra empresa." />
      </div>
    );
  }

  const pending = isPending(row);
  const roleOptions = (roles.data ?? []).filter((r) => isAdmin || r.code !== "admin" || r.id === row.access_role_id);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={pending ? row.invited_email : memberLabel(row)}
        backHref="/usuarios"
        icon="users"
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {!pending && <span className="mr-1">{row.email}</span>}
            <Badge tone={roleTone(row.role_code)}>{row.role_name}</Badge>
            {pending ? <Badge tone="amber">convite pendente</Badge> : <Badge tone={row.active ? "green" : "red"}>{row.active ? "ativo" : "desativado"}</Badge>}
            {isSelf && <Badge tone="cyan">você</Badge>}
          </span>
        }
      />

      {lockSelfAdmin && (
        <InlineAlert tone="amber" icon="info">
          Você é administrador. Para não trancar a porta atrás de si, não é possível remover o seu próprio acesso de administrador nem desativar a sua conta por aqui — peça a outro administrador.
        </InlineAlert>
      )}
      {lockAdminEdit && <InlineAlert tone="amber" icon="lock">Só um administrador pode alterar o acesso de outro administrador.</InlineAlert>}
      {pending && (
        <InlineAlert tone="blue" icon="send">
          Esta pessoa ainda não criou a conta. Ela deve abrir <span className="font-mono">/login</span>, tocar em “Fui convidado” e cadastrar-se com o e-mail <strong>{row.invited_email}</strong>. O acesso é liberado automaticamente.
        </InlineAlert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Dados da pessoa */}
        <SectionCard title="Dados da pessoa">
          {pending ? (
            <p className="text-sm text-slate-400">Nome e telefone serão preenchidos pela pessoa ao criar a conta.</p>
          ) : (
            <>
              <Field label="Nome completo"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Telefone"><TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" /></Field>
              <Field label="E-mail" hint="O e-mail de login não pode ser alterado por aqui."><TextInput value={row.email} disabled /></Field>
              <p className="mb-3 text-xs text-slate-500">Vínculo criado em {fmtDateTime(row.created_at)}.</p>
              <Button variant="primary" size="lg" full disabled={busy !== null || !profileDirty} onClick={() => void saveProfile()}>{busy === "perfil" ? "Salvando…" : "Salvar dados"}</Button>
            </>
          )}
        </SectionCard>

        {/* Acesso */}
        <SectionCard title="Acesso">
          <Field label="Perfil de acesso" hint={formRole?.description || "Define o conjunto padrão de permissões."}>
            <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={lockAdminEdit || lockSelfAdmin}>
              {roleOptions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.system ? "" : " (da empresa)"}</option>)}
            </Select>
          </Field>
          {formIsAdmin ? (
            <p className="mb-4 rounded-xl border border-[var(--line)] bg-white/5 px-3.5 py-3 text-sm text-slate-300">Administrador enxerga <strong>todas as unidades</strong> da empresa.</p>
          ) : (
            <StoreAccess allStores={allStores} storeIds={storeIds} onChange={(a, s) => { setAllStores(a); setStoreIds(s); }} disabled={lockAdminEdit} hint="Quais unidades esta pessoa pode acessar." />
          )}
          {!pending && (
            <Toggle checked={active} onChange={setActive} label="Acesso ativo" hint={active ? "Desativar bloqueia a entrada no sistema imediatamente." : "A pessoa não consegue entrar nesta empresa."} disabled={lockAdminEdit || lockSelfAdmin} />
          )}
          <Button
            variant="primary"
            size="lg"
            full
            disabled={busy !== null || !accessDirty || lockAdminEdit}
            onClick={() => (row.active && !active ? setConfirm("desativar") : void saveAccess())}
          >
            {busy === "acesso" ? "Salvando…" : "Salvar acesso"}
          </Button>
          {pending && (
            <Button variant="ghost" full className="mt-2 !text-rose-300" disabled={busy !== null} onClick={() => setConfirm("cancelar_convite")}>
              <Icon name="trash" size={16} /> Cancelar convite
            </Button>
          )}
        </SectionCard>

        {/* Senha */}
        {!pending && (
          <SectionCard title="Senha" className="lg:col-span-2">
            {svc.isLoading ? (
              <Skeleton rows={1} />
            ) : svc.data ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <PasswordField value={password} onChange={setPassword} label="Nova senha" hint="Redefine a senha de login desta pessoa. Informe a nova senha a ela." />
                <Button variant="soft" size="lg" disabled={busy !== null || password.length < 6} onClick={() => setConfirm("senha")} className="mb-4">
                  <Icon name="lock" size={18} /> Redefinir senha
                </Button>
              </div>
            ) : (
              <InlineAlert tone="slate" icon="info">
                A redefinição de senha pelo administrador precisa da chave <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> no servidor.
                Enquanto isso, a pessoa pode usar <strong>“Esqueci a senha”</strong> na tela de login (recebe um link por e-mail) ou trocar a senha em <strong>Meu perfil</strong>.
              </InlineAlert>
            )}
          </SectionCard>
        )}

        {/* Ajuste fino */}
        <SectionCard
          title="Ajuste fino de permissões"
          className="lg:col-span-2"
          action={
            row.overrides_count > 0 && !savedIsAdmin ? (
              <button type="button" onClick={() => setConfirm("limpar")} className="text-xs font-semibold text-rose-300">Limpar {row.overrides_count} ajuste{row.overrides_count > 1 ? "s" : ""}</button>
            ) : undefined
          }
        >
          {savedIsAdmin ? (
            <InlineAlert tone="red" icon="shield">O perfil <strong>Administrador</strong> tem todas as permissões em todas as unidades; ajustes finos não se aplicam. Para limitar, troque o perfil de acesso.</InlineAlert>
          ) : (
            <p className="mb-3 text-sm text-slate-400">
              O perfil <strong className="text-slate-200">{row.role_name}</strong> define o padrão. Aqui você pode <strong className="text-emerald-300">permitir</strong> algo a mais ou <strong className="text-rose-300">negar</strong> algo só para esta pessoa. As mudanças valem na hora.
            </p>
          )}
          {accessDirty && roleId !== row.access_role_id && <InlineAlert tone="amber">Você trocou o perfil, mas ainda não salvou. A matriz abaixo mostra o perfil atual ({row.role_name}).</InlineAlert>}
          {perms.isLoading || rolePerms.isLoading || overridesQ.isLoading ? (
            <Skeleton rows={3} />
          ) : perms.isError ? (
            <ErrorBox error={toOpsError(perms.error as Error).message} onRetry={() => void perms.refetch()} />
          ) : (
            <MembershipMatrix groups={groups} inherited={inherited} overrides={overrides} isAdminRole={savedIsAdmin} disabled={lockAdminEdit || busy !== null} busyCode={busyCode} onChange={(p, v) => void changeOverride(p, v)} />
          )}
        </SectionCard>
      </div>

      <ConfirmSheet
        open={confirm === "desativar"}
        onClose={() => setConfirm(null)}
        title="Desativar acesso?"
        message={`${memberLabel(row)} não conseguirá mais entrar nesta empresa. Os registros feitos por essa pessoa continuam no histórico. Você pode reativar depois.`}
        confirmLabel="Desativar"
        onConfirm={() => void saveAccess()}
      />
      <ConfirmSheet
        open={confirm === "senha"}
        onClose={() => setConfirm(null)}
        title="Redefinir senha?"
        message={`A senha atual de ${memberLabel(row)} deixará de funcionar. Anote a nova senha (${password}) para entregar à pessoa.`}
        confirmLabel="Redefinir"
        onConfirm={() => void resetPassword()}
      />
      <ConfirmSheet
        open={confirm === "limpar"}
        onClose={() => setConfirm(null)}
        title="Remover todos os ajustes?"
        message="Voltam a valer exatamente as permissões do perfil de acesso."
        confirmLabel="Remover ajustes"
        onConfirm={() => void clearOverrides()}
      />
      <ConfirmSheet
        open={confirm === "cancelar_convite"}
        onClose={() => setConfirm(null)}
        title="Cancelar convite?"
        message={`O e-mail ${row.invited_email} não poderá mais criar conta com este convite.`}
        confirmLabel="Cancelar convite"
        onConfirm={() => void cancelInvite()}
      />
    </div>
  );
}
