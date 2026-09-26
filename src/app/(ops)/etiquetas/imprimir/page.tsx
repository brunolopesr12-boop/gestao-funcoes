"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { useLocations } from "@/lib/ops/hooks";
import { toOpsError } from "@/lib/ops/errors";
import { LABEL_KIND_LABEL, type LabelKind, type Product, type StockBalance } from "@/lib/ops/types";
import {
  EMPTY_LABEL_DATA, LABEL_KINDS, buildAdHocLabelData, buildLabelData, emptyAdHoc, isLabelKind, isUuid, kindFromOrigin, pickTemplate, registerLabels, sampleLabelData,
  toZpl, totalCopies, useCompanyLogo, useLabelRecord, useLabelTemplates, useLotSummaries, type AdHocLabelInput, type LabelData, type PrintJob,
} from "@/lib/ops/modules/labels";
import { Badge, Button, Choice, EmptyState, ErrorBox, Field, IconButton, InlineAlert, NumberInput, PageHeader, SectionCard, Select, Sheet, Skeleton, TextInput, useToast } from "@/components/ops/ui";
import { LocationSelect, LotPicker, ProductPicker } from "@/components/ops/pickers";
import { QrScanner } from "@/components/ops/QrScanner";
import { parseLotQr } from "@/components/ops/QrCode";
import { Icon } from "@/components/ops/Icon";
import { LabelPreview, LabelPrintArea } from "@/components/ops/etiquetas/LabelPreview";
import { AdHocForm } from "@/components/ops/etiquetas/AdHocForm";
import { ConfirmActionSheet, LinkButton, PrintHelp, ZplButtons } from "@/components/ops/etiquetas/shared";

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <ImprimirPage />
    </Suspense>
  );
}

const CONFIRM_FROM = 10;

/**
 * Impressão de etiquetas.
 *  ?lot=<id>            → uma etiqueta de lote
 *  ?lots=<id,id,...>    → várias (ex.: lotes de um recebimento), cópias individuais
 *  ?kind=<tipo>         → tipo inicial (produção, abertura, …)
 *  ?template=<id>       → modelo inicial
 *  ?label=<id>          → reimpressão de uma etiqueta avulsa do histórico
 *  ?avulsa=1            → começa no modo avulsa
 */
function ImprimirPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { store, company, can, displayName } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canPrint = can("etiquetas.imprimir");

  const lotIds = useMemo(() => {
    const raw = [sp.get("lot") ?? "", ...(sp.get("lots") ?? "").split(",")].map((s) => s.trim()).filter(isUuid);
    return Array.from(new Set(raw));
  }, [sp]);
  const labelParam = sp.get("label");
  const kindParam = sp.get("kind");
  const templateParam = sp.get("template");
  const startAdHoc = sp.get("avulsa") === "1";
  const hasSource = lotIds.length > 0 || Boolean(labelParam && isUuid(labelParam));

  /* ---------------- passo 1: origem ---------------- */
  const [mode, setMode] = useState<"lote" | "avulsa">(startAdHoc ? "avulsa" : "lote");
  const [product, setProduct] = useState<Product | null>(null);
  const [scan, setScan] = useState(false);
  const [adhoc, setAdhoc] = useState<AdHocLabelInput>(() => emptyAdHoc(displayName));
  const [adhocReady, setAdhocReady] = useState(false);

  useEffect(() => {
    setAdhoc((a) => (a.responsible ? a : { ...a, responsible: displayName }));
  }, [displayName]);

  const goLot = useCallback(
    (lotId: string, kind?: LabelKind) => {
      const k = kind ?? (isLabelKind(kindParam) ? kindParam : null);
      router.replace(`/etiquetas/imprimir?lot=${lotId}${k ? `&kind=${k}` : ""}`);
    },
    [router, kindParam],
  );
  const onScan = useCallback(
    (text: string) => {
      const id = parseLotQr(text);
      setScan(false);
      if (id) goLot(id);
      else notify("Este código não é o QR Code de um lote.", "erro");
    },
    [goLot, notify],
  );

  /* ---------------- passo 2: dados ---------------- */
  const summaries = useLotSummaries(lotIds);
  const labelRec = useLabelRecord(labelParam && isUuid(labelParam) ? labelParam : null);
  const templates = useLabelTemplates({ onlyActive: true });
  const logo = useCompanyLogo();
  const locations = useLocations();

  const [kind, setKind] = useState<LabelKind | null>(isLabelKind(kindParam) ? kindParam : null);
  const [templateId, setTemplateId] = useState<string | null>(templateParam);
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [responsible, setResponsible] = useState(displayName);
  const [locationId, setLocationId] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<1 | 2>(1);

  useEffect(() => {
    setResponsible((r) => r || displayName);
  }, [displayName]);

  const firstSummary = useMemo(() => summaries.data?.find((s) => s !== null) ?? null, [summaries.data]);
  const effectiveKind: LabelKind = kind ?? (labelRec.data?.kind && isLabelKind(labelRec.data.kind) ? labelRec.data.kind : firstSummary ? kindFromOrigin(firstSummary.lot.origin) : mode === "avulsa" ? "generica" : "producao");
  // reimpressão do histórico: sem ?template=, prefere o modelo usado na etiqueta original
  const preferredTemplateId = templateId ?? labelRec.data?.template_id ?? null;
  const template = useMemo(() => pickTemplate(templates.data ?? [], effectiveKind, preferredTemplateId), [templates.data, effectiveKind, preferredTemplateId]);
  const locationName = (locations.data ?? []).find((l) => l.id === locationId)?.name ?? "";
  const logoUrl = logo.data ?? "";

  const jobs: PrintJob[] = useMemo(() => {
    if (lotIds.length > 0) {
      return (summaries.data ?? []).flatMap((s) =>
        s
          ? [{ key: s.lot.id, lotId: s.lot.id, productId: s.product.id, copies: copies[s.lot.id] ?? 1, data: buildLabelData(s, { company, responsible, location: locationName || undefined, logoUrl }) }]
          : [],
      );
    }
    if (labelParam && labelRec.data) {
      const rec = labelRec.data;
      const data: LabelData = { ...EMPTY_LABEL_DATA, ...(rec.payload ?? {}), logo_url: logoUrl };
      if (responsible) data.responsible = responsible;
      return [{ key: rec.id, lotId: rec.lot_id, productId: rec.product_id, copies: copies[rec.id] ?? rec.copies ?? 1, data }];
    }
    if (mode === "avulsa" && adhocReady) {
      return [{ key: "avulsa", lotId: null, productId: null, copies: copies.avulsa ?? 1, data: buildAdHocLabelData(adhoc, { company, logoUrl }) }];
    }
    return [];
  }, [lotIds.length, summaries.data, labelParam, labelRec.data, mode, adhocReady, adhoc, copies, company, responsible, locationName, logoUrl]);

  const missing = lotIds.length > 0 && summaries.data ? summaries.data.filter((s) => s === null).length : 0;
  const total = totalCopies(jobs);
  const isAdhocFlow = !hasSource && mode === "avulsa";
  const ready = jobs.length > 0 && Boolean(template) && total > 0;
  const zplAll = () => (template ? jobs.map((j) => toZpl(template, j.data, j.copies)).join("\n") : "");

  async function doPrint() {
    if (!store || !template || jobs.length === 0) return;
    setBusy(true);
    setConfirm(false);
    try {
      await registerLabels(store.id, template.id, effectiveKind, jobs);
      invalidate("labels");
      window.print();
      notify(`${total} etiqueta(s) enviada(s) para a impressora e registrada(s) no histórico`);
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }
  function onPrintClick() {
    if (!ready) return;
    if (total >= CONFIRM_FROM) setConfirm(true);
    else void doPrint();
  }

  if (!canPrint) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader backHref="/etiquetas" title="Imprimir etiqueta" icon="printer" />
        <EmptyState emoji="🔒" title="Sem permissão para imprimir etiquetas" description="Peça ao gerente a permissão “Imprimir etiquetas”." />
      </div>
    );
  }

  /* ======================= PASSO 1 ======================= */
  if (!hasSource && !(mode === "avulsa" && adhocReady)) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader backHref="/etiquetas" title="Imprimir etiqueta" subtitle="Passo 1 de 2 · o que vai ser etiquetado?" icon="printer" />
        <Choice<"lote" | "avulsa">
          value={mode}
          onChange={setMode}
          options={[
            { value: "lote", label: "Lote do sistema", hint: "Produto + lote (com QR Code)", icon: "qr" },
            { value: "avulsa", label: "Avulsa (sem lote)", hint: "Digitar produto, quantidade e datas", icon: "tag" },
          ]}
        />
        {mode === "lote" ? (
          <SectionCard title="Escolha o produto e o lote">
            <ProductPicker value={product} onChange={setProduct} autoFocus onScan={() => setScan(true)} />
            {product ? (
              <LotPicker productId={product.id} value={null} includeExpired onChange={(l: StockBalance | null) => l && goLot(l.lot_id)} />
            ) : (
              <p className="text-sm text-slate-400">Ou leia o QR Code de uma etiqueta já impressa para reimprimir o mesmo lote.</p>
            )}
            {product && (
              <p className="mt-2 text-xs text-slate-500">
                Só aparecem lotes com saldo. Para um lote sem saldo, abra-o em <Link href="/estoque/lotes" className="font-semibold text-[var(--accent)]">Estoque › Lotes</Link> e use “Imprimir etiqueta”.
              </p>
            )}
            <Button variant="soft" size="lg" full className="mt-3" onClick={() => setScan(true)}><Icon name="scan" size={18} /> Ler QR Code de uma etiqueta</Button>
          </SectionCard>
        ) : (
          <SectionCard title="Dados da etiqueta avulsa">
            <p className="mb-3 text-xs text-slate-500">Etiqueta avulsa não tem QR Code nem vínculo com o estoque — serve para itens fora do sistema.</p>
            <p className="mb-1.5 text-sm font-semibold text-slate-300">Tipo de etiqueta</p>
            <Choice<LabelKind> value={effectiveKind} onChange={setKind} columns={4} options={LABEL_KINDS.map((k) => ({ value: k, label: LABEL_KIND_LABEL[k] }))} />
            <AdHocForm value={adhoc} onChange={setAdhoc} kind={effectiveKind} />
            <Button
              variant="primary"
              size="lg"
              full
              onClick={() => {
                if (!adhoc.product_name.trim()) return notify("Informe o nome do produto.", "erro");
                if (!adhoc.expires_at) return notify("Informe a validade.", "erro");
                setAdhocReady(true);
              }}
            >
              Continuar <Icon name="chevronRight" size={18} />
            </Button>
          </SectionCard>
        )}
        <Sheet open={scan} onClose={() => setScan(false)} title="Ler QR Code">
          {scan && <QrScanner onResult={onScan} onClose={() => setScan(false)} hint="Aponte para o QR Code da etiqueta do lote" />}
        </Sheet>
      </div>
    );
  }

  /* ======================= PASSO 2 ======================= */
  const loading = (lotIds.length > 0 && summaries.isLoading) || (Boolean(labelParam) && labelRec.isLoading) || templates.isLoading;
  const loadError = summaries.error ?? labelRec.error ?? templates.error;
  const kindTemplates = (templates.data ?? []).filter((t) => t.kind === effectiveKind);
  const otherTemplates = (templates.data ?? []).filter((t) => t.kind !== effectiveKind);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="print:hidden">
        <PageHeader
          backHref={isAdhocFlow ? undefined : "/etiquetas"}
          title="Imprimir etiqueta"
          subtitle={`Passo 2 de 2 · ${lotIds.length > 1 ? `${lotIds.length} lotes` : lotIds.length === 1 ? "1 lote" : "etiqueta avulsa"}`}
          icon="printer"
          actions={isAdhocFlow ? <Button variant="soft" onClick={() => setAdhocReady(false)}><Icon name="arrowLeft" size={16} /> Editar dados</Button> : undefined}
        />
        <PrintHelp compact />

        {loading ? (
          <Skeleton rows={3} />
        ) : loadError ? (
          <ErrorBox error={toOpsError(loadError as Error).message} onRetry={() => { void summaries.refetch(); void templates.refetch(); void labelRec.refetch(); }} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            {/* -------- configuração -------- */}
            <div className="space-y-4">
              {missing > 0 && jobs.length > 0 && <InlineAlert tone="amber">{missing} lote(s) não encontrado(s) ou sem acesso nesta unidade — foram ignorados.</InlineAlert>}
              {lotIds.length > 0 && jobs.length === 0 && (
                <EmptyState emoji="🔎" title="Lote não encontrado" description="Este lote não existe, foi removido ou pertence a outra unidade." action={<LinkButton href="/etiquetas/imprimir" variant="soft">Escolher outro lote</LinkButton>} />
              )}
              {labelParam && !labelRec.data && !labelRec.isLoading && (
                <EmptyState emoji="🔎" title="Etiqueta não encontrada no histórico" action={<LinkButton href="/etiquetas/historico" variant="soft">Voltar ao histórico</LinkButton>} />
              )}

              {jobs.length > 0 && (
                <SectionCard title={jobs.length > 1 ? "Lotes e cópias" : "Etiqueta e cópias"}>
                  <ul className="divide-y divide-[var(--line)]">
                    {jobs.map((j) => (
                      <li key={j.key} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{j.data.product_name || "—"}</p>
                          <p className="text-xs text-slate-400">
                            {j.data.lot_code ? <span className="font-mono">Lote {j.data.lot_code}</span> : "sem lote"}
                            {j.data.expires_at && <> · val. {j.data.expires_at}</>}
                            {j.data.quantity && <> · {j.data.quantity}</>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton icon="minus" label="Menos uma cópia" onClick={() => setCopies((c) => ({ ...c, [j.key]: Math.max(1, (c[j.key] ?? j.copies) - 1) }))} />
                          <NumberInput value={j.copies} onChange={(v) => setCopies((c) => ({ ...c, [j.key]: Math.max(1, Math.round(v ?? 1)) }))} min={1} inputMode="numeric" className="w-20" big />
                          <IconButton icon="plus" label="Mais uma cópia" onClick={() => setCopies((c) => ({ ...c, [j.key]: Math.min(500, (c[j.key] ?? j.copies) + 1) }))} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {jobs.length > 1 && (
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-400">Total</span>
                      <span className="font-bold tabular-nums">{total} etiqueta(s)</span>
                      <Button size="sm" variant="ghost" onClick={() => setCopies(Object.fromEntries(jobs.map((j) => [j.key, 1])))}>1 cópia em todos</Button>
                    </div>
                  )}
                </SectionCard>
              )}

              <SectionCard title="Tipo de etiqueta">
                <Choice<LabelKind> value={effectiveKind} onChange={(k) => { setKind(k); setTemplateId(null); }} columns={4} options={LABEL_KINDS.map((k) => ({ value: k, label: LABEL_KIND_LABEL[k] }))} />
                {(templates.data ?? []).length === 0 ? (
                  <InlineAlert tone="red" icon="alert">
                    Nenhum modelo de etiqueta ativo na empresa. <Link href="/etiquetas/modelos" className="font-semibold underline">Crie os modelos</Link> (quem tem permissão de editar modelos) para poder imprimir.
                  </InlineAlert>
                ) : (
                  <Field label="Modelo" hint={template && template.kind !== effectiveKind ? `Não há modelo de ${LABEL_KIND_LABEL[effectiveKind]}; usando “${template.name}” (${LABEL_KIND_LABEL[template.kind]}).` : "O padrão do tipo é escolhido automaticamente."}>
                    <Select value={template?.id ?? ""} onChange={(e) => setTemplateId(e.target.value || null)}>
                      {kindTemplates.length > 0 && (
                        <optgroup label={LABEL_KIND_LABEL[effectiveKind]}>
                          {kindTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {Number(t.width_mm)}×{Number(t.height_mm)} mm{t.is_default ? " · padrão" : ""}</option>)}
                        </optgroup>
                      )}
                      {otherTemplates.length > 0 && (
                        <optgroup label="Outros tipos">
                          {otherTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {LABEL_KIND_LABEL[t.kind]} · {Number(t.width_mm)}×{Number(t.height_mm)} mm</option>)}
                        </optgroup>
                      )}
                    </Select>
                  </Field>
                )}
              </SectionCard>

              {!isAdhocFlow && (
                <SectionCard title="Responsável e local">
                  <Field label="Responsável" hint="Sai na etiqueta. Padrão: você.">
                    <TextInput value={responsible} onChange={(e) => setResponsible(e.target.value)} />
                  </Field>
                  <Field label="Local (opcional)" hint="Se vazio, usa o local onde o lote está guardado.">
                    <LocationSelect value={locationId} onChange={setLocationId} allowEmpty placeholder="Local onde o lote está" />
                  </Field>
                </SectionCard>
              )}
            </div>

            {/* -------- pré-visualização e ações -------- */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <SectionCard
                title="Pré-visualização (tamanho real)"
                action={
                  <span className="inline-flex items-center gap-2">
                    {template && <Badge tone="slate">{Number(template.width_mm)}×{Number(template.height_mm)} mm</Badge>}
                    <button type="button" onClick={() => setZoom(zoom === 1 ? 2 : 1)} className="rounded-lg border border-[var(--line)] bg-white/5 px-2 py-1 text-xs font-bold text-slate-300">{zoom === 1 ? "2×" : "1×"}</button>
                  </span>
                }
              >
                {!template ? (
                  <EmptyState emoji="🏷️" title="Sem modelo de etiqueta" description="Cadastre um modelo em Etiquetas › Modelos para ver a pré-visualização." />
                ) : jobs.length === 0 ? (
                  <div className="scrollbar-thin overflow-auto rounded-xl bg-[repeating-linear-gradient(45deg,rgba(255,255,255,.03),rgba(255,255,255,.03)_8px,transparent_8px,transparent_16px)] p-4">
                    <LabelPreview template={template} data={sampleLabelData(company, logoUrl)} scale={zoom} />
                    <p className="mt-2 text-xs text-slate-500">Exemplo — escolha um lote para ver os dados reais.</p>
                  </div>
                ) : (
                  <div className="scrollbar-thin flex max-h-[60vh] flex-wrap gap-4 overflow-auto rounded-xl bg-[repeating-linear-gradient(45deg,rgba(255,255,255,.03),rgba(255,255,255,.03)_8px,transparent_8px,transparent_16px)] p-4">
                    {jobs.map((j) => (
                      <div key={j.key} className="relative">
                        <LabelPreview template={template} data={j.data} scale={zoom} />
                        {jobs.length > 1 && <span className="absolute -right-2 -top-2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-white">{j.copies}×</span>}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <div className="space-y-2">
                <Button variant="primary" size="lg" full disabled={!ready || busy} onClick={onPrintClick}>
                  <Icon name="printer" size={20} /> {busy ? "Registrando…" : `Imprimir ${total > 0 ? `${total} etiqueta(s)` : ""}`}
                </Button>
                <ZplButtons getZpl={zplAll} disabled={!ready || busy} />
                <p className="text-[11px] text-slate-500">
                  Ao imprimir, as etiquetas ficam registradas no <Link href="/etiquetas/historico" className="underline">histórico</Link> (quem, quando, quantas). Na janela de impressão, escolha a impressora de etiquetas e confira se o tamanho do papel é {template ? `${Number(template.width_mm)}×${Number(template.height_mm)} mm` : "o da etiqueta"} sem margens.
                </p>
              </div>
            </div>
          </div>
        )}

        <ConfirmActionSheet
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Imprimir muitas etiquetas"
          message={<>Serão impressas <strong>{total} etiquetas</strong> ({jobs.length} lote(s)). Confira as cópias para não desperdiçar o rolo.</>}
          confirmLabel={`Imprimir ${total}`}
          busy={busy}
          onConfirm={doPrint}
        />
      </div>

      <LabelPrintArea template={template} jobs={jobs} />
    </div>
  );
}
