# Vila Rica · Gestão Operacional de Cozinha — Arquitetura

Este documento é o blueprint do sistema de gestão operacional de cozinha
(estoque, lotes, validade, produção, fichas técnicas, recebimento, compras,
inventário, perdas, temperaturas, checklists, tarefas, etiquetas, QR Code,
alertas, relatórios e auditoria). Ele convive com o módulo já existente de
**Funções, Funcionários e Treinamentos** e com o **VILA GPT**, no mesmo app,
no mesmo banco e sob o mesmo login.

Convenções deste documento: tabelas e colunas em `inglês` (padrão do banco já
existente), interface em português.

---

## A. Arquitetura

```
Navegador / PWA (celular, tablet, desktop)
│   Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4
│   ├─ Modo celular   : tela inicial com atalhos grandes + bottom navigation
│   ├─ Modo desktop   : sidebar fixa, tabelas paginadas, filtros, gráficos
│   ├─ TanStack Query : cache, paginação e invalidação por módulo
│   ├─ Fila offline   : IndexedDB (idb-keyval) → reenvio idempotente ao reconectar
│   └─ Câmera         : leitura de QR Code / código de barras (ZXing + BarcodeDetector)
│
├──► Supabase (PostgreSQL + Auth + Storage + Realtime)
│      ├─ Auth        : e-mail + senha (Supabase Auth), sessão em cookie (@supabase/ssr)
│      ├─ RLS         : toda tabela protegida por empresa/unidade + permissão
│      ├─ RPC (SQL)   : TODA operação de estoque passa por funções do banco
│      │                (ops_receive, ops_produce, ops_move_stock, ops_finalize_count…)
│      ├─ Triggers    : auditoria automática, imutabilidade de movimentos e logs
│      ├─ Views       : estoque consolidado, validades, reposição, consumo
│      ├─ Storage     : bucket `ops-fotos` (evidências, fotos de produto, logo)
│      └─ Realtime    : alertas, tarefas, estoque (atualização ao vivo)
│
└──► Next.js Route Handlers (/api/ops/*)  — só o que exige segredo de servidor
       ├─ /api/ops/users        : criar usuário + senha (service role, só admin)
       ├─ /api/ops/cron/alerts  : varredura diária de validades/estoque mínimo (Vercel Cron)
       └─ /api/ops/integrations : contratos de integração (PDV, iFood, balança, ERP…)
```

### Decisões técnicas (e por quê)

| Decisão | Motivo |
|---|---|
| **Regras críticas em funções SQL (`security definer`)** com checagem de permissão interna | Atomicidade (recebimento cria lote + movimento + custo + auditoria em uma transação), mesma regra para web, API e integrações futuras, e nenhuma dependência do frontend para segurança. |
| **`stock_items` (saldo) mantido pelas funções, nunca escrito pelo app** | Com 1.000.000 de movimentações não dá para somar na hora. O saldo é atualizado na mesma transação do movimento; movimentos são a verdade (append-only) e o saldo é o cache consistente. |
| **Movimentos e auditoria são imutáveis** (trigger bloqueia `update`/`delete`) | REGRA 1 e 2: rastreabilidade total; correção = novo movimento. |
| **Supabase Auth ligado para o app inteiro** | O módulo antigo não tinha login. Sem identidade real não há auditoria confiável (REGRA 5). As policies antigas `acesso_total_app` são substituídas por policies de membro da empresa. |
| **Perfis de acesso em `access_roles`/`role_permissions`** (e não `roles`) | `roles` já existe e significa *função operacional* (cargo). Renomear quebraria o módulo de treinamentos. |
| **Checklists em `checklists`/`checklist_tasks`/`checklist_executions`** | `checklist_items` já existe (checklist da função). |
| **`profiles` em vez de `users`** | `auth.users` é do Supabase; `profiles` (1:1) guarda nome, telefone, preferências. Padrão Supabase. |
| **Cadastros (produtos, categorias, unidades, fornecedores, fichas) são da EMPRESA; operação é da UNIDADE** | Uma rede compartilha o catálogo; cada loja tem seu estoque, mínimos, equipamentos e equipe. `product_store_settings` permite mínimo/máximo por unidade. |
| **TanStack Query + consultas por tela** (não um store global) | O módulo antigo carrega tudo em memória — inviável para 10.000 produtos / 100.000 lotes. Aqui cada tela consulta com filtro, ordenação e paginação no banco. |
| **Fila offline só para operações simples e idempotentes** (contagem, temperatura, checklist, perda, consumo por QR) | Cada operação leva um `id` gerado no cliente; a função SQL ignora repetição. Recebimento/produção exigem conexão (o sistema avisa). Conflitos (ex.: estoque insuficiente na hora do reenvio) ficam na tela **Sincronização** para decisão explícita. |
| **Etiquetas em HTML/CSS com tamanho em mm + geração ZPL** | Funciona em qualquer impressora térmica instalada no sistema (diálogo de impressão) e já entrega ZPL para impressoras Zebra-compatíveis via integração futura. |
| **Alertas materializados em `alerts`** (não só calculados na hora) | Permitem "marcar como lido", histórico e notificação. Gerados por trigger (temperatura, recebimento com problema) e por `ops_refresh_alerts()` (validade, mínimo, checklist atrasado, produção pendente), chamada ao abrir o painel e por cron diário. |
| **Custo**: cada lote guarda `unit_cost`; o produto guarda `cost` (último ou médio ponderado, configurável) | Valor do estoque = Σ saldo × custo do lote. Perda e consumo usam o custo do lote consumido. |

