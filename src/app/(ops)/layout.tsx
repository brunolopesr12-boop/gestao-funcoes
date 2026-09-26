"use client";

import { OpsSessionProvider } from "@/lib/ops/session";
import { OpsQueryProvider } from "@/lib/ops/query";
import { ToastProvider } from "@/components/ops/ui";
import { OpsGate } from "@/components/ops/Gate";
import { Shell } from "@/components/ops/Shell";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OpsQueryProvider>
      <OpsSessionProvider>
        <ToastProvider>
          <OpsGate>
            <Shell>{children}</Shell>
          </OpsGate>
        </ToastProvider>
      </OpsSessionProvider>
    </OpsQueryProvider>
  );
}
