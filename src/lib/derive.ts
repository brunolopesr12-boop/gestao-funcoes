import {
  STEPS,
  type Employee,
  type Fitness,
  type Process,
  type ProcessStatus,
  type StepKey,
  type TrainingStep,
} from "./types";

/* ------------------------------------------------------------------ */
/* Índice de treinamento                                               */
/* ------------------------------------------------------------------ */

export type StepMap = Partial<Record<StepKey, TrainingStep>>;
/** chave: `${employee_id}::${process_id}` */
export type TrainingIndex = Map<string, StepMap>;

export function trainingKey(employeeId: string, processId: string): string {
  return `${employeeId}::${processId}`;
}

export function buildTrainingIndex(steps: TrainingStep[]): TrainingIndex {
  const index: TrainingIndex = new Map();
  for (const s of steps) {
    const key = trainingKey(s.employee_id, s.process_id);
    let bucket = index.get(key);
    if (!bucket) {
      bucket = {};
      index.set(key, bucket);
    }
    bucket[s.step] = s;
  }
  return index;
}

export function stepsFor(
  index: TrainingIndex,
  employeeId: string,
  processId: string,
): StepMap {
  return index.get(trainingKey(employeeId, processId)) ?? {};
}

export function isStepDone(
  index: TrainingIndex,
  employeeId: string,
  processId: string,
  step: StepKey,
): boolean {
  return Boolean(stepsFor(index, employeeId, processId)[step]);
}

/* ------------------------------------------------------------------ */
/* Status de um processo                                               */
/* ------------------------------------------------------------------ */

export function statusFromStepMap(map: StepMap): ProcessStatus {
  const done = STEPS.filter((s) => Boolean(map[s])).length;
  if (done === 0) return "nao_iniciado";
  if (done === STEPS.length) return "certificado";
  return "em_treinamento";
}

export function processStatus(
  index: TrainingIndex,
  employeeId: string,
  processId: string,
): ProcessStatus {
  return statusFromStepMap(stepsFor(index, employeeId, processId));
}

/* ------------------------------------------------------------------ */
/* Progresso de um funcionário em uma função                           */
/* ------------------------------------------------------------------ */

export type ProcessProgress = {
  process: Process;
  status: ProcessStatus;
  doneSteps: StepKey[];
  missingSteps: StepKey[];
  stepMap: StepMap;
};

export type RoleProgress = {
  /** processos obrigatórios (contam para a aptidão) */
  required: ProcessProgress[];
  /** processos opcionais (não bloqueiam a aptidão) */
  optional: ProcessProgress[];
  /** todos, na ordem de exibição */
  all: ProcessProgress[];
  doneStepCount: number;
  totalStepCount: number;
  /** 0-100, calculado apenas sobre os processos obrigatórios */
  pct: number;
  certifiedCount: number;
  requiredCount: number;
  fitness: Fitness;
  /** o que ainda falta para ficar apto */
  pending: ProcessProgress[];
};

function progressForProcess(
  index: TrainingIndex,
  employeeId: string,
  process: Process,
): ProcessProgress {
  const stepMap = stepsFor(index, employeeId, process.id);
  const doneSteps = STEPS.filter((s) => Boolean(stepMap[s]));
  const missingSteps = STEPS.filter((s) => !stepMap[s]);
  return {
    process,
    status: statusFromStepMap(stepMap),
    doneSteps,
    missingSteps,
    stepMap,
  };
}

export function roleProgress(
  index: TrainingIndex,
  employeeId: string,
  processes: Process[],
): RoleProgress {
  const all = sortByPosition(processes).map((p) =>
    progressForProcess(index, employeeId, p),
  );
  const required = all.filter((p) => p.process.required);
  const optional = all.filter((p) => !p.process.required);

  const totalStepCount = required.length * STEPS.length;
  const doneStepCount = required.reduce((acc, p) => acc + p.doneSteps.length, 0);
  const certifiedCount = required.filter((p) => p.status === "certificado").length;
  const pct =
    totalStepCount === 0 ? 0 : Math.round((doneStepCount / totalStepCount) * 100);

  let fitness: Fitness;
  if (required.length === 0) fitness = "sem_processos";
  else if (certifiedCount === required.length) fitness = "apto";
  else if (doneStepCount > 0) fitness = "em_treinamento";
  else fitness = "nao_treinado";

  return {
    required,
    optional,
    all,
    doneStepCount,
    totalStepCount,
    pct,
    certifiedCount,
    requiredCount: required.length,
    fitness,
    pending: required.filter((p) => p.status !== "certificado"),
  };
}

/* ------------------------------------------------------------------ */
/* Cobertura de uma função                                             */
/* ------------------------------------------------------------------ */

export type RoleCoverage = {
  roleId: string;
  apt: { employee: Employee; progress: RoleProgress }[];
  training: { employee: Employee; progress: RoleProgress }[];
  untrained: { employee: Employee; progress: RoleProgress }[];
  all: { employee: Employee; progress: RoleProgress }[];
  hasProcesses: boolean;
  /** risco operacional da função */
  risk: "ok" | "atencao" | "critico";
};

export function roleCoverage(
  index: TrainingIndex,
  roleId: string,
  employees: Employee[],
  processes: Process[],
): RoleCoverage {
  const all = employees.map((employee) => ({
    employee,
    progress: roleProgress(index, employee.id, processes),
  }));
  const apt = all.filter((x) => x.progress.fitness === "apto");
  const training = all.filter((x) => x.progress.fitness === "em_treinamento");
  const untrained = all.filter(
    (x) => x.progress.fitness === "nao_treinado" || x.progress.fitness === "sem_processos",
  );

  let risk: RoleCoverage["risk"];
  if (apt.length >= 2) risk = "ok";
  else if (apt.length === 1) risk = "atencao";
  else risk = "critico";

  return {
    roleId,
    apt,
    training,
    untrained,
    all,
    hasProcesses: processes.some((p) => p.required),
    risk,
  };
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

export function sortByPosition<T extends { position: number; name?: string; text?: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    const an = (a.name ?? a.text ?? "").toLowerCase();
    const bn = (b.name ?? b.text ?? "").toLowerCase();
    return an.localeCompare(bn, "pt-BR");
  });
}

export function nextPosition(items: { position: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.position), -1) + 1;
}