---

## B. Estrutura do banco (PostgreSQL / Supabase)

Todas as tabelas: `id uuid pk default gen_random_uuid()`, `created_at`,
`updated_at` (quando editável), FKs com índices, RLS ativado.

### Já existentes (mantidas)
`companies`, `roles`, `competencies`, `checklist_items`, `processes`, `employees`,
`employee_roles`, `training_steps`, `training_events`, `activity_log`,
`kb_articles`, `gpt_questions`, `gpt_login_attempts`.

### Identidade, acesso e configuração
| Tabela | Conteúdo |
|---|---|
| `profiles` | 1:1 com `auth.users`: `full_name`, `phone`, `avatar_url`, `active`, `last_store_id` |
| `stores` | Unidades da empresa: `company_id`, `name`, `code`, `address`, `phone`, `timezone`, `active` |
| `access_roles` | Perfis: `admin`, `gerente`, `estoquista`, `cozinha`, `auditor`, `funcionario` (+ perfis personalizados por empresa) |
| `permissions` | Catálogo de permissões `modulo.acao` (ex.: `estoque.movimentar`) |
| `role_permissions` | Permissões padrão de cada perfil |
| `memberships` | Usuário × empresa: `access_role_id`, `all_stores`, `active`, `invited_email` (convite antes do cadastro) |
| `membership_stores` | Unidades liberadas quando `all_stores = false` |
| `membership_permissions` | Ajuste fino por usuário: `granted` true/false sobre uma permissão |
| `settings` | `company_id`, `store_id` (null = empresa), `key`, `value jsonb` (método de custo, dias de alerta de validade, impressora padrão…) |
| `audit_logs` | Imutável: `user_id`, `user_name`, `company_id`, `store_id`, `action`, `entity`, `entity_id`, `entity_label`, `before`, `after`, `created_at` |

