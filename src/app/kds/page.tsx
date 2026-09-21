"use client";

import { Column } from "@/components/kds/Column";
import { KdsHeader } from "@/components/kds/KdsHeader";
import { OrderCard } from "@/components/kds/OrderCard";
import { KdsProvider, useKds, useNow } from "@/lib/kds/store";

export default function KdsPage() {
  return (
    <KdsProvider>
      <Tela />
    </KdsProvider>
  );
}

function Tela() {
  const { byStage, loading, error, refresh, connection } = useKds();
  const now = useNow(1000);

  if (loading) {
    return (
      <div className="kds-screen grid min-h-dvh place-items-center">
        <p className="text-2xl font-bold text-slate-500">Carregando o KDS…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kds-screen grid min-h-dvh place-items-center px-6">
        <div className="max-w-lg text-center">
          <p className="mb-2 text-5xl">⚠️</p>
          <h1 className="mb-2 text-2xl font-black">
            Não consegui carregar os pedidos
          </h1>
          <p className="mb-4 text-slate-400">{error}</p>
          <p className="mb-5 text-sm text-slate-500">
            Se as tabelas do KDS ainda não existem, rode o arquivo{" "}
            <code className="rounded bg-white/10 px-1">supabase/kds.sql</code> no
            SQL Editor do Supabase.
          </p>
          <button
            onClick={() => void refresh()}
            className="rounded-xl bg-blue-600 px-5 py-3 text-lg font-bold text-white"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-screen flex min-h-dvh flex-col sm:h-dvh">
      <KdsHeader now={now} />

      {!connection.configurado && (
        <p className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm font-bold text-amber-200">
          ⚙️ Integração iFood ainda não configurada — nenhum pedido real vai
          entrar. Abra ⚙️ para ver o que falta.
        </p>
      )}

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 sm:grid-cols-2 sm:overflow-hidden xl:grid-cols-4">
        <Column stage="novo" cards={byStage.novo} now={now} />
        <Column stage="producao" cards={byStage.producao} now={now} />
        <Column stage="pronto" cards={byStage.pronto} now={now} />
        <Column stage="despachado" cards={byStage.despachado} now={now} />
      </div>

      {byStage.cancelado.length > 0 && (
        <section className="border-t-2 border-rose-500/50 bg-rose-950/40 p-2">
          <h2 className="mb-2 px-1 text-sm font-black uppercase tracking-wider text-rose-300">
            🚫 Cancelados pelo iFood — não entregar
          </h2>
          <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-1">
            {byStage.cancelado.map((card) => (
              <div key={card.row.id} className="w-[22rem] shrink-0">
                <OrderCard card={card} now={now} />
              </div>
            ))}
          </div>
        </section>
      )}

      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts } = useKds();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex flex-col items-start gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pop-in max-w-xl rounded-2xl border-2 px-5 py-3 text-lg font-bold shadow-2xl ${
            t.kind === "erro"
              ? "border-rose-500 bg-rose-950 text-rose-100"
              : t.kind === "aviso"
                ? "border-amber-500 bg-amber-950 text-amber-100"
                : "border-emerald-500 bg-emerald-950 text-emerald-100"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
