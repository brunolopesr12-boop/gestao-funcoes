"use client";

import type { Permission } from "@/lib/ops/types";
import { OVERRIDE_LABEL, effectivePermission, type OverrideValue, type PermissionGroup } from "@/lib/ops/modules/usuarios";
import { Badge } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

const OVERRIDES: OverrideValue[] = ["padrao", "permitir", "negar"];

function Yes({ on, muted }: { on: boolean; muted?: boolean }) {
  return on ? (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${muted ? "text-slate-400" : "text-emerald-300"}`}><Icon name="check" size={14} /> sim</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Icon name="minus" size={14} /> não</span>
  );
}

/**
 * Ajuste fino por usuário: para cada permissão mostra o que o perfil dá
 * (herdada), o override (padrão / permitir / negar) e o resultado efetivo.
 */
export function MembershipMatrix({
  groups, inherited, overrides, isAdminRole, disabled, busyCode, onChange,
}: {
  groups: PermissionGroup[]; inherited: Set<string>; overrides: Map<string, OverrideValue>; isAdminRole: boolean; disabled?: boolean; busyCode?: string | null;
  onChange: (perm: Permission, value: OverrideValue) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const effectiveCount = g.items.filter((p) => effectivePermission(isAdminRole, inherited.has(p.code), overrides.get(p.code) ?? "padrao")).length;
        return (
          <section key={g.module} className="card overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-white/[0.03] px-4 py-2.5">
              <h3 className="text-sm font-bold">{g.label}</h3>
              <span className="text-xs tabular-nums text-slate-400">{effectiveCount}/{g.items.length}</span>
            </header>
            <div className="hidden grid-cols-[1fr_90px_90px_170px] gap-2 border-b border-[var(--line)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 md:grid">
              <span>Permissão</span><span>Do perfil</span><span>Efetiva</span><span>Ajuste</span>
            </div>
            <ul className="divide-y divide-[var(--line)]">
              {g.items.map((p) => {
                const inh = inherited.has(p.code);
                const ov = overrides.get(p.code) ?? "padrao";
                const eff = effectivePermission(isAdminRole, inh, ov);
                return (
                  <li key={p.code} className="grid grid-cols-1 gap-2 px-4 py-2.5 md:grid-cols-[1fr_90px_90px_170px] md:items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.description || p.code}</p>
                    </div>
                    <div className="flex items-center gap-4 md:contents">
                      <span className="flex items-center gap-1 md:block"><span className="text-[11px] text-slate-500 md:hidden">perfil:</span><Yes on={isAdminRole || inh} muted /></span>
                      <span className="flex items-center gap-1 md:block"><span className="text-[11px] text-slate-500 md:hidden">efetiva:</span><Yes on={eff} /></span>
                      <span className="ml-auto md:ml-0">
                        {isAdminRole ? (
                          <Badge tone="red">admin: tudo</Badge>
                        ) : (
                          <select
                            value={ov}
                            disabled={disabled || busyCode === p.code}
                            onChange={(e) => onChange(p, e.target.value as OverrideValue)}
                            aria-label={`Ajuste de ${p.name}`}
                            className={`field !h-10 !py-1.5 !text-sm ${ov === "permitir" ? "!border-emerald-500/50" : ov === "negar" ? "!border-rose-500/50" : ""}`}
                          >
                            {OVERRIDES.map((o) => <option key={o} value={o}>{OVERRIDE_LABEL[o]}</option>)}
                          </select>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Matriz de um perfil de acesso: marca/desmarca permissões (por módulo também). */
export function RoleMatrix({
  groups, selected, readOnly, isAdminRole, onToggle, onToggleModule,
}: { groups: PermissionGroup[]; selected: Set<string>; readOnly?: boolean; isAdminRole?: boolean; onToggle: (code: string) => void; onToggleModule: (codes: string[], on: boolean) => void }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const codes = g.items.map((p) => p.code);
        const onCount = isAdminRole ? codes.length : codes.filter((c) => selected.has(c)).length;
        const allOn = onCount === codes.length;
        return (
          <section key={g.module} className="card overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-white/[0.03] px-4 py-2.5">
              <h3 className="text-sm font-bold">{g.label} <span className="ml-1 text-xs font-normal tabular-nums text-slate-400">{onCount}/{codes.length}</span></h3>
              {!readOnly && (
                <button type="button" onClick={() => onToggleModule(codes, !allOn)} className="text-xs font-semibold text-[var(--accent)]">
                  {allOn ? "Desmarcar módulo" : "Marcar módulo"}
                </button>
              )}
            </header>
            <ul className="divide-y divide-[var(--line)]">
              {g.items.map((p) => {
                const on = isAdminRole || selected.has(p.code);
                return (
                  <li key={p.code}>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => onToggle(p.code)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${readOnly ? "cursor-default" : "hover:bg-white/5 active:bg-white/10"}`}
                    >
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-500"}`}>
                        {on && <Icon name="check" size={14} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-100">{p.name}</span>
                        <span className="block text-xs text-slate-500">{p.description || p.code}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