### Catálogo
| Tabela | Conteúdo |
|---|---|
| `units` | Unidades de medida da empresa: `code` (kg, g, L, ml, un, cx, pct, bdj, fd, dz…), `name`, `kind` (massa/volume/contagem), `base_factor` (para a base do tipo) |
| `categories` | `company_id`, `parent_id` (subcategoria), `name`, `kind` padrão |
| `products` | `company_id`, `name`, `internal_code`, `sku`, `barcode`, `category_id`, `product_kind` (`materia_prima`, `semipronto`, `produzido`, `final`, `descartavel`, `outro`), `stock_unit_id`, `purchase_unit_id`, `purchase_factor` (1 caixa = 10 kg), `cost`, `last_purchase_price`, `min_stock`, `max_stock`, `reorder_point`, `ideal_stock`, `shelf_life_days`, `shelf_life_open_days`, `shelf_life_frozen_days`, `shelf_life_thawed_days`, `storage_temp_min/max`, `storage_type` (`ambiente`/`refrigerado`/`congelado`), `default_location_id`, `default_supplier_id`, `photo_url`, `notes`, `active` |
| `product_units` | Conversões extras: `product_id`, `unit_id`, `factor` (1 pacote = 500 g) |
| `product_store_settings` | Mínimo/máximo/reposição/local padrão por unidade |
| `suppliers` | `company_id`, `name`, `trade_name`, `cnpj`, `contact`, `phone`, `whatsapp`, `email`, `address`, `payment_terms`, `lead_time_days`, `notes`, `active` |
| `supplier_products` | Produto × fornecedor: `supplier_code`, `last_price`, `last_purchase_at`, `preferred` |
| `supplier_price_history` | Histórico: `product_id`, `supplier_id`, `store_id`, `price`, `quantity`, `unit_id`, `receipt_id`, `recorded_at` |
| `stock_locations` | `store_id`, `name`, `kind` (`estoque_seco`, `camara_fria`, `freezer`, `geladeira`, `cozinha`, `producao`, `outro`), `temperature_equipment_id` (opcional), `active` |

### Estoque e rastreabilidade
| Tabela | Conteúdo |
|---|---|
| `stock_lots` | Lote: `company_id`, `store_id`, `product_id`, `lot_code`, `origin` (`recebimento`/`producao`/`ajuste`/`transferencia`/`inicial`), `supplier_id`, `receipt_id`, `production_id`, `produced_at`, `received_at`, `opened_at`, `frozen_at`, `thawed_at`, `expires_at`, `unit_cost`, `initial_quantity`, `status` (`ativo`/`esgotado`/`bloqueado`/`vencido`), `notes` |
| `stock_items` | Saldo por `store_id` × `location_id` × `product_id` × `lot_id`: `quantity`, `updated_at`. **Escrita só via funções.** |
| `stock_movements` | Imutável: `store_id`, `product_id`, `lot_id`, `location_id`, `to_location_id`, `movement_type` (`entrada`, `saida`, `producao_consumo`, `producao_entrada`, `consumo`, `transferencia`, `perda`, `ajuste`, `devolucao`, `inventario`), `quantity` (sinal indica direção), `unit_cost`, `total_cost`, `reason`, `reference_type`, `reference_id`, `notes`, `created_by`, `created_at`, `client_op_id` (idempotência) |
| `loss_reasons` | `company_id`, `code`, `name`, `requires_photo`, `active` |
| `losses` | `store_id`, `product_id`, `lot_id`, `location_id`, `quantity`, `unit_id`, `unit_cost`, `total_cost`, `loss_reason_id`, `notes`, `photo_url`, `movement_id`, `created_by` |
| `transfers` | `from_store_id`, `to_store_id` (entre unidades) ou `from_location_id`/`to_location_id` (interna), `status` (`enviado`/`recebido`/`cancelado`), itens em `transfer_items` |

### Compras e recebimento
| Tabela | Conteúdo |
|---|---|
| `purchase_orders` | `store_id`, `supplier_id`, `status` (`rascunho`→`solicitado`→`aprovado`→`pedido`→`recebido`/`cancelado`), `expected_at`, `approved_by`, `notes`, `total` |
| `purchase_order_items` | `product_id`, `quantity`, `unit_id`, `estimated_price`, `received_quantity` |
| `receipts` | `store_id`, `supplier_id`, `purchase_order_id`, `invoice_number`, `invoice_date`, `received_at`, `status` (`rascunho`/`finalizado`/`cancelado`), `result` (`aprovado`/`aprovado_ressalva`/`recusado`), `notes`, `received_by`, `finalized_at` |
| `receipt_items` | `product_id`, `quantity`, `unit_id`, `quantity_in_stock_unit`, `weight`, `lot_code`, `expires_at`, `unit_price`, `total_price`, `temperature`, `package_condition` (`ok`/`danificada`), `result` (`aprovado`/`ressalva`/`recusado`), `rejection_reason`, `location_id`, `notes`, `lot_id` (após finalizar) |

