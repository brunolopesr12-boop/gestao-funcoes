# Gestão de Funções, Funcionários e Treinamentos

Aplicativo web para organizar a estrutura operacional das empresas e garantir que
cada funcionário esteja realmente treinado para exercer sua função.

```
EMPRESA → FUNÇÃO → FUNCIONÁRIO → PROCESSOS → 4 ETAPAS → CERTIFICAÇÃO → APTO
```

Feito para o celular: poucos toques, cards grandes, cores de status e barras de
progresso. Funciona igual no computador, tablet e celular, com os dados
sincronizados em tempo real entre todos os aparelhos.

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
```

```bash
npm run dev
```

Abra <http://localhost:3000>.

## 3. Publicar na Vercel

1. Suba o projeto para um repositório no GitHub.
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → importe o repositório.
   A Vercel detecta Next.js sozinha; não precisa mudar nada na build.
3. Em **Environment Variables** adicione as mesmas duas variáveis do `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`) para
   Production, Preview e Development.
4. **Deploy**. O endereço gerado já funciona no celular.
5. No celular, abra o endereço e use **Adicionar à tela de início** — o app abre em
   tela cheia, como um aplicativo.

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
  lib/
    types.ts                tipos e metadados das etapas
    derive.ts               progresso, status e APTIDÃO
    selectors.ts            pendências, cobertura, "quem sabe fazer", parados
    store.tsx               carga, realtime e todas as gravações
supabase/schema.sql         banco completo + dados iniciais
tests/                      testes da lógica + servidor falso para testes locais
```

## Comandos

```bash
npm run dev        # desenvolvimento
npm run build      # build de produção
npm run typecheck  # checagem de tipos
npm test           # testes da lógica de aptidão/pendências
```

### Testar as telas sem um Supabase real

```bash
node tests/mock-supabase.mjs
```

Em outro terminal:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=teste npm run dev
```

O servidor falso guarda tudo em memória (sem tempo real) e serve só para conferir
os fluxos de tela.

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
