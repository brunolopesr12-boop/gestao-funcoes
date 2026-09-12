"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  ConfirmSheet,
  EmojiPicker,
  Field,
  Select,
  Sheet,
  TextArea,
  TextInput,
} from "./ui";
import { useData } from "@/lib/store";
import { companyRoles, employeeLinks } from "@/lib/selectors";
import type { Employee, Process, Role } from "@/lib/types";

const ROLE_EMOJIS = [
  "🧩", "📦", "🍳", "🙋", "💵", "🥟", "🍕", "🍔", "🧹", "🚚", "📋", "🧊",
];

/* ------------------------------------------------------------------ */
/* Função                                                              */
/* ------------------------------------------------------------------ */

export function RoleSheet({
  open,
  onClose,
  companyId,
  role,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  role: Role | null;
  onDeleted?: () => void;
}) {
  const { actions } = useData();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🧩");
  const [description, setDescription] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState("");

  const currentKey = `${role?.id ?? "novo"}-${open}`;
  if (key !== currentKey) {
    setKey(currentKey);
    setName(role?.name ?? "");
    setEmoji(role?.emoji ?? "🧩");
    setDescription(role?.description ?? "");
    setResponsibilities(role?.responsibilities ?? "");
  }

  const save = async () => {
    if (!name.trim()) return;
    if (role) {
      await actions.updateRole(role.id, {
        name: name.trim(),
        emoji,
        description,
        responsibilities,
      });
    } else {
      await actions.createRole({
        company_id: companyId,
        name,
        emoji,
        description,
        responsibilities,
      });
    }
    onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={role ? "Editar função" : "Nova função"}>
        <Field label="Nome da função">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Montador de pedidos"
            autoFocus
          />
        </Field>
        <Field label="Ícone">
          <EmojiPicker value={emoji} onChange={setEmoji} options={ROLE_EMOJIS} />
        </Field>
        <Field label="Descrição" hint="Opcional">
          <TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Para que serve essa função…"
          />
        </Field>
        <Field label="Responsabilidades" hint="Uma por linha">
          <TextArea
            rows={4}
            value={responsibilities}
            onChange={(e) => setResponsibilities(e.target.value)}
            placeholder={"Manter a bancada organizada\nConferir cada pedido antes de sair"}
          />
        </Field>

        <Button variant="primary" size="lg" full onClick={save} disabled={!name.trim()}>
          Salvar
        </Button>

        {role && (
          <Button
            variant="ghost"
            full
            className="mt-3 !text-rose-400"
            onClick={() => setConfirmDelete(true)}
          >
            Excluir função
          </Button>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Excluir função?"
        message={`Isso apaga "${role?.name ?? ""}", seus processos e todo o treinamento registrado nela.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (role) await actions.deleteRole(role.id);
          onClose();
          onDeleted?.();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Processo                                                            */
/* ------------------------------------------------------------------ */

export function ProcessSheet({
  open,
  onClose,
  roleId,
  process,
}: {
  open: boolean;
  onClose: () => void;
  roleId: string;
  process: Process | null;
}) {
  const { actions } = useData();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [required, setRequired] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState("");

  const currentKey = `${process?.id ?? "novo"}-${open}`;
  if (key !== currentKey) {
    setKey(currentKey);
    setName(process?.name ?? "");
    setDescription(process?.description ?? "");
    setRequired(process?.required ?? true);
  }

  const save = async () => {
    if (!name.trim()) return;
    if (process) {
      await actions.updateProcess(process.id, {
        name: name.trim(),
        description,
        required,
      });
    } else {
      await actions.createProcess({ role_id: roleId, name, description, required });
    }
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={process ? "Editar processo" : "Novo processo"}
      >
        <Field label="O que a pessoa precisa saber fazer">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Fazer estrogonofe de carne"
            autoFocus
          />
        </Field>
        <Field label="Como fazer / detalhes" hint="Opcional — aparece na hora de treinar">
          <TextArea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Passo a passo, ponto de atenção, quantidade…"
          />
        </Field>

        <button
          type="button"
          onClick={() => setRequired((v) => !v)}
          className="mb-5 flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-white/[0.03] p-3.5 text-left"
        >
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-xs ${
              required
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-slate-600"
            }`}
          >
            {required ? "✓" : ""}
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-slate-200">
              Obrigatório para ficar apto
            </span>
            <span className="block text-xs text-slate-400">
              Desmarque se for um processo extra, que não bloqueia a certificação.
            </span>
          </span>
        </button>

        <Button variant="primary" size="lg" full onClick={save} disabled={!name.trim()}>
          Salvar
        </Button>

        {process && (
          <Button
            variant="ghost"
            full
            className="mt-3 !text-rose-400"
            onClick={() => setConfirmDelete(true)}
          >
            Excluir processo
          </Button>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Excluir processo?"
        message={`"${process?.name ?? ""}" e o treinamento registrado nele serão apagados.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (process) await actions.deleteProcess(process.id);
          onClose();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Funcionário                                                         */
/* ------------------------------------------------------------------ */

export function EmployeeSheet({
  open,
  onClose,
  companyId,
  employee,
  defaultRoleId,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  employee: Employee | null;
  defaultRoleId?: string;
  onDeleted?: () => void;
}) {
  const { data, actions } = useData();
  const router = useRouter();
  const roles = companyRoles(data, companyId);

  const [name, setName] = useState("");
  const [status, setStatus] = useState<Employee["status"]>("ativo");
  const [hiredOn, setHiredOn] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [currentRoleId, setCurrentRoleId] = useState("");
  const [trainingRoleIds, setTrainingRoleIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState("");

  const currentKey = `${employee?.id ?? "novo"}-${open}`;
  if (key !== currentKey) {
    setKey(currentKey);
    setName(employee?.name ?? "");
    setStatus(employee?.status ?? "ativo");
    setHiredOn(employee?.hired_on ?? "");
    setPhone(employee?.phone ?? "");
    setNotes(employee?.notes ?? "");
    if (employee) {
      const links = employeeLinks(data, employee.id);
      setCurrentRoleId(links.find((l) => l.kind === "atual")?.role.id ?? "");
      setTrainingRoleIds(
        links.filter((l) => l.kind === "treinando").map((l) => l.role.id),
      );
    } else {
      setCurrentRoleId(defaultRoleId ?? "");
      setTrainingRoleIds([]);
    }
  }

  const toggleTraining = (roleId: string) => {
    setTrainingRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId],
    );
  };

  const save = async () => {
    if (!name.trim()) return;
    if (employee) {
      await actions.updateEmployee(employee.id, {
        name: name.trim(),
        status,
        hired_on: hiredOn || null,
        phone,
        notes,
      });
      await actions.setCurrentRole(employee.id, currentRoleId || null);
      const existing = employeeLinks(data, employee.id).filter(
        (l) => l.kind === "treinando",
      );
      for (const l of existing) {
        if (!trainingRoleIds.includes(l.role.id)) {
          await actions.removeEmployeeRole(l.linkId);
        }
      }
      for (const roleId of trainingRoleIds) {
        if (roleId === currentRoleId) continue;
        await actions.addTrainingRole(employee.id, roleId);
      }
      onClose();
    } else {
      const created = await actions.createEmployee({
        company_id: companyId,
        name,
        status,
        hired_on: hiredOn || null,
        phone,
        notes,
        role_id: currentRoleId || null,
      });
      if (created) {
        for (const roleId of trainingRoleIds) {
          if (roleId === currentRoleId) continue;
          await actions.addTrainingRole(created.id, roleId);
        }
        onClose();
        router.push(`/empresa/${companyId}/funcionarios/${created.id}`);
      }
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={employee ? "Editar funcionário" : "Novo funcionário"}
      >
        <Field label="Nome">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: William"
            autoFocus
          />
        </Field>

        <Field label="Função atual" hint="A função que ele exerce hoje">
          <Select
            value={currentRoleId}
            onChange={(e) => setCurrentRoleId(e.target.value)}
          >
            <option value="">Sem função definida</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.emoji} {r.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Também está sendo treinado para"
          hint="Marque outras funções que essa pessoa está aprendendo"
        >
          {roles.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma função cadastrada ainda.</p>
          ) : (
            <div className="space-y-1.5">
              {roles
                .filter((r) => r.id !== currentRoleId)
                .map((r) => {
                  const on = trainingRoleIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleTraining(r.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        on
                          ? "border-blue-500/60 bg-blue-500/15"
                          : "border-[var(--line)] bg-white/[0.03]"
                      }`}
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded border-2 text-[10px] ${
                          on ? "border-blue-400 bg-blue-500 text-white" : "border-slate-600"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span className="text-[15px]">
                        {r.emoji} {r.name}
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as Employee["status"])}
            >
              <option value="ativo">Ativo</option>
              <option value="afastado">Afastado</option>
              <option value="inativo">Inativo</option>
            </Select>
          </Field>
          <Field label="Data de entrada">
            <TextInput
              type="date"
              value={hiredOn ?? ""}
              onChange={(e) => setHiredOn(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Telefone" hint="Opcional">
          <TextInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(00) 00000-0000"
            inputMode="tel"
          />
        </Field>

        <Field label="Observações" hint="Opcional">
          <TextArea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Disponibilidade, pontos de atenção…"
          />
        </Field>

        <Button variant="primary" size="lg" full onClick={save} disabled={!name.trim()}>
          Salvar
        </Button>

        {employee && (
          <Button
            variant="ghost"
            full
            className="mt-3 !text-rose-400"
            onClick={() => setConfirmDelete(true)}
          >
            Excluir funcionário
          </Button>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Excluir funcionário?"
        message={`Todo o treinamento registrado de ${employee?.name ?? ""} será apagado. O histórico continua disponível.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (employee) await actions.deleteEmployee(employee.id);
          onClose();
          onDeleted?.();
        }}
      />
    </>
  );
}
