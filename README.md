# Vila Rica · Gestão Operacional de Cozinha

Sistema web completo para operar a cozinha no dia a dia — feito para celular,
tablet e computador, com login, permissões por perfil e várias unidades.

```
RECEBER → LOTE + VALIDADE → ESTOQUE → PRODUZIR (ficha técnica) → NOVO LOTE → ETIQUETA/QR
   ↓            ↓              ↓            ↓                        ↓
 custo      alertas         contagem     consumo/perda         rastreabilidade total
```

O mesmo app inclui o módulo de **Funções, Funcionários e Treinamentos**
(certificação em 4 etapas) e o **VILA GPT** (assistente interno que responde só
com base nos procedimentos oficiais cadastrados).

> **Para colocar no ar:** siga [`DEPLOY.md`](DEPLOY.md) (GitHub → Vercel →
> banco criado pela própria Vercel → colar `supabase/install.sql`).
> A arquitetura, o banco e as decisões técnicas estão em
> [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md); o guia para programar novas
> telas em [`docs/GUIA-DEV.md`](docs/GUIA-DEV.md).

---

## O que o sistema faz

| Módulo | Principais funções |
|---|---|
| **Painel** | Valor do estoque, vencidos, vencendo (hoje/3/7 dias), abaixo do mínimo, produções e recebimentos pendentes, tarefas, perdas do período, alertas; gráficos de perdas, consumo, produção, estoque por categoria, mais consumidos, próximos do vencimento. |
| **Produtos** | Código interno, SKU, código de barras, categoria/subcategoria, tipo (matéria-prima, semipronto, produzido, final…), unidade de estoque e de compra com conversão (1 caixa = 10 kg, 1 pacote = 500 g…), custo, mínimo/máximo/ponto de reposição por unidade, validade após produção/abertura/congelamento/descongelamento, temperatura ideal, armazenamento, fornecedores alternativos, foto. |
| **Fichas técnicas** | Ingredientes com peso bruto/líquido, perda %, fator de correção, rendimento, custo total, por unidade e por porção. |
| **Produção** | Escolhe a ficha → quantidade → ingredientes necessários, disponibilidade e lotes FEFO → baixa automática → rendimento real → lote com validade → etiqueta. Produção parcial e planejada. |
| **Recebimento** | Fornecedor, NF, itens com quantidade/unidade/peso/lote/validade/preço/temperatura/embalagem, aprovado/ressalva/recusado com motivo. Ao finalizar: lotes, entrada no estoque, custo (último ou médio), histórico de preço, alertas. |
| **Estoque** | Saldo por unidade, local, produto e lote; lotes; validades (vencidos, hoje, 3 e 7 dias); movimentações imutáveis; consumo, ajuste, entrada manual, transferência interna e entre unidades; abertura/congelamento/descongelamento/bloqueio de lote; FEFO com aviso. |
| **Etiquetas e QR** | Modelos por tipo (produção, abertura, congelamento, descongelamento, fracionamento, armazenamento, recebimento) com editor de layout em mm, impressão individual e em lote, ZPL para impressoras térmicas; QR Code abre a ficha do lote com ações (consumir, transferir, ajustar, perda, contar). |
| **Inventário** | Contagem rápida no celular (local → produto/QR → quantidade), contagem completa, teórico × contado, motivo da diferença, ajustes automáticos ao finalizar. |
| **Perdas** | Motivos configuráveis (vencimento, produção excedente, erro, armazenamento, quebra, contaminação…), custo da perda, foto, painel por motivo/produto/funcionário/período. |
| **Compras e reposição** | Níveis 🟢🟡🔴🚨, sugestão de compra, pedidos com status (rascunho → solicitado → aprovado → pedido → recebido), transformar pedido em recebimento, comparação de preços entre fornecedores. |
| **Temperaturas** | Equipamentos com faixa aceitável, registro rápido, alerta fora da faixa com ação corretiva, histórico e gráfico. |
| **Checklists e tarefas** | Modelos (abertura, fechamento, limpeza, geladeira, freezer…) com frequência e horário, execução com evidência (foto/observação) nas tarefas críticas, tarefas com responsável, prazo, prioridade e status. |
| **Alertas** | Vencido, vencendo, estoque mínimo/crítico, temperatura, checklist atrasado, produção pendente, recebimento com problema, tarefa atrasada — com leitura e histórico. |
| **Relatórios** | Estoque, inventários, movimentações, compras, recebimentos, produção, perdas, validades, temperaturas, checklists, consumo, custos, fornecedores — com filtros e exportação CSV/Excel/PDF. |
| **Auditoria** | Quem fez o quê, quando, registro afetado, valor anterior e novo. Nunca é apagada. |
| **Usuários** | Perfis Administrador, Gerente, Estoquista, Cozinha, Auditor e Funcionário; acesso a todas ou a determinadas unidades; ajuste fino por permissão. |
| **Offline** | Contagens, temperaturas, checklists, perdas e consumos por QR funcionam sem internet e sincronizam depois; conflitos aparecem em **Sincronização**. |

