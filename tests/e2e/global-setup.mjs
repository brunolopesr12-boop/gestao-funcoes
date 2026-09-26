// Prepara o ambiente ponta a ponta: banco local zerado + gateway Supabase local.
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** encerra o que estiver escutando na porta (fuser; lsof como reserva) */
function killPort(port) {
  for (const cmd of [`fuser -k ${port}/tcp`, `kill $(lsof -t -i:${port})`]) {
    try {
      execSync(`${cmd} 2>/dev/null`, { stdio: "ignore", shell: "/bin/bash" });
      return;
    } catch { /* nada escutando ou ferramenta ausente: tenta a próxima */ }
  }
}

export default async function globalSetup() {
  // derruba gateway antigo (se houver) para poder recriar o banco
  killPort(54321);
  await new Promise((r) => setTimeout(r, 500));
  const reset = spawnSync("bash", ["scripts/db-local.sh"], { cwd: root, stdio: "pipe", encoding: "utf8" });
  if (reset.status !== 0) throw new Error(`não consegui recriar o banco de testes:\n${reset.stderr}`);

  const gw = spawn("node", ["tests/local-supabase/server.mjs"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
  gw.unref();
  writeFileSync(join(root, ".tools", "e2e-gateway.pid"), String(gw.pid));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("gateway não subiu")), 15000);
    gw.stdout.on("data", (d) => { if (String(d).includes("http://localhost")) { clearTimeout(t); resolve(); } });
    gw.stderr.on("data", (d) => process.stderr.write(d));
  });
}
