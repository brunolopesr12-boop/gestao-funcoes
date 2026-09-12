"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmployeeSheet, ProcessSheet, RoleSheet } from "@/components/sheets";
import {
  Button,
  EmptyState,
  InlineList,
  ProgressBar,
  SectionTitle,
  Sheet,
  Stat,
  StatusPill,
} from "@/components/ui";
import { useData } from "@/lib/store";
import { roleCoverage, sortByPosition } from "@/lib/derive";
import { companyEmployees, roleEmployees, roleProcesses } from "@/lib/selectors";
import { avatarTone, initials } from "@/lib/format";

export default function RoleDetail() {
  const { companyId, roleId } = useParams<{ companyId: string; roleId: string }>();
  const router = useRouter();
  const { data, trainingIndex, actions } = useData();

  const [editRole, setEditRole] = useState(false);
  const [newProcess, setNewProcess] = useState(false);
  const [editProcessId, setEditProcessId] = useState<string | null>(null);
  const [reorder, setReorder] = useState(false);
  const [linking, setLinking] = useState(false);
  const [newEmployee, setNewEmployee] = useState(false);

  const role = data.roles.find((r) => r.id === roleId);
  const processes = useMemo(() => roleProcesses(data, roleId), [data, roleId]);
  const linked = useMemo(() => roleEmployees(data, roleId), [data, roleId]);
  const coverage = useMemo(
    () => roleCoverage(trainingIndex, roleId, linked.map((l) => l.employee), processes),
    [trainingIndex, roleId, linked, processes],
  );
  const competencies = useMemo(
    () => sortByPosition(data.competencies.filter((c) => c.role_id === roleId)),
    [data.competencies, roleId],
  );
  const checklist = useMemo(
    () => sortByPosition(data.checklist_items.filter((c) => c.role_id === roleId)),
    [data.checklist_items, roleId],
  );

  if (!role) {
    return (
      <AppShell title="Função" backHref={`/empresa/${companyId}/funcoes`}>
        <EmptyState emoji="🔍" title="Função não encontrada" />
      </AppShell>
    );
  }

  const responsibilities = role.responsibilities
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const kindOf = (employeeId: string) =>
    linked.find((l) => l.employee.id === employeeId)?.kind ?? "treinando";

  return (
    <AppShell
      title={`${role.emoji} ${role.name}`}
      subtitle={data.companies.find((c) => c.id === companyId)?.name}
      backHref={`/empresa/${companyId}/funcoes`}
      action={
        <Button size="sm" variant="ghost" onClick={() => setEditRole(true)}>
          Editar
        </Button>
      }
    >
      {role.description && (
        <p className="card mb-4 p-4 text-sm text-slate-300">{role.description}</p>
      )}

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="Aptos" value={coverage.apt.length} tone="green" emoji="🟢" />
        <Stat label="Treinando" value={coverage.training.length} tone="amber" emoji="🟡" />
        <Stat
          label="Não treinados"
          value={coverage.untrained.length}
          tone="red"
          emoji="🔴"
        />
      </div>

      {!coverage.hasProcesses && (
        <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          ⚠️ Esta função ainda não tem processos obrigatórios. Cadastre abaixo o que a
          pessoa precisa saber fazer — sem isso ninguém pode ser certificado.
        </div>
      )}
      {coverage.hasProcesses && coverage.apt.length === 0 && (
        <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          🔴 <strong>Risco operacional:</strong> nenhuma pessoa apta nesta função.
        </div>
      )}

      {/* Funcionários ---------------------------------------------- */}
      <SectionTitle
        hint="Quem ocupa ou está aprendendo esta função"
        action={
          <Button size="sm" onClick={() => setLinking(true)}>
            + Vincular
          </Button>
        }
      >
        Funcionários
      </SectionTitle>

      {coverage.all.length === 0 ? (
        <EmptyState
          emoji="👤"
          title="Ninguém vinculado"
          description="Vincule funcionários para acompanhar o treinamento nesta função."
          action={
            <Button variant="primary" onClick={() => setLinking(true)}>
              Vincular funcionário
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {[...coverage.all]
            .sort((a, b) => b.progress.pct - a.progress.pct)
            .map(({ employee, progress }) => (
              <Link
                key={employee.id}
                href={`/empresa/${companyId}/funcionarios/${employee.id}?funcao=${roleId}`}
                className="card card-hover flex items-center gap-3 p-3.5"
              >
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border text-sm font-bold ${avatarTone(employee.name)}`}
                >
                  {initials(employee.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{employee.name}</p>
                    {kindOf(employee.id) === "treinando" && (
                      <span className="shrink-0 rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
                        treinando
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar value={progress.pct} showLabel />
                  </div>
                </div>
                <StatusPill status={progress.fitness} compact />
              </Link>
            ))}
        </div>
      )}

      {/* Processos / requisitos ------------------------------------ */}
      <div className="mt-8">
        <SectionTitle
          hint="O que a pessoa precisa saber fazer para ser certificada"
          action={
            processes.length > 1 ? (
              <Button size="sm" variant="ghost" onClick={() => setReorder((v) => !v)}>
                {reorder ? "Pronto" : "Reordenar"}
              </Button>
            ) : undefined
          }
        >
          Processos exigidos
        </SectionTitle>

        {processes.length === 0 ? (
          <EmptyState
            emoji="📋"
            title="Nenhum processo cadastrado"
            description="Ex.: fazer arroz, montar pedido, conferir pedido…"
            action={
              <Button variant="primary" onClick={() => setNewProcess(true)}>
                + Novo processo
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {processes.map((p, i) => {
              const certificados = coverage.all.filter(
                (c) =>
                  c.progress.all.find((x) => x.process.id === p.id)?.status ===
                  "certificado",
              ).length;
              return (
                <div key={p.id} className="card overflow-hidden">
                  <div className="flex items-center gap-3 p-3.5">
                    <Link
                      href={`/empresa/${companyId}/processos/${p.id}`}
                      className="min-w-0 flex-1"
                    >
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{p.name}</p>
                        {!p.required && (
                          <span className="shrink-0 rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
                            extra
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        {certificados} de {coverage.all.length} certificados
                      </p>
                    </Link>
                    <button
                      onClick={() => setEditProcessId(p.id)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white/10"
                      aria-label="Editar processo"
                    >
                      ✏️
                    </button>
                  </div>
                  {reorder && (
                    <div className="flex gap-2 border-t border-[var(--line)] p-2">
                      <Button
                        size="sm"
                        full
                        disabled={i === 0}
                        onClick={() => void actions.moveProcess(p.id, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        full
                        disabled={i === processes.length - 1}
                        onClick={() => void actions.moveProcess(p.id, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            <Button variant="primary" full onClick={() => setNewProcess(true)}>
              + Novo processo
            </Button>
          </div>
        )}
      </div>

      {/* Responsabilidades ----------------------------------------- */}
      {responsibilities.length > 0 && (
        <div className="mt-8">
          <SectionTitle>Responsabilidades</SectionTitle>
          <ul className="card space-y-2 p-4">
            {responsibilities.map((r, i) => (
              <li key={i} className="flex gap-2 text-[15px] text-slate-200">
                <span className="text-slate-500">•</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Competências ---------------------------------------------- */}
      <div className="mt-8">
        <SectionTitle hint="Conhecimentos e atitudes esperadas">
          Competências necessárias
        </SectionTitle>
        <div className="card p-4">
          <InlineList
            items={competencies.map((c) => ({ id: c.id, label: c.name }))}
            placeholder="Ex.: organização, agilidade, higiene"
            emptyText="Nenhuma competência cadastrada."
            onAdd={(t) => void actions.addCompetency(roleId, t)}
            onRename={(id, t) => void actions.updateCompetency(id, t)}
            onDelete={(id) => void actions.deleteCompetency(id)}
          />
        </div>
      </div>

      {/* Checklist -------------------------------------------------- */}
      <div className="mt-8">
        <SectionTitle hint="Rotina do dia a dia dessa função">
          Checklist da função
        </SectionTitle>
        <div className="card p-4">
          <InlineList
            bullet="☐"
            items={checklist.map((c) => ({ id: c.id, label: c.text }))}
            placeholder="Ex.: conferir estoque no início do turno"
            emptyText="Nenhum item de checklist cadastrado."
            onAdd={(t) => void actions.addChecklistItem(roleId, t)}
            onRename={(id, t) => void actions.updateChecklistItem(id, t)}
            onDelete={(id) => void actions.deleteChecklistItem(id)}
          />
        </div>
      </div>

      {/* Sheets ---------------------------------------------------- */}
      <RoleSheet
        open={editRole}
        onClose={() => setEditRole(false)}
        companyId={companyId}
        role={role}
        onDeleted={() => router.replace(`/empresa/${companyId}/funcoes`)}
      />
      <ProcessSheet
        open={newProcess}
        onClose={() => setNewProcess(false)}
        roleId={roleId}
        process={null}
      />
      <ProcessSheet
        open={Boolean(editProcessId)}
        onClose={() => setEditProcessId(null)}
        roleId={roleId}
        process={processes.find((p) => p.id === editProcessId) ?? null}
      />
      <LinkEmployeeSheet
        open={linking}
        onClose={() => setLinking(false)}
        companyId={companyId}
        roleId={roleId}
        onNew={() => {
          setLinking(false);
          setNewEmployee(true);
        }}
      />
      <EmployeeSheet
        open={newEmployee}
        onClose={() => setNewEmployee(false)}
        companyId={companyId}
        employee={null}
        defaultRoleId={roleId}
      />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

function LinkEmployeeSheet({
  open,
  onClose,
  companyId,
  roleId,
  onNew,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  roleId: string;
  onNew: () => void;
}) {
  const { data, actions } = useData();
  const all = companyEmployees(data, companyId);
  const linkedIds = new Set(
    data.employee_roles.filter((l) => l.role_id === roleId).map((l) => l.employee_id),
  );

  return (
    <Sheet open={open} onClose={onClose} title="Vincular funcionário">
      <Button variant="primary" full className="mb-4" onClick={onNew}>
        + Cadastrar novo funcionário
      </Button>

      {all.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum funcionário cadastrado nesta empresa ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {all.map((e) => {
            const isLinked = linkedIds.has(e.id);
            const link = data.employee_roles.find(
              (l) => l.role_id === roleId && l.employee_id === e.id,
            );
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white/[0.03] p-3"
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-bold ${avatarTone(e.name)}`}
                >
                  {initials(e.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px]">{e.name}</span>
                {isLinked ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!text-rose-400"
                    onClick={() => link && void actions.removeEmployeeRole(link.id)}
                  >
                    Remover
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void actions.addTrainingRole(e.id, roleId)}
                  >
                    Vincular
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
