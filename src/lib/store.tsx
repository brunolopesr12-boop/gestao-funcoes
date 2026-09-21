"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  buildTrainingIndex,
  nextPosition,
  type TrainingIndex,
} from "./derive";
import type {
  ActivityLog,
  AppData,
  ChecklistItem,
  Company,
  Competency,
  Employee,
  EmployeeRole,
  Process,
  Role,
  StepKey,
  TrainingEvent,
  TrainingStep,
} from "./types";

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

type Data = AppData;

const TABLES = [
  "companies",
  "roles",
  "competencies",
  "checklist_items",
  "processes",
  "employees",
  "employee_roles",
  "training_steps",
  "training_events",
  "activity_log",
  "kb_articles",
] as const;

type TableName = (typeof TABLES)[number];

const EMPTY: Data = {
  companies: [],
  roles: [],
  competencies: [],
  checklist_items: [],
  processes: [],
  employees: [],
  employee_roles: [],
  training_steps: [],
  training_events: [],
  activity_log: [],
  kb_articles: [],
};

type Toast = { id: string; text: string; kind: "ok" | "erro" };

type Ctx = {
  data: Data;
  loading: boolean;
  error: string | null;
  live: boolean;
  trainingIndex: TrainingIndex;
  trainer: string;
  setTrainer: (name: string) => void;
  refresh: () => Promise<void>;
  toasts: Toast[];
  notify: (text: string, kind?: "ok" | "erro") => void;
  actions: Actions;
};

const DataContext = createContext<Ctx | null>(null);

export function useData(): Ctx {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData precisa estar dentro de <DataProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback (ambientes sem crypto.randomUUID)
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) return [...list, row];
  const copy = [...list];
  copy[i] = row;
  return copy;
}

