# Gestão de Funções, Funcionários e Treinamentos

Aplicativo web para organizar a estrutura operacional das empresas e garantir que
cada funcionário esteja realmente treinado para exercer sua função.

```
EMPRESA → FUNÇÃO → FUNCIONÁRIO → PROCESSOS → 4 ETAPAS → CERTIFICAÇÃO → APTO
```

Feito para o celular: poucos toques, cards grandes, cores de status e barras de
progresso. Funciona igual no computador, tablet e celular, com os dados
sincronizados em tempo real entre todos os aparelhos.

Inclui o **VILA GPT**, o assistente interno dos funcionários: um "ChatGPT da
empresa" que responde dúvidas do dia a dia **só com base nas regras, procedimentos,
fichas técnicas, funções e treinamentos cadastrados no sistema**, sempre mostrando
a fonte. Veja a seção [VILA GPT](#vila-gpt).

> **Para colocar no ar agora:** siga o passo a passo de [`DEPLOY.md`](DEPLOY.md)
> (GitHub → Vercel → banco criado pela própria Vercel). As instruções abaixo são
> a versão resumida e a de rodar no computador.

---

## 1. Criar o banco no Supabase

1. Entre em [supabase.com](https://supabase.com), crie uma conta e um **New project**
   (o plano gratuito basta). Guarde a senha do banco.
2. Com o projeto criado, abra **SQL Editor → New query**.
3. Cole **todo** o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique
   em **Run**.
   Isso cria as tabelas, as permissões, liga a sincronização em tempo real e já
   cadastra **Vila Rica** e **Sr. Strogonoff** com as funções e processos iniciais.
   O arquivo pode ser rodado de novo sem problema.
4. Vá em **Project Settings → API** e copie:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. Rodar no computador

```bash
npm install
```

Crie o arquivo `.env.local` na raiz do projeto:

```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
VILA_GPT_ADMIN_PIN=uma-senha          # administração do VILA GPT
ANTHROPIC_API_KEY=sk-ant-...          # opcional: IA do VILA GPT
```

```bash
npm run dev
```

Abra <http://localhost:3000>.

## 3. Publicar na Vercel

Passo a passo completo, com telas e solução de problemas: **[`DEPLOY.md`](DEPLOY.md)**.

Resumo: suba para o GitHub → importe na Vercel → **Storage → Create Database →
Supabase** (a Vercel injeta as chaves sozinha) → rode o `schema.sql` no SQL Editor
do Supabase → **Redeploy**. Depois, no celular, use *Adicionar à tela de início*
para o app abrir em tela cheia.

O app aceita tanto `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
quanto `SUPABASE_URL`/`SUPABASE_ANON_KEY`, então funciona com qualquer nome que a
integração da Vercel usar.

---

## Como o sistema decide quem está APTO

Cada processo tem **4 etapas obrigatórias**:

| | Etapa | Significado |
|---|---|---|
| 👀 | **Mostrei** | Eu mostrei ao funcionário como fazer |
| 👤 | **Fez** | O funcionário fez enquanto eu acompanhei |
| 🗣️ | **Ensinou** | O funcionário conseguiu me explicar como se faz |
| ✅ | **Certifiquei** | Vi ele fazendo sozinho e confirmei que está apto |

- **Certifiquei fica bloqueado** (🔒) até que Mostrei, Fez e Ensinou estejam
  concluídos — a certificação é sempre a última etapa.
- Um processo só fica 🟢 **Certificado** com as 4 etapas.
- O funcionário só vira 🟢 **APTO** quando **todos** os processos obrigatórios da
  função estiverem certificados. Com qualquer etapa pendente ele fica 🟡 **Em
  treinamento**.
- Processos marcados como **extra** (obrigatório desmarcado) não bloqueiam a
  certificação.

Cada etapa marcada grava **data, hora, quem treinou e observação opcional**, e
entra no histórico — que continua disponível mesmo depois de desmarcar.

## Telas

| Tela | Para que serve |
|---|---|
| **Empresas** | Cartão por empresa com aptos / em treinamento / não treinados |
| **Painel da empresa** | Indicadores, cobertura e atalhos |
| **Funções** | Funções da empresa, quantos aptos cada uma tem, alertas de risco |
| **Função** | Funcionários com %, processos exigidos, responsabilidades, competências, checklist |
| **Funcionários** | Busca e filtros por situação (🟢🟡🔴⚪) |
| **Funcionário** | Progresso, **o que falta para ficar apto** e as 4 etapas de cada processo |
| **O que preciso treinar?** | Pendências agrupadas por pessoa, com as etapas para marcar ali mesmo |
| **Quem sabe fazer isso?** | Por processo: quem está certificado, treinando ou não treinado — quem pode substituir quem |
| **Visão gerencial** | "Minha empresa está coberta?", funções sem apto, sem gente, sem processo, funcionários sem função, treinamentos parados |
| **Histórico** | Linha do tempo de treinamentos e cadastros |
| **VILA GPT** | Chat dos funcionários: pergunta → resposta oficial em passos + fonte. Aba *Manual* para consultar tudo |
| **VILA GPT · Administração** | Base de conhecimento, histórico de perguntas, painel de dúvidas frequentes e status |


## VILA GPT

O VILA GPT é o **manual vivo da empresa + assistente dos funcionários**. Antes de
perguntar ao Bruno ou ao gerente, o funcionário abre o VILA GPT (botão na tela
inicial, no painel da empresa ou pelo endereço `/vila-gpt`) e pergunta:

> "Como faço o fechamento do caixa?" · "Qual embalagem devo usar?" ·
> "Quem sabe fazer esse processo?" · "O que faço quando o cliente reclama?"

### De onde vêm as respostas

Tudo é montado na hora a partir do que já está no sistema — nada é duplicado:

| Fonte | Tabela | Exemplo de fonte mostrada |
|---|---|---|
| Base de conhecimento (procedimentos, regras, perguntas e respostas, treinamentos, fichas técnicas, cardápios, produtos, documentos) | `kb_articles` | *Procedimento — Fechamento de caixa* |
| Funções: descrição, responsabilidades, competências | `roles`, `competencies` | *Função — Atendente* |
| Checklists de cada função | `checklist_items` | *Checklist — Caixa* |
| Processos (o "como fazer" cadastrado em cada processo) | `processes` | *Processo — Fazer arroz (Montador de pedidos)* |
| Quem exerce cada função e quem está certificado em cada processo | `employees`, `employee_roles`, `training_steps` | *Quem sabe fazer — Fazer arroz* |

Só entra o que está marcado como **oficial**. Rascunhos ficam guardados, mas o
VILA GPT não os usa. Alterou uma regra? A próxima resposta já usa o texto novo.

### Regra principal: nunca inventar

1. A pergunta é comparada com toda a base (busca em português, com sinônimos do
   dia a dia: abrir/abertura, iFood/delivery, comanda/pedido…).
2. Se nada parecido for encontrado, a resposta é, na hora e sem gastar IA:
   **"Não encontrei esse procedimento na base oficial da empresa. Procure um
   gerente ou responsável."**
3. Se houver fontes, a IA (Claude) recebe **somente** essas fontes e instruções
   estritas: seguir a regra oficial à risca, responder curto e em passos
   numerados, e devolver `found = false` quando as fontes não bastam. A resposta
   vem em JSON validado, e só as fontes realmente usadas são exibidas
   (*Fonte: Ficha técnica — Strogonoff de frango*).
4. Sem `ANTHROPIC_API_KEY` (ou se a IA falhar), o VILA GPT entra em **modo
   busca**: mostra o texto oficial da fonte mais parecida, com a mesma frase de
   "não encontrei" quando a semelhança não é suficiente.

### Administração (`/vila-gpt/admin`)

Protegida pela senha `VILA_GPT_ADMIN_PIN`. Funcionários comuns só perguntam e
consultam; só quem tem a senha altera a base.

- **Base** — cadastrar, editar, excluir e pesquisar tudo que está cadastrado;
  marcar o que é oficial; ver também o que vem dos outros módulos.
- **Perguntas** — funcionário, pergunta, data/hora, resposta, fonte, feedback
  (👍/👎); botão *Criar procedimento para esta dúvida* nas perguntas sem resposta.
- **Painel** — dúvidas mais frequentes, perguntas sem resposta e o alerta
  *"Este assunto está gerando muitas dúvidas. Considere criar ou atualizar um
  treinamento."* (3+ perguntas de 2+ pessoas sobre o mesmo assunto em 30 dias).
- **Status** — o que está configurado (senha, IA, chave de serviço) e contagens.

### Configuração

| Variável | Obrigatória? | Para quê |
|---|---|---|
| `VILA_GPT_ADMIN_PIN` | Sim, para administrar | Senha da área de administração (mín. 4 caracteres). |
| `ANTHROPIC_API_KEY` | Recomendada | Liga a IA. Sem ela: modo busca. |
| `VILA_GPT_MODEL` | Não | Modelo Claude (padrão `claude-opus-5`; `claude-sonnet-5` é mais barato). |
| `VILA_GPT_EFFORT` | Não | `low`, `medium` (padrão) ou `high`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Não | Permite travar a escrita da base no banco (`supabase/vila-gpt-lock.sql`). |

Na Vercel: **Settings → Environment Variables**, depois **Redeploy**. As tabelas
`kb_articles` e `gpt_questions` são criadas pelo mesmo `supabase/schema.sql`
(pode rodar de novo; é idempotente).

> Segurança: como o app não tem login, a senha protege a **interface** de
> administração e as rotas do servidor. Para impedir também escritas diretas
> no banco com a chave anon, defina `SUPABASE_SERVICE_ROLE_KEY` e rode
> `supabase/vila-gpt-lock.sql`.

## Sincronização entre aparelhos

O app assina as mudanças do Postgres via Supabase Realtime: o que você marca no
celular aparece no computador em segundos, sem recarregar. A bolinha ao lado do
seu nome no topo fica **verde** quando a sincronização está ativa. Ao voltar para o
app (ou ao reconectar a internet) os dados são recarregados automaticamente.

Nada fica só no aparelho — todo o dado mora no Supabase.

## Estrutura do projeto

```
src/
  app/                      telas (Next.js App Router)
  components/
    ui.tsx                  botões, cards, barras, selos, sheets
    AppShell.tsx            cabeçalho, responsável, avisos
    sheets.tsx              formulários de empresa/função/processo/funcionário
    TrainingChips.tsx       as 4 etapas de treinamento
  app/vila-gpt/             chat dos funcionários e administração
  app/api/vila-gpt/         rotas do servidor: perguntar, feedback, administração
  components/vila-gpt/      resposta formatada, ficha da fonte, formulário, abas da administração
  lib/
    types.ts                tipos e metadados das etapas
    derive.ts               progresso, status e APTIDÃO
    selectors.ts            pendências, cobertura, "quem sabe fazer", parados
    store.tsx               carga, realtime e todas as gravações
    vila-gpt/
      text.ts               normalização, raízes e sinônimos em português
      knowledge.ts          base unificada (artigos + funções + processos + checklists + quem sabe fazer)
      retrieval.ts          busca (BM25) e regra de confiança
      analytics.ts          dúvidas frequentes, alertas de treinamento
      server/               banco, senha de administrador e resposta com IA
supabase/schema.sql         banco completo + dados iniciais
supabase/vila-gpt-lock.sql  (opcional) trava a escrita da base ao servidor
tests/                      testes da lógica + servidor falso para testes locais
```

## Comandos

```bash
npm run dev        # desenvolvimento
npm run build      # build de produção
npm run typecheck  # checagem de tipos
npm test           # testes da lógica de aptidão/pendências e do VILA GPT
```

### Testar as telas sem um Supabase real

```bash
node tests/mock-supabase.mjs
```

Em outro terminal:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=teste VILA_GPT_ADMIN_PIN=1234 npm run dev
```

O servidor falso guarda tudo em memória (sem tempo real) e serve só para conferir
os fluxos de tela. Ele já vem com alguns exemplos na base do VILA GPT.

## Segurança

A primeira versão não tem login: quem tiver o endereço consegue ver e editar. Para
uso interno com um endereço não divulgado isso costuma bastar. Quando quiser
proteger, ative o Supabase Auth e troque, no fim do `schema.sql`,
`to anon, authenticated` por `to authenticated` nas policies.

## Crescer depois

O banco já foi modelado para receber, sem migração pesada: novas empresas, funções,
funcionários e processos (tudo pelo app), além de avaliações, documentos,
checklists por turno e níveis de competência — as tabelas `competencies`,
`checklist_items` e `processes` são independentes e ligadas por `role_id`.
