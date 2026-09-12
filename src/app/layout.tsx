import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataProvider } from "@/lib/store";
import { Gate } from "@/components/Gate";

export const metadata: Metadata = {
  title: "Gestão de Funções e Treinamentos",
  description:
    "Empresas, funções, funcionários, processos e certificação de treinamento.",
  applicationName: "Gestão de Funções",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Funções" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <DataProvider>
          <Gate>{children}</Gate>
        </DataProvider>
      </body>
    </html>
  );
}
