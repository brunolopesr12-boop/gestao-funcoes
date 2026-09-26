"use client";

import { DataProvider } from "@/lib/store";
import { Gate } from "@/components/Gate";

/** Módulo de funções/funcionários/treinamentos e VILA GPT (carga em memória, realtime). */
export default function TreinamentosLayout({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <Gate>{children}</Gate>
    </DataProvider>
  );
}
