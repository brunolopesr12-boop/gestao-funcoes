import { readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export default async function globalTeardown() {
  try {
    const pid = Number(readFileSync(join(root, ".tools", "e2e-gateway.pid"), "utf8"));
    if (pid) process.kill(pid);
    unlinkSync(join(root, ".tools", "e2e-gateway.pid"));
  } catch { /* já encerrado */ }
}
