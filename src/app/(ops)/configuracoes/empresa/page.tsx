"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/ops/session";
import { useInvalidate } from "@/lib/ops/query";
import { supabaseBrowser } from "@/lib/supabase/client";
import { unwrap } from "@/lib/ops/rpc";
import { toOpsError } from "@/lib/ops/errors";
import { COMPANY_DATA_EMPTY, coerceCompanyData, coerceLogoUrl, setSetting, settingsToMap, useSettingsRows, type CompanyData } from "@/lib/ops/modules/configuracoes";
import { EmojiPicker } from "@/components/ui";
import { Button, ErrorBox, Field, PageHeader, SectionCard, Skeleton, TextArea, TextInput, useToast } from "@/components/ops/ui";
import { PhotoUpload } from "@/components/ops/PhotoUpload";
import { Label, NoPermission } from "@/components/ops/usuarios/Common";

const EMOJIS = ["🏪", "👨‍🍳", "🍕", "🍔", "🥟", "☕", "🍰", "🍩", "🍝", "🥗", "🍣", "🍺", "🚚", "🏢", "🏬"];
const COLORS = ["#f97316", "#e11d48", "#f59e0b", "#10b981", "#2563eb", "#8b5cf6", "#06b6d4", "#64748b"];

export default function EmpresaPage() {
  const { company, canCompany, refresh } = useSession();
  const notify = useToast();
  const invalidate = useInvalidate();
  const canEdit = canCompany("configuracoes.editar");
  const settings = useSettingsRows(company?.id, null);
  const map = settingsToMap(settings.data);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏪");
  const [color, setColor] = useState("#f97316");
  const [notes, setNotes] = useState("");
  const [logo, setLogo] = useState("");
  const [dados, setDados] = useState<CompanyData>(COMPANY_DATA_EMPTY);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    setName(company.name);
    setEmoji(company.emoji || "🏪");
    setColor(company.color || "#f97316");
    setNotes(company.notes ?? "");
  }, [company]);
  useEffect(() => {
    if (!settings.data) return;
    setLogo(coerceLogoUrl(map["empresa.logo_url"]));
    setDados(coerceCompanyData(map["empresa.dados"]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const companyDirty = company ? name.trim() !== company.name || emoji !== company.emoji || color !== company.color || notes.trim() !== (company.notes ?? "") : false;
  const dadosSaved = coerceCompanyData(map["empresa.dados"]);
  const dadosDirty = JSON.stringify(dados) !== JSON.stringify(dadosSaved);

  async function saveCompany() {
    if (!company) return;
    if (name.trim().length < 2) return notify("Informe o nome da empresa.", "erro");
    setBusy("empresa");
    try {
      unwrap(await supabaseBrowser().from("companies").update({ name: name.trim(), emoji, color, notes: notes.trim() }).eq("id", company.id));
      notify("Empresa salva");
      invalidate("companies");
      await refresh();
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function saveLogo(url: string) {
    if (!company) return;
    setLogo(url);
    setBusy("logo");
    try {
      await setSetting(company.id, null, "empresa.logo_url", url);
      notify(url ? "Logo salvo" : "Logo removido");
      invalidate("settings");
    } catch (e) {
      notify(toOpsError(e as Error).message, "erro");
    } finally {
      setBusy(null);
    }
  }

  async function saveDados() {
    if (!company) return;
    setBusy("dados");
    try {
      await setSetting(company.id, null, "empresa.dados", { razao_social: dados.razao_social.trim(), cnpj: dados.cnpj.trim(), telefone: dados.telefone.trim(), endereco: dados.endereco.trim() });
      notify("Dados para etiqueta salvos");
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
        <PageHeader title="Empresa" backHref="/configuracoes" />
        <NoPermission perm="configuracoes.editar" what="alterar os dados da empresa" />
      </div>
    );
  }
  if (!company) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Empresa" backHref="/configuracoes" />
        <Skeleton rows={3} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Empresa" subtitle="Identidade visual e dados usados nas etiquetas" backHref="/configuracoes" icon="building" />

      <SectionCard title="Identidade" className="mb-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl text-3xl" style={{ background: `${color}33`, border: `1px solid ${color}` }}>{emoji}</span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{name || "Nome da empresa"}</p>
            <p className="text-xs text-slate-500">Assim a empresa aparece no menu e no seletor de unidades.</p>
          </div>
        </div>
        <Field label="Nome"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Label>Emoji</Label>
        <div className="mb-4"><EmojiPicker value={emoji} onChange={setEmoji} options={EMOJIS.includes(emoji) ? EMOJIS : [emoji, ...EMOJIS]} /></div>
        <Label>Cor</Label>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={`h-10 w-10 rounded-xl border-2 transition ${color === c ? "scale-110 border-white" : "border-transparent"}`} style={{ background: c }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Cor personalizada" className="h-10 w-14 cursor-pointer rounded-xl border border-[var(--line)] bg-transparent" />
        </div>
        <Field label="Observações" hint="Anotações internas (não aparecem para a equipe)."><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button variant="primary" size="lg" full disabled={busy !== null || !companyDirty} onClick={() => void saveCompany()}>{busy === "empresa" ? "Salvando…" : "Salvar empresa"}</Button>
      </SectionCard>

      <SectionCard title="Logo" className="mb-4">
        {settings.isLoading ? (
          <Skeleton rows={1} />
        ) : settings.isError ? (
          <ErrorBox error={toOpsError(settings.error as Error).message} onRetry={() => void settings.refetch()} />
        ) : (
          <>
            <PhotoUpload value={logo} onChange={(url) => void saveLogo(url)} folder="empresa" label="Logo da empresa" hint="Aparece nas etiquetas que têm o campo “logo” ligado e nos relatórios em PDF. É salvo automaticamente." />
            {busy === "logo" && <p className="text-xs text-slate-400">Salvando…</p>}
          </>
        )}
      </SectionCard>

      <SectionCard title="Dados para etiquetas e documentos" className="mb-4">
        <p className="mb-3 text-sm text-slate-400">Razão social, CNPJ, telefone e endereço podem ser impressos nas etiquetas (campo “empresa”) e nos relatórios.</p>
        <Field label="Razão social"><TextInput value={dados.razao_social} onChange={(e) => setDados({ ...dados, razao_social: e.target.value })} /></Field>
        <div className="grid gap-0 sm:grid-cols-2 sm:gap-3">
          <Field label="CNPJ"><TextInput inputMode="numeric" value={dados.cnpj} onChange={(e) => setDados({ ...dados, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></Field>
          <Field label="Telefone"><TextInput inputMode="tel" value={dados.telefone} onChange={(e) => setDados({ ...dados, telefone: e.target.value })} placeholder="(00) 0000-0000" /></Field>
        </div>
        <Field label="Endereço"><TextInput value={dados.endereco} onChange={(e) => setDados({ ...dados, endereco: e.target.value })} placeholder="Rua, número, bairro, cidade" /></Field>
        <Button variant="primary" size="lg" full disabled={busy !== null || !dadosDirty || settings.isLoading} onClick={() => void saveDados()}>{busy === "dados" ? "Salvando…" : "Salvar dados"}</Button>
      </SectionCard>
    </div>
  );
}
