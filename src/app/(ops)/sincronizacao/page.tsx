"use client";

import { useOfflineQueue } from "@/lib/ops/offline";
import { fmtDateTime } from "@/lib/ops/format";
import { Button } from "@/components/ui";
import { PageHeader, Badge, EmptyState, InlineAlert, IconButton } from "@/components/ops/ui";

/** Fila de operações feitas sem internet e conflitos que precisam de decisão. */
export default function SyncPage() {
  const q = useOfflineQueue();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Sincronização"
        subtitle={q.online ? "Conectado" : "Sem conexão — as operações abaixo serão enviadas quando a internet voltar"}
        icon="cloudOff"
        actions={<Button variant="primary" disabled={!q.online || q.pending === 0} onClick={() => void q.flush()}>Enviar agora</Button>}
      />
      {!q.online && <InlineAlert tone="amber" icon="wifiOff">Você está offline. Recebimentos e produções exigem conexão; contagens, temperaturas, checklists, perdas e consumos por QR ficam na fila.</InlineAlert>}
      {q.queue.length === 0 ? (
        <EmptyState emoji="✅" title="Nada pendente" description="Todas as operações já foram enviadas ao servidor." />
      ) : (
        <div className="space-y-2">
          {q.queue.map((op) => (
            <div key={op.id} className={`card flex items-center gap-3 p-3 ${op.status === "erro" ? "border-rose-500/40" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{op.label}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(op.createdAt)} · {op.rpc}</p>
                {op.error && <p className="mt-1 text-xs text-rose-300">Conflito: {op.error}</p>}
              </div>
              <Badge tone={op.status === "erro" ? "red" : "amber"}>{op.status === "erro" ? "precisa de decisão" : "na fila"}</Badge>
              {op.status === "erro" && <IconButton icon="refresh" label="Tentar de novo" onClick={() => void q.retry(op.id)} />}
              <IconButton icon="trash" label="Descartar" tone="danger" onClick={() => { if (confirm("Descartar esta operação? Ela NÃO será registrada no sistema.")) void q.remove(op.id); }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
