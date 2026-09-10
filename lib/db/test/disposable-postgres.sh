#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mentor-connect-postgres.XXXXXX")
CLUSTER_DIR="$FIXTURE_DIR/cluster"
SOCKET_DIR="$FIXTURE_DIR/socket"
mkdir "$SOCKET_DIR"
PORT=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
STARTED=0

cleanup() {
  if [ "$STARTED" -eq 1 ]; then
    pg_ctl -D "$CLUSTER_DIR" -m immediate -w stop >/dev/null
  fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT HUP INT TERM

initdb -D "$CLUSTER_DIR" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$CLUSTER_DIR" -o "-F -h 127.0.0.1 -p $PORT -k $SOCKET_DIR" -w start >/dev/null
STARTED=1

TEST_DATABASE_URL="postgresql://127.0.0.1:$PORT/postgres" \
  node --test "$ROOT/lib/db/test/catalog.integration.test.mjs"