### Fichas técnicas e produção
| Tabela | Conteúdo |
|---|---|
| `recipes` | `company_id`, `product_id` (o que produz), `name`, `version`, `yield_quantity`, `yield_unit_id`, `portion_size`, `portion_unit_id`, `prep_time_min`, `shelf_life_days`, `instructions`, `active` |
| `recipe_items` | `ingredient_product_id`, `gross_quantity`, `unit_id`, `net_quantity`, `loss_pct` (calculado), `correction_factor`, `notes` |
| `productions` | `store_id`, `recipe_id`, `product_id`, `status` (`planejada`/`em_andamento`/`concluida`/`cancelada`), `planned_quantity`, `produced_quantity`, `expected_yield`, `actual_yield_pct`, `lot_id` (saída), `lot_code`, `expires_at`, `location_id`, `started_at`, `finished_at`, `produced_by`, `notes`, `total_cost`, `unit_cost` |
| `production_items` | Ingredientes consumidos: `product_id`, `lot_id`, `planned_quantity`, `consumed_quantity`, `unit_cost`, `movement_id` |

### Inventário
| Tabela | Conteúdo |
|---|---|
| `inventory_counts` | `store_id`, `location_id` (opcional), `status` (`aberta`/`finalizada`/`cancelada`), `kind` (`rapida`/`completa`), `started_by`, `finished_by`, `notes`, totais |
| `inventory_items` | `product_id`, `lot_id`, `location_id`, `theoretical_quantity` (congelada na contagem), `counted_quantity`, `difference`, `reason`, `counted_by`, `counted_at`, `movement_id` (ajuste gerado) |

### Temperatura, checklists, tarefas
| Tabela | Conteúdo |
|---|---|
| `temperature_equipment` | `store_id`, `name`, `kind` (`geladeira`/`freezer`/`camara_fria`/`balcao`/`estufa`/`outro`), `location_text`, `min_temp`, `max_temp`, `check_interval_min`, `active` |
| `temperature_logs` | `equipment_id`, `temperature`, `in_range`, `measured_at`, `measured_by`, `corrective_action` (`ajuste`/`transferencia`/`manutencao`/`descarte`/`outro`), `notes`, `alert_id` |
| `checklists` | Modelo: `company_id`, `store_id` (null = todas), `name`, `kind` (`abertura`, `fechamento`, `limpeza`, `geladeira`, `freezer`, `cozinha`, `estoque`, `seguranca_alimentar`, `outro`), `frequency` (`diaria`/`semanal`/`mensal`/`por_turno`/`sob_demanda`), `scheduled_time`, `weekdays`, `assigned_role`, `mandatory`, `active` |
| `checklist_tasks` | `checklist_id`, `text`, `critical` (exige foto/observação), `requires_photo`, `position` |
| `checklist_executions` | `checklist_id`, `store_id`, `due_date`, `status` (`pendente`/`em_andamento`/`concluido`/`atrasado`), `started_by`, `finished_by`, `finished_at`, `score` |
| `checklist_execution_items` | `task_id`, `done`, `done_by`, `done_at`, `notes`, `photo_url` |
| `tasks` | `store_id`, `title`, `description`, `assigned_to`, `priority` (`baixa`/`media`/`alta`/`urgente`), `status` (`pendente`/`em_andamento`/`concluida`/`atrasada`/`cancelada`), `due_at`, `completed_at`, `created_by`, `source_type`/`source_id` (alerta, checklist…) |

### Etiquetas, alertas
| Tabela | Conteúdo |
|---|---|
| `label_templates` | `company_id`, `name`, `kind` (`producao`/`abertura`/`congelamento`/`descongelamento`/`fracionamento`/`armazenamento`/`recebimento`), `width_mm`, `height_mm`, `layout jsonb` (campos, posições, fontes, QR, barras), `default` |
| `labels` | Etiquetas emitidas: `store_id`, `template_id`, `product_id`, `lot_id`, `kind`, `quantity`, `payload jsonb` (o que foi impresso), `qr_token`, `printed_by`, `printed_at` |
| `alerts` | `company_id`, `store_id`, `kind` (`vencido`, `vencendo`, `estoque_minimo`, `estoque_proximo_minimo`, `estoque_critico`, `temperatura`, `checklist_atrasado`, `producao_pendente`, `recebimento_problema`, `tarefa_atrasada`), `severity` (`info`/`atencao`/`critico`), `title`, `message`, `entity_type`, `entity_id`, `dedupe_key`, `status` (`aberto`/`lido`/`resolvido`), `read_by`, `read_at`, `resolved_at` |
| `integration_events` | Fila/outbox para integrações futuras (PDV, iFood, ERP): `kind`, `payload`, `status` |

