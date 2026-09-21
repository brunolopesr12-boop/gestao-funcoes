# Gestão de Funções, Funcionários e Treinamentos

Aplicativo web para organizar a estrutura operacional das empresas e garantir que
cada funcionário esteja realmente treinado para exercer sua função.

```
EMPRESA → FUNÇÃO → FUNCIONÁRIO → PROCESSOS → 4 ETAPAS → CERTIFICAÇÃO → APTO
```

Feito para o celular: poucos toques, cards grandes, cores de status e barras de
progresso. Funciona igual no computador, tablet e celular, com os dados
sincronizados em tempo real entre todos os aparelhos.

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
| **KDS — Sr. Strogonoff** | Comandas do delivery: filas, alertas, conferência e despacho |

## KDS — Sr. Strogonoff (comandas do delivery)

Tela de cozinha em `/kds` para substituir a notinha de papel:

```
iFood → comanda no KDS → alertas piscando → produzir → conferir → despachar → status volta pro iFood
```

### O que a tela faz

- **Quatro filas**: Novos · Em produção · Prontos/conferência · Despachados
  (cancelados aparecem numa faixa separada, sem poder ser despachados).
- **Alertas impossíveis de ignorar**, gerados a partir do próprio pedido:
  `💰 RECEBER R$ X`, `💵 TROCO PARA R$ Y`, `🥤 NÃO ESQUECER BEBIDA`,
  `➕ ITEM EXTRA`, `🧂 MOLHO`, `⚠️ OBSERVAÇÃO IMPORTANTE`,
  `🛵 CHAMAR OUTRO MOTOBOY`, `📍 ATENÇÃO NA ENTREGA` — os críticos piscam.
  Quando está tudo pago, aparece `✅ PAGO PELO APP`.
- **Cronômetro** por pedido e `🔴 PEDIDO ATRASADO` passando do limite (ajustável
  em ⚙️, padrão 25 min).
- **Conferência** em 8 itens (comida, bebida, adicionais, molhos, observações,
  pagamento, troco, entrega). O que não existe no pedido já vem liberado.
- **Despacho bloqueado** enquanto houver alerta crítico sem conferência — dá para
  forçar, mas só com ação explícita, e fica registrado.
- Som opcional no pedido novo, estado da conexão no topo e atualização
  automática em todos os monitores (Supabase Realtime).

### Alertas novos no futuro

Todos os alertas são regras em [`src/lib/kds/alerts.ts`](src/lib/kds/alerts.ts).
Para criar um tipo novo basta acrescentar um item em `ALERT_RULES` — a tela, a
conferência e o bloqueio de despacho passam a considerá-lo sozinhos.

### 1. Criar as tabelas

No Supabase: **SQL Editor → New query** → cole
[`supabase/kds.sql`](supabase/kds.sql) → **Run**. Pode rodar de novo sem problema.

### 2. Ligar a integração do iFood

A integração usa a **Merchant API oficial** do iFood (nada de scraping). As
credenciais ficam **só no servidor** — nenhuma delas tem prefixo
`NEXT_PUBLIC_`, então nunca chegam ao navegador.

Na Vercel (**Settings → Environment Variables**) ou no `.env.local`:

| Variável | O que é |
|---|---|
| `IFOOD_CLIENT_ID` | Client ID da sua aplicação no Portal do Desenvolvedor iFood |
| `IFOOD_CLIENT_SECRET` | Client Secret da mesma aplicação |
| `IFOOD_MERCHANT_ID` | ID da loja (vários separados por vírgula) |
| `IFOOD_API_BASE` | opcional — padrão `https://merchant-api.ifood.com.br` |
| `SUPABASE_SERVICE_ROLE_KEY` | opcional — se ausente, o servidor usa a chave anon |
| `KDS_COMPANY_ID` | opcional — amarra as comandas a uma empresa do cadastro |

**O que ainda depende de você (não dá para fazer por código):**

1. Criar a aplicação no [Portal do Desenvolvedor iFood](https://developer.ifood.com.br)
   e pegar Client ID / Client Secret.
2. Pedir os módulos **Order** e **Events** (`ORDER_STATUS`) para a aplicação.
3. Passar pela **homologação** do iFood para a aplicação sair de teste.
4. Vincular a loja (merchant) à aplicação e anotar o `merchantId`.

Enquanto isso não estiver pronto, o KDS diz na cara `🔴 iFood não configurado` e
lista o que falta em ⚙️ — ele **nunca** finge que a integração está no ar.

### 3. Como os pedidos entram

O servidor faz o *polling* oficial de eventos (`/events/v1.0/events:polling`),
confirma o recebimento (`acknowledgment`), busca o detalhe do pedido e grava a
comanda. A rota é `POST /api/ifood/poll` e a tela do KDS a chama a cada 30
segundos (intervalo mínimo exigido pelo iFood, respeitado também entre
instâncias). **Deixe a tela do KDS aberta** na cozinha: é ela que mantém o ciclo
rodando. Se preferir, aponte um agendador externo para essa mesma rota.

Proteção contra duplicidade em duas camadas: o `id` do evento é chave primária em
`kds_ifood_events` e o `ifood_order_id` é índice único em `kds_orders` — o mesmo
pedido nunca vira duas comandas, mesmo com reenvio ou queda de conexão.

### 4. O que volta para o iFood

| Ação no KDS | Chamada na Merchant API |
|---|---|
| **Aceitar** | `confirm` (+ `startPreparation`, se a loja usar) |
| **Pedido pronto** | `readyToPickup` |
| **Despachar** (entrega própria) | `dispatch` |
| **Despachar** (entrega do iFood) | nada — quem despacha é o entregador do iFood; a loja já enviou `readyToPickup` |

Se o iFood recusar a mudança, o KDS **não** avança a etapa em silêncio: mostra o
erro devolvido pela API.

> **Mensagem automática para o cliente:** não foi implementada. O iFood já avisa
> o cliente quando o status muda, e mandar um texto próprio exigiria a API de
> chat (integração adicional). Ficou de fora de propósito.

### Pedido de teste

Em ⚙️ há botões que criam comandas marcadas com 🧪 **TESTE** (pedido com bebida,
com troco, com observação, entrega própria etc.). Servem para a equipe treinar e
para conferir os alertas. Essas comandas **não** enviam nada ao iFood.

---

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
    kds/                    KDS: tipos, normalização do pedido, alertas, comanda
    ifood/                  integração oficial (auth, polling, status) — servidor
    server/                 acesso ao banco e regras do fluxo — servidor
  components/kds/           comanda, alertas, filas, conferência
  app/kds/                  tela do KDS
  app/api/ifood/            polling e status da integração
  app/api/kds/              ações do pedido, configuração e pedido de teste
supabase/schema.sql         banco completo + dados iniciais
supabase/kds.sql            tabelas do KDS e da integração iFood
tests/                      testes da lógica + servidor falso para testes locais
```

## Comandos

```bash
npm run dev        # desenvolvimento
npm run build      # build de produção
npm run typecheck  # checagem de tipos
npm test           # testes da lógica de aptidão/pendências e do KDS
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

As credenciais do iFood são a exceção: ficam só em variável de ambiente do
servidor, nunca no banco e nunca no navegador. Todas as chamadas à Merchant API
saem das rotas em `src/app/api/`.

## Crescer depois

O banco já foi modelado para receber, sem migração pesada: novas empresas, funções,
funcionários e processos (tudo pelo app), além de avaliações, documentos,
checklists por turno e níveis de competência — as tabelas `competencies`,
`checklist_items` e `processes` são independentes e ligadas por `role_id`.
