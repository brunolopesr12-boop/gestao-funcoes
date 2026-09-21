/**
 * Chamadas do navegador para as rotas /api/vila-gpt/* e utilidades de tela.
 */
import type { GptMode, GptQuestion, GptSource, KbArticle } from "../types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sem corpo */
  }
  if (!res.ok) {
    const erro = (body as { erro?: string } | null)?.erro;
    throw new Error(erro || `Erro ${res.status}`);
  }
  return body as T;
}

/* ------------------------------------------------------------------ */
/* Funcionário                                                         */
/* ------------------------------------------------------------------ */

export type AskResponse = {
  id: string;
  answer: string;
  found: boolean;
  mode: GptMode;
  sources: GptSource[];
  warning: string | null;
  logged: boolean;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function askVilaGpt(input: {
  question: string;
  company_id: string | null;
  employee_name: string;
  employee_id: string | null;
  history: ChatTurn[];
}): Promise<AskResponse> {
  return api<AskResponse>("/api/vila-gpt/ask", { method: "POST", body: JSON.stringify(input) });
}

export function sendFeedback(id: string, helpful: boolean): Promise<{ ok: true }> {
  return api("/api/vila-gpt/feedback", { method: "POST", body: JSON.stringify({ id, helpful }) });
}

export async function fetchSuggestions(companyId: string | null): Promise<string[]> {
  const q = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
  try {
    const r = await api<{ frequent: string[] }>(`/api/vila-gpt/suggestions${q}`);
    return r.frequent ?? [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Administração                                                       */
/* ------------------------------------------------------------------ */

export type AdminSession = {
  configured: boolean;
  admin: boolean;
  ai: { enabled: boolean; model: string; effort: string } | null;
  service_role: boolean | null;
};

export function fetchAdminSession(): Promise<AdminSession> {
  return api<AdminSession>("/api/vila-gpt/admin/session");
}

export function adminLogin(pin: string): Promise<{ admin: boolean }> {
  return api("/api/vila-gpt/admin/session", { method: "POST", body: JSON.stringify({ pin }) });
}

export function adminLogout(): Promise<{ admin: boolean }> {
  return api("/api/vila-gpt/admin/session", { method: "DELETE" });
}

export type ArticleInput = Omit<KbArticle, "id" | "created_at" | "updated_at" | "position"> & {
  position?: number;
};

export function createArticle(input: ArticleInput): Promise<{ article: KbArticle }> {
  return api("/api/vila-gpt/admin/articles", { method: "POST", body: JSON.stringify(input) });
}

export function updateArticle(
  id: string,
  patch: Partial<ArticleInput>,
): Promise<{ article: KbArticle }> {
  return api("/api/vila-gpt/admin/articles", {
    method: "PUT",
    body: JSON.stringify({ id, ...patch }),
  });
}

export function deleteArticle(id: string, by: string): Promise<{ ok: true }> {
  const q = `?id=${encodeURIComponent(id)}&by=${encodeURIComponent(by)}`;
  return api(`/api/vila-gpt/admin/articles${q}`, { method: "DELETE" });
}

export async function fetchHistory(companyId: string | null, limit = 1000): Promise<GptQuestion[]> {
  const params = new URLSearchParams();
  if (companyId) params.set("company_id", companyId);
  params.set("limit", String(limit));
  const r = await api<{ rows: GptQuestion[] }>(`/api/vila-gpt/admin/history?${params}`);
  return r.rows ?? [];
}

export function deleteHistoryRow(id: string): Promise<{ ok: true }> {
  return api(`/api/vila-gpt/admin/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Preferências locais                                                 */
/* ------------------------------------------------------------------ */

export const STORAGE = {
  company: "vgpt.company",
  employee: "vgpt.employee",
} as const;

export function readLocal(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* ignora */
  }
}

/* ------------------------------------------------------------------ */
/* Texto da resposta → blocos                                          */
/* ------------------------------------------------------------------ */

export type AnswerBlock =
  | { type: "p"; text: string }
  | { type: "ol"; items: string[] }
  | { type: "ul"; items: string[] };

/** Quebra a resposta em parágrafos, listas numeradas e marcadores. */
export function parseAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const num = line.match(/^(\d{1,2})[.)]\s+(.*)$/);
    const bullet = line.match(/^[-•*☐✓✔]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (num) {
      if (last?.type === "ol") last.items.push(num[2]);
      else blocks.push({ type: "ol", items: [num[2]] });
    } else if (bullet) {
      if (last?.type === "ul") last.items.push(bullet[1]);
      else blocks.push({ type: "ul", items: [bullet[1]] });
    } else {
      blocks.push({ type: "p", text: line });
    }
  }
  return blocks;
}
