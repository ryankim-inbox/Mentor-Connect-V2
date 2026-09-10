#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mentor-connect-classroom.XXXXXX")
CLUSTER_DIR="$FIXTURE_DIR/cluster"
SOCKET_DIR="$FIXTURE_DIR/socket"
mkdir "$SOCKET_DIR"
PORT=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
STARTED=0
API_STARTED=0
API_PID=

cleanup() {
  if [ "$API_STARTED" -eq 1 ]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [ "$STARTED" -eq 1 ]; then
    pg_ctl -D "$CLUSTER_DIR" -m immediate -w stop >/dev/null
  fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT HUP INT TERM

initdb -D "$CLUSTER_DIR" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$CLUSTER_DIR" -o "-F -h 127.0.0.1 -p $PORT -k $SOCKET_DIR" -w start >/dev/null
STARTED=1

for database in classroom_empty classroom_populated classroom_concurrent classroom_seed classroom_mismatch classroom_failure classroom_real; do
  createdb -h 127.0.0.1 -p "$PORT" "$database"
done

REAL_TEST_ENV=
if [ -n "${CLASSROOM_TEST_PYTHON:-}" ]; then
  API_PORT=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
  SESSION_SECRET=$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')
  (
    cd "$ROOT/Python"
    exec env PYTHONDONTWRITEBYTECODE=1 \
      DATABASE_URL="postgresql://127.0.0.1:$PORT/classroom_real" \
      SESSION_SECRET="$SESSION_SECRET" PORT="$API_PORT" \
      "$CLASSROOM_TEST_PYTHON" -B -m uvicorn main:app \
        --host 127.0.0.1 --port "$API_PORT"
  ) >"$FIXTURE_DIR/python-api.log" 2>&1 &
  API_PID=$!
  API_STARTED=1
  attempts=0
  until curl --fail --silent "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 100 ]; then
      exit 1
    fi
    sleep 0.1
  done
  REAL_TEST_ENV="TEST_CLASSROOM_REAL_URL=postgresql://127.0.0.1:$PORT/classroom_real TEST_CLASSROOM_REAL_ORIGIN=http://127.0.0.1:$API_PORT"
fi

env $REAL_TEST_ENV \
  TEST_CLASSROOM_EMPTY_URL="postgresql://127.0.0.1:$PORT/classroom_empty" \
  TEST_CLASSROOM_POPULATED_URL="postgresql://127.0.0.1:$PORT/classroom_populated" \
  TEST_CLASSROOM_CONCURRENT_URL="postgresql://127.0.0.1:$PORT/classroom_concurrent" \
  TEST_CLASSROOM_SEED_URL="postgresql://127.0.0.1:$PORT/classroom_seed" \
  TEST_CLASSROOM_MISMATCH_URL="postgresql://127.0.0.1:$PORT/classroom_mismatch" \
  TEST_CLASSROOM_FAILURE_URL="postgresql://127.0.0.1:$PORT/classroom_failure" \
    node --test "$ROOT/lib/db/test/classroom-bootstrap.test.mjs"
