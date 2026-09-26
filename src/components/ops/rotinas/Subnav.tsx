"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/ops/session";
import { Icon, type IconName } from "@/components/ops/Icon";

type Item = { href: string; label: string; icon: IconName; perm?: string; match: (p: string) => boolean };

const AREAS: Record<"temperaturas" | "checklists", Item[]> = {
  temperaturas: [
    { href: "/temperaturas", label: "Painel", icon: "thermometer", perm: "temperaturas.ver", match: (p) => p === "/temperaturas" },
    { href: "/temperaturas/registrar", label: "Registrar", icon: "plus", perm: "temperaturas.registrar", match: (p) => p.startsWith("/temperaturas/registrar") },
    { href: "/temperaturas/equipamentos", label: "Equipamentos", icon: "settings", perm: "temperaturas.ver", match: (p) => p.startsWith("/temperaturas/equipamentos") },
  ],
  checklists: [
    { href: "/checklists", label: "Execuções", icon: "list", perm: "checklists.ver", match: (p) => p === "/checklists" || p.startsWith("/checklists/executar") },
    { href: "/checklists/modelos", label: "Modelos", icon: "edit", perm: "checklists.editar", match: (p) => p.startsWith("/checklists/modelos") },
  ],
};

/** Navegação entre as telas de um mesmo módulo (temperaturas ou checklists). */
export function RotinasSubnav({ area }: { area: keyof typeof AREAS }) {
  const path = usePathname() ?? "";
  const { can } = useSession();
  const items = AREAS[area].filter((i) => !i.perm || can(i.perm));
  if (items.length <= 1) return null;
  return (
    <div className="scrollbar-thin -mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      {items.map((i) => {
        const active = i.match(path);
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
