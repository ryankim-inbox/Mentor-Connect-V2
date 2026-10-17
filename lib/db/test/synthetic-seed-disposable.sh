#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mentor-connect-synthetic.XXXXXX")
STARTED=0
cleanup() {
  if [ "$STARTED" -eq 1 ]; then pg_ctl -D "$FIXTURE_DIR/cluster" -m immediate -w stop >/dev/null; fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT HUP INT TERM
mkdir "$FIXTURE_DIR/socket"
PORT=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
initdb -D "$FIXTURE_DIR/cluster" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$FIXTURE_DIR/cluster" -o "-F -h 127.0.0.1 -p $PORT -k $FIXTURE_DIR/socket" -w start >/dev/null
STARTED=1
TEST_SYNTHETIC_DATABASE_URL="postgresql://127.0.0.1:$PORT/postgres" SYNTHETIC_TEST_PYTHON="${SYNTHETIC_TEST_PYTHON:-${CLASSROOM_TEST_PYTHON:-$ROOT/.venv/bin/python}}" node --test "$ROOT/lib/db/test/synthetic-seed.test.mjs"
