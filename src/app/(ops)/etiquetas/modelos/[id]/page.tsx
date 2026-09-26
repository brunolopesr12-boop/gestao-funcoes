"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { LABEL_KIND_LABEL, type LabelTemplate } from "@/lib/ops/types";
import { factoryLayout, sampleLabelData, toZpl, useCompanyLogo, useLabelTemplate } from "@/lib/ops/modules/labels";
import { Badge, Button, ConfirmSheet, EmptyState, ErrorBox, InlineAlert, PageHeader, SectionCard, Skeleton, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { LayoutEditor } from "@/components/ops/etiquetas/LayoutEditor";
import { LabelPreview, LabelPrintArea } from "@/components/ops/etiquetas/LabelPreview";
import { ConfirmActionSheet, ZoomPicker, ZplButtons } from "@/components/ops/etiquetas/shared";

/** EDITOR VISUAL de um modelo de etiqueta. */
export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { company, canCompany } = useSession();
  const canEdit = canCompany("etiquetas.editar_modelos");
  const notify = useToast();
  const invalidate = useInvalidate();
  const q = useLabelTemplate(id);
  const logo = useCompanyLogo();

  const [draft, setDraft] = useState<LabelTemplate | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // carrega a cópia local uma vez por modelo (não sobrescreve o que está sendo editado)
  const loadedId = useRef<string | null>(null);
  useEffect(() => {
    if (q.data && loadedId.current !== q.data.id) {
      loadedId.current = q.data.id;
      setDraft(q.data);
    }
  }, [q.data]);

  const dirty = useMemo(() => Boolean(draft && q.data && JSON.stringify(draft) !== JSON.stringify(q.data)), [draft, q.data]);
  const sample = useMemo(() => sampleLabelData(company, logo.data ?? ""), [company, logo.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return notify("Dê um nome ao modelo.", "erro");
    const w = Number(draft.width_mm), h = Number(draft.height_mm);
    if (!(w >= 20 && w <= 300 && h >= 10 && h <= 300)) return notify("Tamanho inválido (mínimo 20×10 mm, máximo 300×300 mm).", "erro");
    setBusy(true);
    try {
      const { error } = await supabaseBrowser()
        .from("label_templates")
        .update({ name, kind: draft.kind, width_mm: w, height_mm: h, layout: draft.layout, active: draft.active, is_default: draft.is_default })
        .eq("id", draft.id);
      if (error) throw toOpsError(error);
      if (draft.is_default) await rpc("ops_label_template_set_default", { p_template: draft.id });
      notify("Modelo salvo");
      invalidate("label_templates");
      const fresh = await q.refetch();
      if (fresh.data) setDraft(fresh.data);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  function restore() {
    if (!draft) return;
    const f = factoryLayout(draft.kind);
    setDraft({ ...draft, width_mm: f.width_mm, height_mm: f.height_mm, layout: f.layout });
    setSelected(null);
    setConfirmRestore(false);
    notify("Layout de fábrica restaurado. Salve para aplicar.", "info");
  }

  async function remove() {
    if (!draft) return;
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().from("label_templates").delete().eq("id", draft.id);
      if (error) throw toOpsError(error);
      notify("Modelo excluído");
      invalidate("label_templates");
      router.replace("/etiquetas/modelos");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  function testPrint() {
    if (!draft) return;
    window.print();
  }

  if (q.isLoading || (q.data && !draft)) return <Skeleton rows={4} />;
  if (q.error) return <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data || !draft) {
    return (
      <EmptyState emoji="🔎" title="Modelo não encontrado" description="Ele pode ter sido excluído ou pertencer a outra empresa." action={<Link href="/etiquetas/modelos" className="text-sm font-semibold text-[var(--accent)]">Voltar para modelos</Link>} />
    );
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          backHref="/etiquetas/modelos"
          title={draft.name || "Modelo de etiqueta"}
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Badge tone="blue">{LABEL_KIND_LABEL[draft.kind]}</Badge>
              <span className="tabular-nums">{Number(draft.width_mm)} × {Number(draft.height_mm)} mm</span>
              {draft.is_default && <Badge tone="green" dot="⭐">padrão do tipo</Badge>}
              {dirty && <Badge tone="amber">alterações não salvas</Badge>}
            </span>
          }
          icon="layers"
          actions={canEdit ? <Button variant="primary" size="lg" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button> : undefined}
        />
        {!canEdit && <InlineAlert tone="slate" icon="lock">Somente visualização: você não tem a permissão “Editar modelos de etiqueta”.</InlineAlert>}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* pré-visualização (em cima no celular, à direita no desktop) */}
          <div className="order-1 lg:order-2 lg:sticky lg:top-4 lg:self-start">
            <SectionCard title="Pré-visualização" action={<ZoomPicker value={zoom} onChange={setZoom} />}>
              <p className="mb-3 text-xs text-slate-500">Dados de exemplo (Recheio de frango, lote L260926-001, datas de hoje). Toque em um campo para editá-lo.</p>
              <div className="scrollbar-thin overflow-auto rounded-xl bg-[repeating-linear-gradient(45deg,rgba(255,255,255,.03),rgba(255,255,255,.03)_8px,transparent_8px,transparent_16px)] p-4" onClick={() => setSelected(null)}>
                <LabelPreview template={draft} data={sample} scale={zoom} guides selected={selected} onSelect={setSelected} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button variant="soft" size="lg" onClick={testPrint}><Icon name="printer" size={18} /> Imprimir teste</Button>
                {canEdit && <Button variant="soft" size="lg" onClick={() => setConfirmRestore(true)}><Icon name="refresh" size={18} /> Restaurar padrão</Button>}
              </div>
              <div className="mt-2">
                <ZplButtons getZpl={() => toZpl(draft, sample, 1)} filename={`teste-${draft.name.replace(/\s+/g, "-").toLowerCase() || "modelo"}.zpl`} />
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                O teste imprime na impressora deste aparelho, uma etiqueta por página no tamanho do modelo, e não entra no histórico. O ZPL é para impressoras Zebra/compatíveis (203 dpi).
              </p>
              {canEdit && (
                <button type="button" onClick={() => setConfirmDelete(true)} className="mt-4 text-xs font-semibold text-rose-300 underline">Excluir este modelo</button>
              )}
            </SectionCard>
          </div>

          <div className={`order-2 lg:order-1 ${canEdit ? "" : "pointer-events-none opacity-70"}`}>
            <LayoutEditor template={draft} onChange={setDraft} selected={selected} onSelect={setSelected} logoUrl={logo.data ?? ""} />
            {canEdit && (
              <div className="mt-4">
                <Button variant="primary" size="lg" full disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar modelo"}</Button>
              </div>
            )}
          </div>
        </div>

        <ConfirmActionSheet
          open={confirmRestore}
          onClose={() => setConfirmRestore(false)}
          title="Restaurar layout de fábrica"
          message={<>O layout volta ao modelo de fábrica de <strong>{LABEL_KIND_LABEL[draft.kind]}</strong> ({factoryLayout(draft.kind).width_mm}×{factoryLayout(draft.kind).height_mm} mm). Suas posições e campos atuais serão descartados (só depois de salvar isso passa a valer).</>}
          confirmLabel="Restaurar"
          onConfirm={restore}
        />
        <ConfirmSheet
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Excluir modelo"
          message={`Excluir “${draft.name}”? As etiquetas já impressas continuam no histórico. Se preferir, marque o modelo como inativo.`}
          confirmLabel="Excluir"
          onConfirm={() => void remove()}
        />
      </div>

      <LabelPrintArea template={draft} jobs={[{ key: "teste", data: sample, copies: 1 }]} />
    </div>
  );
}
