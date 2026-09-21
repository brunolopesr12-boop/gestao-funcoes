"use client";

import { useEffect, useState } from "react";
import { SAMPLE_KEYS, SAMPLE_ORDERS } from "@/lib/kds/samples";
import { useKds } from "@/lib/kds/store";

/**
 * Só o que o operador precisa mexer: minutos para o pedido ser considerado
 * atrasado, som, aceite automático e o estado da integração. Nada de
 * administração aqui.
 */
export function KdsSettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { settings, saveSettings, connection, operator, setOperator, createTestOrder } =
    useKds();
  const [minutos, setMinutos] = useState(String(settings.lateMinutes));
  const [nome, setNome] = useState(operator);

  useEffect(() => {
    if (open) {
      setMinutos(String(settings.lateMinutes));
      setNome(operator);
    }
  }, [open, settings.lateMinutes, operator]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fade-in absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border-2 border-[var(--line)] bg-[#0f172a] sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <h3 className="text-xl font-black">Configurações do KDS</h3>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-slate-300"
          >
            ✕
          </button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* ------------------ integração ------------------ */}
          <section>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
              Integração iFood
            </h4>
            <div
              className={`rounded-xl border p-3 text-sm ${
                connection.configurado && connection.conectado
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-100"
              }`}
            >
              {connection.configurado ? (
                connection.conectado ? (
                  <p className="font-bold">🟢 Conectado e recebendo pedidos.</p>
                ) : (
                  <>
                    <p className="font-bold">🔴 Sem conexão com o iFood.</p>
                    {connection.mensagem && (
                      <p className="mt-1 opacity-90">{connection.mensagem}</p>
                    )}
                  </>
                )
              ) : (
                <>
                  <p className="font-bold">
                    ⚙️ A integração ainda não foi configurada.
                  </p>
                  <p className="mt-1">
                    Falta definir no servidor:{" "}
                    <strong>{connection.falta.join(", ") || "as credenciais"}</strong>.
                    O passo a passo está no arquivo <code>README.md</code> do
                    projeto (seção KDS).
                  </p>
                </>
              )}
            </div>
          </section>

          {/* ------------------ atraso ------------------ */}
          <section>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
              Pedido atrasado
            </h4>
            <label className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={240}
                value={minutos}
                onChange={(e) => setMinutos(e.target.value)}
                onBlur={() => {
                  const n = Number(minutos);
                  if (Number.isFinite(n) && n >= 1 && n !== settings.lateMinutes) {
                    void saveSettings({ late_minutes: n });
                  }
                }}
                className="field w-24 text-center text-xl font-bold"
              />
              <span className="text-slate-300">
                minutos até marcar <strong>🔴 PEDIDO ATRASADO</strong>
              </span>
            </label>
          </section>

          {/* ------------------ operador ------------------ */}
          <section>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
              Quem está conferindo
            </h4>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={() => setOperator(nome.trim())}
              placeholder="Ex.: Bruno"
              className="field"
            />
            <p className="mt-1 text-xs text-slate-500">
              O nome fica gravado em cada conferência e despacho.
            </p>
          </section>

          {/* ------------------ pedido de teste ------------------ */}
          <section>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
              Pedido de teste
            </h4>
            <p className="mb-2 text-xs text-slate-500">
              Cria uma comanda marcada com 🧪 <strong>TESTE</strong>. Serve para
              treinar o fluxo e conferir os alertas. Nunca envia nada ao iFood.
            </p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => void createTestOrder(key)}
                  className="rounded-lg border border-[var(--line)] bg-white/5 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  {SAMPLE_ORDERS[key].label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
