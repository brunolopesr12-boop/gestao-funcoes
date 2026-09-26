"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import type { Category } from "@/lib/ops/types";
import { CATEGORY_COLORS, CATEGORY_EMOJIS, type CategoryRow } from "@/lib/ops/modules/cadastros";
import { Button, Field, Select, Sheet, TextInput, Toggle, useToast } from "@/components/ops/ui";
import { EmojiPicker } from "@/components/ui";

/**
 * Criar/editar categoria ou subcategoria.
 * `parents` = categorias de primeiro nível (para escolher a categoria-mãe).
 */
export function CategoryEditorSheet({
  open, onClose, category, parents, defaultParentId, nextPosition,
}: { open: boolean; onClose: () => void; category: CategoryRow | null; parents: Category[]; defaultParentId?: string | null; nextPosition: number }) {
  const { company } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📦");
  const [color, setColor] = useState("#64748b");
  const [parentId, setParentId] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setEmoji(category?.emoji ?? "📦");
    setColor(category?.color ?? "#64748b");
    setParentId(category?.parent_id ?? defaultParentId ?? "");
    setActive(category?.active ?? true);
  }, [open, category, defaultParentId]);

  // uma categoria que já tem subcategorias não pode virar subcategoria
  const hasChildren = Number(category?.children_count ?? 0) > 0;
  const parentOptions = parents.filter((p) => p.id !== category?.id);

  async function save() {
    if (!company) return;
    if (!name.trim()) return notify("Informe o nome da categoria.", "erro");
    setBusy(true);
    try {
      const payload = { company_id: company.id, name: name.trim(), emoji: emoji || "📦", color, parent_id: parentId || null, active };
      if (category) {
        const r = await supabaseBrowser().from("categories").update(payload).eq("id", category.id).select("id");
        if (r.error) throw r.error;
        if (!r.data?.length) throw new Error("Você não tem permissão para editar categorias.");
        notify("Categoria salva");
      } else {
        const { error } = await supabaseBrowser().from("categories").insert({ ...payload, position: nextPosition });
        if (error) throw error;
        notify("Categoria criada");
      }
      invalidate("categories", "products");
      onClose();
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
      title={category ? "Editar categoria" : parentId ? "Nova subcategoria" : "Nova categoria"}
      footer={
        <div className="flex gap-2 pb-3">
          <Button variant="soft" size="lg" full onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="lg" full onClick={() => void save()} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      }
    >
      <Field label="Nome">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Carnes, Laticínios, Hortifrúti" autoFocus />
      </Field>
      <Field label="Categoria-mãe" hint={hasChildren ? "Esta categoria tem subcategorias, por isso precisa continuar no primeiro nível." : "Deixe em branco para uma categoria de primeiro nível."}>
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={hasChildren}>
          <option value="">Nenhuma (primeiro nível)</option>
          {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
        </Select>
      </Field>
      <div className="mb-4">
        <span className="mb-1.5 block text-sm font-semibold text-slate-300">Emoji</span>
        <EmojiPicker value={emoji} onChange={setEmoji} options={CATEGORY_EMOJIS.includes(emoji) ? CATEGORY_EMOJIS : [emoji, ...CATEGORY_EMOJIS]} />
        <div className="mt-2 flex items-center gap-2">
          <TextInput value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 4))} className="!w-24 text-center text-xl" aria-label="Emoji personalizado" />
          <span className="text-xs text-slate-500">ou digite/cole outro emoji</span>
        </div>
      </div>
      <div className="mb-4">
        <span className="mb-1.5 block text-sm font-semibold text-slate-300">Cor</span>
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORY_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={`h-9 w-9 rounded-full border-2 transition ${color === c ? "scale-110 border-white" : "border-transparent"}`} style={{ background: c }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Outra cor" className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent" />
        </div>
      </div>
      <Toggle checked={active} onChange={setActive} label="Categoria ativa" hint="Categorias inativas não aparecem para escolher em produtos novos." />
    </Sheet>
  );
}
