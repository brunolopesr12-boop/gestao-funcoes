"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/lib/ops/session";
import { toOpsError } from "@/lib/ops/errors";
import { fmtDate } from "@/lib/ops/format";
import type { Product } from "@/lib/ops/types";
import { likeTerm, looksLikeBarcode } from "@/lib/ops/modules/estoque";
import { Badge, Button, PageHeader, SearchInput, Skeleton } from "@/components/ops/ui";
import { ProductThumb } from "@/components/ops/pickers";
import { QrScanner } from "@/components/ops/QrScanner";
import { parseLotQr } from "@/components/ops/QrCode";
import { Icon } from "@/components/ops/Icon";

type Next = "consumir" | "contar" | "perda" | null;
type LotHit = { id: string; lot_code: string; expires_at: string | null; status: string; product_id: string; products: { name: string; internal_code: string } | null };
type Status = { kind: "scan" } | { kind: "busy"; text: string } | { kind: "notfound"; text: string } | { kind: "choose"; text: string; lots: LotHit[]; products: Product[] };

const NEXT_LABEL: Record<Exclude<Next, null>, string> = { consumir: "Consumir", contar: "Contar", perda: "Registrar perda" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <QrPage />
    </Suspense>
  );
}

/** Leitura de QR Code / código de barras → ficha do lote ou do produto. */
function QrPage() {
  const { store, company } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const nextParam = sp.get("next");
  const next: Next = nextParam === "consumir" || nextParam === "contar" || nextParam === "perda" ? nextParam : null;

  const [status, setStatus] = useState<Status>({ kind: "scan" });
  const [scanKey, setScanKey] = useState(0);
  const [manual, setManual] = useState("");

  // refs para manter o callback do leitor estável (senão a câmera reinicia a cada render)
  const ctx = useRef({ storeId: store?.id ?? "", companyId: company?.id ?? "", next, router });
  ctx.current = { storeId: store?.id ?? "", companyId: company?.id ?? "", next, router };

  const goLot = useCallback((lot: { id: string; product_id: string }) => {
    const { next: n, router: r } = ctx.current;
    if (n === "contar") r.push(`/contar?lot=${lot.id}`);
    else if (n === "perda") r.push(`/perdas/nova?lot=${lot.id}&product=${lot.product_id}`);
    else if (n === "consumir") r.push(`/lote/${lot.id}?acao=consumir`);
    else r.push(`/lote/${lot.id}`);
  }, []);

  const goProduct = useCallback((productId: string) => {
    const { next: n, router: r } = ctx.current;
    if (n === "contar") r.push(`/contar?product=${productId}`);
    else if (n === "perda") r.push(`/perdas/nova?product=${productId}`);
    else if (n === "consumir") r.push(`/estoque/produto/${productId}?acao=consumir`);
    else r.push(`/estoque/produto/${productId}`);
  }, []);

  const handle = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const { storeId, companyId } = ctx.current;
      setStatus({ kind: "busy", text });
      try {
        // 1) QR de lote (URL /l/<id>, /lote/<id> ou uuid)
        const lotId = parseLotQr(text);
        if (lotId) {
          const r = await supabaseBrowser().from("stock_lots").select("id, product_id").eq("id", lotId).maybeSingle();
          if (r.error) throw toOpsError(r.error);
          if (r.data) return goLot(r.data);
          return setStatus({ kind: "notfound", text });
        }
        const sb = supabaseBrowser();
        // 2) código de barras → produto da empresa
        if (looksLikeBarcode(text) && companyId) {
          const r = await sb.from("products").select("*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)").eq("company_id", companyId).eq("barcode", text).limit(5);
          if (r.error) throw toOpsError(r.error);
          const ps = (r.data ?? []) as Product[];
          if (ps.length === 1) return goProduct(ps[0].id);
          if (ps.length > 1) return setStatus({ kind: "choose", text, lots: [], products: ps });
        }
        // 3) código do lote na unidade (ou código interno do produto)
        const [lr, pr] = await Promise.all([
          storeId
            ? sb.from("stock_lots").select("id, lot_code, expires_at, status, product_id, products(name, internal_code)").eq("store_id", storeId).ilike("lot_code", text.replace(/[%_,()]/g, "")).order("created_at", { ascending: false }).limit(10)
            : Promise.resolve({ data: [] as LotHit[], error: null }),
          companyId
            ? sb.from("products").select("*, categories(id, name, emoji, color), units:stock_unit_id(id, code, name)").eq("company_id", companyId).or(`internal_code.ilike.${likeTerm(text)},sku.ilike.${likeTerm(text)}`).limit(5)
            : Promise.resolve({ data: [] as Product[], error: null }),
        ]);
        if (lr.error) throw toOpsError(lr.error);
        if (pr.error) throw toOpsError(pr.error);
        const lotsFound = (lr.data ?? []) as unknown as LotHit[];
        const prodsFound = (pr.data ?? []) as Product[];
        if (lotsFound.length === 1 && prodsFound.length === 0) return goLot(lotsFound[0]);
        if (lotsFound.length === 0 && prodsFound.length === 1) return goProduct(prodsFound[0].id);
        if (lotsFound.length + prodsFound.length > 0) return setStatus({ kind: "choose", text, lots: lotsFound, products: prodsFound });
        setStatus({ kind: "notfound", text });
      } catch (e) {
        setStatus({ kind: "notfound", text: `${text} (${toOpsError(e as Error).message})` });
      }
    },
    [goLot, goProduct],
  );

  const onResult = useCallback((t: string) => void handle(t), [handle]);

  function again() {
    setStatus({ kind: "scan" });
    setManual("");
    setScanKey((k) => k + 1);
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-160px)] max-w-md flex-col">
      <PageHeader
        title="Ler QR Code"
        subtitle={next ? <span>Depois de ler: <Badge tone="blue">{NEXT_LABEL[next]}</Badge></span> : "Etiqueta do lote ou código de barras do produto"}
        icon="scan"
        backHref="/"
      />

      {status.kind === "scan" && (
        <QrScanner key={scanKey} onResult={onResult} hint="Aponte a câmera para o QR Code da etiqueta ou para o código de barras do produto" />
      )}

      {status.kind === "busy" && (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent)] border-t-transparent" />
          <p className="text-sm text-slate-300">Procurando <span className="font-mono">{status.text}</span>…</p>
        </div>
      )}

      {status.kind === "notfound" && (
        <div className="card p-5">
          <div className="mb-3 flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-300"><Icon name="alert" /></span>
            <div>
              <p className="font-semibold">Código não encontrado</p>
              <p className="mt-1 text-sm text-slate-400">
                <span className="font-mono">{status.text}</span> não é um lote {store ? `de ${store.name}` : "desta unidade"} nem um código de barras cadastrado.
              </p>
            </div>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) void handle(manual);
            }}
          >
            <SearchInput value={manual} onChange={setManual} placeholder="Digite o código do lote ou do produto" autoFocus className="flex-1" />
            <Button variant="primary" type="submit" disabled={!manual.trim()}>Buscar</Button>
          </form>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="soft" size="lg" onClick={again}><Icon name="scan" size={18} /> Ler de novo</Button>
            <Link href="/estoque/lotes" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white/5 px-4 py-3 text-base font-semibold">
              <Icon name="layers" size={18} /> Ver lotes
            </Link>
          </div>
        </div>
      )}

      {status.kind === "choose" && (
        <div className="card p-4">
          <p className="mb-3 text-sm text-slate-300">Encontrei mais de um resultado para <span className="font-mono">{status.text}</span>. Escolha:</p>
          <div className="divide-y divide-[var(--line)]">
            {status.lots.map((l) => (
              <button key={l.id} type="button" onClick={() => goLot(l)} className="flex w-full items-center gap-3 py-2.5 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5"><Icon name="qr" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.products?.name ?? "Lote"}</span>
                  <span className="block text-xs text-slate-500">Lote <span className="font-mono">{l.lot_code}</span> · validade {fmtDate(l.expires_at)} · {l.status}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-slate-600" />
              </button>
            ))}
            {status.products.map((p) => (
              <button key={p.id} type="button" onClick={() => goProduct(p.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
                <ProductThumb product={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block text-xs text-slate-500">Produto · <span className="font-mono">{p.internal_code}</span>{p.barcode ? ` · ${p.barcode}` : ""}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-slate-600" />
              </button>
            ))}
          </div>
          <Button variant="soft" size="lg" full className="mt-3" onClick={again}><Icon name="scan" size={18} /> Ler de novo</Button>
        </div>
      )}

      {status.kind === "scan" && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {(["consumir", "contar", "perda"] as const).map((n) => (
            <Link
              key={n}
              href={`/qr?next=${n}`}
              replace
              className={`rounded-xl border px-2 py-2 font-semibold ${next === n ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--line)] bg-white/5 text-slate-300"}`}
            >
              {NEXT_LABEL[n]}
            </Link>
          ))}
          <p className="col-span-3 text-slate-500">Escolha o que fazer depois de ler (opcional).</p>
        </div>
      )}
    </div>
  );
}