### Views e funções principais
- `v_stock_balances` — saldo por produto/lote/local com validade, custo e valor.
- `v_stock_by_product` — consolidado por produto na unidade, com nível (🟢🟡🔴🚨).
- `v_replenishment` — atual × mínimo × máximo × sugestão de compra.
- `v_expiring_lots` — lotes vencidos / vencendo (hoje, 3, 7 dias).
- `v_consumption` — consumo por produto/período (movimentos negativos).
- `ops_has_permission(store, perm)`, `ops_is_member(company)`, `ops_current_company_ids()`.
- `ops_move_stock(...)`, `ops_pick_fefo(...)`, `ops_receive(receipt)`,
  `ops_produce(production, ...)`, `ops_register_loss(...)`, `ops_transfer(...)`,
  `ops_adjust(...)`, `ops_consume(...)`, `ops_finalize_count(count)`,
  `ops_refresh_alerts(store)`, `ops_dashboard(store, from, to)`.

---

## C. Relacionamentos

```
auth.users 1─1 profiles ──< memberships >── companies ──< stores
                              │  └─< membership_stores >─┘
                              └─ access_roles ─< role_permissions >─ permissions

companies ─< categories ─< products >─ units
                         products ─< product_units
                         products ─< product_store_settings >─ stores
companies ─< suppliers ─< supplier_products >─ products
                         supplier_price_history

stores ─< stock_locations ─< stock_items >─ stock_lots >─ products
stores ─< stock_movements (product, lot, location, reference)

stores ─< purchase_orders ─< purchase_order_items
purchase_orders 1─0..1 receipts ─< receipt_items ─→ stock_lots (ao finalizar)

products 1─< recipes ─< recipe_items ─→ products (ingredientes)
recipes ─< productions ─< production_items ─→ stock_lots (consumidos)
productions 1─1 stock_lots (lote produzido)

stores ─< inventory_counts ─< inventory_items ─→ stock_movements (ajustes)
stores ─< losses ─→ loss_reasons, stock_movements
stores ─< temperature_equipment ─< temperature_logs ─→ alerts
companies ─< checklists ─< checklist_tasks
stores ─< checklist_executions ─< checklist_execution_items
stores ─< tasks, alerts, labels
companies ─< label_templates, settings, audit_logs
```

Regras de integridade:
- FKs de registros operacionais para cadastros são `on delete restrict`
  (não se apaga produto com histórico; inativa-se).
- `stock_movements`, `audit_logs`, `supplier_price_history`, `labels`:
  triggers impedem `update` e `delete` para qualquer papel.
- `stock_items.quantity >= 0` (check); movimento que deixaria negativo é rejeitado
  (exceto quando a configuração `stock.allow_negative` = true na unidade).

---

## D. Módulos