const TRAINER_STORAGE_KEY = "gf.trainer";

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [trainer, setTrainerState] = useState("");
  const dataRef = useRef(data);
  dataRef.current = data;
  const trainerRef = useRef(trainer);
  trainerRef.current = trainer;

  const notify = useCallback((text: string, kind: "ok" | "erro" = "ok") => {
    const id = newId();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const setTrainer = useCallback((name: string) => {
    setTrainerState(name);
    try {
      window.localStorage.setItem(TRAINER_STORAGE_KEY, name);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    try {
      setTrainerState(window.localStorage.getItem(TRAINER_STORAGE_KEY) ?? "");
    } catch {
      /* ignora */
    }
  }, []);

  /* ----------------------- carga inicial ---------------------------- */
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const sb = supabase();
      const results = await Promise.all(
        TABLES.map(async (table) => {
          let query = sb.from(table).select("*");
          if (table === "training_events" || table === "activity_log") {
            query = query.order("created_at", { ascending: false }).limit(500);
          }
          const { data: rows, error: err } = await query;
          if (err) throw new Error(`${table}: ${err.message}`);
          return [table, rows ?? []] as const;
        }),
      );
      const next = { ...EMPTY };
      for (const [table, rows] of results) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (next as any)[table] = rows;
      }
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ----------------------- realtime --------------------------------- */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = supabase();

    const handle = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const table = payload.table as TableName;
      if (!TABLES.includes(table)) return;
      setData((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = (prev as any)[table] as { id: string }[];
        if (!list) return prev;
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string } | null)?.id;
          if (!oldId) return prev;
          return { ...prev, [table]: list.filter((r) => r.id !== oldId) };
        }
        const row = payload.new as { id?: string };
        if (!row?.id) return prev;
        return {
          ...prev,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          [table]: upsertById(list, row as any),
        };
      });
    };

    const channel = sb
      .channel("gestao-funcoes-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        handle as (payload: unknown) => void,
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLive(false);
        }
      });

    return () => {
      void sb.removeChannel(channel);
    };
  }, []);

  /* ------- ressincroniza ao voltar para a aba / reconectar ---------- */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [refresh]);

  /* ----------------------- mutações --------------------------------- */

  const applyLocal = useCallback(
    <K extends TableName>(table: K, row: Data[K][number]) => {
      setData((prev) => ({
        ...prev,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [table]: upsertById(prev[table] as any, row as any),
      }));
    },
    [],
  );

  const removeLocal = useCallback((table: TableName, id: string) => {
    setData((prev) => ({
      ...prev,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [table]: (prev[table] as any[]).filter((r) => r.id !== id),
    }));
  }, []);

  const actions = useMemo(
    () =>
      createActions({
        getData: () => dataRef.current,
        applyLocal,
        removeLocal,
        notify,
        getTrainer: () => trainerRef.current,
        refresh,
      }),
    [applyLocal, removeLocal, notify, refresh],
  );

  const trainingIndex = useMemo(
    () => buildTrainingIndex(data.training_steps),
    [data.training_steps],
  );

  const value: Ctx = {
    data,
    loading,
    error,
    live,
    trainingIndex,
    trainer,
    setTrainer,
    refresh,
    toasts,
    notify,
    actions,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/* ------------------------------------------------------------------ */
/* Ações (escrita)                                                     */
/* ------------------------------------------------------------------ */

type ActionDeps = {
  getData: () => Data;
  applyLocal: <K extends TableName>(table: K, row: Data[K][number]) => void;
  removeLocal: (table: TableName, id: string) => void;
  notify: (text: string, kind?: "ok" | "erro") => void;
  getTrainer: () => string;
  refresh: () => Promise<void>;
};

export type Actions = ReturnType<typeof createActions>;

function createActions(deps: ActionDeps) {
  const { getData, applyLocal, removeLocal, notify, getTrainer, refresh } = deps;

  async function insert<K extends TableName>(
    table: K,
    row: Data[K][number],
  ): Promise<boolean> {
    applyLocal(table, row);
    const { error } = await supabase().from(table).insert(row);
    if (error) {
      removeLocal(table, (row as { id: string }).id);
      notify(`Erro ao salvar: ${error.message}`, "erro");
      return false;
    }
    return true;
  }

  async function update<K extends TableName>(
    table: K,
    id: string,
    patch: Partial<Data[K][number]>,
  ): Promise<boolean> {
    const before = (getData()[table] as { id: string }[]).find((r) => r.id === id);
    if (before) applyLocal(table, { ...before, ...patch } as Data[K][number]);
    const { error } = await supabase().from(table).update(patch as never).eq("id", id);
    if (error) {
      if (before) applyLocal(table, before as Data[K][number]);
      notify(`Erro ao salvar: ${error.message}`, "erro");
      return false;
    }
    return true;
  }

  async function remove(table: TableName, id: string): Promise<boolean> {
    const before = (getData()[table] as { id: string }[]).find((r) => r.id === id);
    removeLocal(table, id);
    const { error } = await supabase().from(table).delete().eq("id", id);
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (before) applyLocal(table, before as any);
      notify(`Erro ao excluir: ${error.message}`, "erro");
      return false;
    }
    return true;
  }

  async function log(entry: {
    company_id: string | null;
    entity: string;
    entity_name: string;
    action: string;
    detail?: string;
  }) {
    const row: ActivityLog = {
      id: newId(),
      company_id: entry.company_id,
      entity: entry.entity,
      entity_name: entry.entity_name,
      action: entry.action,
      detail: entry.detail ?? "",
      actor: getTrainer() || "",
      created_at: new Date().toISOString(),
    };
    await insert("activity_log", row);
  }

  const now = () => new Date().toISOString();

  /* ------------------------------ empresas ------------------------- */
  return {
    async createCompany(input: { name: string; emoji: string; color: string; notes?: string }) {
      const row: Company = {
        id: newId(),
        name: input.name.trim(),
        emoji: input.emoji || "🏢",
        color: input.color || "#2563eb",
        notes: input.notes ?? "",
        active: true,
        position: nextPosition(getData().companies),
        created_at: now(),
        updated_at: now(),
      };
      const ok = await insert("companies", row);
      if (ok) {
        await log({ company_id: row.id, entity: "empresa", entity_name: row.name, action: "criou" });
        notify("Empresa criada");
      }
      return ok ? row : null;
    },

    async updateCompany(id: string, patch: Partial<Company>) {
      const ok = await update("companies", id, patch);
      if (ok) {
        const c = getData().companies.find((x) => x.id === id);
        await log({ company_id: id, entity: "empresa", entity_name: c?.name ?? "", action: "editou" });
        notify("Empresa atualizada");
      }
      return ok;
    },

    async deleteCompany(id: string) {
      const c = getData().companies.find((x) => x.id === id);
      const ok = await remove("companies", id);
      if (ok) {
        await refresh();
        await log({ company_id: null, entity: "empresa", entity_name: c?.name ?? "", action: "excluiu" });
        notify("Empresa excluída");
      }
      return ok;
    },

    /* ------------------------------ funções ------------------------- */
    async createRole(input: {
      company_id: string;
      name: string;
      emoji?: string;
      description?: string;
      responsibilities?: string;
    }) {
      const siblings = getData().roles.filter((r) => r.company_id === input.company_id);
      const row: Role = {
        id: newId(),
        company_id: input.company_id,
        name: input.name.trim(),
        description: input.description ?? "",
        responsibilities: input.responsibilities ?? "",
        emoji: input.emoji || "🧩",
        position: nextPosition(siblings),
        active: true,
        created_at: now(),
        updated_at: now(),
      };
      const ok = await insert("roles", row);
      if (ok) {
        await log({ company_id: row.company_id, entity: "função", entity_name: row.name, action: "criou" });
        notify("Função criada");
      }
      return ok ? row : null;
    },

    async updateRole(id: string, patch: Partial<Role>) {
      const before = getData().roles.find((r) => r.id === id);
      const ok = await update("roles", id, patch);
      if (ok && before) {
        await log({ company_id: before.company_id, entity: "função", entity_name: patch.name ?? before.name, action: "editou" });
        notify("Função atualizada");
      }
      return ok;
    },

    async deleteRole(id: string) {
      const before = getData().roles.find((r) => r.id === id);
      const ok = await remove("roles", id);
      if (ok && before) {
        await refresh();
        await log({ company_id: before.company_id, entity: "função", entity_name: before.name, action: "excluiu" });
        notify("Função excluída");
      }
      return ok;
    },

    async moveRole(id: string, direction: -1 | 1) {
      const d = getData();
      const role = d.roles.find((r) => r.id === id);
      if (!role) return false;
      const siblings = d.roles
        .filter((r) => r.company_id === role.company_id)
        .sort((a, b) => a.position - b.position);
      const i = siblings.findIndex((r) => r.id === id);
      const j = i + direction;
      if (j < 0 || j >= siblings.length) return false;
      const other = siblings[j];
      await update("roles", role.id, { position: other.position });
      await update("roles", other.id, { position: role.position });
      return true;
    },

    /* --------------------------- competências ----------------------- */
    async addCompetency(role_id: string, name: string) {
      const siblings = getData().competencies.filter((c) => c.role_id === role_id);
      const row: Competency = {
        id: newId(),
        role_id,
        name: name.trim(),
        position: nextPosition(siblings),
        created_at: now(),
      };
      return (await insert("competencies", row)) ? row : null;
    },
    async updateCompetency(id: string, name: string) {
      return update("competencies", id, { name: name.trim() });
    },
    async deleteCompetency(id: string) {
      return remove("competencies", id);
    },

    /* ---------------------------- checklist ------------------------- */
    async addChecklistItem(role_id: string, text: string) {
      const siblings = getData().checklist_items.filter((c) => c.role_id === role_id);
      const row: ChecklistItem = {
        id: newId(),
        role_id,
        text: text.trim(),
        position: nextPosition(siblings),
        created_at: now(),
      };
      return (await insert("checklist_items", row)) ? row : null;
    },
    async updateChecklistItem(id: string, text: string) {
      return update("checklist_items", id, { text: text.trim() });
    },
    async deleteChecklistItem(id: string) {
      return remove("checklist_items", id);
    },

    /* ---------------------------- processos ------------------------- */
    async createProcess(input: {
      role_id: string;
      name: string;
      description?: string;
      required?: boolean;
    }) {
      const d = getData();
      const siblings = d.processes.filter((p) => p.role_id === input.role_id);
      const role = d.roles.find((r) => r.id === input.role_id);
      const row: Process = {
        id: newId(),
        role_id: input.role_id,
        name: input.name.trim(),
        description: input.description ?? "",
        required: input.required ?? true,
        position: nextPosition(siblings),
        created_at: now(),
        updated_at: now(),
      };
      const ok = await insert("processes", row);
      if (ok) {
        await log({
          company_id: role?.company_id ?? null,
          entity: "processo",
          entity_name: row.name,
          action: "criou",
          detail: role ? `função ${role.name}` : "",
        });
      }
      return ok ? row : null;
    },

    async updateProcess(id: string, patch: Partial<Process>) {
      const d = getData();
      const before = d.processes.find((p) => p.id === id);
      const ok = await update("processes", id, patch);
      if (ok && before) {
        const role = d.roles.find((r) => r.id === before.role_id);
        await log({
          company_id: role?.company_id ?? null,
          entity: "processo",
          entity_name: patch.name ?? before.name,
          action: "editou",
        });
      }
      return ok;
    },

    async deleteProcess(id: string) {
      const d = getData();
      const before = d.processes.find((p) => p.id === id);
      const ok = await remove("processes", id);
      if (ok && before) {
        const role = d.roles.find((r) => r.id === before.role_id);
        await log({
          company_id: role?.company_id ?? null,
          entity: "processo",
          entity_name: before.name,
          action: "excluiu",
        });
      }
      return ok;
    },

    async moveProcess(id: string, direction: -1 | 1) {
      const d = getData();
      const proc = d.processes.find((p) => p.id === id);
      if (!proc) return false;
      const siblings = d.processes
        .filter((p) => p.role_id === proc.role_id)
        .sort((a, b) => a.position - b.position);
      const i = siblings.findIndex((p) => p.id === id);
      const j = i + direction;
      if (j < 0 || j >= siblings.length) return false;
      const other = siblings[j];
      await update("processes", proc.id, { position: other.position });
      await update("processes", other.id, { position: proc.position });
      return true;
    },

    /* --------------------------- funcionários ------------------------ */
    async createEmployee(input: {
      company_id: string;
      name: string;
      status?: Employee["status"];
      hired_on?: string | null;
      phone?: string;
      notes?: string;
      role_id?: string | null;
    }) {
      const row: Employee = {
        id: newId(),
        company_id: input.company_id,
        name: input.name.trim(),
        status: input.status ?? "ativo",
        hired_on: input.hired_on || null,
        phone: input.phone ?? "",
        notes: input.notes ?? "",
        created_at: now(),
        updated_at: now(),
      };
      const ok = await insert("employees", row);
      if (!ok) return null;
      if (input.role_id) {
        await insert("employee_roles", {
          id: newId(),
          employee_id: row.id,
          role_id: input.role_id,
          kind: "atual",
          created_at: now(),
        });
      }
      await log({ company_id: row.company_id, entity: "funcionário", entity_name: row.name, action: "criou" });
      notify("Funcionário cadastrado");
      return row;
    },

    async updateEmployee(id: string, patch: Partial<Employee>) {
      const before = getData().employees.find((e) => e.id === id);
      const ok = await update("employees", id, patch);
      if (ok && before) {
        await log({ company_id: before.company_id, entity: "funcionário", entity_name: patch.name ?? before.name, action: "editou" });
        notify("Funcionário atualizado");
      }
      return ok;
    },

    async deleteEmployee(id: string) {
      const before = getData().employees.find((e) => e.id === id);
      const ok = await remove("employees", id);
      if (ok && before) {
        await refresh();
        await log({ company_id: before.company_id, entity: "funcionário", entity_name: before.name, action: "excluiu" });
        notify("Funcionário excluído");
      }
      return ok;
    },

    /** Define a função ATUAL do funcionário (no máximo uma). */
    async setCurrentRole(employee_id: string, role_id: string | null) {
      const d = getData();
      const links = d.employee_roles.filter((l) => l.employee_id === employee_id);
      const current = links.find((l) => l.kind === "atual");

      if (current && current.role_id !== role_id) {
        await remove("employee_roles", current.id);
      }
      if (!role_id) return true;

      const existing = d.employee_roles.find(
        (l) => l.employee_id === employee_id && l.role_id === role_id,
      );
      if (existing) {
        if (existing.kind !== "atual") {
          await update("employee_roles", existing.id, { kind: "atual" });
        }
        return true;
      }
      return insert("employee_roles", {
        id: newId(),
        employee_id,
        role_id,
        kind: "atual",
        created_at: now(),
      });
    },

    /** Adiciona uma função de treinamento (além da atual). */
    async addTrainingRole(employee_id: string, role_id: string) {
      const exists = getData().employee_roles.find(
        (l) => l.employee_id === employee_id && l.role_id === role_id,
      );
      if (exists) return true;
      return insert("employee_roles", {
        id: newId(),
        employee_id,
        role_id,
        kind: "treinando",
        created_at: now(),
      });
    },

    async removeEmployeeRole(link_id: string) {
      return remove("employee_roles", link_id);
    },

    /* --------------------------- treinamento ------------------------- */
    /**
     * Marca ou desmarca uma etapa. Registra data/hora, responsável e
     * observação, e grava o histórico.
     */
    async toggleStep(args: {
      employee_id: string;
      process_id: string;
      step: StepKey;
      on: boolean;
      trainer?: string;
      notes?: string;
    }) {
      const d = getData();
      const employee = d.employees.find((e) => e.id === args.employee_id);
      const process = d.processes.find((p) => p.id === args.process_id);
      const role = process ? d.roles.find((r) => r.id === process.role_id) : undefined;
      const existing = d.training_steps.find(
        (s) =>
          s.employee_id === args.employee_id &&
          s.process_id === args.process_id &&
          s.step === args.step,
      );

      if (args.on) {
        if (existing) return true;
        const row: TrainingStep = {
          id: newId(),
          employee_id: args.employee_id,
          process_id: args.process_id,
          step: args.step,
          done_at: now(),
          trainer: (args.trainer ?? getTrainer() ?? "").trim(),
          notes: args.notes ?? "",
          created_at: now(),
        };
        const ok = await insert("training_steps", row);
        if (!ok) return false;
        await insert("training_events", {
          id: newId(),
          company_id: employee?.company_id ?? null,
          employee_id: args.employee_id,
          process_id: args.process_id,
          employee_name: employee?.name ?? "",
          process_name: process?.name ?? "",
          role_name: role?.name ?? "",
          step: args.step,
          action: "marcou",
          trainer: row.trainer,
          notes: row.notes,
          created_at: now(),
        });
        return true;
      }

      if (!existing) return true;
      const ok = await remove("training_steps", existing.id);
      if (!ok) return false;
      await insert("training_events", {
        id: newId(),
        company_id: employee?.company_id ?? null,
        employee_id: args.employee_id,
        process_id: args.process_id,
        employee_name: employee?.name ?? "",
        process_name: process?.name ?? "",
        role_name: role?.name ?? "",
        step: args.step,
        action: "desmarcou",
        trainer: (args.trainer ?? getTrainer() ?? "").trim(),
        notes: args.notes ?? "",
        created_at: now(),
      });
      return true;
    },

    async updateStepNotes(step_id: string, notes: string) {
      return update("training_steps", step_id, { notes });
    },
  };
}
