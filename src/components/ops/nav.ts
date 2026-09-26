import type { IconName } from "./Icon";

export type NavItem = { href: string; label: string; icon: IconName; perm?: string; perms?: string[]; badge?: "alerts" | "tasks" };
export type NavGroup = { title: string; items: NavItem[] };

/** Menu do desktop (sidebar) — cada item exige uma permissão na unidade atual. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Visão geral",
    items: [
      { href: "/painel", label: "Painel", icon: "dashboard", perm: "painel.ver" },
      { href: "/alertas", label: "Alertas", icon: "bell", perm: "alertas.ver", badge: "alerts" },
      { href: "/tarefas", label: "Tarefas", icon: "checkSquare", perm: "tarefas.ver", badge: "tasks" },
    ],
  },
  {
    title: "Operação",
    items: [
      { href: "/estoque", label: "Estoque", icon: "warehouse", perm: "estoque.ver" },
      { href: "/validades", label: "Validades", icon: "clock", perm: "estoque.ver" },
      { href: "/recebimento", label: "Recebimento", icon: "truck", perm: "recebimento.ver" },
      { href: "/producao", label: "Produção", icon: "flame", perm: "producao.ver" },
      { href: "/inventario", label: "Inventário", icon: "clipboard", perms: ["inventario.ver", "inventario.contar"] },
      { href: "/perdas", label: "Perdas", icon: "trash", perms: ["perdas.ver", "perdas.registrar"] },
      { href: "/temperaturas", label: "Temperaturas", icon: "thermometer", perm: "temperaturas.ver" },
      { href: "/checklists", label: "Checklists", icon: "list", perm: "checklists.ver" },
      { href: "/etiquetas", label: "Etiquetas", icon: "tag", perm: "etiquetas.imprimir" },
      { href: "/qr", label: "Ler QR Code", icon: "scan", perm: "estoque.ver" },
    ],
  },
  {
    title: "Compras",
    items: [
      { href: "/reposicao", label: "Reposição", icon: "cart", perms: ["compras.ver", "estoque.ver"] },
      { href: "/compras", label: "Pedidos de compra", icon: "file", perm: "compras.ver" },
      { href: "/fornecedores", label: "Fornecedores", icon: "building", perm: "fornecedores.ver" },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { href: "/produtos", label: "Produtos", icon: "box", perm: "produtos.ver" },
      { href: "/fichas", label: "Fichas técnicas", icon: "book", perm: "fichas.ver" },
      { href: "/treinamentos", label: "Funções e treinamentos", icon: "users", perm: "treinamentos.ver" },
      { href: "/vila-gpt", label: "VILA GPT", icon: "sparkles", perm: "treinamentos.ver" },
    ],
  },
  {
    title: "Gestão",
    items: [
      { href: "/relatorios", label: "Relatórios", icon: "chart", perm: "relatorios.ver" },
      { href: "/auditoria", label: "Auditoria", icon: "history", perm: "auditoria.ver" },
      { href: "/usuarios", label: "Usuários", icon: "shield", perm: "usuarios.gerenciar" },
      { href: "/configuracoes", label: "Configurações", icon: "settings", perm: "configuracoes.editar" },
    ],
  },
];

/** Atalhos grandes da tela inicial no celular. */
export const MOBILE_TILES: (NavItem & { tone: string; description: string })[] = [
  { href: "/recebimento/novo", label: "Receber", icon: "truck", perm: "recebimento.criar", tone: "bg-blue-600", description: "Conferir mercadoria" },
  { href: "/producao/nova", label: "Produzir", icon: "flame", perm: "producao.finalizar", tone: "bg-orange-600", description: "Baixa e novo lote" },
  { href: "/estoque", label: "Estoque", icon: "warehouse", perm: "estoque.ver", tone: "bg-emerald-600", description: "Saldos e lotes" },
  { href: "/contar", label: "Contar", icon: "clipboard", perm: "inventario.contar", tone: "bg-violet-600", description: "Contagem rápida" },
  { href: "/perdas/nova", label: "Perda", icon: "trash", perm: "perdas.registrar", tone: "bg-rose-600", description: "Registrar perda" },
  { href: "/etiquetas", label: "Etiquetas", icon: "tag", perm: "etiquetas.imprimir", tone: "bg-cyan-600", description: "Imprimir" },
  { href: "/checklists", label: "Checklists", icon: "list", perm: "checklists.executar", tone: "bg-teal-600", description: "Tarefas do dia" },
  { href: "/temperaturas/registrar", label: "Temperatura", icon: "thermometer", perm: "temperaturas.registrar", tone: "bg-sky-600", description: "Registrar medição" },
  { href: "/estoque/transferir", label: "Transferir", icon: "swap", perm: "estoque.movimentar", tone: "bg-indigo-600", description: "Entre locais/unidades" },
  { href: "/qr", label: "Ler QR", icon: "scan", perm: "estoque.ver", tone: "bg-slate-600", description: "Consultar lote" },
];

export const BOTTOM_NAV: NavItem[] = [
  { href: "/", label: "Início", icon: "home" },
  { href: "/estoque", label: "Estoque", icon: "warehouse", perm: "estoque.ver" },
  { href: "/qr", label: "Ler QR", icon: "scan", perm: "estoque.ver" },
  { href: "/alertas", label: "Alertas", icon: "bell", perm: "alertas.ver", badge: "alerts" },
];

export function itemAllowed(item: NavItem, can: (p: string) => boolean): boolean {
  if (item.perms) return item.perms.some((p) => can(p));
  if (item.perm) return can(item.perm);
  return true;
}
