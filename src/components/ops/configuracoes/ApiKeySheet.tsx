"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { API_SCOPES, generateApiKey } from "@/lib/ops/modules/configuracoes";
import { Button, Field, InlineAlert, Sheet, TextInput, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { CopyButton, Label } from "@/components/ops/usuarios/Common";

/**
 * Nova chave de API: gerada no navegador (vr_ + 32 bytes aleatórios), só o
 * hash sha256 vai para o banco. A chave em texto aparece UMA vez.
 */
export function ApiKeySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { company, user } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["estoque.ler", "produtos.ler"]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setScopes(["estoque.ler", "produtos.ler"]);
    setCreated(null);
  }, [open]);

  const toggle = (v: string) => {
    if (v === "*") return setScopes(scopes.includes("*") ? [] : ["*"]);
    const next = scopes.filter((s) => s !== "*");
    setScopes(next.includes(v) ? next.filter((s) => s !== v) : [...next, v]);
  };

  async function create() {
    if (!company) return;
    if (name.trim().length < 2) return notify("Dê um nome à chave (ex.: PDV loja 1).", "erro");
    if (scopes.length === 0) return notify("Escolha pelo menos um escopo.", "erro");
    setBusy(true);
    try {
      const { key, hash } = await generateApiKey();
      unwrap(await supabaseBrowser().from("api_keys").insert({ company_id: company.id, name: name.trim(), key_hash: hash, scopes, created_by: user?.id ?? null }));
      setCreated({ key, name: name.trim() });
      invalidate("api_keys");
      notify("Chave criada");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={created ? "Chave criada" : "Nova chave de API"}
      footer={
        created ? (
          <div className="pb-2"><Button variant="primary" size="lg" full onClick={onClose}>Já copiei, fechar</Button></div>
        ) : (
          <div className="flex gap-2 pb-2">
            <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="lg" full disabled={busy} onClick={() => void create()}>{busy ? "Gerando…" : "Gerar chave"}</Button>
          </div>
        )
      }
    >
      {created ? (
        <div>
          <InlineAlert tone="amber" icon="alert">
            <strong>Copie agora.</strong> Por segurança a chave não fica salva: só o seu “resumo” (hash). Se perder, revogue e crie outra.
          </InlineAlert>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">{created.name}</p>
          <div className="card mb-3 flex items-center gap-2 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-sm text-emerald-200">{created.key}</code>
            <CopyButton text={created.key} />
          </div>
          <p className="text-sm text-slate-400">
            O sistema externo envia a chave no cabeçalho <span className="font-mono text-slate-200">Authorization: Bearer {"<chave>"}</span> nas rotas <span className="font-mono">/api/ops/integrations/*</span>.
          </p>
        </div>
      ) : (
        <div>
          <Field label="Nome da chave" hint="Identifique o sistema que vai usá-la."><TextInput value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Ex.: PDV loja Centro, ERP, iFood" /></Field>
          <Label hint="Só libere o que o sistema externo realmente precisa.">Escopos</Label>
          <div className="mb-4 space-y-1.5">
            {API_SCOPES.map((s) => {
              const on = scopes.includes(s.value) || (s.value !== "*" && scopes.includes("*"));
              return (
                <button key={s.value} type="button" onClick={() => toggle(s.value)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${on ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--line)] bg-white/5"}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-slate-500"}`}>{on && <Icon name="check" size={14} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{s.label} <span className="ml-1 font-mono text-xs font-normal text-slate-500">{s.value}</span></span>
                    <span className="block text-xs text-slate-500">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}