| # | Módulo | Rotas (desktop) | Atalho celular |
|---|---|---|---|
| 1 | Dashboard | `/painel` | início |
| 2 | Estoque (saldos, lotes, movimentações, validades, transferências, ajustes) | `/estoque`, `/estoque/lotes`, `/estoque/movimentacoes`, `/validades`, `/estoque/transferir` | Estoque |
| 3 | Recebimento | `/recebimento`, `/recebimento/[id]` | Receber |
| 4 | Produção | `/producao`, `/producao/[id]` | Produzir |
| 5 | Fichas técnicas | `/fichas`, `/fichas/[id]` | — |
| 6 | Produtos, categorias, unidades de medida | `/produtos`, `/produtos/[id]`, `/produtos/categorias`, `/produtos/unidades` | — |
| 7 | Fornecedores + comparação de preços | `/fornecedores`, `/fornecedores/[id]` | — |
| 8 | Compras (pedidos) + Reposição | `/compras`, `/compras/[id]`, `/reposicao` | — |
| 9 | Inventário / contagem rápida | `/inventario`, `/inventario/[id]`, `/contar` | Contar |
| 10 | Perdas | `/perdas` | Perda |
| 11 | Temperaturas | `/temperaturas` | Temperatura |
| 12 | Checklists | `/checklists`, `/checklists/[id]` | Checklists |
| 13 | Tarefas | `/tarefas` | Tarefas |
| 14 | Etiquetas (impressão + editor de modelos) | `/etiquetas`, `/etiquetas/modelos` | Etiquetas |
| 15 | QR Code (leitura + ficha do lote) | `/qr`, `/lote/[id]` | Ler QR |
| 16 | Alertas | `/alertas` | 🔔 |
| 17 | Relatórios (CSV/Excel/PDF) | `/relatorios/*` | — |
| 18 | Auditoria | `/auditoria` | — |
| 19 | Usuários e permissões | `/usuarios` | — |
| 20 | Configurações (empresa, unidades, etiquetas, alertas, motivos de perda, impressoras…) | `/configuracoes/*` | — |
| 21 | Onboarding (assistente inicial) | `/inicio` | — |
| 22 | Sincronização offline | `/sincronizacao` | — |
| — | Treinamentos (módulo existente) | `/treinamentos` → `/empresa/...` | — |
| — | VILA GPT (existente) | `/vila-gpt` | — |

---

## E. Fluxos principais

**Recebimento** → `receipts` (rascunho) → itens conferidos (qtd, lote, validade,
preço, temperatura, embalagem, resultado) → `ops_receive(receipt_id)`:
para cada item aprovado/ressalva: cria `stock_lots`, movimento `entrada`,
atualiza `stock_items`, custo do produto (último/médio), `supplier_products`
e `supplier_price_history`; item recusado não entra no estoque, mas fica
registrado com motivo e gera alerta `recebimento_problema`; pedido de compra
vinculado vai para `recebido`; `audit_logs`; etiquetas de recebimento opcionais.

**Produção** → escolher ficha → quantidade planejada → sistema calcula
ingredientes (escala pela ficha) e mostra disponibilidade + lotes FEFO →
`ops_produce(...)`: consome ingredientes (movimentos `producao_consumo` por lote,
FEFO automático ou lotes escolhidos), cria lote do produto (`producao_entrada`)
com validade = data + `shelf_life_days` da ficha/produto, custo = Σ custos
consumidos ÷ rendimento real, registra rendimento esperado × real, gera
etiqueta. Produção parcial: `produced_quantity` < planejada, com o restante
podendo virar nova produção.

**Consumo / Transferência / Perda / Ajuste** → `ops_move_stock` com o tipo
correspondente; perda também grava em `losses` com motivo, custo e foto.

**Inventário** → abrir contagem (local opcional) → congela `theoretical_quantity`
por item → contagem no celular (busca/QR) → `ops_finalize_count`: para cada
diferença gera movimento `inventario` (ajuste) com motivo e atualiza saldo.

**Compras** → tela Reposição sugere (max − atual, ou ideal − atual) → cria
pedido `rascunho` → `solicitado` → `aprovado` → `pedido` → "Receber" cria
recebimento pré-preenchido → finalização marca `recebido`.

**Validade / FEFO** → `stock_lots.expires_at` alimenta `v_expiring_lots`;
`ops_pick_fefo` escolhe lotes por menor validade; a UI mostra o lote que deveria
sair primeiro e alerta quando outro lote foi escolhido.

**Temperatura** → registro → trigger avalia faixa → fora da faixa cria `alert`
`temperatura` e exige ação corretiva.

**Checklists** → modelos por empresa/unidade + frequência → `ops_generate_checklists(store, date)`
cria as execuções do dia → itens marcados (tarefa crítica exige foto/observação) →
atrasados geram alerta.

**Alertas** → `ops_refresh_alerts(store)` (painel + cron) e triggers;
`dedupe_key` evita duplicidade; leitura/resolução por usuário.

**Auditoria** → trigger genérico grava antes/depois em todas as tabelas
relevantes; funções gravam ações de negócio ("finalizou recebimento", "produziu").

---

## F. Permissões

Perfis padrão (editáveis, com ajuste fino por usuário):

