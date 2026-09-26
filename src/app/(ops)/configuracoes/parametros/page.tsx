"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate, useRealtimeInvalidate } from "@/lib/ops/query";
import { toOpsError } from "@/lib/ops/errors";
import {
  PARAM_DEFAULTS, PARAM_KEYS, coerceParam, deleteStoreSetting, setSetting, settingsToMap, useCompanyStores, useSettingsRows,
  type CostMethod, type ConsumptionBasis, type ParamKey, type ParamsForm, type PrinterKind,
} from "@/lib/ops/modules/configuracoes";
import { Badge, Button, Choice, ErrorBox, InlineAlert, NumberInput, PageHeader, SectionCard, Select, Skeleton, Toggle, useToast } from "@/components/ops/ui";
import { Label, NoPermission } from "@/components/ops/usuarios/Common";

export default function ParametrosPage() {
  const { company, canCompany } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("configuracoes.editar");
  const stores = useCompanyStores();
  const [storeId, setStoreId] = useState<string>("");
  const companyRows = useSettingsRows(company?.id, null);
  const storeRows = useSettingsRows(storeId ? company?.id : undefined, storeId || null);
  useRealtimeInvalidate(["settings"]);

  const companyMap = useMemo(() => settingsToMap(companyRows.data), [companyRows.data]);
  const storeMap = useMemo(() => settingsToMap(storeId ? storeRows.data : []), [storeRows.data, storeId]);
  const loading = companyRows.isLoading || (Boolean(storeId) && storeRows.isLoading);

  /** valores efetivos do escopo escolhido (unidade > empresa > padrão) */
  const effective = useMemo(() => {
    const f = { ...PARAM_DEFAULTS } as ParamsForm;
    for (const k of PARAM_KEYS) {
      const raw = storeId && k in storeMap ? storeMap[k] : companyMap[k];
      (f as Record<string, unknown>)[k] = coerceParam(k, raw);
    }
    return f;
  }, [companyMap, storeMap, storeId]);

  const [form, setForm] = useState<ParamsForm>(PARAM_DEFAULTS);
  useEffect(() => {
    if (!loading) setForm(effective);
  }, [effective, loading]);
  const set = <K extends ParamKey>(k: K, v: ParamsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const changed = PARAM_KEYS.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(effective[k]));
  const isOverride = (k: ParamKey) => Boolean(storeId) && k in storeMap;
  const [busy, setBusy] = useState<string | null>(null);

  async function save() {
    if (!company) return;
    if (form["validade.dias_alerta"] < 0 || form["validade.dias_critico"] < 0) return notify("Os dias não podem ser negativos.", "erro");
    if (form["validade.dias_critico"] > form["validade.dias_alerta"]) return notify("Os dias de alerta crítico devem ser menores ou iguais aos dias de alerta.", "erro");
    if (form["temperaturas.intervalo_min"] < 5) return notify("O intervalo mínimo entre medições é de 5 minutos.", "erro");
    if (form["etiquetas.impressora"].largura_mm < 10 || form["etiquetas.impressora"].altura_mm < 10) return notify("A etiqueta precisa ter pelo menos 10 mm de largura e altura.", "erro");
    setBusy("save");
    try {
      for (const k of changed) await setSetting(company.id, storeId || null, k, form[k]);
      notify(changed.length === 1 ? "Parâmetro salvo" : `${changed.length} parâmetros salvos`);
      invalidate("settings");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function useCompanyDefault(k: ParamKey) {
    if (!company || !storeId) return;
    setBusy(k);
    try {
      await deleteStoreSetting(company.id, storeId, k);
      notify("Voltou a valer o padrão da empresa");
      invalidate("settings");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Parâmetros" backHref="/configuracoes" />
        <NoPermission perm="configuracoes.editar" what="alterar parâmetros" />
      </div>
    );
  }

  /** etiqueta "definido nesta unidade / herdado" (função de render, não componente: evita remontar a cada render) */
  const overrideTag = (k: ParamKey) =>
    storeId ? (
      <span className="mb-2 flex items-center gap-2 text-[11px]">
        {isOverride(k) ? (
          <>
            <Badge tone="violet">definido nesta unidade</Badge>
            <button type="button" disabled={busy !== null} onClick={() => void useCompanyDefault(k)} className="font-semibold text-[var(--accent)] disabled:opacity-50">usar padrão da empresa</button>
          </>
        ) : (
          <Badge tone="slate">herdado da empresa</Badge>
        )}
      </span>
    ) : null;

  const printer = form["etiquetas.impressora"];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Parâmetros de estoque e validade" subtitle="Regras que valem para toda a empresa, com exceções por unidade" backHref="/configuracoes" icon="settings" />

      <div className="card mb-4 p-4">
        <Label hint="O padrão da empresa vale para todas as unidades. Escolha uma unidade para definir exceções só para ela.">Aplicar em</Label>
        <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Padrão da empresa (todas as unidades)</option>
          {(stores.data ?? []).map((s) => <option key={s.id} value={s.id}>Unidade: {s.name}{s.active ? "" : " (inativa)"}</option>)}
        </Select>
      </div>

      {companyRows.isError ? (
        <ErrorBox error={toOpsError(companyRows.error as Error).message} onRetry={() => void companyRows.refetch()} />
      ) : loading ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <SectionCard title="Estoque e custo" className="mb-4">
            {overrideTag("estoque.metodo_custo")}
            <Label hint="Como o custo do produto é atualizado a cada recebimento.">Método de custo</Label>
            <Choice<CostMethod>
              value={form["estoque.metodo_custo"]}
              onChange={(v) => set("estoque.metodo_custo", v)}
              options={[
                { value: "medio", label: "Custo médio", hint: "Média ponderada entre o que já tinha e o que entrou" },
                { value: "ultimo", label: "Último preço", hint: "Custo = preço da última compra" },
              ]}
            />
            {overrideTag("estoque.permitir_negativo")}
            <Toggle checked={form["estoque.permitir_negativo"]} onChange={(v) => set("estoque.permitir_negativo", v)} label="Permitir estoque negativo" hint="Se ligado, consumos e perdas passam mesmo sem saldo. Recomendado: desligado." />
            {overrideTag("estoque.permitir_consumo_vencido")}
            <Toggle checked={form["estoque.permitir_consumo_vencido"]} onChange={(v) => set("estoque.permitir_consumo_vencido", v)} label="Permitir consumir lote vencido" hint="Se desligado, lotes vencidos só podem ser descartados como perda." />
          </SectionCard>

          <SectionCard title="Validade" className="mb-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                {overrideTag("validade.dias_alerta")}
                <Label hint="Lotes que vencem dentro deste prazo aparecem como “vencendo”.">Dias para alerta de validade</Label>
                <NumberInput value={form["validade.dias_alerta"]} onChange={(v) => set("validade.dias_alerta", Math.max(0, Math.round(v ?? 0)))} inputMode="numeric" suffix="dias" big min={0} />
              </div>
              <div>
                {overrideTag("validade.dias_critico")}
                <Label hint="Dentro deste prazo o alerta vira crítico.">Dias para alerta crítico</Label>
                <NumberInput value={form["validade.dias_critico"]} onChange={(v) => set("validade.dias_critico", Math.max(0, Math.round(v ?? 0)))} inputMode="numeric" suffix="dias" big min={0} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Etiquetas e impressora" className="mb-4">
            {overrideTag("etiquetas.impressora")}
            <Label hint="Navegador: imprime pelo diálogo do sistema (qualquer impressora). ZPL: gera o código para impressoras Zebra-compatíveis.">Impressora padrão</Label>
            <Choice<PrinterKind>
              value={printer.tipo}
              onChange={(v) => set("etiquetas.impressora", { ...printer, tipo: v })}
              options={[
                { value: "navegador", label: "Navegador", hint: "Diálogo de impressão", icon: "printer" },
                { value: "zpl", label: "ZPL (Zebra)", hint: "Código para impressora térmica", icon: "tag" },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Largura padrão</Label>
                <NumberInput value={printer.largura_mm} onChange={(v) => set("etiquetas.impressora", { ...printer, largura_mm: v ?? 0 })} suffix="mm" min={10} />
              </div>
              <div>
                <Label>Altura padrão</Label>
                <NumberInput value={printer.altura_mm} onChange={(v) => set("etiquetas.impressora", { ...printer, altura_mm: v ?? 0 })} suffix="mm" min={10} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Temperaturas" className="mb-4">
            {overrideTag("temperaturas.intervalo_min")}
            <Label hint="Padrão para equipamentos novos; cada equipamento pode ter o seu.">Intervalo entre medições</Label>
            <NumberInput value={form["temperaturas.intervalo_min"]} onChange={(v) => set("temperaturas.intervalo_min", Math.max(0, Math.round(v ?? 0)))} inputMode="numeric" suffix="min" big min={5} />
          </SectionCard>

          <SectionCard title="Inventário" className="mb-4">
            {overrideTag("inventario.nao_contado_zera")}
            <Toggle checked={form["inventario.nao_contado_zera"]} onChange={(v) => set("inventario.nao_contado_zera", v)} label="Item não contado vira zero" hint="Ao finalizar a contagem, o que não foi contado é considerado zero (gera ajuste). Desligado: mantém o saldo teórico." />
          </SectionCard>

          <SectionCard title="Produção" className="mb-4">
            {overrideTag("producao.consumo_por")}
            <Label hint="Informativo: como o sistema calcula o consumo de ingredientes ao concluir a produção.">Consumo de ingredientes</Label>
            <Choice<ConsumptionBasis>
              value={form["producao.consumo_por"]}
              onChange={(v) => set("producao.consumo_por", v)}
              options={[
                { value: "planejado", label: "Pela quantidade planejada", hint: "Baixa conforme a ficha × quantidade planejada" },
                { value: "produzido", label: "Pela quantidade produzida", hint: "Baixa proporcional ao que realmente saiu" },
              ]}
            />
          </SectionCard>

          <SectionCard title="Alertas" className="mb-4">
            {overrideTag("alertas.email")}
            <Toggle checked={form["alertas.email"]} onChange={(v) => set("alertas.email", v)} label="Alertas por e-mail (reservado)" hint="Reservado para uso futuro: o envio por e-mail ainda não está disponível nesta versão. Os alertas aparecem no painel e em Alertas." />
            <InlineAlert tone="slate" icon="info">Hoje os alertas são exibidos dentro do sistema (sino e painel). Esta chave apenas guarda a preferência.</InlineAlert>
          </SectionCard>

          <div className="sticky bottom-20 z-20 lg:bottom-4">
            <div className="flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/95 p-2 shadow-xl backdrop-blur">
              <Button variant="soft" size="lg" disabled={changed.length === 0 || busy !== null} onClick={() => setForm(effective)}>Descartar</Button>
              <Button variant="primary" size="lg" full disabled={changed.length === 0 || busy !== null} onClick={() => void save()}>
                {busy === "save" ? "Salvando…" : changed.length === 0 ? "Tudo salvo" : `Salvar ${changed.length} alteração${changed.length > 1 ? "ões" : ""}${storeId ? " nesta unidade" : ""}`}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
