"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  Button,
  ConfirmSheet,
  EmojiPicker,
  EmptyState,
  Field,
  ProgressBar,
  SectionTitle,
  Sheet,
  TextArea,
  TextInput,
} from "@/components/ui";
import { useData } from "@/lib/store";
import { companyOverview, sortedCompanies } from "@/lib/selectors";
import type { Company } from "@/lib/types";

const COMPANY_EMOJIS = ["🏪", "👨‍🍳", "🍕", "🍔", "☕", "🥟", "🏢", "🛒", "🍰", "🚚"];

export default function HomePage() {
  const { data, trainingIndex } = useData();
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState(false);

  const companies = useMemo(() => sortedCompanies(data), [data]);

  return (
    <AppShell
      title="Minhas empresas"
      subtitle={`${companies.length} ${companies.length === 1 ? "empresa" : "empresas"} · dados sincronizados`}
    >
      {companies.length === 0 ? (
        <EmptyState
          emoji="🏢"
          title="Nenhuma empresa cadastrada"
          description="Comece criando sua primeira empresa."
          action={
            <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
              + Nova empresa
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {companies.map((company) => {
            const ov = companyOverview(data, trainingIndex, company.id);
            const total = ov.employees.length;
            const pct = total === 0 ? 0 : Math.round((ov.aptos / total) * 100);
            return (
              <div key={company.id} className="card card-hover relative overflow-hidden">
                <span
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ background: company.color }}
                />
                <Link href={`/empresa/${company.id}`} className="block p-4 pl-5">
                  <div className="flex items-center gap-3">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[var(--line)] bg-white/5 text-3xl">
                      {company.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-xl font-extrabold">{company.name}</h2>
                      <p className="text-sm text-slate-400">
                        {ov.roles.length} {ov.roles.length === 1 ? "função" : "funções"} ·{" "}
                        {total} {total === 1 ? "funcionário" : "funcionários"}
                      </p>
                    </div>
                    <span className="text-2xl text-slate-600">›</span>
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                      🟢 {ov.aptos} aptos
                    </span>
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
                      🟡 {ov.emTreinamento}
                    </span>
                    <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-rose-300">
                      🔴 {ov.naoTreinados + ov.semFuncao}
                    </span>
                  </div>

                  <div className="mt-3">
                    <ProgressBar value={pct} showLabel />
                  </div>

                  {(ov.rolesSemApto.length > 0 || ov.rolesSemFuncionario.length > 0) && (
                    <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      ⚠️ {ov.rolesSemApto.length + ov.rolesSemFuncionario.length}{" "}
                      {ov.rolesSemApto.length + ov.rolesSemFuncionario.length === 1
                        ? "função sem ninguém apto"
                        : "funções sem ninguém apto"}
                    </p>
                  )}
                </Link>
                <button
                  onClick={() => setEditing(company)}
                  className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-white/10"
                  aria-label="Editar empresa"
                >
                  ⋯
                </button>
              </div>
            );
          })}

          <Button variant="primary" size="lg" full onClick={() => setCreating(true)}>
            + Nova empresa
          </Button>
        </div>
      )}

      <div className="mt-8">
        <SectionTitle>Como funciona</SectionTitle>
        <div className="card space-y-2 p-4 text-sm text-slate-400">
          <p>
            <strong className="text-slate-200">Empresa → Função → Funcionário →
            Processos → 4 etapas → Certificação.</strong>
          </p>
          <p>
            Cada processo precisa passar por 👀 Mostrei, 👤 Fez, 🗣️ Ensinou e ✅
            Certifiquei. Quando todos os processos obrigatórios de uma função estão
            certificados, o funcionário vira 🟢 <strong>APTO</strong> automaticamente.
          </p>
        </div>
      </div>

      <CompanySheet open={creating} onClose={() => setCreating(false)} company={null} />
      <CompanySheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        company={editing}
      />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

function CompanySheet({
  open,
  onClose,
  company,
}: {
  open: boolean;
  onClose: () => void;
  company: Company | null;
}) {
  const { actions } = useData();
  const [name, setName] = useState(company?.name ?? "");
  const [emoji, setEmoji] = useState(company?.emoji ?? "🏪");
  const [color, setColor] = useState(company?.color ?? "#2563eb");
  const [notes, setNotes] = useState(company?.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState("");

  // reinicia o formulário quando a empresa muda
  const currentKey = `${company?.id ?? "novo"}-${open}`;
  if (key !== currentKey) {
    setKey(currentKey);
    setName(company?.name ?? "");
    setEmoji(company?.emoji ?? "🏪");
    setColor(company?.color ?? "#2563eb");
    setNotes(company?.notes ?? "");
  }

  const save = async () => {
    if (!name.trim()) return;
    if (company) {
      await actions.updateCompany(company.id, { name: name.trim(), emoji, color, notes });
    } else {
      await actions.createCompany({ name, emoji, color, notes });
    }
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={company ? "Editar empresa" : "Nova empresa"}
      >
        <Field label="Nome">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Vila Rica"
            autoFocus
          />
        </Field>
        <Field label="Ícone">
          <EmojiPicker value={emoji} onChange={setEmoji} options={COMPANY_EMOJIS} />
        </Field>
        <Field label="Cor">
          <div className="flex flex-wrap gap-2">
            {["#e11d48", "#f59e0b", "#10b981", "#2563eb", "#8b5cf6", "#06b6d4"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-10 w-10 rounded-xl border-2 ${color === c ? "border-white" : "border-transparent"}`}
                style={{ background: c }}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
        </Field>
        <Field label="Observações" hint="Opcional">
          <TextArea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Endereço, horário, observações…"
          />
        </Field>

        <div className="flex gap-3">
          <Button variant="primary" size="lg" full onClick={save} disabled={!name.trim()}>
            Salvar
          </Button>
        </div>

        {company && (
          <Button
            variant="ghost"
            full
            className="mt-3 !text-rose-400"
            onClick={() => setConfirmDelete(true)}
          >
            Excluir empresa
          </Button>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Excluir empresa?"
        message={`Isso apaga ${company?.name ?? ""} com todas as funções, funcionários e treinamentos dela. Não dá para desfazer.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (company) await actions.deleteCompany(company.id);
          onClose();
        }}
      />
    </>
  );
}
