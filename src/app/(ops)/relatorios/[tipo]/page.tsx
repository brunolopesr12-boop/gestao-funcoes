"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { findReport, REPORTS } from "@/lib/ops/modules/reports";
import { Button, EmptyState, PageHeader } from "@/components/ops/ui";
import { ReportPage } from "@/components/ops/gestao/ReportPage";

export default function RelatorioPage() {
  const params = useParams<{ tipo: string }>();
  const report = findReport(String(params?.tipo ?? ""));
  if (!report) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Relatório não encontrado" backHref="/relatorios" icon="chart" />
        <EmptyState
          emoji="🤷"
          title="Este relatório não existe"
          description={`Relatórios disponíveis: ${REPORTS.map((r) => r.title).join(", ")}.`}
          action={<Link href="/relatorios"><Button variant="primary">Ver todos os relatórios</Button></Link>}
        />
      </div>
    );
  }
  return <ReportPage key={report.key} report={report} />;
}
