#!/usr/bin/env bash
set -euo pipefail
# Isolated local cluster only. Never reads a project DATABASE_URL or environment secrets.
BLOOM_PG_BIN="${BLOOM_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
BLOOM_TEST_PORT="${BLOOM_TEST_PORT:-55440}"
BLOOM_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bloom-db-test.XXXXXX")"
BLOOM_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
export BLOOM_TEST_PORT
export BLOOM_PSQL="$BLOOM_PG_BIN/psql"
cleanup() {
  "$BLOOM_PG_BIN/pg_ctl" -D "$BLOOM_TEST_ROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$BLOOM_TEST_ROOT"
}
trap cleanup EXIT
"$BLOOM_PG_BIN/initdb" -D "$BLOOM_TEST_ROOT/data" -A trust --no-locale >"$BLOOM_TEST_ROOT/init.log"
"$BLOOM_PG_BIN/pg_ctl" -D "$BLOOM_TEST_ROOT/data" -l "$BLOOM_TEST_ROOT/server.log" -o "-p $BLOOM_TEST_PORT -h 127.0.0.1" start >/dev/null
"$BLOOM_PSQL" -h 127.0.0.1 -p "$BLOOM_TEST_PORT" -d postgres -X -q -v ON_ERROR_STOP=1 -f "$BLOOM_REPO/supabase/tests/platform.sql"
for migration in "$BLOOM_REPO"/supabase/migrations/*.sql; do
  if [[ "$migration" == *202609200027_onboarding.sql ]]; then
    "$BLOOM_PSQL" -h 127.0.0.1 -p "$BLOOM_TEST_PORT" -d postgres -X -q -v ON_ERROR_STOP=1 -f "$BLOOM_REPO/supabase/tests/onboarding_legacy.sql"
  fi
  "$BLOOM_PSQL" -h 127.0.0.1 -p "$BLOOM_TEST_PORT" -d postgres -X -q -v ON_ERROR_STOP=1 -f "$migration"
done
python3 -B "$BLOOM_REPO/supabase/tests/test_database.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_calendar_database.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_local_guard.py"
python3 -B "$BLOOM_REPO/supabase/tests/test_property_setup.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_admin_participation.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_pending_owners.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_mixed_review.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_property_rename.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_cleaner_journey.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_owner_hub.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_listing_deletion.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_owner_creation.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_owner_configuration.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_practice_withdrawal.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_maintenance.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_property_people.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_onboarding.py"

python3 -B "$BLOOM_REPO/supabase/tests/test_push.py"
