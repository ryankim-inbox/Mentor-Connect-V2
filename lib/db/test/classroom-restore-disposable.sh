#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mentor-connect-restore.XXXXXX")
mkdir "$FIXTURE_DIR/socket"
PORT=$(node -e 'const s = require("node:net").createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
STARTED=0
cleanup() {
  if [ "$STARTED" -eq 1 ]; then pg_ctl -D "$FIXTURE_DIR/cluster" -m immediate -w stop >/dev/null; fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$FIXTURE_DIR/cluster" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$FIXTURE_DIR/cluster" -o "-F -h 127.0.0.1 -p $PORT -k $FIXTURE_DIR/socket" -w start >/dev/null
STARTED=1
for database in restore_source restore_empty restore_occupied; do
  createdb -h 127.0.0.1 -p "$PORT" "$database"
done
TEST_RESTORE_BASE_URL="postgresql://127.0.0.1:$PORT" node --test "$ROOT/lib/db/test/classroom-restore.test.mjs"
