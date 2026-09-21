"use client";

import { Button, SectionTitle } from "@/components/ui";
import type { AdminSession } from "@/lib/vila-gpt/client";
import type { KnowledgeDoc } from "@/lib/vila-gpt/knowledge";

function Row({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 p-3.5">
      <span className="text-lg leading-none">{ok === null ? "◦" : ok ? "🟢" : "🟡"}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-slate-400">{detail}</p>
      </div>
    </li>
  );
}

/** Aba "Status": o que está ligado e o que falta configurar. */
export function StatusTab({
  session,
  docs,
  onLogout,
  onRefresh,
}: {
  session: AdminSession;
  docs: KnowledgeDoc[];
  onLogout: () => void;
  onRefresh: () => void;
}) {
  const articles = docs.filter((d) => d.article);
  const official = articles.filter((d) => d.article?.official).length;
  const system = docs.length - articles.length;
  const ai = session.ai;

  return (
    <div>
      <SectionTitle action={<Button size="sm" variant="ghost" onClick={onRefresh}>Atualizar</Button>}>
        Configuração
      </SectionTitle>
      <ul className="card mb-6 divide-y divide-[var(--line)]">
        <Row
          ok={session.configured}
          label="Senha de administrador"
          detail={`VILA_GPT_ADMIN_PIN definida. Só quem tem a senha altera a base.${
            session.failed_logins_24h ? ` Tentativas erradas nas últimas 24h: ${session.failed_logins_24h}.` : ""
          }`}
        />
        <Row
          ok={session.session_secret ? true : null}
          label={session.session_secret ? "Segredo de sessão configurado" : "Segredo de sessão não configurado (recomendado)"}
          detail={
            session.session_secret
              ? "VILA_GPT_SESSION_SECRET assina o cookie de administrador."
              : "Defina VILA_GPT_SESSION_SECRET (um texto aleatório longo) para que o cookie de administrador não dependa só da senha."
          }
        />
        <Row
          ok={Boolean(ai?.enabled)}
          label={ai?.enabled ? `IA ligada · ${ai.model}` : "IA desligada (modo busca)"}
          detail={
            ai?.enabled
              ? `As respostas são redigidas pela IA só com base nas fontes oficiais (esforço: ${ai.effort}; até ${ai.max_per_day} respostas com IA por dia, depois cai para o modo busca). Troque o modelo com VILA_GPT_MODEL e o limite com VILA_GPT_MAX_AI_PER_DAY.`
              : "Defina ANTHROPIC_API_KEY para a IA redigir as respostas. Sem ela, o VILA GPT mostra a fonte oficial mais parecida."
          }
        />
        <Row
          ok={session.service_role ? true : null}
          label={session.service_role ? "Chave de serviço configurada" : "Chave de serviço não configurada (opcional)"}
          detail={
            session.service_role
              ? "O servidor grava com SUPABASE_SERVICE_ROLE_KEY. Você pode rodar supabase/vila-gpt-lock.sql para travar a escrita da base no banco."
              : "Opcional: defina SUPABASE_SERVICE_ROLE_KEY e rode supabase/vila-gpt-lock.sql para que só o servidor consiga escrever na base."
          }
        />
      </ul>

      <SectionTitle>Base de conhecimento</SectionTitle>
      <ul className="card mb-6 divide-y divide-[var(--line)]">
        <Row ok={official > 0} label={`${official} ${official === 1 ? "informação oficial" : "informações oficiais"}`} detail={`${articles.length - official} em rascunho (não usadas nas respostas).`} />
        <Row ok={system > 0} label={`${system} itens vindos dos outros módulos`} detail="Funções, checklists, processos e responsáveis entram automaticamente, sem duplicar dados." />
      </ul>

      <SectionTitle>Como o VILA GPT responde</SectionTitle>
      <div className="card mb-6 space-y-2 p-4 text-sm text-slate-400">
        <p>1. Procura na base oficial as fontes mais parecidas com a pergunta.</p>
        <p>2. Se não achar nada, responde na hora: “Não encontrei esse procedimento na base oficial da empresa. Procure um gerente ou responsável.”</p>
        <p>3. Se achar, a IA redige uma resposta curta, em passos, usando só o que está nas fontes, e indica a fonte.</p>
        <p>4. Toda pergunta fica no histórico; assuntos repetidos viram alerta de treinamento no Painel.</p>
        <p>Alterou uma regra? A próxima resposta já usa o texto novo.</p>
      </div>

      <Button variant="ghost" full className="!text-rose-400" onClick={onLogout}>
        Sair da administração
      </Button>
    </div>
  );
}
