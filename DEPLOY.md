# Publicar o aplicativo — GitHub + Vercel + Supabase

Siga na ordem. Leva cerca de 15 minutos. Só existe **um** passo fora da Vercel:
colar o arquivo do banco no Supabase (passo 4).

---

## 1. Enviar o projeto para o GitHub

O projeto já está com o Git iniciado e o primeiro commit feito.

**a)** Crie a conta em <https://github.com> (se ainda não tiver).

**b)** Crie um repositório novo em <https://github.com/new>:

- **Repository name:** `gestao-funcoes`
- **Private** (recomendado — é dado da sua equipe)
- **Não** marque nada em "Initialize this repository with" (sem README, sem
  .gitignore, sem license). O repositório precisa nascer vazio.
- **Create repository**

**c)** Na tela que aparecer, copie o endereço do repositório (algo como
`https://github.com/SEU-USUARIO/gestao-funcoes.git`) e rode aqui na pasta do
projeto, trocando `SEU-USUARIO`:

```bash
git remote add origin https://github.com/SEU-USUARIO/gestao-funcoes.git
```

```bash
git branch -M main && git push -u origin main
```

Se pedir login, use seu usuário do GitHub e um **Personal Access Token** como
senha (GitHub → Settings → Developer settings → Personal access tokens → Tokens
(classic) → Generate new token → marque `repo`). O Windows costuma abrir uma
janela do navegador para autorizar, o que é mais simples.

---

## 2. Importar na Vercel

**a)** Entre em <https://vercel.com> e faça login **com a conta do GitHub**.

**b)** **Add New → Project**.

**c)** Encontre `gestao-funcoes` na lista e clique em **Import**.
(Se o repositório não aparecer: **Adjust GitHub App Permissions** e libere o acesso.)

**d)** Não mude nada. Framework: Next.js. Clique em **Deploy**.

O primeiro deploy vai funcionar, mas o app vai abrir na tela
**"Falta conectar o banco de dados"** — é o esperado, ainda não existe banco.

---

## 3. Criar o banco pela própria Vercel

**a)** No projeto, abra a aba **Storage**.
(Em algumas contas fica em **Integrations → Browse Marketplace**.)

**b)** **Create Database** → escolha **Supabase** → **Continue**.

**c)** Aceite os termos, escolha o plano **Free**, dê um nome
(ex.: `gestao-funcoes`) e a região **South America (São Paulo)** se estiver
disponível — fica mais rápido no Brasil.

**d)** **Connect to Project** / **Create**.

A Vercel cria o projeto Supabase e **adiciona as variáveis de ambiente
automaticamente** no seu projeto. Você não precisa copiar chave nenhuma.

> O app aceita os dois formatos de nome que a integração pode usar
> (`NEXT_PUBLIC_SUPABASE_*` ou `SUPABASE_*`), então funciona de qualquer jeito.

---

## 4. Criar as tabelas (único passo no Supabase)

A Vercel cria o banco **vazio**. As tabelas vêm do arquivo do projeto.

**a)** Ainda na aba **Storage** da Vercel, clique no banco criado e depois em
**Open in Supabase** (ou entre em <https://supabase.com/dashboard> — o projeto
já vai estar lá).

**b)** No menu da esquerda: **SQL Editor** → **New query**.

**c)** Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste projeto,
copie **tudo** (Ctrl+A, Ctrl+C) e cole no editor.

**d)** Clique em **Run** (ou Ctrl+Enter).

Deve aparecer *Success. No rows returned*. Isso cria:

- as 12 tabelas (incluindo as duas do VILA GPT),
- as permissões de acesso,
- a **sincronização em tempo real** entre os aparelhos,
- e já cadastra **Vila Rica** e **Sr. Strogonoff** com as funções e os processos
  do Montador de pedidos.

Pode rodar de novo sem medo — o arquivo não duplica nada.

---

## 5. Redeploy

Volte na Vercel → aba **Deployments** → no deploy mais recente clique nos três
pontinhos **⋯** → **Redeploy** → **Redeploy**.

Isso é necessário porque as variáveis de ambiente entram no app na hora da build.