Regras que o banco garante (não dependem da tela): toda alteração de estoque
gera movimentação rastreável e imutável; correção é sempre um novo registro;
lote com validade quando aplicável; permissões verificadas no banco (RLS +
funções); auditoria em toda ação relevante; um usuário nunca enxerga dados de
empresa/unidade que não lhe foram liberadas.

## Tecnologia

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase
(PostgreSQL, Auth, Storage, Realtime) · TanStack Query · Recharts · ZXing
(leitura de QR/código de barras) · qrcode · ExcelJS · jsPDF · PWA com service
worker · Vercel.

## Rodar no computador

```bash
npm install
```

Crie `.env.local` (veja `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=...        # recomendado (usuários, cron, integrações)
VILA_GPT_ADMIN_PIN=uma-senha         # administração do VILA GPT
ANTHROPIC_API_KEY=sk-ant-...         # opcional: IA do VILA GPT
```

Aplique `supabase/install.sql` no SQL Editor do projeto e rode:

```bash
npm run dev
```

## Comandos

```bash
npm run dev          # desenvolvimento
npm run build        # build de produção
npm run typecheck    # checagem de tipos
npm test             # testes de lógica (treinamentos, VILA GPT, utilidades)
npm run db:bundle    # regenera supabase/install.sql a partir de supabase/migrations
npm run db:local     # recria o banco local de testes (PostgreSQL) e aplica o install.sql 2×
npm run test:db      # testes de integração do banco (fluxos + RLS) no PostgreSQL local
npm run test:all     # lógica + banco
npm run e2e          # ponta a ponta no navegador (Playwright + Supabase local sem Docker)
npm run e2e:prod     # o mesmo contra o build de produção (npm run e2e:build antes)
```

Os testes de banco cobrem: bootstrap do primeiro administrador, padrões da
empresa, permissões por perfil e por unidade, conversão de unidades,
recebimento → lote/validade/estoque/custo/histórico de preço, ficha técnica,
produção → baixa FEFO → novo lote com validade e custo real, consumo com aviso
FEFO e idempotência, perda com custo/motivo/foto, inventário → ajustes,
transferências, eventos de lote, validade → alerta, estoque mínimo →
reposição, imutabilidade de movimentos/auditoria, compras → recebimento,
temperatura → alerta, checklists, tarefas, painel/relatórios, onboarding,
modelos de etiqueta (padrão por tipo), guardas de administrador (só admin
concede o perfil admin; a empresa nunca fica sem admin ativo) e guardas de
permissão (ninguém concede permissão avulsa que não possui; perfil de admin
só é editado por admin).

## Estrutura

```
supabase/
  schema.sql              módulo de treinamentos + VILA GPT (original)
  migrations/0001..0019   sistema de cozinha (fonte da verdade)
  install.sql             arquivo único gerado (colar no Supabase)
src/
  app/(ops)/              telas do sistema de cozinha
  app/(treinamentos)/     funções, funcionários, treinamentos e VILA GPT
  app/api/ops/            usuários (service role), cron de alertas, integrações
  app/api/vila-gpt/       rotas do VILA GPT
  app/login, app/auth     login, cadastro, recuperação de senha
  lib/ops/                sessão/permissões, hooks, RPC, fila offline, tipos, formatação
  lib/supabase/           clientes (navegador, servidor, service role), middleware
  components/ops/         shell, kit de UI, pickers, QR, fotos e componentes por módulo
tests/                    testes de lógica e de banco (tests/db)
docs/                     ARQUITETURA.md e GUIA-DEV.md
```

## Integrações futuras

O sistema já expõe contratos para PDV, pedidos, iFood, ERP, balanças, BI e
impressoras: chaves de API em **Configurações → Integrações** e rotas
`GET /api/ops/integrations/produtos`, `GET /api/ops/integrations/estoque`,
`POST /api/ops/integrations/movimentos` (baixa/entrada idempotente) e
`POST|GET /api/ops/integrations/eventos` (fila de eventos). Etiquetas podem ser
exportadas em ZPL. Nenhuma integração externa fictícia foi implementada.

## VILA GPT e treinamentos

Veja a seção correspondente em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e
as telas em **Funções e treinamentos** e **VILA GPT** no menu. O VILA GPT
responde apenas com base na base oficial e agora respeita as empresas do
usuário logado.
