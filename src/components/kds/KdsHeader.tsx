"use client";

import Link from "next/link";
import { useState } from "react";
import { useKds } from "@/lib/kds/store";
import { KdsSettingsSheet } from "./KdsSettingsSheet";

const relogio = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Faixa superior: identidade, relógio, som e — discreto, como pedido — o
 * estado da conexão com o iFood.
 */
export function KdsHeader({ now }: { now: number }) {
  const { connection, live, soundOn, toggleSound, byStage } = useKds();
  const [config, setConfig] = useState(false);

  const ativo =
    byStage.novo.length + byStage.producao.length + byStage.pronto.length;

  const conectado = connection.configurado && connection.conectado;
  const rotulo = !connection.configurado
    ? "iFood não configurado"
    : conectado
      ? "iFood conectado"
      : "iFood desconectado";

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-[var(--line)] px-3 py-2">
      <h1 className="text-xl font-black uppercase tracking-tight sm:text-2xl">
        KDS — Sr. Strogonoff
      </h1>

      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${
          conectado
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            : "border-rose-500/60 bg-rose-500/10 text-rose-300"
        }`}
        title={connection.mensagem || rotulo}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            conectado ? "bg-emerald-400" : "bg-rose-400 kds-blink"
          }`}
        />
        {conectado ? "🟢" : "🔴"} {rotulo}
      </span>

      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
          live
            ? "border-slate-600 bg-white/5 text-slate-400"
            : "border-amber-500/50 bg-amber-500/10 text-amber-300"
        }`}
        title={live ? "Telas sincronizadas" : "Reconectando à sincronização"}
      >
        {live ? "telas sincronizadas" : "sincronizando…"}
      </span>

      <span className="ml-auto text-lg font-bold text-slate-400 tabular-nums">
        {ativo} na fila · {relogio.format(now)}
      </span>

      <button
        onClick={() => void toggleSound()}
        className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-lg"
        title={soundOn ? "Som ligado" : "Som desligado"}
        aria-label={soundOn ? "Desligar som" : "Ligar som"}
      >
        {soundOn ? "🔔" : "🔕"}
      </button>

      <button
        onClick={() => setConfig(true)}
        className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-lg"
        aria-label="Configurações do KDS"
      >
        ⚙️
      </button>

      <Link
        href="/"
        className="rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm font-bold text-slate-400"
      >
        sair
      </Link>

      <KdsSettingsSheet open={config} onClose={() => setConfig(false)} />
    </header>
  );
}
