#!/usr/bin/env bash
# Verificação completa antes de publicar: tipos, testes de lógica, banco local e bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "→ typecheck"; npx tsc --noEmit
echo "→ testes de lógica"; npm test --silent
echo "→ bundle do banco"; node scripts/db-bundle.mjs
echo "→ testes de banco (PostgreSQL local)"; PGDATABASE_TEST="${PGDATABASE_TEST:-vila_dbtest}" npm run test:db --silent
echo "✓ tudo certo"