| Permissão (`modulo.acao`) | admin | gerente | estoquista | cozinha | auditor | funcionario |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| painel.ver | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| produtos.ver / produtos.editar | ✓/✓ | ✓/✓ | ✓/– | ✓/– | ✓/– | ✓/– |
| fornecedores.ver / editar | ✓/✓ | ✓/✓ | ✓/– | –/– | ✓/– | –/– |
| estoque.ver / estoque.movimentar / estoque.ajustar | ✓ | ✓ | ✓ | ✓/✓/– | ✓/–/– | ✓/–/– |
| recebimento.ver / criar / finalizar | ✓ | ✓ | ✓ | – | ✓/–/– | – |
| producao.ver / criar / finalizar | ✓ | ✓ | – | ✓ | ✓/–/– | – |
| fichas.ver / editar | ✓ | ✓ | – | ✓/– | ✓/– | – |
| inventario.ver / contar / finalizar | ✓ | ✓ | ✓ | –/✓/– | ✓/–/– | –/✓/– |
| perdas.ver / registrar | ✓ | ✓ | ✓ | ✓ | ✓/– | –/✓ |
| compras.ver / criar / aprovar | ✓ | ✓ | ✓/✓/– | – | ✓/–/– | – |
| temperaturas.ver / registrar / editar | ✓ | ✓ | ✓/✓/– | ✓/✓/– | ✓/–/– | ✓/✓/– |
| checklists.ver / executar / editar | ✓ | ✓ | ✓/✓/– | ✓/✓/– | ✓/–/– | ✓/✓/– |
| tarefas.ver / executar / editar | ✓ | ✓ | ✓/✓/– | ✓/✓/– | ✓/–/– | ✓/✓/– |
| etiquetas.imprimir / editar_modelos | ✓ | ✓ | ✓/– | ✓/– | – | ✓/– |
| alertas.ver / resolver | ✓ | ✓ | ✓ | ✓ | ✓/– | ✓/– |
| relatorios.ver / exportar | ✓ | ✓ | – | – | ✓ | – |
| auditoria.ver | ✓ | ✓ | – | – | ✓ | – |
| usuarios.gerenciar | ✓ | ✓ (só da unidade) | – | – | – | – |
| configuracoes.editar | ✓ | ✓ | – | – | – | – |
| treinamentos.ver / editar | ✓ | ✓ | ✓/– | ✓/– | ✓/– | ✓/– |

Escopo: `admin` = todas as unidades da empresa. Demais perfis: `all_stores` ou
lista em `membership_stores`. A checagem é sempre no banco:
`ops_has_permission(store_id, 'perm')` dentro das policies e das funções.
O frontend só usa as permissões para esconder botões (`useCan('perm')`).

Bootstrap: o primeiro usuário autenticado quando não existe nenhum membro no
sistema vira `admin` das empresas existentes (`ops_bootstrap_admin()`); depois
disso, só admins/gerentes criam ou convidam usuários.

---

## G. Plano de implementação

1. **Fundação** — migrations (auth, permissões, RLS, auditoria, catálogo,
   estoque, compras/recebimento, produção, inventário, temperatura/checklists/
   tarefas, etiquetas/alertas, views, storage/realtime, seed Vila Rica),
   bundle `supabase/install.sql`, testes de banco em Postgres local com
   shim de `auth.uid()`.
2. **Auth + layout** — login, middleware, `AuthProvider`, seletor de unidade,
   sidebar/bottom nav, kit de UI (tabela paginada, filtros, formulários, QR).
3. **Cadastros** — produtos, categorias, unidades de medida, locais, fornecedores, usuários.
4. **Estoque** — saldos, lotes, movimentações, validades, transferências, ajustes, consumo por QR.
5. **Recebimento** e **Compras/Reposição**.
6. **Fichas técnicas** e **Produção**.
7. **Etiquetas** (modelos + impressão) e **QR** (leitura + ficha do lote).
8. **Inventário** e **Perdas**.
9. **Temperaturas**, **Checklists**, **Tarefas**.
10. **Alertas**, **Dashboard**, **Relatórios** (CSV/Excel/PDF), **Auditoria**.
11. **Configurações** + **Onboarding** + **Offline/Sincronização** + PWA.
12. **Integração final**, testes de fluxo ponta a ponta, build de produção, documentação.
