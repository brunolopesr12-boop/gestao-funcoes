// Após o tsc emitir .tmp-test/, acrescenta a extensão .js nos imports relativos
// para que o Node consiga resolvê-los em ESM.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.tmp-test/", import.meta.url));
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const p = join(dir, f);
  const src = readFileSync(p, "utf8");
  const out = src.replace(/from ["'](\.\/[^"']+?)["']/g, (m, spec) =>
    spec.endsWith(".js") ? m : `from "${spec}.js"`,
  );
  if (out !== src) writeFileSync(p, out);
}
