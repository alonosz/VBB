#!/usr/bin/env bash
# Applies the feed migrations to a throwaway Postgres and checks the schema
# guarantees. Run it after touching anything in supabase/migrations.
#
#   ./scripts/db-test.sh                 # boots a temporary local cluster
#   DATABASE_URL=postgres://… ./scripts/db-test.sh   # uses an existing database
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -n "${DATABASE_URL:-}" ]; then
  PSQL=(psql "$DATABASE_URL")
else
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
  if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
    echo "No local Postgres found. Set DATABASE_URL, or install postgresql." >&2
    exit 1
  fi

  PORT="${PGPORT:-54322}"
  DATA="$(mktemp -d)/pgdata"
  # Postgres refuses to run as root, so hand the cluster to the postgres user
  # when we happen to be root.
  RUNAS=""
  if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1; then
    RUNAS="postgres"
    mkdir -p "$DATA" && chown -R postgres:postgres "$(dirname "$DATA")"
    chmod 755 "$(dirname "$DATA")"
  fi

  run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }

  run "$PGBIN/initdb -D $DATA -U postgres --auth=trust -E UTF8" >/dev/null
  run "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l /tmp/vbb-db-test.log start" >/dev/null
  trap 'run "$PGBIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1 || true' EXIT

  psql -h /tmp -p "$PORT" -U postgres -qc "create database vbb_test" >/dev/null
  PSQL=(psql -h /tmp -p "$PORT" -U postgres -d vbb_test)
fi

for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$migration")"
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$migration"
done

echo
"${PSQL[@]}" -f "$ROOT/supabase/tests/feeds_schema_test.sql" 2>&1 \
  | grep -E "PASS|FAIL|ERROR" \
  | sed -E 's/^.*(NOTICE|ERROR):  //'

echo
echo "schema OK"
