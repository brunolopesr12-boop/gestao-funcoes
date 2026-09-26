"use client";

import { useState } from "react";
import { generatePassword } from "@/lib/ops/modules/usuarios";
import { Icon } from "@/components/ops/Icon";
import { CopyButton, Label } from "./Common";

/** Senha com botões "gerar", "mostrar" e "copiar" — para ditar ao funcionário. */
export function PasswordField({ value, onChange, label = "Senha inicial", hint, autoFocus }: { value: string; onChange: (v: string) => void; label?: string; hint?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(true);
  return (
    <div className="mb-4">
      <Label hint={hint ?? "Mínimo de 6 caracteres. Anote e entregue à pessoa; ela pode trocar depois em Meu perfil."}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type={show ? "text" : "password"}
            value={value}
            autoFocus={autoFocus}
            autoComplete="new-password"
            onChange={(e) => onChange(e.target.value)}
            className="field pr-10 font-mono"
            placeholder="••••••••"
          />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar senha" : "Mostrar senha"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-white/10">
            <Icon name={show ? "eye" : "lock"} size={16} />
          </button>
        </div>
        <button type="button" onClick={() => onChange(generatePassword(10))} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">
          <Icon name="sparkles" size={16} /> Gerar
        </button>
        {value && <CopyButton text={value} />}
      </div>
    </div>
  );
}
