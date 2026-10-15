#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
PYTHON_BIN=${PYTHON_BIN:-"$ROOT/.venv/bin/python"}
for tool in "$PYTHON_BIN" node pnpm initdb pg_ctl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Required test tool missing: $tool" >&2; exit 1; }
done

"$PYTHON_BIN" -c "import pytest, psycopg, psycopg2, uvicorn, websockets"
CLASSROOM_TEST_PYTHON=$PYTHON_BIN
export CLASSROOM_TEST_PYTHON

pnpm --filter @workspace/db schema:check

FIXTURE_DIR=$(mktemp -d /tmp/mentor-connect-python.XXXXXX)
CLUSTER_DIR="$FIXTURE_DIR/cluster"
SOCKET_DIR="$FIXTURE_DIR/socket"
mkdir "$SOCKET_DIR"

cleanup() {
  result=$?
  set +e
  trap - EXIT HUP INT TERM
  if [ -f "$CLUSTER_DIR/postmaster.pid" ]; then
    pg_ctl -D "$CLUSTER_DIR" -m immediate -w stop >/dev/null || true
  fi
  rm -rf "$FIXTURE_DIR"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

PORT=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
initdb -D "$CLUSTER_DIR" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$CLUSTER_DIR" -l "$FIXTURE_DIR/postgres.log" \
  -o "-F -h 127.0.0.1 -p $PORT -k $SOCKET_DIR" -w start >/dev/null

CHAT_TEST_ADMIN_DSN="postgresql://127.0.0.1:$PORT/postgres"
MENTOR_RANKS_TEST_DSN="$CHAT_TEST_ADMIN_DSN"
DATABASE_URL="$CHAT_TEST_ADMIN_DSN"
export CHAT_TEST_ADMIN_DSN MENTOR_RANKS_TEST_DSN DATABASE_URL

if [ "$#" -eq 0 ]; then
  set -- tests
fi
"$PYTHON_BIN" -m pytest "$@"
