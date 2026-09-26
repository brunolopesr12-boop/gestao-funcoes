"use client";

import Link from "next/link";
import { useSession } from "@/lib/ops/session";
import { PageHeader } from "@/components/ops/ui";
import { Icon, type IconName } from "@/components/ops/Icon";
import { NoPermission } from "@/components/ops/usuarios/Common";

type Card = { href: string; title: string; description: string; icon: IconName; tone: string; external?: boolean };

/** Hub de configurações: cada cartão leva a uma área. */
export default function ConfiguracoesPage() {
  const { company, canCompany, isAdmin, stores } = useSession();
  const canEdit = canCompany("configuracoes.editar");
  const canUsers = canCompany("usuarios.gerenciar");

  if (!canEdit && !canUsers) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Configurações" icon="settings" />
        <NoPermission perm="configuracoes.editar" what="alterar configurações" />
      </div>
    );
  }

  const cards: Card[] = [
    ...(canEdit
      ? [
          { href: "/configuracoes/empresa", title: "Empresa", description: "Nome, logo, cor e dados para etiquetas", icon: "building", tone: "bg-orange-600" },
          { href: "/configuracoes/unidades", title: "Unidades e locais de estoque", description: `${stores.length} unidade(s) · geladeiras, freezers, estoque seco`, icon: "warehouse", tone: "bg-emerald-600" },
          { href: "/configuracoes/parametros", title: "Parâmetros de estoque e validade", description: "Método de custo, dias de alerta, impressora, temperaturas", icon: "settings", tone: "bg-blue-600" },
          { href: "/configuracoes/motivos-perda", title: "Motivos de perda", description: "Vencimento, quebra, erro de produção…", icon: "trash", tone: "bg-rose-600" },
          { href: "/produtos/unidades", title: "Unidades de medida", description: "kg, g, L, un, caixa, pacote…", icon: "scale", tone: "bg-violet-600", external: true },
          { href: "/temperaturas/equipamentos", title: "Equipamentos de temperatura", description: "Geladeiras, freezers e câmaras monitorados", icon: "thermometer", tone: "bg-sky-600", external: true },
          { href: "/etiquetas/modelos", title: "Modelos de etiqueta", description: "Tamanho, campos e QR Code das etiquetas", icon: "tag", tone: "bg-cyan-600", external: true },
          { href: "/checklists/modelos", title: "Checklists", description: "Abertura, fechamento, limpeza e frequências", icon: "list", tone: "bg-teal-600", external: true },
        ] satisfies Card[]
      : []),
    ...(canUsers ? [{ href: "/usuarios", title: "Usuários e permissões", description: "Contas, convites, perfis de acesso e ajustes finos", icon: "shield", tone: "bg-amber-600" } satisfies Card] : []),
    ...(canEdit ? [{ href: "/configuracoes/integracoes", title: "Integrações", description: "Chaves de API, fila de eventos e rotas para PDV/ERP", icon: "swap", tone: "bg-indigo-600" } satisfies Card] : []),
    ...(isAdmin ? [{ href: "/inicio", title: "Nova empresa", description: "Criar outra empresa neste sistema (você será o administrador)", icon: "plus", tone: "bg-slate-600" } satisfies Card] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Configurações" subtitle={company ? `${company.emoji} ${company.name}` : undefined} icon="settings" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card card-hover flex items-center gap-3 p-3.5">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${c.tone}`}><Icon name={c.icon} size={24} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-extrabold leading-tight">{c.title}</span>
              <span className="block text-xs text-slate-400">{c.description}</span>
            </span>
            <Icon name="chevronRight" className="text-slate-600" />
          </Link>
        ))}
      </div>
    </div>
  );
}
