#!/bin/bash
set -e
CI=true pnpm install --frozen-lockfile
pnpm run typecheck
