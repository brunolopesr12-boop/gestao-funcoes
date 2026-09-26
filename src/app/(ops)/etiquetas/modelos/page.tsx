"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { rpc } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { LABEL_KIND_LABEL, type LabelTemplate } from "@/lib/ops/types";
import { sampleLabelData, useCompanyLogo, useLabelTemplates } from "@/lib/ops/modules/labels";
import { Badge, Button, DataTable, EmptyState, ErrorBox, IconButton, InlineAlert, PageHeader, useToast, type Column } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";
import { NewTemplateSheet } from "@/components/ops/etiquetas/NewTemplateSheet";
import { LabelPreview } from "@/components/ops/etiquetas/LabelPreview";
import { ConfirmActionSheet } from "@/components/ops/etiquetas/shared";

/** Modelos de etiqueta da empresa: lista, novo modelo e padrão por tipo. */
export default function ModelosPage() {
  const { company, canCompany } = useSession();
  const router = useRouter();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("etiquetas.editar_modelos");
  const q = useLabelTemplates();
  const logo = useCompanyLogo();
  useRealtimeInvalidate(["label_templates"]);
  const [newOpen, setNewOpen] = useState(false);
  const [toDefault, setToDefault] = useState<LabelTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  async function setDefault(t: LabelTemplate) {
    setBusy(true);
    try {
      await rpc("ops_label_template_set_default", { p_template: t.id });
      notify(`“${t.name}” agora é o padrão de ${LABEL_KIND_LABEL[t.kind]}`);
      invalidate("label_templates");
      setToDefault(null);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  async function seed() {
    if (!company) return;
    setBusy(true);
    try {
      const n = await rpc<number>("ops_label_templates_seed_defaults", { p_company: company.id });
      notify(`${n} modelo(s) de fábrica criado(s)`);
      invalidate("label_templates");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  const rows = q.data ?? [];
  const sample = sampleLabelData(company, logo.data ?? "");
  const columns: Column<LabelTemplate>[] = [
    {
      key: "preview", label: "", hideOnMobile: true, className: "w-[120px]",
      render: (t) => (
        <div className="overflow-hidden" style={{ width: 100, height: Math.round((100 * Number(t.height_mm)) / Math.max(1, Number(t.width_mm))) }}>
          <LabelPreview template={t} data={sample} scale={100 / (Number(t.width_mm) * 3.7795)} />
        </div>
      ),
    },
    { key: "name", label: "Nome", render: (t) => <span className={`font-semibold ${t.active ? "" : "text-slate-500 line-through"}`}>{t.name}</span> },
    { key: "kind", label: "Tipo", render: (t) => <Badge tone="blue">{LABEL_KIND_LABEL[t.kind]}</Badge> },
    { key: "size", label: "Tamanho", render: (t) => <span className="tabular-nums text-slate-300">{Number(t.width_mm)} × {Number(t.height_mm)} mm</span> },
    { key: "is_default", label: "Padrão", render: (t) => (t.is_default ? <Badge tone="green" dot="⭐">padrão do tipo</Badge> : <span className="text-slate-500">—</span>) },
    { key: "active", label: "Ativo", render: (t) => <Badge tone={t.active ? "green" : "slate"}>{t.active ? "Ativo" : "Inativo"}</Badge> },
    {
      key: "actions", label: "", align: "right",
      render: (t) => (
        <span className="inline-flex items-center gap-1.5">
          {canEdit && !t.is_default && (
            <Button size="sm" variant="soft" disabled={busy} onClick={() => setToDefault(t)}>
              <Icon name="star" size={14} /> Definir como padrão
            </Button>
          )}
          <IconButton icon={canEdit ? "edit" : "eye"} label={canEdit ? "Editar modelo" : "Ver modelo"} href={`/etiquetas/modelos/${t.id}`} tone="primary" />
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        backHref="/etiquetas"
        title="Modelos de etiqueta"
        subtitle={company?.name}
        icon="layers"
        actions={canEdit ? <Button variant="primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={18} /> Novo modelo</Button> : undefined}
      />
      {!canEdit && <InlineAlert tone="slate" icon="lock">Você pode ver os modelos, mas só quem tem a permissão “Editar modelos de etiqueta” altera ou cria modelos.</InlineAlert>}
      <InlineAlert tone="blue" icon="info">
        Cada tipo de etiqueta (produção, abertura, congelamento…) tem um <strong>modelo padrão</strong>, escolhido automaticamente na hora de imprimir. Os tamanhos são em milímetros e valem para qualquer impressora térmica.
      </InlineAlert>

      {q.error ? (
        <ErrorBox error={toOpsError(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : !q.isLoading && rows.length === 0 ? (
        <EmptyState
          emoji="🏷️"
          title="Nenhum modelo de etiqueta"
          description={canEdit ? "Crie os modelos de fábrica (60×40 mm para cada tipo + um pequeno 50×30) e ajuste depois no editor." : "Peça ao gerente para criar os modelos de etiqueta da empresa."}
          action={
            canEdit ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" size="lg" disabled={busy} onClick={() => void seed()}><Icon name="sparkles" size={18} /> Criar modelos de fábrica</Button>
                <Button variant="soft" size="lg" onClick={() => setNewOpen(true)}><Icon name="plus" size={18} /> Novo modelo</Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          mobileCard={(t) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className={`truncate font-semibold ${t.active ? "" : "text-slate-500 line-through"}`}>{t.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                  <Badge tone="blue">{LABEL_KIND_LABEL[t.kind]}</Badge>
                  <span className="tabular-nums">{Number(t.width_mm)}×{Number(t.height_mm)} mm</span>
                  {t.is_default && <Badge tone="green" dot="⭐">padrão</Badge>}
                  {!t.active && <Badge tone="slate">inativo</Badge>}
                </p>
                {canEdit && !t.is_default && (
                  <button type="button" disabled={busy} onClick={() => setToDefault(t)} className="mt-1.5 text-xs font-semibold text-[var(--accent)]">Definir como padrão do tipo</button>
                )}
              </div>
              <IconButton icon={canEdit ? "edit" : "eye"} label={canEdit ? "Editar modelo" : "Ver modelo"} href={`/etiquetas/modelos/${t.id}`} tone="primary" size={44} />
            </div>
          )}
        />
      )}

      <NewTemplateSheet open={newOpen} onClose={() => setNewOpen(false)} templates={rows} onCreated={(id) => router.push(`/etiquetas/modelos/${id}`)} />
      <ConfirmActionSheet
        open={Boolean(toDefault)}
        onClose={() => setToDefault(null)}
        title="Definir como padrão do tipo"
        message={toDefault ? <>“{toDefault.name}” passa a ser usado automaticamente nas etiquetas de <strong>{LABEL_KIND_LABEL[toDefault.kind]}</strong>. O modelo padrão atual deixa de ser padrão.</> : null}
        confirmLabel="Definir como padrão"
        busy={busy}
        onConfirm={() => { if (toDefault) void setDefault(toDefault); }}
      />
    </div>
  );
}
