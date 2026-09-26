"use client";

import { formatCnpj, formatPhone, waLink, type SupplierForm as SupplierFormState } from "@/lib/ops/modules/cadastros";
import { Field, NumberInput, TextArea, TextInput, Toggle } from "@/components/ops/ui";
import { Icon } from "@/components/ops/Icon";

/** Campos do cadastro de fornecedor (usado em novo e edição). */
export function SupplierFormFields({ form, set, disabled }: { form: SupplierFormState; set: (patch: Partial<SupplierFormState>) => void; disabled?: boolean }) {
  const wa = waLink(form.whatsapp || form.phone);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Identificação</h2>
        <Field label="Nome / razão social">
          <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Distribuidora Boa Mesa Ltda" disabled={disabled} autoFocus />
        </Field>
        <Field label="Nome fantasia" hint="Como a equipe conhece o fornecedor.">
          <TextInput value={form.trade_name} onChange={(e) => set({ trade_name: e.target.value })} placeholder="Ex.: Boa Mesa" disabled={disabled} />
        </Field>
        <Field label="CNPJ" hint="Só números; a máscara é aplicada sozinha.">
          <TextInput value={form.cnpj} onChange={(e) => set({ cnpj: formatCnpj(e.target.value) })} placeholder="00.000.000/0000-00" inputMode="numeric" className="font-mono" disabled={disabled} />
        </Field>
        <Field label="Endereço">
          <TextArea value={form.address} onChange={(e) => set({ address: e.target.value })} rows={2} placeholder="Rua, número, bairro, cidade" disabled={disabled} />
        </Field>
        <Toggle checked={form.active} onChange={(v) => set({ active: v })} label="Fornecedor ativo" hint="Inativo: não aparece para escolher em pedidos e recebimentos." disabled={disabled} />
      </section>

      <div className="space-y-4">
        <section className="card p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Contato</h2>
          <Field label="Pessoa de contato">
            <TextInput value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} placeholder="Nome do vendedor" disabled={disabled} />
          </Field>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Telefone">
              <TextInput value={form.phone} onChange={(e) => set({ phone: formatPhone(e.target.value) })} placeholder="(00) 0000-0000" inputMode="tel" disabled={disabled} />
            </Field>
            <Field label="WhatsApp">
              <div className="flex gap-2">
                <TextInput value={form.whatsapp} onChange={(e) => set({ whatsapp: formatPhone(e.target.value) })} placeholder="(00) 00000-0000" inputMode="tel" disabled={disabled} />
                <a
                  href={wa ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Abrir conversa no WhatsApp"
                  title={wa ? "Abrir no WhatsApp" : "Informe o número"}
                  className={`grid h-[46px] w-14 shrink-0 place-items-center rounded-xl border ${wa ? "border-emerald-500/50 bg-emerald-600 text-white active:scale-95" : "pointer-events-none border-[var(--line)] bg-white/5 text-slate-500"}`}
                >
                  <Icon name="send" />
                </a>
              </div>
            </Field>
          </div>
          <Field label="E-mail">
            <TextInput type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="pedidos@fornecedor.com.br" inputMode="email" disabled={disabled} />
          </Field>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Condições comerciais</h2>
          <Field label="Condições de pagamento" hint="Ex.: 28 dias, boleto; à vista com 5% de desconto.">
            <TextInput value={form.payment_terms} onChange={(e) => set({ payment_terms: e.target.value })} placeholder="Ex.: 28 dias" disabled={disabled} />
          </Field>
          <Field label="Prazo de entrega" hint="Dias entre o pedido e a chegada. Usado na sugestão de compras.">
            <NumberInput value={form.lead_time_days} onChange={(v) => set({ lead_time_days: v })} min={0} inputMode="numeric" suffix="dias" placeholder="0" disabled={disabled} />
          </Field>
          <Field label="Observações" hint="Dias de entrega, pedido mínimo, quem atende…">
            <TextArea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} disabled={disabled} />
          </Field>
        </section>
      </div>
    </div>
  );
}
