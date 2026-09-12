"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { stepsFor, statusFromStepMap } from "@/lib/derive";
import { fmtDateTime } from "@/lib/format";
import { STEPS, STEP_META, type Process, type StepKey } from "@/lib/types";
import { Button, Field, Sheet, StatusPill, TextArea, TextInput } from "./ui";

/* ------------------------------------------------------------------ */
/* Linha com as 4 etapas                                               */
/* ------------------------------------------------------------------ */

export function TrainingChips({
  employeeId,
  process,
}: {
  employeeId: string;
  process: Process;
}) {
  const { trainingIndex, actions, trainer, setTrainer, notify } = useData();
  const map = stepsFor(trainingIndex, employeeId, process.id);
  const [detail, setDetail] = useState<StepKey | null>(null);
  const [askName, setAskName] = useState<StepKey | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const basicsDone = STEPS.slice(0, 3).every((s) => Boolean(map[s]));

  const mark = async (step: StepKey) => {
    await actions.toggleStep({
      employee_id: employeeId,
      process_id: process.id,
      step,
      on: true,
    });
    if (step === "certifiquei") {
      notify(`✅ ${process.name} certificado!`);
    }
  };

  const onTap = (step: StepKey) => {
    if (map[step]) {
      setDetail(step);
      return;
    }
    if (step === "certifiquei" && !basicsDone) {
      notify("Conclua Mostrei, Fez e Ensinou antes de certificar.", "erro");
      return;
    }
    if (!trainer.trim()) {
      setNameDraft("");
      setAskName(step);
      return;
    }
    void mark(step);
  };

  return (
    <>
      <div className="grid grid-cols-4 gap-1.5">
        {STEPS.map((step) => {
          const done = Boolean(map[step]);
          const locked = step === "certifiquei" && !done && !basicsDone;
          return (
            <button
              key={step}
              onClick={() => onTap(step)}
              className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 transition active:scale-95 ${
                done
                  ? step === "certifiquei"
                    ? "border-emerald-400/70 bg-emerald-500/25 text-emerald-100"
                    : "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                  : locked
                    ? "border-[var(--line)] bg-white/[0.02] text-slate-600"
                    : "border-[var(--line)] bg-white/[0.03] text-slate-400"
              }`}
              title={STEP_META[step].help}
            >
              <span className={`text-lg leading-none ${done ? "" : "grayscale opacity-60"}`}>
                {STEP_META[step].emoji}
              </span>
              <span className="text-[10px] font-semibold leading-tight">
                {STEP_META[step].short}
              </span>
              <span className="text-[10px] leading-none">
                {done ? "☑" : locked ? "🔒" : "☐"}
              </span>
            </button>
          );
        })}
      </div>

      {/* detalhe da etapa marcada ---------------------------------- */}
      <StepDetailSheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        step={detail}
        employeeId={employeeId}
        process={process}
      />

      {/* pede o nome do responsável na primeira marcação ----------- */}
      <Sheet
        open={Boolean(askName)}
        onClose={() => setAskName(null)}
        title="Quem está treinando?"
      >
        <p className="mb-4 text-sm text-slate-400">
          Vou gravar esse nome junto com a data e a hora de cada etapa. Você só
          precisa informar uma vez.
        </p>
        <Field label="Seu nome">
          <TextInput
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Ex.: Bruno"
            autoFocus
          />
        </Field>
        <Button
          variant="primary"
          size="lg"
          full
          disabled={!nameDraft.trim()}
          onClick={async () => {
            setTrainer(nameDraft.trim());
            const step = askName;
            setAskName(null);
            if (step) {
              await actions.toggleStep({
                employee_id: employeeId,
                process_id: process.id,
                step,
                on: true,
                trainer: nameDraft.trim(),
              });
            }
          }}
        >
          Continuar
        </Button>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe / edição de uma etapa já marcada                            */
/* ------------------------------------------------------------------ */

function StepDetailSheet({
  open,
  onClose,
  step,
  employeeId,
  process,
}: {
  open: boolean;
  onClose: () => void;
  step: StepKey | null;
  employeeId: string;
  process: Process;
}) {
  const { trainingIndex, actions } = useData();
  const [note, setNote] = useState("");
  const [key, setKey] = useState("");

  const record = step ? stepsFor(trainingIndex, employeeId, process.id)[step] : undefined;

  const currentKey = `${record?.id ?? ""}-${open}`;
  if (key !== currentKey) {
    setKey(currentKey);
    setNote(record?.notes ?? "");
  }

  if (!step) return null;
  const meta = STEP_META[step];

  return (
    <Sheet open={open} onClose={onClose} title={`${meta.emoji} ${meta.label}`}>
      <p className="mb-4 text-sm text-slate-400">{meta.help}</p>

      <div className="card mb-4 space-y-2 p-4 text-sm">
        <Row label="Processo" value={process.name} />
        <Row label="Data e hora" value={fmtDateTime(record?.done_at)} />
        <Row label="Responsável" value={record?.trainer || "—"} />
      </div>

      <Field label="Observação" hint="Fica salva no histórico">
        <TextArea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: precisou de ajuda no ponto do arroz"
        />
      </Field>

      <Button
        variant="primary"
        full
        onClick={async () => {
          if (record) await actions.updateStepNotes(record.id, note);
          onClose();
        }}
      >
        Salvar observação
      </Button>

      <Button
        variant="ghost"
        full
        className="mt-3 !text-rose-400"
        onClick={async () => {
          await actions.toggleStep({
            employee_id: employeeId,
            process_id: process.id,
            step,
            on: false,
          });
          onClose();
        }}
      >
        Desmarcar esta etapa
      </Button>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-200">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cartão completo de um processo (nome + status + etapas)             */
/* ------------------------------------------------------------------ */

export function ProcessTrainingCard({
  employeeId,
  process,
  roleName,
}: {
  employeeId: string;
  process: Process;
  roleName?: string;
}) {
  const { trainingIndex } = useData();
  const map = stepsFor(trainingIndex, employeeId, process.id);
  const status = statusFromStepMap(map);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="card p-3.5">
      <div className="mb-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold leading-tight">{process.name}</p>
            {!process.required && (
              <span className="shrink-0 rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
                extra
              </span>
            )}
          </div>
          {roleName && <p className="text-xs text-slate-500">{roleName}</p>}
        </div>
        <StatusPill status={status} />
        {process.description && (
          <button
            onClick={() => setShowInfo((v) => !v)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/5 text-xs text-slate-400"
            aria-label="Detalhes do processo"
          >
            ℹ️
          </button>
        )}
      </div>

      {showInfo && process.description && (
        <p className="mb-2.5 whitespace-pre-wrap rounded-xl bg-black/25 p-3 text-sm text-slate-300">
          {process.description}
        </p>
      )}

      <TrainingChips employeeId={employeeId} process={process} />
    </div>
  );
}
