# Guia de desenvolvimento — módulos do sistema de cozinha

Leia junto com `docs/ARQUITETURA.md`. Este guia diz **como** escrever uma tela
nova para que ela converse com o resto do sistema.

## Regras de ouro
1. **Nunca** escreva em `stock_items`, `stock_movements`, `audit_logs`, `labels`,
   `supplier_price_history` pela API. Toda alteração de estoque passa por RPC:
   `ops_receive`, `ops_produce_now`/`ops_production_finish`, `ops_consume`,
   `ops_register_loss`, `ops_adjust`, `ops_create_lot`, `ops_transfer_internal`,
   `ops_transfer_between_stores`, `ops_lot_event`, `ops_finalize_count`.
2. Status de `receipts`, `purchase_orders`, `productions`, `inventory_counts`
   só muda pelas RPCs (`ops_receive`, `ops_po_set_status`, `ops_production_*`,
   `ops_finalize_count`, `ops_count_cancel`, `ops_receipt_cancel`). Um `update`
   direto no status é rejeitado pelo banco.
3. A tela **só esconde** botões com `useCan('perm')`; a permissão real é
   checada no banco (RLS + funções). Sempre trate o erro `OpsError`.
4. Tudo em português, textos simples, botões grandes (`size="lg"`), confirmação
   antes de ações críticas (`ConfirmSheet`), feedback com `useToast()`.
5. Listas grandes: filtre/pagine no banco (`.range(from, to)` + `count: "exact"`),
   nunca carregue tudo. Use `usePagination()` + `DataTable`.
6. Depois de gravar, invalide as consultas: `const invalidate = useInvalidate(); invalidate("products", "stock_items")`.
   Chaves de consulta sempre começam pelo nome da tabela/entidade (`["products", ...]`).
7. Operações simples que devem funcionar offline usam `callOfflineable(rpc, args, label)`
   de `@/lib/ops/offline` (a RPC precisa aceitar `p_client_op_id`).

## Onde ficam as coisas
```
src/lib/ops/
  session.tsx   useSession() → { store, company, can(perm), canCompany, isAdmin, stores, setStore, displayName, user }
  hooks.ts      useUnits, useCategories, useLocations, useSuppliers, useLossReasons, useEquipment, useMembers,
                useProductSearch(term), useProduct(id), useProductLots(productId), useStoreId()
  rpc.ts        rpc(name, args) e unwrap(res)  → lançam OpsError com mensagem amigável
  offline.ts    callOfflineable, useOfflineQueue
  query.tsx     useInvalidate(), useRealtimeInvalidate([tabelas])
  format.ts     fmtQty, fmtMoney, fmtDate, fmtDateTime, fmtRelative, todayISO, parseDecimal, toCSV, downloadBlob, LEVEL_META, EXPIRY_META
  types.ts      tipos de todas as tabelas + rótulos (MOVEMENT_LABEL, PO_STATUS_LABEL, ...)
  errors.ts     OpsError, toOpsError
src/components/ops/
  ui.tsx        PageHeader, DataTable, usePagination, Badge, toneFor, KpiCard, ActionTile, Tabs, Choice, Toggle,
                NumberInput (aceita vírgula), SearchInput, useDebounced, Drawer, SectionCard, Row, IconButton,
                InlineAlert, Skeleton, ErrorBox, Money, Qty, LevelDot, useToast
                + reexporta Button, Card, Field, TextInput, TextArea, Select, Sheet, ConfirmSheet, EmptyState, ProgressBar
  pickers.tsx   ProductPicker, ProductSheet, ProductThumb, LotPicker, LocationSelect, UnitSelect, CategorySelect, SupplierSelect, MemberSelect
  PhotoUpload.tsx  <PhotoUpload value onChange folder="perdas" /> e uploadPhoto()
  QrScanner.tsx    <QrScanner onResult onClose />   QrCode.tsx: <QrSvg value />, lotQrValue(lotId), parseLotQr(text), qrDataUrl()
  Icon.tsx      <Icon name="truck" />  (nomes em nav.ts)
  nav.ts        menus (adicione aqui se criar uma rota nova)
```

## Padrão de uma tela de lista
```tsx
"use client";
export default function Page() {
  const { store, can } = useSession();
  const [term, setTerm] = useState(""); const t = useDebounced(term);
  const pg = usePagination(50);
  const q = useQuery({
    queryKey: ["receipts", store?.id, t, pg.page],
    enabled: Boolean(store?.id),
    queryFn: async () => {
      let qb = supabaseBrowser().from("receipts").select("*, suppliers(id,name)", { count: "exact" })
        .eq("store_id", store!.id).order("received_at", { ascending: false }).range(pg.range.from, pg.range.to);
      if (t) qb = qb.or(`number.ilike.%${t}%,invoice_number.ilike.%${t}%`);
      const res = await qb; if (res.error) throw toOpsError(res.error);
      return { rows: res.data as Receipt[], total: res.count ?? 0 };
    },
  });
  useRealtimeInvalidate(["receipts"]);
  ...
  <DataTable columns={...} rows={q.data?.rows ?? []} total={q.data?.total} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} rowHref={(r) => `/recebimento/${r.id}`} mobileCard={(r) => ...} />
}
```

## Padrão de uma ação
```tsx
const notify = useToast(); const invalidate = useInvalidate();
try {
  const r = await rpc<{ ok: boolean }>("ops_receive", { p_receipt: id });
  notify("Recebimento finalizado"); invalidate("receipts", "stock_items", "stock_lots", "alerts");
} catch (e) { notify(toOpsError(e as Error).message, "erro"); }
```

## Banco
- Schema: `supabase/migrations/*.sql` (fonte da verdade). Views: `v_stock_balances`,
  `v_stock_by_product`, `v_replenishment`, `v_expiring_lots`, `v_movements`, `v_losses`, `v_audit_logs`.
- RPCs de leitura: `ops_dashboard`, `ops_lot_summary`, `ops_recipe_cost`, `ops_production_plan`,
  `ops_report_consumption|losses|production|stock_by_category`, `ops_supplier_price_comparison`,
  `ops_my_permissions`, `ops_pick_fefo`, `ops_fefo_first_lot`, `ops_convert_qty`, `ops_next_internal_code`.
- Alertas: `ops_refresh_alerts(store)`, `ops_alert_mark(id, 'lido'|'resolvido')`, `ops_alerts_mark_all_read(store)`.
- Checklists: `ops_generate_checklists(store, date)`, `ops_checklist_start`, `ops_checklist_item_set`, `ops_checklist_finish`.
- Temperatura: `ops_temperature_register(equipment, temp, action, notes, at, client_op_id)`.
- Inventário: `ops_count_open`, `ops_count_set_item`, `ops_finalize_count`, `ops_count_cancel`.
- Compras: `ops_po_set_status`, `ops_receipt_from_po`.
- Cadastros simples (produtos, categorias, fornecedores, locais, equipamentos, checklists, fichas, tarefas,
  pedidos/recebimentos em rascunho e seus itens) são gravados direto nas tabelas (RLS protege).
- Testes de banco: `npm run test:db` (Postgres local). Lógica: `npm test`. Tipos: `npm run typecheck`.

## Rotas
Todas as telas do sistema ficam em `src/app/(ops)/<rota>/page.tsx` ("use client").
O layout já provê sessão, consultas, toasts e o shell. Rotas previstas em `docs/ARQUITETURA.md` (seção D).
