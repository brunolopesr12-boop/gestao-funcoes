# Publicar o aplicativo — GitHub + Vercel + Supabase

Siga na ordem. Leva cerca de 20 minutos. Fora da Vercel só existem dois passos:
colar o arquivo do banco no Supabase (passo 4) e conferir a configuração de
login (passo 5).

---

## 1. Enviar o projeto para o GitHub

**a)** Crie a conta em <https://github.com> (se ainda não tiver).

**b)** Crie um repositório novo em <https://github.com/new> (`gestao-funcoes`,
**Private**, sem README/.gitignore/license).

**c)** Na pasta do projeto:

```bash
git remote add origin https://github.com/SEU-USUARIO/gestao-funcoes.git
git branch -M main && git push -u origin main
```

---

## 2. Importar na Vercel

**a)** Entre em <https://vercel.com> com a conta do GitHub → **Add New → Project**
→ **Import** em `gestao-funcoes` → **Deploy** (não mude nada).

O primeiro deploy abre na tela **"Falta conectar o banco de dados"** — esperado.

---

## 3. Criar o banco pela própria Vercel

Aba **Storage** → **Create Database** → **Supabase** → plano **Free**, região
**South America (São Paulo)** → **Connect to Project**.

A Vercel cria o projeto Supabase e injeta as variáveis de ambiente sozinha
(`NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`, com qualquer nome que a integração
usar — o app aceita todos).

---

## 4. Criar as tabelas (único passo no Supabase)

**a)** Storage → clique no banco → **Open in Supabase** → **SQL Editor → New query**.

**b)** Abra o arquivo [`supabase/install.sql`](supabase/install.sql) deste projeto,
copie **tudo** e cole no editor → **Run**.

Isso cria, de uma vez: o módulo de funções/treinamentos, o VILA GPT e todo o
sistema de gestão de cozinha (mais de 60 tabelas, views, funções, permissões
por perfil, RLS, auditoria imutável, bucket de fotos, realtime) e já cadastra a
empresa **Vila Rica** com uma unidade, unidades de medida, categorias, motivos
de perda, modelos de etiqueta e checklists iniciais — tudo editável.
**Pode rodar de novo sem medo**: o arquivo é idempotente e nunca apaga dados.

> Se você já tinha o `schema.sql` antigo aplicado, rode o `install.sql` mesmo
> assim: ele complementa sem apagar nada.

---

## 5. Login (Supabase Auth)

No painel do Supabase → **Authentication → Providers → Email**:

- Deixe **Email** ativado.
- **Confirm email**: recomendamos **desligar** para uso interno (os usuários
  entram na hora com a senha que o administrador definir). Se preferir manter,
  configure o remetente em Authentication → SMTP e peça para cada pessoa
  confirmar o e-mail.
- Em **Authentication → URL Configuration**, coloque o endereço do app
  (`https://gestao-funcoes.vercel.app`) em **Site URL** e adicione
  `https://gestao-funcoes.vercel.app/auth/callback` em **Redirect URLs**
  (necessário para "esqueci a senha").

---

## 6. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Obrigatória? | Para quê |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Injetadas pela integração (passo 3). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Recomendada** | Chave *service_role* (Supabase → Project Settings → API). Permite criar usuários com senha na tela **Usuários**, a varredura diária de alertas (cron) e a API de integrações. Nunca vai para o navegador. |
| `CRON_SECRET` | Recomendada | Qualquer texto longo; protege as rotas do cron. |
| `NEXT_PUBLIC_ALLOW_SIGNUP` | Não | `true` libera "criar conta" para qualquer pessoa. Padrão: só o primeiro administrador e e-mails convidados. |
| `VILA_GPT_ADMIN_PIN` | Para administrar o VILA GPT | Senha da administração da base de conhecimento (mín. 6 caracteres). |
| `VILA_GPT_SESSION_SECRET` | Recomendada | Texto aleatório que assina o cookie da administração do VILA GPT. |
| `ANTHROPIC_API_KEY` | Opcional | Liga a IA do VILA GPT. Sem ela: modo busca. |

Depois de salvar variáveis: **Deployments → ⋯ → Redeploy**.

---

## 7. Primeiro acesso

1. Abra o endereço do app. A tela de login avisa **"Primeiro acesso"**: clique
   em **Criar conta**, informe nome, e-mail e senha. Esse primeiro usuário vira
   **administrador** da Vila Rica (e das demais empresas já cadastradas).
2. Vá em **Configurações** e confira a unidade (nome, endereço), os locais de
   estoque (Estoque seco, Geladeira, Freezer, Cozinha) e os equipamentos de
   temperatura.
3. Em **Usuários**, cadastre a equipe: nome, e-mail, senha inicial, perfil
   (Gerente, Estoquista, Cozinha, Auditor ou Funcionário) e unidades liberadas.
   Sem a chave de serviço, use **Convidar por e-mail**: a pessoa cria a conta em
   `/login` com aquele e-mail.
4. Cadastre **Produtos** (com unidade de compra e conversão), **Fornecedores** e
   as **Fichas técnicas**. Registre o estoque inicial em **Estoque → Entrada
   manual** ou faça o primeiro **Recebimento**.
5. No celular, abra o endereço e use **Adicionar à tela de início**: o app abre
   em tela cheia, com os atalhos Receber, Produzir, Estoque, Contar, Perda,
   Etiquetas, Checklists, Temperatura e Ler QR.

---

## Cron (varredura diária)

O `vercel.json` já agenda:

- `/api/keepalive` (12:00 UTC) — mantém o banco gratuito acordado;
- `/api/ops/cron/alerts` (06:00 UTC) — gera os checklists do dia e atualiza os
  alertas de validade, estoque mínimo, checklists atrasados, produções e tarefas
  (requer `SUPABASE_SERVICE_ROLE_KEY`). Sem o cron, a mesma varredura roda ao
  abrir o Painel ou a Central de alertas.

---

## Atualizar o app depois

```bash
git add -A && git commit -m "descrição da mudança" && git push
```

A Vercel refaz o deploy sozinha. Se a atualização trouxer mudanças de banco,
rode o `supabase/install.sql` de novo no SQL Editor (é seguro).

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| "Falta conectar o banco de dados" | Variáveis não chegaram na build. Confira em Settings → Environment Variables e faça **Redeploy**. |
| "Não consegui carregar sua sessão" com erro de tabela/função | O `install.sql` não rodou (ou é antigo). Rode-o inteiro no SQL Editor. |
| Login diz "Confirme seu e-mail" | Desligue *Confirm email* em Authentication → Providers → Email, ou confirme o usuário em Authentication → Users. |
| "Sua conta ainda não foi liberada" | Um administrador precisa cadastrar/convidar esse e-mail em **Usuários** (ou, se é a primeira empresa, use **Criar minha empresa**). |
| Não consigo criar usuário com senha | Falta `SUPABASE_SERVICE_ROLE_KEY`. Enquanto isso use **Convidar por e-mail**. |
| Banco pausado (plano gratuito) | Supabase → **Resume project**. Nada é perdido. |
| Fotos não sobem | Confira se o bucket `ops-fotos` existe (Storage). O `install.sql` cria; se não, crie um bucket público com esse nome. |
| Etiqueta sai fora do tamanho | Na impressão, escolha o tamanho do papel igual ao do modelo (ex.: 60×40 mm) e margens zero; para impressoras Zebra use **Baixar ZPL**. |
| VILA GPT "Não consegui ler a base" | Rode o `install.sql` e confira `VILA_GPT_ADMIN_PIN`. |
