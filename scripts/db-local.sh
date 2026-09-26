#!/usr/bin/env bash
# Recria o banco local de testes e aplica shim + install.sql.
# Requer PostgreSQL local (padrão: usuário postgres, banco vila_test).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${PGDATABASE_TEST:-vila_test}"
export PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}"
node scripts/db-bundle.mjs
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists $DB;"
psql -v ON_ERROR_STOP=1 -d postgres -qc "create database $DB;"
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f tests/db/auth-shim.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f supabase/install.sql
# aplica de novo para garantir idempotência
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f supabase/install.sql
echo "banco $DB pronto (install.sql aplicado 2x sem erro)"
