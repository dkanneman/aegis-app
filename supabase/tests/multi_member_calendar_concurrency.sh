#!/usr/bin/env bash
set -euo pipefail

: "${PEPPER_TEST_DATABASE_URL:?Set PEPPER_TEST_DATABASE_URL to the disposable local database.}"
PSQL_BIN="${PSQL_BIN:-psql}"
EVENT_ID="00000000-0000-4000-8000-000000000402"
HOUSEHOLD_ID="00000000-0000-4000-8000-000000000001"
MEMBER_ID="00000000-0000-4000-8000-000000000013"
FIRST_RESULT="$(mktemp)"
SECOND_RESULT="$(mktemp)"

cleanup() {
  "$PSQL_BIN" "$PEPPER_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -q \
    -c "delete from public.events where id='$EVENT_ID'::uuid" >/dev/null 2>&1 || true
  rm -f "$FIRST_RESULT" "$SECOND_RESULT"
}
trap cleanup EXIT

"$PSQL_BIN" "$PEPPER_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -q <<SQL
delete from public.events where id='$EVENT_ID'::uuid;
insert into public.events(
  id,household_id,title,starts_at,status,visibility,kind,source,
  owner_member_id,revision,updated_at
) values (
  '$EVENT_ID','$HOUSEHOLD_ID','[PEPPER TEST] Revision race',
  '2026-09-22T17:00:00Z','confirmed','household','event','pepper',
  '$MEMBER_ID',1,'2026-09-16T12:00:00.123456Z'
);
SQL

(
  "$PSQL_BIN" "$PEPPER_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -qAt <<SQL
begin;
with changed as (
  update public.events
  set title='[PEPPER TEST] First writer',revision=revision+1,updated_at=now()
  where id='$EVENT_ID'::uuid and household_id='$HOUSEHOLD_ID'::uuid and revision=1
  returning id
)
select count(*) from changed;
select pg_sleep(1);
commit;
SQL
) >"$FIRST_RESULT" &
FIRST_PID=$!

sleep 0.2

(
  "$PSQL_BIN" "$PEPPER_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -qAt <<SQL
begin;
with changed as (
  update public.events
  set title='[PEPPER TEST] Second writer',revision=revision+1,updated_at=now()
  where id='$EVENT_ID'::uuid and household_id='$HOUSEHOLD_ID'::uuid and revision=1
  returning id
)
select count(*) from changed;
commit;
SQL
) >"$SECOND_RESULT" &
SECOND_PID=$!

wait "$FIRST_PID"
wait "$SECOND_PID"

FIRST_COUNT="$(head -n 1 "$FIRST_RESULT" | tr -d '[:space:]')"
SECOND_COUNT="$(head -n 1 "$SECOND_RESULT" | tr -d '[:space:]')"
FINAL_STATE="$($PSQL_BIN "$PEPPER_TEST_DATABASE_URL" -X -qAt -c \
  "select revision||':'||title from public.events where id='$EVENT_ID'::uuid")"

if [[ "$FIRST_COUNT" != "1" || "$SECOND_COUNT" != "0" ]]; then
  echo "Expected one successful writer and one conflict; got $FIRST_COUNT and $SECOND_COUNT." >&2
  exit 1
fi
if [[ "$FINAL_STATE" != "2:[PEPPER TEST] First writer" ]]; then
  echo "Unexpected final event state: $FINAL_STATE" >&2
  exit 1
fi

echo "Concurrent revision gate: one success, one conflict; fractional timestamp was irrelevant."
