#!/bin/bash
set -e
CI=true pnpm install --frozen-lockfile
pnpm --filter db push
