"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/ops/session";
import { Icon, type IconName } from "@/components/ops/Icon";

const ITEMS: { href: string; label: string; icon: IconName; perm?: string }[] = [
  { href: "/estoque", label: "Saldos", icon: "warehouse" },
  { href: "/estoque/lotes", label: "Lotes", icon: "layers" },
  { href: "/validades", label: "Validades", icon: "clock" },
  { href: "/estoque/movimentacoes", label: "Movimentações", icon: "history" },
  { href: "/estoque/transferir", label: "Transferir", icon: "swap", perm: "estoque.movimentar" },
  { href: "/qr", label: "Ler QR", icon: "scan" },
];

/** Navegação entre as telas do módulo de estoque. */
export function EstoqueSubnav() {
  const path = usePathname();
  const { can } = useSession();
  return (
    <div className="scrollbar-thin -mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      {ITEMS.filter((i) => !i.perm || can(i.perm)).map((i) => {
        const active = path === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              active ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--line)] bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <Icon name={i.icon} size={14} />
            {i.label}
          </Link>
        );
      })}
    </div>
  );
}
