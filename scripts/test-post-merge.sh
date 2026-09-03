#!/usr/bin/env sh
# The merge hook may install dependencies and run read-only validation only.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat > "$TMP/bin/pnpm" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$TEST_PNPM_CALLS"
EOF
chmod +x "$TMP/bin/pnpm"

TEST_PNPM_CALLS="$TMP/pnpm-calls" PATH="$TMP/bin:$PATH" sh "$ROOT/scripts/post-merge.sh"

grep -Fx 'install --frozen-lockfile' "$TMP/pnpm-calls" > /dev/null
grep -Fx 'run typecheck' "$TMP/pnpm-calls" > /dev/null
if grep -E -- '--filter|push|migration' "$TMP/pnpm-calls" > /dev/null; then
  echo "post-merge attempted a database-changing command" >&2
  exit 1
fi

echo "post-merge tests passed"
