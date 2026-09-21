"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "@/lib/store";
import { Button, Field, Sheet, TextInput } from "./ui";

export type IdentityCopy = { title: string; help: string };

const DEFAULT_IDENTITY: IdentityCopy = {
  title: "Quem está treinando?",
  help: "Esse nome fica gravado em cada etapa de treinamento que você marcar, junto com a data e a hora. Assim você sabe depois quem treinou e certificou cada pessoa.",
};

export function AppShell({
  title,
  subtitle,
  backHref,
  action,
  identity = DEFAULT_IDENTITY,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  action?: React.ReactNode;
  /** texto da folha "quem é você" (o VILA GPT usa um texto próprio) */
  identity?: IdentityCopy;
  children: React.ReactNode;
}) {
  const { live, trainer } = useData();
  const [openTrainer, setOpenTrainer] = useState(false);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[#0b1020]/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-3">
          {backHref ? (
            <Link
              href={backHref}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-lg text-slate-300 active:scale-95"
              aria-label="Voltar"
            >
              ←
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold leading-tight sm:text-xl">
              {title}
            </h1>
            {subtitle && (
              <div className="truncate text-xs text-slate-400">{subtitle}</div>
            )}
          </div>
          {action}
          <button
            onClick={() => setOpenTrainer(true)}
            title={trainer ? `Responsável: ${trainer}` : "Definir quem é você"}
            className="grid h-10 shrink-0 place-items-center gap-1 rounded-xl border border-[var(--line)] bg-white/5 px-3 text-xs font-semibold text-slate-300 active:scale-95"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-slate-500"}`}
                title={live ? "Sincronizado em tempo real" : "Sincronizando..."}
              />
              {trainer ? trainer.split(" ")[0] : "Eu"}
            </span>
          </button>
        </div>
      </header>

      <main className="safe-bottom px-4 pt-4">{children}</main>

      <TrainerSheet open={openTrainer} onClose={() => setOpenTrainer(false)} identity={identity} />
      <Toasts />
    </div>
  );
}

function TrainerSheet({
  open,
  onClose,
  identity,
}: {
  open: boolean;
  onClose: () => void;
  identity: IdentityCopy;
}) {
  const { trainer, setTrainer, live, refresh } = useData();
  const [name, setName] = useState(trainer);

  return (
    <Sheet open={open} onClose={onClose} title={identity.title}>
      <p className="mb-4 text-sm text-slate-400">{identity.help}</p>
      <Field label="Seu nome">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Bruno"
          autoFocus
        />
      </Field>

      <div className="card mb-4 flex items-center gap-3 p-3 text-sm">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400"}`}
        />
        <span className="flex-1 text-slate-300">
          {live
            ? "Sincronização em tempo real ativa"
            : "Conectando à sincronização..."}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          Atualizar
        </Button>
      </div>

      <Button
        variant="primary"
        size="lg"
        full
        onClick={() => {
          setTrainer(name.trim());
          onClose();
        }}
      >
        Salvar
      </Button>
    </Sheet>
  );
}

function Toasts() {
  const { toasts } = useData();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pop-in max-w-sm rounded-2xl border px-4 py-2.5 text-sm font-medium shadow-xl backdrop-blur ${
            t.kind === "erro"
              ? "border-rose-500/40 bg-rose-950/90 text-rose-100"
              : "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
