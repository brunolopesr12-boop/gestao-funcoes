"use client";

import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import { useCategoryRows, type CategoryRow } from "@/lib/ops/modules/cadastros";
import { Badge, Button, ConfirmSheet, EmptyState, ErrorBox, IconButton, InlineAlert, PageHeader, Skeleton, Toggle, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { CadastrosSubnav } from "@/components/ops/cadastros/Subnav";
import { CategoryEditorSheet } from "@/components/ops/cadastros/CategoryEditorSheet";

/** Categorias e subcategorias de produtos (v_categories). */
export default function CategoriasPage() {
  const { canCompany } = useSession();
  const canEdit = canCompany("produtos.editar");
  const notify = useToast();
  const invalidate = useInvalidate();
  const q = useCategoryRows();
  useRealtimeInvalidate(["categories", "products"]);

  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const parents = useMemo(() => all.filter((c) => !c.parent_id).filter((c) => showInactive || c.active), [all, showInactive]);
  const childrenOf = (id: string) => all.filter((c) => c.parent_id === id).filter((c) => showInactive || c.active);
  const totalProducts = all.reduce((s, c) => s + Number(c.products_count), 0);

  /** Move a categoria uma posição para cima/baixo entre as irmãs, regravando as posições. */
  async function move(cat: CategoryRow, dir: -1 | 1) {
    const siblings = all.filter((c) => (c.parent_id ?? null) === (cat.parent_id ?? null)).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const i = siblings.findIndex((c) => c.id === cat.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    const order = [...siblings];
    [order[i], order[j]] = [order[j], order[i]];
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      for (let k = 0; k < order.length; k++) {
        if (order[k].position !== k) {
          const r = await sb.from("categories").update({ position: k }).eq("id", order[k].id);
          if (r.error) throw r.error;
        }
      }
      invalidate("categories");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(cat: CategoryRow) {
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("categories").update({ active: !cat.active }).eq("id", cat.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error("Você não tem permissão para editar categorias.");
      invalidate("categories");
      notify(cat.active ? "Categoria inativada" : "Categoria reativada");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function remove(cat: CategoryRow) {
    setBusy(true);
    try {
      const r = await supabaseBrowser().from("categories").delete().eq("id", cat.id).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error("Você não tem permissão para excluir categorias.");
      invalidate("categories", "products");
      notify("Categoria excluída");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const nextPosition = (parentId: string | null) => all.filter((c) => (c.parent_id ?? null) === parentId).reduce((m, c) => Math.max(m, c.position + 1), 0);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Categorias"
        subtitle={`${all.filter((c) => c.active).length} categorias · ${totalProducts} produtos classificados`}
        backHref="/produtos"
        icon="layers"
        actions={canEdit ? <Button variant="primary" onClick={() => setCreating({ parentId: null })}><Icon name="plus" size={18} /> Nova categoria</Button> : undefined}
      />
      <CadastrosSubnav />
      <div className="mb-3 sm:max-w-xs"><Toggle checked={showInactive} onChange={setShowInactive} label="Mostrar inativas" /></div>

      {q.isLoading ? (
        <Skeleton rows={4} />
      ) : q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : parents.length === 0 ? (
        <EmptyState emoji="🗂️" title="Nenhuma categoria" description="Categorias organizam o catálogo (ex.: Carnes, Laticínios, Hortifrúti) e permitem filtrar estoque e relatórios." action={canEdit ? <Button variant="primary" onClick={() => setCreating({ parentId: null })}>Criar a primeira categoria</Button> : undefined} />
      ) : (
        <>
          {!canEdit && <InlineAlert tone="slate" icon="lock">Você pode consultar as categorias, mas não alterá-las (produtos.editar).</InlineAlert>}
          <div className="card divide-y divide-[var(--line)] overflow-hidden">
            {parents.map((p, i) => {
              const kids = childrenOf(p.id);
              return (
                <div key={p.id}>
                  <CategoryRowItem cat={p} sub={false} first={i === 0} last={i === parents.length - 1} canEdit={canEdit} busy={busy} onMove={move} onAddChild={(id) => setCreating({ parentId: id })} onEdit={setEditing} onToggle={toggleActive} onDelete={setDeleting} />
                  {kids.length > 0 && (
                    <div className="divide-y divide-[var(--line)] border-t border-[var(--line)] bg-black/10">
                      {kids.map((k, j) => <CategoryRowItem key={k.id} cat={k} sub first={j === 0} last={j === kids.length - 1} canEdit={canEdit} busy={busy} onMove={move} onAddChild={(id) => setCreating({ parentId: id })} onEdit={setEditing} onToggle={toggleActive} onDelete={setDeleting} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">Use as setas para definir a ordem em que as categorias aparecem nas listas. A ordem é a mesma para toda a empresa.</p>
        </>
      )}

      <CategoryEditorSheet open={Boolean(editing) || Boolean(creating)} onClose={() => { setEditing(null); setCreating(null); }} category={editing} parents={all.filter((c) => !c.parent_id)} defaultParentId={creating?.parentId ?? null} nextPosition={nextPosition(editing ? (editing.parent_id ?? null) : (creating?.parentId ?? null))} />
      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Excluir categoria"
        message={
          deleting
            ? `Excluir “${deleting.name}”? ${Number(deleting.all_products_count) > 0 ? `${deleting.all_products_count} produto(s) ficarão sem categoria. ` : ""}${Number(deleting.children_count) > 0 ? `As ${deleting.children_count} subcategorias passarão para o primeiro nível. ` : ""}Se preferir só esconder, use “Inativar”.`
            : ""
        }
        confirmLabel="Excluir"
        onConfirm={() => { if (deleting) void remove(deleting); }}
      />
    </div>
  );
}

/** Botão de mover (seta para cima/baixo). */
function MoveButton({ up, disabled, onClick }: { up?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={up ? "Mover para cima" : "Mover para baixo"} title={up ? "Mover para cima" : "Mover para baixo"} className="grid h-[34px] w-[34px] place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-40">
      <Icon name="chevronDown" size={18} className={up ? "rotate-180" : ""} />
    </button>
  );
}

/** Linha de categoria/subcategoria com contagem e ações. */
function CategoryRowItem({
  cat, sub, first, last, canEdit, busy, onMove, onAddChild, onEdit, onToggle, onDelete,
}: {
  cat: CategoryRow; sub: boolean; first: boolean; last: boolean; canEdit: boolean; busy: boolean;
  onMove: (cat: CategoryRow, dir: -1 | 1) => Promise<void>; onAddChild: (parentId: string) => void; onEdit: (cat: CategoryRow) => void; onToggle: (cat: CategoryRow) => Promise<void>; onDelete: (cat: CategoryRow) => void;
}) {
  const n = Number(cat.products_count), all = Number(cat.all_products_count), kids = Number(cat.children_count);
  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${sub ? "pl-10" : ""} ${!cat.active ? "opacity-60" : ""}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${cat.color}33`, border: `1px solid ${cat.color}66` }}>{cat.emoji}</span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate">{cat.name}</span>
          {!cat.active && <Badge tone="red">inativa</Badge>}
        </p>
        <p className="text-xs text-slate-500">
          {n} {n === 1 ? "produto ativo" : "produtos ativos"}
          {all > n && ` (${all - n} inativos)`}
          {!sub && kids > 0 && ` · ${kids} subcategoria${kids === 1 ? "" : "s"}`}
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <MoveButton up disabled={busy || first} onClick={() => void onMove(cat, -1)} />
          <MoveButton disabled={busy || last} onClick={() => void onMove(cat, 1)} />
          {!sub && <IconButton icon="plus" label="Nova subcategoria" size={34} onClick={() => onAddChild(cat.id)} />}
          <IconButton icon="edit" label="Editar" size={34} onClick={() => onEdit(cat)} />
          <IconButton icon={cat.active ? "eye" : "check"} label={cat.active ? "Inativar" : "Reativar"} size={34} disabled={busy} onClick={() => void onToggle(cat)} />
          <IconButton icon="trash" label="Excluir" tone="danger" size={34} disabled={busy} onClick={() => onDelete(cat)} />
        </div>
      )}
    </div>
  );
}
