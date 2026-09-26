"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/ops/session";
import { useOfflineQueue } from "@/lib/ops/offline";
import { useRealtimeInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials } from "@/lib/ops/format";
import { Icon } from "./Icon";
import { BOTTOM_NAV, NAV_GROUPS, itemAllowed } from "./nav";
import { Sheet, Button } from "./ui";

function useCounts() {
  const { store, can } = useSession();
  const sid = store?.id;
  const q = useQuery({
    queryKey: ["alerts", "count", sid],
    enabled: Boolean(sid) && can("alertas.ver"),
    refetchInterval: 60_000,
    queryFn: async () => {
      const sb = supabaseBrowser();
      const [{ count: alerts }, { count: tasks }] = await Promise.all([
        sb.from("alerts").select("id", { count: "exact", head: true }).eq("store_id", sid!).eq("status", "aberto"),
        sb.from("tasks").select("id", { count: "exact", head: true }).eq("store_id", sid!).in("status", ["pendente", "em_andamento", "atrasada"]),
      ]);
      return { alerts: alerts ?? 0, tasks: tasks ?? 0 };
    },
  });
  useRealtimeInvalidate(["alerts", "tasks"]);
  return q.data ?? { alerts: 0, tasks: 0 };
}

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = useSession();
  const counts = useCounts();
  const [menuOpen, setMenuOpen] = useState(false);
  const offline = useOfflineQueue();

  useEffect(() => setMenuOpen(false), [pathname]);

  const groups = useMemo(
    () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => itemAllowed(i, can)) })).filter((g) => g.items.length > 0),
    [can],
  );
  const badge = (b?: "alerts" | "tasks") => (b === "alerts" ? counts.alerts : b === "tasks" ? counts.tasks : 0);

  return (
    <div className="min-h-dvh lg:flex">
      {/* ---------------- sidebar (desktop) ---------------- */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--panel)]/70 backdrop-blur-xl lg:flex print:hidden">
        <Brand />
        <StoreSwitcher />
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.title}</p>
              {g.items.map((it) => {
                const active = isActive(pathname, it.href);
                const n = badge(it.badge);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`mb-0.5 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition ${
                      active ? "bg-[var(--accent)]/15 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon name={it.icon} size={18} className={active ? "text-[var(--accent)]" : "text-slate-500"} />
                    <span className="flex-1 truncate">{it.label}</span>
                    {n > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white tabular-nums">{n}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <UserBox />
      </aside>

      {/* ---------------- conteúdo ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* barra superior (celular/tablet) */}
        <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur-xl lg:hidden print:hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <Link href="/" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-lg font-black text-white">V</Link>
            <StoreSwitcher compact />
            <div className="flex-1" />
            {!offline.online && <span title="Sem conexão" className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/20 text-amber-300"><Icon name="wifiOff" size={18} /></span>}
            {offline.pending + offline.errors > 0 && (
              <Link href="/sincronizacao" className="grid h-9 min-w-9 place-items-center rounded-xl bg-amber-500/20 px-2 text-xs font-bold text-amber-300">
                {offline.pending + offline.errors}
              </Link>
            )}
            {can("alertas.ver") && (
              <Link href="/alertas" className="relative grid h-10 w-10 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-300">
                <Icon name="bell" />
                {counts.alerts > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{counts.alerts}</span>}
              </Link>
            )}
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menu" className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-300">
              <Icon name="menu" />
            </button>
          </div>
        </header>

        {/* aviso offline (desktop) */}
        {(!offline.online || offline.pending + offline.errors > 0) && (
          <div className="hidden items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200 lg:flex print:hidden">
            <span className="flex items-center gap-2">
              <Icon name={offline.online ? "cloudOff" : "wifiOff"} size={16} />
              {!offline.online ? "Sem conexão: operações simples ficam na fila e são enviadas quando a internet voltar." : `${offline.pending} operação(ões) aguardando envio${offline.errors ? ` · ${offline.errors} com erro` : ""}.`}
            </span>
            <Link href="/sincronizacao" className="font-semibold underline">Ver fila</Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-3 sm:px-5 sm:pt-5 lg:pb-8 print:p-0">{children}</main>

        {/* bottom navigation (celular) */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--panel)]/95 backdrop-blur-xl lg:hidden print:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {BOTTOM_NAV.filter((i) => itemAllowed(i, can)).map((it) => {
              const active = isActive(pathname, it.href);
              const n = badge(it.badge);
              return (
                <Link key={it.href} href={it.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${active ? "text-[var(--accent)]" : "text-slate-400"}`}>
                  <Icon name={it.icon} size={22} />
                  {it.label}
                  {n > 0 && <span className="absolute right-3 top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{n}</span>}
                </Link>
              );
            })}
            <button type="button" onClick={() => setMenuOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-slate-400">
              <Icon name="menu" size={22} />
              Menu
            </button>
          </div>
        </nav>
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <div className="mb-3"><StoreSwitcher inline /></div>
        {groups.map((g) => (
          <div key={g.title} className="mb-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.title}</p>
            <div className="grid grid-cols-2 gap-2">
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2.5 text-sm font-semibold">
                  <Icon name={it.icon} size={18} className="text-[var(--accent)]" />
                  <span className="truncate">{it.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        <UserBox inline />
      </Sheet>
    </div>
  );
}

function Brand() {
  const { company } = useSession();
  return (
    <Link href="/painel" className="flex items-center gap-3 px-4 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)] text-xl font-black text-white shadow-lg shadow-orange-900/30">
        {company?.emoji && company.emoji.length <= 3 ? company.emoji : "V"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-extrabold leading-tight">{company?.name ?? "Vila Rica"}</span>
        <span className="block text-[11px] text-slate-500">Gestão de cozinha</span>
      </span>
    </Link>
  );
}

export function StoreSwitcher({ compact, inline }: { compact?: boolean; inline?: boolean }) {
  const { stores, store, setStore, companies } = useSession();
  const router = useRouter();
  if (stores.length === 0) return null;
  const label = (s: { name: string; company_id: string }) => {
    const c = companies.find((x) => x.id === s.company_id);
    return companies.length > 1 && c ? `${c.name} · ${s.name}` : s.name;
  };
  if (stores.length === 1) {
    return compact ? (
      <span className="truncate text-sm font-bold">{store?.name}</span>
    ) : (
      <div className={`${inline ? "" : "mx-3 mb-3"} flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/5 px-3 py-2 text-sm`}>
        <Icon name="building" size={16} className="text-slate-500" />
        <span className="truncate font-semibold">{store?.name}</span>
      </div>
    );
  }
  return (
    <div className={compact ? "min-w-0 flex-1" : inline ? "" : "mx-3 mb-3"}>
      <select
        value={store?.id ?? ""}
        onChange={(e) => {
          setStore(e.target.value);
          router.refresh();
        }}
        aria-label="Unidade"
        className="field !py-2 text-sm font-semibold"
      >
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{label(s)}</option>
        ))}
      </select>
    </div>
  );
}

function UserBox({ inline }: { inline?: boolean }) {
  const { displayName, user, signOut, memberships, company } = useSession();
  const role = memberships.find((m) => m.company_id === company?.id)?.access_roles?.name ?? "";
  return (
    <div className={`${inline ? "mt-2 border-t border-[var(--line)] pt-3" : "border-t border-[var(--line)] p-3"} flex items-center gap-2`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent)]/20 text-xs font-bold text-[var(--accent)]">{initials(displayName || "?")}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{displayName || user?.email}</span>
        <span className="block truncate text-[11px] text-slate-500">{role || user?.email}</span>
      </span>
      <Link href="/perfil" aria-label="Meu perfil" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10"><Icon name="settings" size={18} /></Link>
      <button type="button" onClick={() => void signOut()} aria-label="Sair" title="Sair" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10">
        <Icon name="logout" size={18} />
      </button>
    </div>
  );
}

/** Tela de espera usada pelo Gate. */
export function ShellSkeleton({ text = "Carregando…" }: { text?: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-10">
      <div className="mb-6 h-8 w-52 animate-pulse rounded-xl bg-white/10" />
      <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />)}</div>
      <p className="mt-6 text-center text-sm text-slate-500">{text}</p>
    </div>
  );
}

export function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-10">
      <div className="card p-6">{children}</div>
    </div>
  );
}

export function RetryButton({ onClick, label = "Tentar novamente" }: { onClick: () => void; label?: string }) {
  return <Button variant="primary" full onClick={onClick}>{label}</Button>;
}
