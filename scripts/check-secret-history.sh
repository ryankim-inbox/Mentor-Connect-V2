#!/usr/bin/env sh
# Scan every reachable Git commit. Gitleaks handles findings and redacts values.
set -eu

cd "$(dirname "$0")/.."

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is required for the full-history secret scan (CI installs it)." >&2
  exit 127
fi

echo "Scanning complete Git history with redacted gitleaks output..."
exec gitleaks git --redact --no-banner
