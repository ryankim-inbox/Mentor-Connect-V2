#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PYTHON_FREEZE_BASE=${PYTHON_FREEZE_BASE:-98e1b04c292302bd25365ed7db4c5675671df337}
PYTHON_PR_BASE=${PYTHON_PR_BASE:-$(git merge-base HEAD refs/remotes/origin/main 2>/dev/null || true)}
PYTHON_FREEZE_SCOPE_REF=${PYTHON_FREEZE_SCOPE_REF:-codex/learning-tasks-21-24}
CURRENT_REF=${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-$(git branch --show-current)}}

if [ "$CURRENT_REF" = "$PYTHON_FREEZE_SCOPE_REF" ]; then
  if [ -z "$PYTHON_PR_BASE" ]; then
    echo "PYTHON_PR_BASE is required when origin/main is unavailable" >&2
    exit 1
  fi
  git rev-parse --verify "$PYTHON_FREEZE_BASE^{commit}" >/dev/null
  git rev-parse --verify "$PYTHON_PR_BASE^{commit}" >/dev/null
fi

run() {
  if [ "$MODE" = "--print" ]; then
    printf '%s\n' "$*"
  else
    "$@"
  fi
}

MODE=${1:-}
case "$MODE" in
  ""|--print) ;;
  *) echo "usage: sh scripts/verify-release.sh [--print]" >&2; exit 2 ;;
esac

run pnpm install --frozen-lockfile
run node scripts/test-python-runtime.mjs
run node scripts/test-python-freeze.mjs
run pnpm typecheck
run pnpm build:release
run pnpm test:gateway
run pnpm test:migrations
run pnpm --filter @workspace/db test
run pnpm --filter @workspace/peerbridge test:unit
run pnpm api:generate
run git diff --exit-code -- lib/api-client-react/src/generated lib/api-zod/src/generated
run pnpm api:contract-test
run node scripts/verify-api-boundary.mjs
run sh scripts/check-secrets.sh
run pnpm test:secrets
run node --test scripts/smoke-classroom.test.mjs
run pnpm exec playwright install --with-deps chromium
run pnpm e2e
if [ "$CURRENT_REF" = "$PYTHON_FREEZE_SCOPE_REF" ]; then
  run node scripts/check-python-unchanged.mjs "$PYTHON_FREEZE_BASE"
  run node scripts/check-python-unchanged.mjs "$PYTHON_PR_BASE"
else
  echo "Python freeze checks are scoped to $PYTHON_FREEZE_SCOPE_REF; current ref is $CURRENT_REF"
fi
