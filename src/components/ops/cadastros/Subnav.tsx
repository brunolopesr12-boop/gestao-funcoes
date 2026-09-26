"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/ops/session";
import { Icon, type IconName } from "@/components/ops/Icon";

const ITEMS: { href: string; label: string; icon: IconName; perm?: string; match: (p: string) => boolean }[] = [
  { href: "/produtos", label: "Produtos", icon: "box", perm: "produtos.ver", match: (p) => p === "/produtos" || (p.startsWith("/produtos/") && !p.startsWith("/produtos/categorias") && !p.startsWith("/produtos/unidades")) },
  { href: "/produtos/categorias", label: "Categorias", icon: "layers", perm: "produtos.ver", match: (p) => p.startsWith("/produtos/categorias") },
  { href: "/produtos/unidades", label: "Unidades de medida", icon: "scale", perm: "produtos.ver", match: (p) => p.startsWith("/produtos/unidades") },
  { href: "/fornecedores", label: "Fornecedores", icon: "building", perm: "fornecedores.ver", match: (p) => p.startsWith("/fornecedores") },
];

/** Navegação entre as telas de cadastro (produtos, categorias, unidades, fornecedores). */
export function CadastrosSubnav() {
  const path = usePathname() ?? "";
  const { canCompany } = useSession();
  return (
    <div className="scrollbar-thin -mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      {ITEMS.filter((i) => !i.perm || canCompany(i.perm)).map((i) => {
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
