#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
PG_TEST_BIN=$(dirname "$(command -v pg_ctl)")
node --test "$ROOT/ops/demo-refresh-handoff/protocol.test.mjs"
"${PYTHON_BIN:-python3}" -I -B -m unittest discover -s "$ROOT/ops/demo-refresh-handoff" -p 'test_launcher.py'
TEST_REFRESH_PG_BIN="$PG_TEST_BIN" RUN_REFRESH_BACKUP_LOCAL_TEST=1 node --test "$ROOT/ops/demo-refresh-handoff/backup.integration.test.mjs"
