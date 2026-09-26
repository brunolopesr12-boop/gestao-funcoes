"use client";

import { useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { fmtDate } from "@/lib/ops/format";
import { toOpsError } from "@/lib/ops/errors";
import { isPending, memberLabel, roleTone, useAccessRoles, useMembershipsList, useServiceRole, type MembershipFilters, type MembershipRow } from "@/lib/ops/modules/usuarios";
import { Badge, Button, DataTable, ErrorBox, InlineAlert, PageHeader, SearchInput, Select, useDebounced, usePagination, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NoPermission, UsuariosSubnav } from "@/components/ops/usuarios/Common";
import { NewUserSheet } from "@/components/ops/usuarios/NewUserSheet";

const STATUS_OPTIONS: { value: MembershipFilters["status"]; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "ativos", label: "Ativos" },
  { value: "pendentes", label: "Convites pendentes" },
  { value: "inativos", label: "Desativados" },
];

export default function UsuariosPage() {
  const { company, canCompany, user } = useSession();
  const canManage = canCompany("usuarios.gerenciar");
  const [term, setTerm] = useState("");
  const t = useDebounced(term);
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState<MembershipFilters["status"]>("todos");
  const [open, setOpen] = useState(false);
  const pg = usePagination(50);
  const roles = useAccessRoles();
  const svc = useServiceRole();
  const q = useMembershipsList({ term: t, roleId, status }, pg.range, pg.page);
  useRealtimeInvalidate(["memberships", "membership_stores", "membership_permissions", "profiles"]);

  if (!canManage) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Usuários" icon="shield" />
        <NoPermission perm="usuarios.gerenciar" what="gerenciar usuários" />
      </div>
    );
  }

  const storesLabel = (r: MembershipRow) => (r.role_code === "admin" || r.all_stores ? "Todas" : r.store_names.length === 0 ? "Nenhuma" : r.store_names.join(", "));

  const columns: Column<MembershipRow>[] = [
    {
      key: "pessoa", label: "Pessoa",
      render: (r) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold">
            <span className="truncate">{isPending(r) ? r.invited_email : memberLabel(r)}</span>
            {r.user_id === user?.id && <Badge tone="cyan">você</Badge>}
            {isPending(r) && <Badge tone="amber">convite pendente</Badge>}
          </p>
          {!isPending(r) && <p className="truncate text-xs text-slate-500">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p>}
        </div>
      ),
    },
    { key: "perfil", label: "Perfil", render: (r) => <span className="inline-flex items-center gap-1"><Badge tone={roleTone(r.role_code)}>{r.role_name}</Badge>{r.overrides_count > 0 && <Badge tone="violet">{r.overrides_count} ajuste{r.overrides_count > 1 ? "s" : ""}</Badge>}</span> },
    { key: "unidades", label: "Unidades", render: (r) => <span className="block max-w-[260px] truncate text-slate-300" title={storesLabel(r)}>{storesLabel(r)}</span> },
    { key: "ativo", label: "Ativo", align: "center", render: (r) => <Badge tone={r.active ? "green" : "red"}>{r.active ? "Sim" : "Não"}</Badge> },
    { key: "criado", label: "Criado em", hideOnMobile: true, render: (r) => <span className="text-slate-400">{fmtDate(r.created_at)}</span> },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Usuários"
        subtitle={company ? `${company.emoji} ${company.name}` : undefined}
        icon="shield"
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Icon name="plus" size={18} /> Novo usuário</Button>}
      />
      <UsuariosSubnav />

      {svc.data === false && (
        <InlineAlert tone="amber" icon="info">
          <strong>Criação com senha desativada.</strong> Para o administrador criar contas com senha inicial, configure <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> na Vercel (Settings → Environment Variables) e faça o Redeploy.
          Enquanto isso, convide por e-mail: a pessoa cria a conta em <span className="font-mono">/login</span> → “Fui convidado”.
        </InlineAlert>
      )}

      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_200px_200px]">
        <SearchInput value={term} onChange={(v) => { setTerm(v); pg.setPage(0); }} placeholder="Buscar por nome, e-mail ou telefone" />
        <Select value={roleId} onChange={(e) => { setRoleId(e.target.value); pg.setPage(0); }} aria-label="Perfil">
          <option value="">Todos os perfis</option>
          {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as MembershipFilters["status"]); pg.setPage(0); }} aria-label="Situação">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {q.isError ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data?.rows ?? []}
          loading={q.isLoading || q.isFetching}
          total={q.data?.total}
          page={pg.page}
          pageSize={pg.pageSize}
          onPage={pg.setPage}
          rowHref={(r) => `/usuarios/${r.id}`}
          emptyTitle={t || roleId || status !== "todos" ? "Nenhum usuário com esses filtros" : "Nenhum usuário ainda"}
          emptyDescription={t || roleId || status !== "todos" ? "Tente outra busca ou limpe os filtros." : "Toque em “Novo usuário” para criar uma conta com senha ou convidar por e-mail."}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{isPending(r) ? r.invited_email : memberLabel(r)}</span>
                  {r.user_id === user?.id && <Badge tone="cyan">você</Badge>}
                </p>
                {!isPending(r) && <p className="truncate text-xs text-slate-500">{r.email}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={roleTone(r.role_code)}>{r.role_name}</Badge>
                  {isPending(r) && <Badge tone="amber">convite pendente</Badge>}
                  {!r.active && <Badge tone="red">desativado</Badge>}
                  {r.overrides_count > 0 && <Badge tone="violet">{r.overrides_count} ajuste{r.overrides_count > 1 ? "s" : ""}</Badge>}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500">Unidades: {storesLabel(r)}</p>
              </div>
              <Icon name="chevronRight" className="text-slate-600" />
            </div>
          )}
        />
      )}

      <NewUserSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
