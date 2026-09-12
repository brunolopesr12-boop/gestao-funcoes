import {
  roleCoverage,
  roleProgress,
  sortByPosition,
  type RoleCoverage,
  type RoleProgress,
  type TrainingIndex,
} from "./derive";
import type {
  AppData,
  Employee,
  Process,
  ProcessStatus,
  Role,
  StepKey,
} from "./types";
import { STEPS } from "./types";

/* ------------------------------------------------------------------ */
/* Listas básicas                                                      */
/* ------------------------------------------------------------------ */

export function sortedCompanies(d: AppData) {
  return [...d.companies].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function companyRoles(d: AppData, companyId: string): Role[] {
  return sortByPosition(d.roles.filter((r) => r.company_id === companyId));
}

export function roleProcesses(d: AppData, roleId: string): Process[] {
  return sortByPosition(d.processes.filter((p) => p.role_id === roleId));
}

export function companyEmployees(d: AppData, companyId: string): Employee[] {
  return [...d.employees]
    .filter((e) => e.company_id === companyId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function companyProcesses(d: AppData, companyId: string): Process[] {
  const roleIds = new Set(companyRoles(d, companyId).map((r) => r.id));
  return d.processes
    .filter((p) => roleIds.has(p.role_id))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));
}

/* ------------------------------------------------------------------ */
/* Vínculos funcionário <-> função                                     */
/* ------------------------------------------------------------------ */

export type RoleLink = {
  linkId: string;
  role: Role;
  kind: "atual" | "treinando";
};

export function employeeLinks(d: AppData, employeeId: string): RoleLink[] {
  const links: RoleLink[] = [];
  for (const l of d.employee_roles) {
    if (l.employee_id !== employeeId) continue;
    const role = d.roles.find((r) => r.id === l.role_id);
    if (!role) continue;
    links.push({ linkId: l.id, role, kind: l.kind });
  }
  return links.sort((a, b) =>
    a.kind === b.kind
      ? a.role.name.localeCompare(b.role.name, "pt-BR")
      : a.kind === "atual"
        ? -1
        : 1,
  );
}

export function currentRoleOf(d: AppData, employeeId: string): Role | null {
  return employeeLinks(d, employeeId).find((l) => l.kind === "atual")?.role ?? null;
}

export function roleEmployees(d: AppData, roleId: string): { employee: Employee; kind: "atual" | "treinando" }[] {
  const out: { employee: Employee; kind: "atual" | "treinando" }[] = [];
  for (const l of d.employee_roles) {
    if (l.role_id !== roleId) continue;
    const employee = d.employees.find((e) => e.id === l.employee_id);
    if (!employee) continue;
    out.push({ employee, kind: l.kind });
  }
  return out.sort((a, b) => a.employee.name.localeCompare(b.employee.name, "pt-BR"));
}

/* ------------------------------------------------------------------ */
/* Resumo de um funcionário                                            */
/* ------------------------------------------------------------------ */

export type EmployeeBucket = "apto" | "em_treinamento" | "nao_treinado" | "sem_funcao";

export type EmployeeSummary = {
  employee: Employee;
  links: { link: RoleLink; progress: RoleProgress }[];
  current: { link: RoleLink; progress: RoleProgress } | null;
  /** função usada para exibir o progresso principal */
  focus: { link: RoleLink; progress: RoleProgress } | null;
  pct: number;
  bucket: EmployeeBucket;
};

export function employeeSummary(
  d: AppData,
  index: TrainingIndex,
  employee: Employee,
): EmployeeSummary {
  const links = employeeLinks(d, employee.id).map((link) => ({
    link,
    progress: roleProgress(index, employee.id, roleProcesses(d, link.role.id)),
  }));
  const current = links.find((l) => l.link.kind === "atual") ?? null;
  const focus =
    current ??
    [...links].sort((a, b) => b.progress.pct - a.progress.pct)[0] ??
    null;

  let bucket: EmployeeBucket;
  if (links.length === 0) bucket = "sem_funcao";
  else if (current?.progress.fitness === "apto") bucket = "apto";
  else if (links.some((l) => l.progress.fitness === "apto")) bucket = "apto";
  else if (links.some((l) => l.progress.doneStepCount > 0)) bucket = "em_treinamento";
  else bucket = "nao_treinado";

  return {
    employee,
    links,
    current,
    focus,
    pct: focus?.progress.pct ?? 0,
    bucket,
  };
}

export function companyEmployeeSummaries(
  d: AppData,
  index: TrainingIndex,
  companyId: string,
): EmployeeSummary[] {
  return companyEmployees(d, companyId).map((e) => employeeSummary(d, index, e));
}

/* ------------------------------------------------------------------ */
/* Visão geral da empresa                                              */
/* ------------------------------------------------------------------ */

export type CompanyOverview = {
  roles: { role: Role; coverage: RoleCoverage; processes: Process[] }[];
  employees: EmployeeSummary[];
  aptos: number;
  emTreinamento: number;
  naoTreinados: number;
  semFuncao: number;
  rolesSemFuncionario: Role[];
  rolesSemApto: Role[];
  rolesSemProcesso: Role[];
  pendingProcessCount: number;
};

export function companyOverview(
  d: AppData,
  index: TrainingIndex,
  companyId: string,
): CompanyOverview {
  const roles = companyRoles(d, companyId).map((role) => {
    const processes = roleProcesses(d, role.id);
    const employees = roleEmployees(d, role.id).map((x) => x.employee);
    return { role, coverage: roleCoverage(index, role.id, employees, processes), processes };
  });

  const employees = companyEmployeeSummaries(d, index, companyId);

  const pendingProcessCount = employees.reduce(
    (acc, e) => acc + e.links.reduce((a, l) => a + l.progress.pending.length, 0),
    0,
  );

  return {
    roles,
    employees,
    aptos: employees.filter((e) => e.bucket === "apto").length,
    emTreinamento: employees.filter((e) => e.bucket === "em_treinamento").length,
    naoTreinados: employees.filter((e) => e.bucket === "nao_treinado").length,
    semFuncao: employees.filter((e) => e.bucket === "sem_funcao").length,
    rolesSemFuncionario: roles.filter((r) => r.coverage.all.length === 0).map((r) => r.role),
    rolesSemApto: roles
      .filter((r) => r.coverage.all.length > 0 && r.coverage.apt.length === 0)
      .map((r) => r.role),
    rolesSemProcesso: roles.filter((r) => !r.coverage.hasProcesses).map((r) => r.role),
    pendingProcessCount,
  };
}

/* ------------------------------------------------------------------ */
/* Pendências de treinamento                                           */
/* ------------------------------------------------------------------ */

export type PendingItem = {
  role: Role;
  process: Process;
  status: ProcessStatus;
  missingSteps: StepKey[];
  doneSteps: StepKey[];
};

export type EmployeePendings = {
  employee: Employee;
  items: PendingItem[];
  pct: number;
};

export function pendingsByEmployee(
  d: AppData,
  index: TrainingIndex,
  companyId: string,
): EmployeePendings[] {
  const out: EmployeePendings[] = [];
  for (const summary of companyEmployeeSummaries(d, index, companyId)) {
    const items: PendingItem[] = [];
    for (const { link, progress } of summary.links) {
      for (const p of progress.pending) {
        items.push({
          role: link.role,
          process: p.process,
          status: p.status,
          missingSteps: p.missingSteps,
          doneSteps: p.doneSteps,
        });
      }
    }
    if (items.length === 0) continue;
    // em treinamento primeiro (mais perto de terminar), depois não iniciados
    items.sort((a, b) => b.doneSteps.length - a.doneSteps.length);
    out.push({ employee: summary.employee, items, pct: summary.pct });
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}

/* ------------------------------------------------------------------ */
/* "Quem sabe fazer isso?"                                             */
/* ------------------------------------------------------------------ */

export type KnowledgeRow = {
  employee: Employee;
  status: ProcessStatus;
  doneSteps: StepKey[];
  linked: boolean;
};

const STATUS_ORDER: Record<ProcessStatus, number> = {
  certificado: 0,
  em_treinamento: 1,
  nao_iniciado: 2,
};

export function processKnowledge(
  d: AppData,
  index: TrainingIndex,
  companyId: string,
  processId: string,
): KnowledgeRow[] {
  const process = d.processes.find((p) => p.id === processId);
  const linkedIds = new Set(
    process ? roleEmployees(d, process.role_id).map((x) => x.employee.id) : [],
  );
  return companyEmployees(d, companyId)
    .map((employee) => {
      const map = index.get(`${employee.id}::${processId}`) ?? {};
      const doneSteps = STEPS.filter((s) => Boolean(map[s]));
      const status: ProcessStatus =
        doneSteps.length === STEPS.length
          ? "certificado"
          : doneSteps.length > 0
            ? "em_treinamento"
            : "nao_iniciado";
      return { employee, status, doneSteps, linked: linkedIds.has(employee.id) };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        Number(b.linked) - Number(a.linked) ||
        a.employee.name.localeCompare(b.employee.name, "pt-BR"),
    );
}

/* ------------------------------------------------------------------ */
/* Treinamentos parados                                                */
/* ------------------------------------------------------------------ */

export type StalledTraining = {
  employee: Employee;
  role: Role;
  process: Process;
  lastAt: string;
  days: number;
  doneSteps: StepKey[];
};

export function stalledTrainings(
  d: AppData,
  index: TrainingIndex,
  companyId: string,
  thresholdDays = 14,
): StalledTraining[] {
  const out: StalledTraining[] = [];
  const now = Date.now();
  for (const employee of companyEmployees(d, companyId)) {
    for (const link of employeeLinks(d, employee.id)) {
      for (const process of roleProcesses(d, link.role.id)) {
        const map = index.get(`${employee.id}::${process.id}`) ?? {};
        const done = STEPS.filter((s) => Boolean(map[s]));
        if (done.length === 0 || done.length === STEPS.length) continue;
        const lastAt = done
          .map((s) => map[s]!.done_at)
          .sort()
          .at(-1)!;
        const days = Math.floor((now - new Date(lastAt).getTime()) / 86_400_000);
        if (days >= thresholdDays) {
          out.push({ employee, role: link.role, process, lastAt, days, doneSteps: done });
        }
      }
    }
  }
  return out.sort((a, b) => b.days - a.days);
}
