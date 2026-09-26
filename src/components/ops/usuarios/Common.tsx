"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { copyToClipboard } from "@/lib/ops/modules/usuarios";
import { EmptyState } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/** Tela para quem não tem a permissão necessária (o banco também bloqueia). */
export function NoPermission({ perm, what }: { perm: string; what: string }) {
  return (
    <EmptyState
      emoji="🔒"
      title={`Você não tem permissão para ${what}`}
      description={`Peça ao administrador para liberar a permissão "${perm}" no seu perfil de acesso.`}
      action={<Link href="/" className="rounded-xl border border-[var(--line)] bg-white/5 px-4 py-2 text-sm font-semibold">Voltar ao início</Link>}
    />
  );
}

/** Rótulo de campo para controles que não podem ficar dentro de <label> (Choice, listas). */
export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <p className="text-sm font-semibold text-slate-300">{children}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function CopyButton({ text, label = "Copiar", size = "md" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyToClipboard(text);
        setDone(ok);
        setTimeout(() => setDone(false), 1500);
      }}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-semibold transition active:scale-95 ${
        done ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" : "border-[var(--line)] bg-white/5 text-slate-200 hover:bg-white/10"
      } ${size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}
    >
      <Icon name={done ? "check" : "file"} size={16} /> {done ? "Copiado" : label}
    </button>
  );
}

/** Abas do módulo: usuários × perfis de acesso. */
export function UsuariosSubnav() {
  const path = usePathname();
  const tabs = [
    { href: "/usuarios", label: "Usuários", active: path === "/usuarios" || (path.startsWith("/usuarios/") && !path.startsWith("/usuarios/perfis")) },
    { href: "/usuarios/perfis", label: "Perfis de acesso", active: path.startsWith("/usuarios/perfis") },
  ];
  return (
    <div className="mb-4 flex gap-1 rounded-xl border border-[var(--line)] bg-white/5 p-1">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition ${t.active ? "bg-[var(--panel-2)] text-white shadow" : "text-slate-400 hover:text-slate-200"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
