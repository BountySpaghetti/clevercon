#!/usr/bin/env bash
# Runs `tsc --noEmit` for every workspace package that has its own
# tsconfig.json. The frontend (apps/web) runs its own typecheck via
# `npm run build -w @clevercon/web` and is out of scope here.
set -e

for dir in packages/common packages/db packages/agent-sdk packages/mcp services/api services/indexer services/workers; do
  dir="${dir%/}"
  if [ -f "$dir/tsconfig.json" ]; then
    echo "==> typecheck $dir"
    npx tsc --noEmit -p "$dir/tsconfig.json"
  fi
done
