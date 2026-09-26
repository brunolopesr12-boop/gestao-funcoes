"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";

export function OpsQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Invalida consultas quando alguma das tabelas muda no banco (Realtime).
 * As chaves das consultas começam pelo nome da tabela/entidade.
 */
export function useRealtimeInvalidate(tables: string[], keys?: string[][]) {
  const qc = useQueryClient();
  const sig = tables.join(",");
  const keySig = JSON.stringify(keys ?? []);
  useEffect(() => {
    if (!isSupabaseConfigured || tables.length === 0) return;
    const sb = supabaseBrowser();
    let channel = sb.channel(`vr-rt-${sig}-${Math.random().toString(36).slice(2, 8)}`);
    for (const t of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
        void qc.invalidateQueries({ queryKey: [t] });
        for (const k of keys ?? []) void qc.invalidateQueries({ queryKey: k });
      });
    }
    channel.subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, keySig, qc]);
}

/** Invalida um grupo de chaves (após uma mutação). */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) => {
    for (const p of prefixes) void qc.invalidateQueries({ queryKey: [p] });
  };
}
