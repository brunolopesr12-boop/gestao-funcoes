import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "@/components/pwa/SwRegister";

export const metadata: Metadata = {
  title: "Vila Rica · Gestão de Cozinha",
  description: "Estoque, lotes, validade, produção, fichas técnicas, recebimento, compras, inventário, perdas, temperaturas, checklists e treinamentos.",
  applicationName: "Vila Rica Cozinha",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Vila Rica" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
