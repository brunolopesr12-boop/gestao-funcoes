// Gera supabase/install.sql = schema.sql (módulo de treinamentos) + migrations
// do sistema de cozinha, na ordem. É o arquivo único para colar no SQL Editor.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../supabase/", import.meta.url));
const migrationsDir = join(root, "migrations");

const parts = [];
parts.push(`-- =====================================================================
--  VILA RICA · GESTÃO OPERACIONAL DE COZINHA + FUNÇÕES/TREINAMENTOS + VILA GPT
--  Arquivo único de instalação, gerado por: npm run db:bundle
--
--  Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
--  É seguro rodar de novo (idempotente). Nunca apaga dados.
-- =====================================================================
`);
parts.push(readFileSync(join(root, "schema.sql"), "utf8"));
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const f of files) {
  parts.push(`\n\n-- ===================================================================\n-- migration: ${f}\n-- ===================================================================\n`);
  parts.push(readFileSync(join(migrationsDir, f), "utf8"));
}
writeFileSync(join(root, "install.sql"), parts.join("\n"));
console.log(`supabase/install.sql gerado (${files.length} migrations).`);
