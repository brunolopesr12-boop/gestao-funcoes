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
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { buildAlerts, buildChecklist } from "./alerts";
import { rowToOrder, settingsFromRow, type KdsOrderRow } from "./row";
import {
  DEFAULT_SETTINGS,
  type KdsAlert,
  type KdsChecklistItem,
  type KdsOrder,
  type KdsSettings,
  type KdsStage,
} from "./types";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type KdsCard = {
  order: KdsOrder;
  row: KdsOrderRow;
  alerts: KdsAlert[];
  checklist: KdsChecklistItem[];
  /** Alertas que exigem conferência antes do despacho. */
  blocking: KdsAlert[];
  conferido: boolean;
};

export type KdsConnection = {
  configurado: boolean;
  conectado: boolean;
  mensagem: string;
  falta: string[];
  ultimoPolling: string | null;
  banco: boolean;
};

export type KdsAction =
  | "aceitar"
  | "produzir"
  | "pronto"
  | "conferir"
  | "despachar"
  | "ocultar";

type Toast = { id: string; text: string; kind: "ok" | "erro" | "aviso" };

type Ctx = {
  cards: KdsCard[];
  byStage: Record<KdsStage, KdsCard[]>;
  settings: KdsSettings;
  loading: boolean;
  error: string | null;
  live: boolean;
  connection: KdsConnection;
  busy: string | null;
  toasts: Toast[];
  operator: string;
  setOperator: (v: string) => void;
  soundOn: boolean;
  toggleSound: () => Promise<void>;
  act: (
    id: string,
    action: KdsAction,
    extra?: { conferencia?: string[]; forcar?: boolean },
  ) => Promise<boolean>;
  saveSettings: (patch: {
    late_minutes?: number;
    sound?: boolean;
    auto_confirm?: boolean;
  }) => Promise<void>;
  createTestOrder: (tipo: string) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (text: string, kind?: Toast["kind"]) => void;
};

const KdsContext = createContext<Ctx | null>(null);

