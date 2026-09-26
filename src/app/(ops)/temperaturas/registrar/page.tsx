"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { useEquipment } from "@/lib/ops/hooks";
import { callOfflineable } from "@/lib/ops/offline";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDateTime } from "@/lib/ops/format";
import type { CorrectiveAction, TemperatureEquipment } from "@/lib/ops/types";
import { EQUIPMENT_KIND_LABEL } from "@/lib/ops/types";
import { CORRECTIVE_OPTIONS, fmtTemp, fromLocalInput, inRange, nowLocalInput } from "@/lib/ops/modules/rotinas";
import { Button, Choice, EmptyState, ErrorBox, Field, InlineAlert, NumberInput, PageHeader, Skeleton, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

type Result = { queued: boolean; in_range: boolean; min: number; max: number; temperature: number; equipment: TemperatureEquipment; duplicated?: boolean };
type RegisterRpc = { ok: boolean; id: string; in_range?: boolean; alert_id?: string | null; min?: number; max?: number; duplicated?: boolean };

export default function RegistrarTemperaturaPage() {
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <RegistrarTemperatura />
    </Suspense>
  );
}

function RegistrarTemperatura() {
  const { store, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const notify = useToast();
  const invalidate = useInvalidate();
  const eq = useEquipment();
  const list = useMemo(() => eq.data ?? [], [eq.data]);

  const [eqId, setEqId] = useState<string>(params.get("equipment") ?? "");
  const [temp, setTemp] = useState<number | null>(null);
  const [action, setAction] = useState<CorrectiveAction>("");
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState(nowLocalInput());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // equipamento vindo da URL (?equipment=) ou o primeiro da lista
  useEffect(() => {
    const fromUrl = params.get("equipment");
    if (fromUrl && list.some((e) => e.id === fromUrl)) setEqId(fromUrl);
  }, [params, list]);

  const equipment = list.find((e) => e.id === eqId) ?? null;
  const out = equipment !== null && temp !== null && !inRange(temp, Number(equipment.min_temp), Number(equipment.max_temp));
  const needsMore = out && (action === "" || notes.trim() === "");
  const canSubmit = Boolean(equipment) && temp !== null && !needsMore && Boolean(fromLocalInput(when)) && !busy;

  function reset(nextId?: string) {
    setResult(null);
    setTemp(null);
    setAction("");
    setNotes("");
    setWhen(nowLocalInput());
    if (nextId !== undefined) setEqId(nextId);
  }

  async function submit() {
    if (!equipment || temp === null) return;
    const measuredAt = fromLocalInput(when);
    if (!measuredAt) return notify("Data/hora inválida.", "erro");
    setBusy(true);
    try {
      const r = await callOfflineable<RegisterRpc>(
        "ops_temperature_register",
        { p_equipment: equipment.id, p_temperature: temp, p_corrective_action: action, p_notes: notes.trim(), p_measured_at: measuredAt },
        `Temperatura ${equipment.name}: ${fmtTemp(temp)}`,
      );
      const localIn = inRange(temp, Number(equipment.min_temp), Number(equipment.max_temp));
      if (r.queued) {
        setResult({ queued: true, in_range: localIn, min: Number(equipment.min_temp), max: Number(equipment.max_temp), temperature: temp, equipment });
        notify("Sem conexão: a medição ficou na fila e será enviada quando a internet voltar.", "info");
      } else {
        setResult({ queued: false, in_range: r.data.in_range ?? localIn, min: Number(r.data.min ?? equipment.min_temp), max: Number(r.data.max ?? equipment.max_temp), temperature: temp, equipment, duplicated: r.data.duplicated });
        notify(r.data.in_range ?? localIn ? "Temperatura registrada" : "Registrado: fora da faixa — alerta gerado", r.data.in_range ?? localIn ? "ok" : "erro");
      }
      invalidate("temperature_logs", "temperature_equipment", "alerts", "dashboard");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (!equipment) return reset();
    const i = list.findIndex((e) => e.id === equipment.id);
    const n = list[(i + 1) % list.length];
    reset(n?.id ?? "");
  }

  if (!can("temperaturas.registrar")) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Registrar temperatura" backHref="/temperaturas" icon="thermometer" />
        <EmptyState emoji="🔒" title="Sem permissão para registrar temperaturas" description="Peça ao gerente para liberar a permissão “temperaturas.registrar” no seu perfil." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Registrar temperatura" subtitle={store?.name} backHref="/temperaturas" icon="thermometer" />

      {eq.isLoading ? (
        <Skeleton rows={3} />
      ) : eq.error ? (
        <ErrorBox error={toOpsError(eq.error as Error).message} onRetry={() => void eq.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          emoji="🌡️"
          title="Nenhum equipamento ativo"
          description="Cadastre as geladeiras, freezers e câmaras desta unidade antes de registrar temperaturas."
          action={can("temperaturas.editar") ? <Link href="/temperaturas/equipamentos" className="rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-white">Cadastrar equipamentos</Link> : undefined}
        />
      ) : result ? (
        <ResultPanel result={result} onNext={next} onAgain={() => reset(result.equipment.id)} onBack={() => router.push("/temperaturas")} hasMany={list.length > 1} />
      ) : (
        <>
          <p className="mb-1.5 text-sm font-semibold text-slate-300">1. Qual equipamento?</p>
          <Choice
            value={eqId}
            onChange={(v) => { setEqId(v); setTemp(null); setAction(""); }}
            columns={list.length > 6 ? 2 : 1}
            options={list.map((e) => ({ value: e.id, label: e.name, hint: `${EQUIPMENT_KIND_LABEL[e.kind]} · ${fmtTemp(e.min_temp)} a ${fmtTemp(e.max_temp)}${e.location_text ? ` · ${e.location_text}` : ""}` }))}
          />

          {equipment && (
            <>
              <p className="mb-1.5 text-sm font-semibold text-slate-300">2. Temperatura medida</p>
              <div className="mb-1 flex items-center gap-2">
                <NumberInput value={temp} onChange={setTemp} big suffix="°C" inputMode="decimal" autoFocus placeholder="0,0" className="flex-1" />
                <button
                  type="button"
                  onClick={() => setTemp((t) => (t === null ? null : -t))}
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white/5 text-xl font-bold text-slate-200 active:scale-95"
                  aria-label="Inverter sinal (negativo/positivo)"
                  title="Negativo / positivo"
                >
                  ±
                </button>
              </div>
              <p className="mb-4 text-xs text-slate-400">
                Faixa aceitável: <span className="font-semibold text-slate-200">{fmtTemp(equipment.min_temp)} a {fmtTemp(equipment.max_temp)}</span>. Use o botão ± para freezers (negativo).
              </p>

              {temp !== null && (
                <div className={`mb-4 rounded-2xl border px-4 py-3 text-center ${out ? "border-rose-500/50 bg-rose-500/10" : "border-emerald-500/40 bg-emerald-500/10"}`}>
                  <p className={`text-lg font-extrabold ${out ? "text-rose-200" : "text-emerald-200"}`}>{out ? "Fora da faixa" : "Dentro da faixa"}</p>
                  {out && <p className="text-xs text-rose-200/80">Informe a ação corretiva e uma observação. Um alerta será gerado.</p>}
                </div>
              )}

              {out && (
                <>
                  <p className="mb-1.5 text-sm font-semibold text-slate-300">3. O que foi feito? <span className="text-rose-400">*</span></p>
                  <Choice value={action} onChange={setAction} options={CORRECTIVE_OPTIONS} columns={2} />
                  <Field label="Observação *" hint="Explique o que aconteceu e o que foi feito.">
                    <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: porta ficou aberta; ajustei o termostato e vou medir de novo em 1h" />
                  </Field>
                </>
              )}
              {!out && (
                <Field label="Observação" hint="Opcional.">
                  <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              )}

              <Field label="Data e hora da medição" hint="Padrão: agora. Altere só se estiver lançando uma medição anterior.">
                <TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} max={nowLocalInput()} />
              </Field>

              {needsMore && temp !== null && <InlineAlert tone="amber">Fora da faixa: escolha a ação corretiva e escreva uma observação para salvar.</InlineAlert>}

              <Button variant="primary" size="lg" full disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? "Salvando…" : "Salvar medição"}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ResultPanel({ result, onNext, onAgain, onBack, hasMany }: { result: Result; onNext: () => void; onAgain: () => void; onBack: () => void; hasMany: boolean }) {
  const ok = result.in_range;
  return (
    <div className="pop-in">
      <div className={`card mb-4 border-2 p-6 text-center ${ok ? "border-emerald-500/60 bg-emerald-500/10" : "border-rose-500/60 bg-rose-500/10"}`}>
        <div className="text-5xl">{ok ? "✅" : "🚨"}</div>
        <p className={`mt-2 text-2xl font-extrabold ${ok ? "text-emerald-200" : "text-rose-200"}`}>{ok ? "Dentro da faixa" : "Fora da faixa — alerta gerado"}</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums">{fmtTemp(result.temperature)}</p>
        <p className="mt-1 text-sm text-slate-300">
          {result.equipment.name} · faixa {fmtTemp(result.min)} a {fmtTemp(result.max)}
        </p>
        <p className="text-xs text-slate-400">{fmtDateTime(new Date().toISOString())}</p>
        {result.queued && <p className="mt-2 text-xs font-semibold text-amber-300">Sem internet: ficou na fila e será enviado automaticamente. Veja em Sincronização.</p>}
        {result.duplicated && <p className="mt-2 text-xs text-slate-400">Esta medição já tinha sido enviada antes — nada foi duplicado.</p>}
        {!ok && !result.queued && <p className="mt-2 text-xs text-rose-200/80">Acompanhe em <Link href="/alertas" className="underline">Alertas</Link>. Meça novamente após a ação corretiva.</p>}
      </div>
      <div className="flex flex-col gap-2">
        {hasMany && (
          <Button variant="primary" size="lg" full onClick={onNext}>
            Próximo equipamento <Icon name="chevronRight" size={18} />
          </Button>
        )}
        <Button variant="soft" size="lg" full onClick={onAgain}>Medir este equipamento de novo</Button>
        <Button variant="ghost" size="lg" full onClick={onBack}>Voltar ao painel</Button>
      </div>
    </div>
  );
}
