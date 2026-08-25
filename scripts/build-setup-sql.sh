#!/usr/bin/env bash
# Rebuilds supabase/setup.sql from the migrations. Run after adding one.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/supabase/setup.sql"

{
  cat <<'HDR'
-- VBB Engine — one-paste setup for the Supabase SQL Editor.
--
-- GENERATED FILE. Do not edit by hand: it is the migrations in
-- supabase/migrations/ concatenated in order, so that setting up a new project
-- is a single copy-paste instead of one per migration.
--
-- Regenerate with:  ./scripts/build-setup-sql.sh
--
-- The migrations remain the source of truth. If this file and they ever
-- disagree, they are right and this is stale.

HDR
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "-- ============================================================"
    echo "-- $(basename "$f")"
    echo "-- ============================================================"
    echo
    cat "$f"
    echo
  done
} > "$OUT"

echo "wrote $(wc -l < "$OUT") lines to supabase/setup.sql"
