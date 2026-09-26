# Relatório de entrega — Sistema de Gestão Operacional de Cozinha (Vila Rica)

Data: 2026-09-26 · Branch: `claude/lucid-goodall-t0ebwo`

## 1. O que foi implementado

Sistema web completo e funcional (não é protótipo) com identidade e código
próprios, cobrindo os 44 pontos do pedido. Os módulos antigos (Funções,
Funcionários, Treinamentos e VILA GPT) foram preservados e passaram a exigir
login, respeitando as empresas do usuário.

| Área | Entregue |
|---|---|
| Base | Login (Supabase Auth), primeiro acesso vira administrador, convites por e-mail, recuperação de senha, middleware de sessão, seletor de unidade, PWA instalável, service worker, fila offline com conflitos em **Sincronização**, onboarding |
| Cadastros | Produtos (tipos matéria-prima → semipronto → produzido → final, unidades de estoque/compra com conversão, custo, mínimos por unidade, validades, temperatura, armazenamento, fornecedores alternativos, foto), categorias, unidades de medida, locais de estoque, fornecedores com histórico e comparação de preços |
| Estoque | Saldos por unidade/local/produto/lote, lotes com validade (FEFO), movimentações imutáveis, consumo, ajuste, entrada manual, transferência interna e entre unidades, abertura/congelamento/descongelamento/bloqueio de lote, ficha do lote por QR Code com ações |
| Recebimento e compras | Recebimento com itens conferidos (aprovado/ressalva/recusado com motivo, temperatura, embalagem), finalização gera lotes, estoque, custo (médio ou último) e histórico de preço; reposição com níveis 🟢🟡🔴🚨 e sugestão de compra; pedidos rascunho → solicitado → aprovado → pedido → recebido → cancelado, convertidos em recebimento |
| Fichas técnicas e produção | Ingredientes com peso bruto/líquido, perda %, fator de correção, rendimento e custo (total, unitário, por porção); produção com plano de ingredientes, disponibilidade e lotes FEFO, baixa automática, rendimento real, novo lote com validade e custo real, produção parcial e planejada, versões de ficha |
| Etiquetas | Modelos por tipo com editor em mm (campos, QR, código de barras, logo), impressão individual e em lote, histórico, ZPL para impressoras térmicas |
| Inventário e perdas | Contagem rápida no celular (local → produto/QR → quantidade), contagem completa, teórico × contado, motivos de diferença, ajustes ao finalizar; perdas com motivo, custo, foto obrigatória quando exigida, painel por motivo/produto/funcionário/período |
| Rotinas | Temperaturas por equipamento com faixa, alerta crítico fora da faixa e ação corretiva; checklists (abertura, fechamento, limpeza…) gerados por frequência, evidência nas tarefas críticas, conclusão obrigatória; tarefas com responsável, prazo, prioridade e atraso automático |
| Gestão | Central de alertas (validade, mínimo, temperatura, checklist, produção, recebimento, tarefa), painel com cartões e gráficos, relatórios com filtros e exportação CSV/Excel/PDF, auditoria imutável |
| Usuários e configurações | Perfis Administrador, Gerente, Estoquista, Cozinha, Auditor e Funcionário, perfis personalizados, acesso por unidade, ajuste fino por permissão, criação de usuário com senha (chave de serviço) ou convite, empresa/unidades/parâmetros, chaves de API e fila de eventos para integrações (PDV, iFood, ERP, balanças, BI) sem integrações fictícias |

## 2. Estrutura de arquivos

- `supabase/migrations/0001..0019` — fonte da verdade do banco; `supabase/install.sql` é o arquivo único gerado (`npm run db:bundle`) para colar no Supabase.
- `src/app/(ops)/` — 66 telas do sistema de cozinha; `src/app/(treinamentos)/` — módulos antigos; `src/app/api/ops/` — usuários (chave de serviço), cron de alertas e integrações; `src/app/login`, `src/app/auth`, `src/app/l/[id]` (QR do lote).
- `src/lib/ops/` — sessão e permissões, RPC, fila offline, tipos, formatação pt-BR e um módulo de dados por área (`modules/*`).
- `src/components/ops/` — shell (sidebar, barra inferior, seletor de unidade), kit de UI, pickers, QR/scanner, fotos e componentes por módulo (77 arquivos).
- `tests/` — lógica (`npm test`), banco (`tests/db`), ponta a ponta (`tests/e2e`) e o Supabase local sem Docker (`tests/local-supabase`).
- `docs/ARQUITETURA.md` (arquitetura, banco, relacionamentos, módulos, fluxos, permissões, decisões), `docs/GUIA-DEV.md`, `README.md`, `DEPLOY.md`.

