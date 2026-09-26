"use client";

import { get, set } from "idb-keyval";
import { useEffect, useState } from "react";
import { isNetworkError, toOpsError } from "./errors";
import { rpc } from "./rpc";
import { newId } from "./format";

/**
 * FILA OFFLINE
 *
 * Operações simples e idempotentes (contagem, temperatura, checklist, perda,
 * consumo por QR...) são gravadas no IndexedDB quando não há conexão e
 * reenviadas quando a internet volta. Cada operação leva um `client_op_id`;
 * as funções do banco ignoram repetições.
 *
 * Conflitos (ex.: estoque insuficiente na hora do reenvio) ficam marcados
 * como `erro` para decisão explícita na tela /sincronizacao.
 */
export type QueuedOp = {
  id: string;            // client_op_id
  rpc: string;
  args: Record<string, unknown>;
  label: string;
  createdAt: string;
  status: "pendente" | "erro";
  error?: string;
  attempts: number;
};

const KEY = "vr.offline.queue";
const listeners = new Set<() => void>();
let flushing = false;

function emit() {
  for (const l of listeners) l();
}

export async function listQueue(): Promise<QueuedOp[]> {
  try {
    return ((await get(KEY)) as QueuedOp[] | undefined) ?? [];
  } catch {
    return [];
  }
}

async function saveQueue(q: QueuedOp[]) {
  try {
    await set(KEY, q);
  } catch {
    /* IndexedDB indisponível (modo privado): sem fila */
  }
  emit();
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export async function enqueue(op: Omit<QueuedOp, "createdAt" | "status" | "attempts">): Promise<QueuedOp> {
  const q = await listQueue();
  const item: QueuedOp = { ...op, createdAt: new Date().toISOString(), status: "pendente", attempts: 0 };
  q.push(item);
  await saveQueue(q);
  return item;
}

export async function removeFromQueue(id: string) {
  const q = await listQueue();
  await saveQueue(q.filter((x) => x.id !== id));
}

export async function retryQueued(id: string) {
  const q = await listQueue();
  const it = q.find((x) => x.id === id);
  if (it) {
    it.status = "pendente";
    it.error = undefined;
    await saveQueue(q);
  }
  await flushQueue();
}

/** Reenvia tudo que está pendente, em ordem. Para no primeiro erro de rede. */
export async function flushQueue(): Promise<{ sent: number; failed: number; remaining: number }> {
  if (flushing) return { sent: 0, failed: 0, remaining: (await listQueue()).length };
  flushing = true;
  let sent = 0, failed = 0;
  try {
    let q = await listQueue();
    for (const op of q.filter((x) => x.status === "pendente")) {
      if (!isOnline()) break;
      try {
        await rpc(op.rpc, op.args);
        q = q.filter((x) => x.id !== op.id);
        sent++;
        await saveQueue(q);
      } catch (e) {
        if (isNetworkError(e as Error)) break;
        const err = toOpsError(e as Error);
        const it = q.find((x) => x.id === op.id);
        if (it) {
          it.status = "erro";
          it.error = err.message;
          it.attempts += 1;
        }
        failed++;
        await saveQueue(q);
      }
    }
    return { sent, failed, remaining: (await listQueue()).length };
  } finally {
    flushing = false;
    emit();
  }
}

export type OfflineResult<T> = { queued: true; id: string } | { queued: false; data: T };

/**
 * Executa a RPC agora; se não houver conexão, coloca na fila.
 * O `client_op_id` é gerado aqui e enviado como `p_client_op_id`.
 */
export async function callOfflineable<T>(name: string, args: Record<string, unknown>, label: string): Promise<OfflineResult<T>> {
  const id = (args.p_client_op_id as string | undefined) ?? newId();
  const full = { ...args, p_client_op_id: id };
  if (!isOnline()) {
    await enqueue({ id, rpc: name, args: full, label });
    return { queued: true, id };
  }
  try {
    const data = await rpc<T>(name, full);
    return { queued: false, data };
  } catch (e) {
    if (isNetworkError(e as Error)) {
      await enqueue({ id, rpc: name, args: full, label });
      return { queued: true, id };
    }
    throw e;
  }
}

/** Estado da fila para a interface. */
export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => void listQueue().then((q) => alive && setQueue(q));
    load();
    listeners.add(load);
    const on = () => {
      setOnline(true);
      void flushQueue();
    };
    const off = () => setOnline(false);
    setOnline(isOnline());
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const timer = window.setInterval(() => {
      if (isOnline()) void flushQueue();
    }, 30_000);
    if (isOnline()) void flushQueue();
    return () => {
      alive = false;
      listeners.delete(load);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.clearInterval(timer);
    };
  }, []);

  return {
    queue,
    online,
    pending: queue.filter((q) => q.status === "pendente").length,
    errors: queue.filter((q) => q.status === "erro").length,
    flush: flushQueue,
    remove: removeFromQueue,
    retry: retryQueued,
  };
}
