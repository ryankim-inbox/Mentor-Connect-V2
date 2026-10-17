#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mentor-journey-operator.XXXXXX")
mkdir "$FIXTURE_DIR/socket"
PORT=$(node -e 'const net=require("node:net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
cleanup() { pg_ctl -D "$FIXTURE_DIR/cluster" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT HUP INT TERM
initdb -D "$FIXTURE_DIR/cluster" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$FIXTURE_DIR/cluster" -o "-F -h 127.0.0.1 -p $PORT -k $FIXTURE_DIR/socket" -w start >/dev/null
TEST_DATABASE_URL="postgresql://127.0.0.1:$PORT/postgres" node --test "$ROOT/lib/db/test/journey-upgrade.test.mjs" "$ROOT/lib/db/test/account-trust-upgrade.test.mjs" "$ROOT/lib/db/test/account-trust-recovery.test.mjs"