export function useKds(): Ctx {
  const ctx = useContext(KdsContext);
  if (!ctx) throw new Error("useKds precisa estar dentro de <KdsProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Som do pedido novo                                                  */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null;

async function ensureAudio(): Promise<boolean> {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return false;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    return audioCtx.state === "running";
  } catch {
    return false;
  }
}

function beep(): void {
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime;
  for (const [i, freq] of [880, 1175, 880].entries()) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + i * 0.18);
    osc.stop(t0 + i * 0.18 + 0.18);
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

const OPERATOR_KEY = "kds.operador";
const SOUND_KEY = "kds.som";
const POLL_MS = 30_000;
/** Pedidos mais antigos que isso somem da tela. */
const JANELA_HORAS = 18;

function emptyByStage(): Record<KdsStage, KdsCard[]> {
  return { novo: [], producao: [], pronto: [], despachado: [], cancelado: [] };
}

export function KdsProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<KdsOrderRow[]>([]);
  const [settings, setSettings] = useState<KdsSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [operator, setOperatorState] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [connection, setConnection] = useState<KdsConnection>({
    configurado: false,
    conectado: false,
    mensagem: "Verificando integração…",
    falta: [],
    ultimoPolling: null,
    banco: true,
  });

  const knownIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const soundRef = useRef(false);
  soundRef.current = soundOn;

  const notify = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const setOperator = useCallback((v: string) => {
    setOperatorState(v);
    try {
      window.localStorage.setItem(OPERATOR_KEY, v);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    try {
      setOperatorState(window.localStorage.getItem(OPERATOR_KEY) ?? "");
      if (window.localStorage.getItem(SOUND_KEY) === "1") {
        void ensureAudio().then((ok) => setSoundOn(ok));
      }
    } catch {
      /* ignora */
    }
  }, []);

  const toggleSound = useCallback(async () => {
    if (soundOn) {
      setSoundOn(false);
      try {
        window.localStorage.setItem(SOUND_KEY, "0");
      } catch {
        /* ignora */
      }
      return;
    }
    const ok = await ensureAudio();
    setSoundOn(ok);
    if (ok) beep();
    try {
      window.localStorage.setItem(SOUND_KEY, ok ? "1" : "0");
    } catch {
      /* ignora */
    }
    if (!ok) notify("Seu navegador bloqueou o som.", "aviso");
  }, [soundOn, notify]);

  /* ------------------------- carga ------------------------------- */
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError("Banco de dados não configurado.");
      return;
    }
    try {
      const sb = supabase();
      const desde = new Date(Date.now() - JANELA_HORAS * 3600_000).toISOString();
      const [ordersRes, settingsRes] = await Promise.all([
        sb
          .from("kds_orders")
          .select("*")
          .is("hidden_at", null)
          .gte("placed_at", desde)
          .order("placed_at", { ascending: true }),
        sb.from("kds_settings").select("*").eq("id", "default").maybeSingle(),
      ]);
      if (ordersRes.error) throw new Error(ordersRes.error.message);
      setRows((ordersRes.data ?? []) as KdsOrderRow[]);
      if (!settingsRes.error) setSettings(settingsFromRow(settingsRes.data));
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

  /* ------------------------- realtime ---------------------------- */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = supabase();
    const channel = sb
      .channel("kds-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kds_orders" },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === "DELETE") {
              const id = (payload.old as { id?: string } | null)?.id;
              return id ? prev.filter((r) => r.id !== id) : prev;
            }
            const row = payload.new as KdsOrderRow;
            if (!row?.id) return prev;
            if (row.hidden_at) return prev.filter((r) => r.id !== row.id);
            const i = prev.findIndex((r) => r.id === row.id);
            if (i === -1) return [...prev, row];
            const copy = [...prev];
            copy[i] = row;
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kds_settings" },
        (payload) => setSettings(settingsFromRow(payload.new as never)),
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void sb.removeChannel(channel);
    };
  }, []);

  /* --------- ressincroniza ao voltar/reconectar ------------------ */
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
    };
  }, [refresh]);

  /* ------------------------- polling iFood ------------------------ */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch("/api/ifood/poll", {
          method: "POST",
          cache: "no-store",
        });
        const json = (await res.json()) as {
          ok: boolean;
          conectado: boolean;
          configurado: boolean;
          mensagem: string;
          novos: number;
          cancelados: number;
          ultimo_polling?: string | null;
        };
        if (cancelled) return;
        setConnection((prev) => ({
          ...prev,
          configurado: json.configurado,
          conectado: json.conectado,
          mensagem: json.mensagem ?? "",
          ultimoPolling: json.ultimo_polling ?? new Date().toISOString(),
        }));
        if (json.novos > 0 || json.cancelados > 0) void refresh();
      } catch {
        if (!cancelled) {
          setConnection((prev) => ({
            ...prev,
            conectado: false,
            mensagem: "Sem resposta do servidor. Tentando de novo…",
          }));
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };

    // Status inicial (rápido) e depois o ciclo de polling.
    void fetch("/api/ifood/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: Record<string, unknown>) => {
        if (cancelled) return;
        setConnection({
          configurado: Boolean(s.configurado),
          conectado: Boolean(s.conectado),
          mensagem: String(s.mensagem ?? s.erro ?? ""),
          falta: Array.isArray(s.falta) ? (s.falta as string[]) : [],
          ultimoPolling: (s.ultimo_polling as string | null) ?? null,
          banco: Boolean(s.banco),
        });
      })
      .catch(() => undefined);

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  /* ------------------------- cartões ------------------------------ */
  const cards = useMemo<KdsCard[]>(() => {
    return rows
      .map((row) => {
        const order = rowToOrder(row);
        const alerts = buildAlerts(order, settings);
        const checklist = buildChecklist(order, alerts);
        return {
          row,
          order,
          alerts,
          checklist,
          blocking: alerts.filter((a) => a.blocking),
          conferido: Boolean(row.checked_at),
        };
      })
      .sort(
        (a, b) =>
          new Date(a.order.placedAt).getTime() - new Date(b.order.placedAt).getTime(),
      );
  }, [rows, settings]);

  const byStage = useMemo(() => {
    const out = emptyByStage();
    for (const card of cards) out[card.order.stage].push(card);
    // Despachados e cancelados: os mais recentes primeiro.
    out.despachado.reverse();
    out.cancelado.reverse();
    return out;
  }, [cards]);

  /* --------------- aviso sonoro de pedido novo -------------------- */
  useEffect(() => {
    const atuais = new Set(rows.map((r) => r.id));
    if (firstLoad.current) {
      knownIds.current = atuais;
      firstLoad.current = false;
      return;
    }
    const novos = rows.filter(
      (r) => !knownIds.current.has(r.id) && r.stage === "novo",
    );
    knownIds.current = atuais;
    if (novos.length > 0) {
      if (soundRef.current) beep();
      notify(
        novos.length === 1
          ? `Pedido novo #${novos[0].display_id}`
          : `${novos.length} pedidos novos`,
      );
    }
  }, [rows, notify]);

  /* ------------------------- ações -------------------------------- */
  const act = useCallback<Ctx["act"]>(
    async (id, action, extra) => {
      setBusy(id);
      try {
        const res = await fetch(`/api/kds/orders/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acao: action,
            operador: operator,
            conferencia: extra?.conferencia,
            forcar: extra?.forcar ?? false,
          }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          pedido?: KdsOrderRow;
          erro?: string;
          detalhe?: string;
          aviso?: string;
        };
        if (!res.ok || !json.ok) {
          notify(json.erro ?? `Erro ${res.status}`, "erro");
          return false;
        }
        if (json.pedido) {
          const row = json.pedido;
          setRows((prev) => {
            if (row.hidden_at) return prev.filter((r) => r.id !== row.id);
            const i = prev.findIndex((r) => r.id === row.id);
            if (i === -1) return [...prev, row];
            const copy = [...prev];
            copy[i] = row;
            return copy;
          });
        }
        if (json.aviso) notify(json.aviso, "aviso");
        return true;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "erro");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [operator, notify],
  );

  const saveSettings = useCallback<Ctx["saveSettings"]>(
    async (patch) => {
      try {
        const res = await fetch("/api/kds/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json()) as { ok: boolean; config?: KdsSettings; erro?: string };
        if (!res.ok || !json.ok) {
          notify(json.erro ?? "Não consegui salvar.", "erro");
          return;
        }
        if (json.config) setSettings(json.config);
        notify("Configuração salva");
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "erro");
      }
    },
    [notify],
  );

  const createTestOrder = useCallback<Ctx["createTestOrder"]>(
    async (tipo) => {
      try {
        const res = await fetch("/api/kds/teste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo }),
        });
        const json = (await res.json()) as { ok: boolean; erro?: string };
        if (!res.ok || !json.ok) {
          notify(json.erro ?? "Não consegui criar o pedido de teste.", "erro");
          return;
        }
        await refresh();
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "erro");
      }
    },
    [notify, refresh],
  );

  const value: Ctx = {
    cards,
    byStage,
    settings,
    loading,
    error,
    live,
    connection,
    busy,
    toasts,
    operator,
    setOperator,
    soundOn,
    toggleSound,
    act,
    saveSettings,
    createTestOrder,
    refresh,
    notify,
  };

  return <KdsContext.Provider value={value}>{children}</KdsContext.Provider>;
}

/** Relógio compartilhado: um único timer para todos os cronômetros. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
