"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { slug } from "@/lib/ops/format";
import type { AccessRole } from "@/lib/ops/types";
import { groupPermissions, roleTone, saveRolePermissions, useAccessRoles, useMembershipCounts, usePermissionsCatalog, useRolePermissions } from "@/lib/ops/modules/usuarios";
import { Badge, Button, ConfirmSheet, ErrorBox, Field, InlineAlert, PageHeader, Select, Sheet, Skeleton, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NoPermission, UsuariosSubnav } from "@/components/ops/usuarios/Common";
import { RoleMatrix } from "@/components/ops/usuarios/PermissionMatrix";

export default function PerfisPage() {
  const { company, canCompany, isAdmin, refresh } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canManage = canCompany("usuarios.gerenciar");
  const roles = useAccessRoles();
  const perms = usePermissionsCatalog();
  const counts = useMembershipCounts();
  const [roleId, setRoleId] = useState<string>("");
  const role = useMemo(() => (roles.data ?? []).find((r) => r.id === roleId) ?? null, [roles.data, roleId]);
  const rolePerms = useRolePermissions(roleId);
  useRealtimeInvalidate(["access_roles", "role_permissions", "memberships"]);

  useEffect(() => {
    if (!roleId && roles.data?.length) setRoleId(roles.data[0].id);
  }, [roles.data, roleId]);

  const groups = useMemo(() => groupPermissions(perms.data ?? []), [perms.data]);
  const saved = useMemo(() => new Set((rolePerms.data ?? []).map((r) => r.permission_code)), [rolePerms.data]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => setSel(new Set(saved)), [saved]);
  const dirty = useMemo(() => sel.size !== saved.size || [...sel].some((c) => !saved.has(c)), [sel, saved]);

  // edição de nome/descrição
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
  }, [role]);
  const metaDirty = role ? name.trim() !== role.name || description.trim() !== role.description : false;

  const [busy, setBusy] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editable = Boolean(role && !role.system && role.company_id === company?.id);
  const isAdminRole = role?.code === "admin";
  const membersOf = (id: string) => counts.data?.active[id] ?? 0;
  /** inclui vínculos desativados: o perfil não pode ser excluído enquanto alguém (mesmo inativo) o usa */
  const anyMemberOf = (id: string) => counts.data?.total[id] ?? 0;

  async function savePerms() {
    if (!role) return;
    setBusy("perms");
    try {
      await saveRolePermissions(role.id, [...sel]);
      notify("Permissões do perfil salvas");
      invalidate("role_permissions");
      await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }
  async function saveMeta() {
    if (!role) return;
    if (name.trim().length < 2) return notify("Informe o nome do perfil.", "erro");
    setBusy("meta");
    try {
      unwrap(await supabaseBrowser().from("access_roles").update({ name: name.trim(), description: description.trim() }).eq("id", role.id));
      notify("Perfil salvo");
      invalidate("access_roles", "memberships");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }
  async function removeRole() {
    if (!role) return;
    setBusy("delete");
    try {
      unwrap(await supabaseBrowser().from("access_roles").delete().eq("id", role.id));
      notify("Perfil excluído");
      setRoleId("");
      invalidate("access_roles", "role_permissions");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Perfis de acesso" icon="shield" />
        <NoPermission perm="usuarios.gerenciar" what="gerenciar perfis de acesso" />
      </div>
    );
  }

  const list = roles.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Perfis de acesso"
        subtitle="Conjuntos de permissões. Perfis do sistema são fixos; os da empresa você edita."
        icon="shield"
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={18} /> Novo perfil</Button>}
      />
      <UsuariosSubnav />

      {roles.isError ? (
        <ErrorBox error={toOpsError(roles.error as Error).message} onRetry={() => void roles.refetch()} />
      ) : roles.isLoading ? (
        <Skeleton rows={4} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* celular: seletor */}
          <div className="lg:hidden">
            <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Perfil">
              {list.map((r) => <option key={r.id} value={r.id}>{r.name}{r.system ? " (sistema)" : " (da empresa)"} · {membersOf(r.id)} pessoa(s)</option>)}
            </Select>
          </div>
          {/* desktop: lista */}
          <aside className="hidden lg:block">
            <div className="card divide-y divide-[var(--line)] overflow-hidden">
              {list.map((r) => (
                <button key={r.id} type="button" onClick={() => setRoleId(r.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${r.id === roleId ? "bg-[var(--accent)]/15" : "hover:bg-white/5"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate font-semibold">{r.name}</span><Badge tone={r.system ? "slate" : "violet"}>{r.system ? "sistema" : "empresa"}</Badge></span>
                    <span className="block truncate text-xs text-slate-500">{r.description || r.code}</span>
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">{membersOf(r.id)} <Icon name="users" size={14} className="inline" /></span>
                </button>
              ))}
              {list.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Nenhum perfil encontrado.</p>}
            </div>
          </aside>

          <section>
            {!role ? (
              <Skeleton rows={2} />
            ) : (
              <>
                <div className="card mb-4 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-2 text-lg font-bold"><Badge tone={roleTone(role.code)}>{role.code}</Badge>{role.name}</h2>
                      <p className="text-sm text-slate-400">{role.description || "Sem descrição."}</p>
                      <p className="mt-1 text-xs text-slate-500">{membersOf(role.id)} pessoa(s) com este perfil nesta empresa</p>
                    </div>
                    {editable && (
                      <Button variant="ghost" className="!text-rose-300" disabled={busy !== null || anyMemberOf(role.id) > 0} title={anyMemberOf(role.id) > 0 ? "Mova as pessoas (inclusive desativadas) para outro perfil antes de excluir" : undefined} onClick={() => setConfirmDelete(true)}>
                        <Icon name="trash" size={16} /> Excluir perfil
                      </Button>
                    )}
                  </div>
                  {editable && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Field label="Nome"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
                      <Field label="Descrição"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para que serve este perfil" /></Field>
                      <div className="sm:col-span-2"><Button variant="soft" disabled={busy !== null || !metaDirty} onClick={() => void saveMeta()}>{busy === "meta" ? "Salvando…" : "Salvar nome e descrição"}</Button></div>
                    </div>
                  )}
                </div>

                {role.system && (
                  <InlineAlert tone="slate" icon="lock">
                    Perfil do sistema: a matriz é somente leitura. Para um conjunto diferente, crie um <strong>perfil personalizado</strong> (pode copiar deste) ou use o ajuste fino na tela de cada usuário.
                  </InlineAlert>
                )}
                {isAdminRole && <InlineAlert tone="red" icon="shield">Administrador tem <strong>todas</strong> as permissões em todas as unidades, sempre.</InlineAlert>}

                {perms.isLoading || rolePerms.isLoading ? (
                  <Skeleton rows={3} />
                ) : (
                  <RoleMatrix
                    groups={groups}
                    selected={sel}
                    readOnly={!editable}
                    isAdminRole={isAdminRole}
                    onToggle={(code) => setSel((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; })}
                    onToggleModule={(codes, on) => setSel((s) => { const n = new Set(s); for (const c of codes) { if (on) n.add(c); else n.delete(c); } return n; })}
                  />
                )}

                {editable && (
                  <div className="sticky bottom-20 z-10 mt-4 flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/95 p-2 shadow-xl backdrop-blur lg:bottom-4">
                    <Button variant="soft" size="lg" disabled={!dirty || busy !== null} onClick={() => setSel(new Set(saved))}>Descartar</Button>
                    <Button variant="primary" size="lg" full disabled={!dirty || busy !== null} onClick={() => void savePerms()}>
                      {busy === "perms" ? "Salvando…" : dirty ? `Salvar permissões (${sel.size})` : "Permissões salvas"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <NewRoleSheet open={newOpen} onClose={() => setNewOpen(false)} roles={list} isAdmin={isAdmin} onCreated={(id) => setRoleId(id)} />
      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Excluir perfil?"
        message={`O perfil "${role?.name ?? ""}" será removido. Só é possível excluir perfis sem pessoas vinculadas.`}
        confirmLabel="Excluir"
        onConfirm={() => void removeRole()}
      />
    </div>
  );
}

/** Cria um perfil personalizado da empresa, opcionalmente copiando as permissões de outro. */
function NewRoleSheet({ open, onClose, roles, isAdmin, onCreated }: { open: boolean; onClose: () => void; roles: AccessRole[]; isAdmin: boolean; onCreated: (id: string) => void }) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(""); setCode(""); setCodeTouched(false); setDescription(""); setCopyFrom("");
  }, [open]);

  const copyOptions = roles.filter((r) => isAdmin || r.code !== "admin");

  async function create() {
    if (!company) return;
    const c = slug(code || name);
    if (name.trim().length < 2) return notify("Informe o nome do perfil.", "erro");
    if (!c) return notify("Informe um código (letras e números).", "erro");
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const pos = roles.filter((r) => r.company_id === company.id).length + 10;
      const ins = unwrap(await sb.from("access_roles").insert({ company_id: company.id, code: c, name: name.trim(), description: description.trim(), system: false, position: pos }).select("id").single()) as { id: string };
      if (copyFrom) {
        const src = roles.find((r) => r.id === copyFrom);
        let codes: string[] = [];
        if (src?.code === "admin") {
          codes = (unwrap(await sb.from("permissions").select("code")) as { code: string }[]).map((p) => p.code);
        } else {
          codes = (unwrap(await sb.from("role_permissions").select("permission_code").eq("access_role_id", copyFrom)) as { permission_code: string }[]).map((p) => p.permission_code);
        }
        if (codes.length) unwrap(await sb.from("role_permissions").insert(codes.map((permission_code) => ({ access_role_id: ins.id, permission_code }))));
      }
      notify("Perfil criado");
      invalidate("access_roles", "role_permissions");
      onCreated(ins.id);
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
      title="Novo perfil de acesso"
      footer={
        <div className="flex gap-2 pb-2">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full disabled={busy} onClick={() => void create()}>{busy ? "Criando…" : "Criar perfil"}</Button>
        </div>
      }
    >
      <Field label="Nome" hint="Ex.: Líder de turno, Caixa, Auxiliar de estoque">
        <TextInput value={name} autoFocus onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(slug(e.target.value)); }} />
      </Field>
      <Field label="Código" hint="Identificador curto, sem espaços. Gerado a partir do nome.">
        <TextInput value={code} onChange={(e) => { setCodeTouched(true); setCode(slug(e.target.value)); }} className="font-mono" />
      </Field>
      <Field label="Descrição"><TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para que serve este perfil" /></Field>
      <Field label="Copiar permissões de" hint="Comece a partir de um perfil parecido e ajuste depois.">
        <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          <option value="">Começar sem permissões</option>
          {copyOptions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.system ? " (sistema)" : ""}</option>)}
        </Select>
      </Field>
    </Sheet>
  );
}
