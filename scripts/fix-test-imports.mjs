// Após o tsc emitir .tmp-test/, acrescenta a extensão .js nos imports relativos
// para que o Node consiga resolvê-los em ESM (inclui subpastas).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../.tmp-test/", import.meta.url));

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!name.endsWith(".js")) continue;
    const src = readFileSync(p, "utf8");
    const out = src.replace(/from ["'](\.{1,2}\/[^"']+?)["']/g, (m, spec) =>
      spec.endsWith(".js") ? m : `from "${spec}.js"`,
    );
    if (out !== src) writeFileSync(p, out);
  }
}

walk(root);
