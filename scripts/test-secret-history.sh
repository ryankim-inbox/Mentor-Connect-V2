#!/usr/bin/env sh
# Verifies the repository wrapper invokes the history scanner in redacted mode
# and preserves a scanner failure without printing scan payloads itself.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gitleaks" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" > "$TEST_GITLEAKS_ARGS"
exit "${TEST_GITLEAKS_EXIT:-0}"
EOF
chmod +x "$TMP/bin/gitleaks"

TEST_GITLEAKS_ARGS="$TMP/args" PATH="$TMP/bin:$PATH" \
  sh "$ROOT/scripts/check-secret-history.sh" > "$TMP/stdout" 2> "$TMP/stderr"

[ "$(cat "$TMP/args")" = "git --redact --no-banner" ]
grep -F "redacted gitleaks output" "$TMP/stdout" > /dev/null

set +e
TEST_GITLEAKS_EXIT=1 TEST_GITLEAKS_ARGS="$TMP/failure-args" PATH="$TMP/bin:$PATH" \
  sh "$ROOT/scripts/check-secret-history.sh" > "$TMP/failure-stdout" 2> "$TMP/failure-stderr"
STATUS=$?
set -e

[ "$STATUS" -eq 1 ]
[ "$(cat "$TMP/failure-args")" = "git --redact --no-banner" ]
[ ! -s "$TMP/failure-stderr" ]

echo "secret history wrapper tests passed"
