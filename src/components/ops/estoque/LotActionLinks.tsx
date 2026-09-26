"use client";

import Link from "next/link";
import { useSession } from "@/lib/ops/session";
import { Icon, type IconName } from "@/components/ops/Icon";

type Action = { href: string; label: string; icon: IconName; perm: string; tone?: "danger" };

/**
 * Atalhos para outras telas a partir de um lote/produto
 * (transferir, perda, etiqueta, contagem, temperatura). Só mostra o que o
 * usuário pode fazer.
 */
export function LotActionLinks({ lotId, productId, compact }: { lotId?: string | null; productId: string; compact?: boolean }) {
  const { can } = useSession();
  const q = (extra: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const all: Action[] = [
    { href: `/estoque/transferir${q({ product: productId, lot: lotId })}`, label: "Transferir", icon: "swap", perm: "estoque.movimentar" },
    { href: `/perdas/nova${q({ product: productId, lot: lotId })}`, label: "Registrar perda", icon: "trash", perm: "perdas.registrar", tone: "danger" },
  ];
  if (lotId) all.push({ href: `/etiquetas/imprimir${q({ lot: lotId })}`, label: "Imprimir etiqueta", icon: "printer", perm: "etiquetas.imprimir" });
  all.push({ href: `/contar${q({ lot: lotId, product: lotId ? undefined : productId })}`, label: "Contar", icon: "clipboard", perm: "inventario.contar" });
  all.push({ href: "/temperaturas/registrar", label: "Registrar temperatura", icon: "thermometer", perm: "temperaturas.registrar" });
  const actions = all.filter((a) => can(a.perm));

  if (actions.length === 0) return null;
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className={`flex min-h-12 items-center gap-2 rounded-2xl border px-3.5 py-3 text-sm font-semibold transition active:scale-[0.98] ${
            a.tone === "danger" ? "border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20" : "border-[var(--line)] bg-white/5 text-slate-100 hover:bg-white/10"
          }`}
        >
          <Icon name={a.icon} size={18} />
          <span className="truncate">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}