Quando terminar, abra o endereço (`gestao-funcoes.vercel.app`). As duas empresas
devem aparecer na tela inicial. **Pronto.**

---

## 5b. Ligar o VILA GPT (assistente dos funcionários)

O VILA GPT já vem no app. Faltam só duas variáveis, em **Settings → Environment
Variables** do projeto na Vercel:

| Variável | Valor |
|---|---|
| `VILA_GPT_ADMIN_PIN` | A senha que só a administração vai saber (mín. 6 caracteres). Sem ela ninguém altera a base oficial. |
| `VILA_GPT_SESSION_SECRET` | Recomendado: um texto longo e aleatório (ex.: 40 letras e números), para assinar o cookie de quem entrou na administração. |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic (<https://console.anthropic.com>). Opcional: sem ela o VILA GPT mostra o procedimento oficial mais parecido em vez de redigir a resposta. |

Depois faça o **Redeploy** de novo (passo 5). O `schema.sql` do passo 4 já cria as
tabelas do VILA GPT.

Para começar: abra **VILA GPT → ⚙️ → entre com a senha → + Cadastrar informação
oficial** e cadastre os primeiros procedimentos (fechamento de caixa, abertura,
o que fazer quando o cliente reclama…). As funções, processos e checklists já
cadastrados entram automaticamente.

## 6. Colocar na tela do celular

Abra o endereço no celular e:

- **Android / Chrome:** menu ⋮ → *Adicionar à tela inicial*
- **iPhone / Safari:** botão compartilhar → *Adicionar à Tela de Início*

O app abre em tela cheia, sem barra de navegador, igual a um aplicativo instalado.

Faça isso em todos os aparelhos que forem usar. O que você marcar em um aparece
nos outros em segundos — a bolinha ao lado do seu nome, no topo, fica **verde**
quando a sincronização em tempo real está ligada.

---

## 7. Primeiro uso

1. Toque no botão do seu nome (canto superior direito) e informe **quem é você**.
   Esse nome fica gravado em toda etapa de treinamento que você marcar.
2. Entre em **Sr. Strogonoff → Funcionários → + Novo funcionário** e cadastre a
   equipe, escolhendo a **função atual** de cada um.
3. Em **Funções**, abra cada função e cadastre os **processos** (o que a pessoa
   precisa saber fazer). Só o Montador de pedidos já vem preenchido.
4. No dia a dia, use **O que preciso treinar?** — é a tela feita para usar com o
   celular na mão, marcando as etapas na hora.

---

## Atualizar o app depois

Qualquer mudança no código é só:

```bash
git add -A && git commit -m "descrição da mudança" && git push
```

A Vercel refaz o deploy sozinha em ~1 minuto.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Tela "Falta conectar o banco de dados" | As variáveis não chegaram na build. Confira em **Settings → Environment Variables** se existe `NEXT_PUBLIC_SUPABASE_URL` (ou `SUPABASE_URL`) e refaça o **Redeploy** (passo 5). |
| "Não consegui carregar os dados" com erro de tabela | O passo 4 não rodou. Volte ao SQL Editor e rode o `schema.sql` inteiro. |
| A bolinha do topo fica cinza | A sincronização em tempo real não conectou. Rode o `schema.sql` de novo (o bloco final liga o realtime) e recarregue a página. Mesmo cinza o app funciona; ele recarrega os dados ao voltar para a tela. |
| Empresas não aparecem | Supabase → **Table Editor → companies**. Se estiver vazia, rode o `schema.sql` de novo. |
| VILA GPT: "Falta definir a senha de administrador" | Adicione `VILA_GPT_ADMIN_PIN` nas variáveis da Vercel e refaça o Redeploy. |
| VILA GPT responde "IA indisponível" | Confira `ANTHROPIC_API_KEY` e o saldo/limites da conta na Anthropic. Enquanto isso ele mostra a fonte oficial mais parecida. |
| VILA GPT: "Não consegui ler a base" | O `schema.sql` mais novo não rodou (tabelas `kb_articles`/`gpt_questions`). Rode-o de novo no SQL Editor. |
