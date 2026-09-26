"use client";

import { useCompanyStores } from "@/lib/ops/modules/usuarios";
import { Toggle } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { Label } from "./Common";

/**
 * Unidades liberadas para um vínculo: "todas" ou lista escolhida.
 * Usado no cadastro/convite e na edição do usuário.
 */
export function StoreAccess({
  allStores, storeIds, onChange, disabled, hint,
}: { allStores: boolean; storeIds: string[]; onChange: (allStores: boolean, storeIds: string[]) => void; disabled?: boolean; hint?: string }) {
  const q = useCompanyStores();
  const stores = q.data ?? [];
  const toggle = (id: string) => onChange(false, storeIds.includes(id) ? storeIds.filter((s) => s !== id) : [...storeIds, id]);

  return (
    <div className="mb-4">
      <Label hint={hint ?? "Administradores sempre enxergam todas as unidades."}>Unidades</Label>
      <Toggle checked={allStores} onChange={(v) => onChange(v, v ? [] : storeIds)} label="Todas as unidades" hint="Inclui unidades criadas no futuro" disabled={disabled} />
      {!allStores && (
        <div className="space-y-1.5">
          {q.isLoading && <p className="text-sm text-slate-400">Carregando unidades…</p>}
          {stores.map((s) => {
            const on = storeIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(s.id)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition disabled:opacity-50 ${
                  on ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--line)] bg-white/5 text-slate-300"
                }`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-slate-500"}`}>
                  {on && <Icon name="check" size={14} />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {s.name}
                  {!s.active && <span className="ml-2 text-xs font-normal text-slate-500">(inativa)</span>}
                </span>
                {s.code && <span className="font-mono text-xs text-slate-500">{s.code}</span>}
              </button>
            );
          })}
          {!q.isLoading && stores.length === 0 && <p className="text-sm text-amber-200">Nenhuma unidade cadastrada. Crie uma em Configurações → Unidades.</p>}
          {!allStores && storeIds.length === 0 && stores.length > 0 && <p className="text-xs text-amber-200">Escolha pelo menos uma unidade, senão a pessoa não verá nada.</p>}
        </div>
      )}
    </div>
  );
}