## 3. Banco de dados

61 tabelas, 12 views, 127 funções, 19 triggers, 105 índices e 109 policies de RLS.
Regras garantidas pelo banco, independentes da tela:

- toda alteração de estoque passa por funções (`ops_consume`, `ops_receive`, `ops_production_finish`, `ops_register_loss`, `ops_adjust`, `ops_transfer_*`, `ops_finalize_count`) que checam permissão, gravam movimento e auditoria;
- `stock_movements`, `audit_logs`, `labels` e `supplier_price_history` são imutáveis (trigger recusa update/delete); correção é sempre um novo registro;
- mudança de status só pelas funções (`ops_guard_status`);
- RLS em todas as tabelas por empresa/unidade/permissão; views com `security_invoker`;
- só administrador concede ou altera o perfil admin, a empresa nunca fica sem admin ativo, ninguém concede permissão avulsa que não possui;
- idempotência de operações vindas da fila offline (`client_op_id`);
- migrations idempotentes e sem destruição de dados (o `install.sql` pode ser reaplicado).

## 4. Testes executados

| Suíte | Resultado |
|---|---|
| Typecheck (`tsc --noEmit`) | 0 erros |
| Lógica (`npm test`) | 40 testes, todos passando |
| Banco (`npm run test:db`, PostgreSQL local com RLS) | 25 cenários, todos passando |
| Ponta a ponta em modo produção (`npm run e2e:build` + `npm run e2e:prod`, Playwright + Chromium) | 18 testes em 7 specs, todos passando: login/primeiro acesso, treinamentos e VILA GPT sob login, recebimento → estoque → consumo FEFO → ficha do lote, reposição → pedido → recebimento, ficha técnica → produção, inventário → ajuste, perda, temperatura → alerta, checklist, tarefas |
| `next build` | concluído com todas as rotas |

## 5. Problemas encontrados e decisões

- **Sem Docker/Supabase CLI no ambiente**: foi escrito um Supabase local (GoTrue falso + PostgREST "lite" sobre o PostgreSQL) para rodar o app real no navegador com RLS real. Em produção o app fala com o Supabase de verdade.
- **Contagens embutidas** (`receipt_items(count)`) exigem agregações habilitadas no PostgREST do Supabase; há fallback automático.
- **"Só planejar"** grava a produção planejada, mas não persiste ajustes por ingrediente (lote/quantidade); ao concluir, o plano é recalculado e ajustado na hora.
- **ZPL** assume 203 dpi e não inclui o logo; impressoras de 300 dpi precisam ajustar a constante.
- **Fichas técnicas**: nenhuma receita foi inventada; o sistema fica pronto para receber os dados reais.
- **Relatórios** baseados em views dependem das permissões das tabelas de origem: um perfil só com `relatorios.ver` pode ver relatórios vazios (comportamento intencional do RLS).
- **Diferença de fuso**: filtros por dia nas listas usam o fuso do aparelho; os KPIs do banco usam a data do servidor (UTC), podendo divergir perto da meia-noite.

## 6. Para colocar no ar (o que depende de você)

1. Seguir `DEPLOY.md` (GitHub → Vercel → Supabase) e colar `supabase/install.sql` no SQL Editor.
2. Definir na Vercel `SUPABASE_SERVICE_ROLE_KEY` (usuários com senha, cron, integrações) e `CRON_SECRET`.
3. Em Authentication → Providers → Email, decidir sobre confirmação de e-mail; configurar Site URL e Redirect URL.
4. Cadastrar produtos, fornecedores e as fichas técnicas reais; ajustar motivos de perda, checklists, equipamentos e modelos de etiqueta em Configurações.

## 7. Próximos passos sugeridos

- Persistir os ajustes por ingrediente no planejamento de produção (nova RPC `ops_production_create` com itens).
- Integrações reais (PDV/iFood/ERP) usando as chaves de API e a fila de eventos já existentes.
- Impressão direta em impressoras térmicas via WebUSB/rede (hoje: diálogo de impressão do navegador ou download de ZPL).
- Relatórios agendados por e-mail.
