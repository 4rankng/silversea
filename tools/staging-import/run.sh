#!/usr/bin/env bash
# Replay the staging data import. Use the default local backend, or set
# BASE / ADMIN_USER / ADMIN_PASSWORD to point at another environment.
#
# Examples:
#   ./run.sh                                          # local
#   BASE=https://vantai.tingting.vip ./run.sh         # staging
#   BASE=http://192.168.1.10:3001 ADMIN_USER=admin ADMIN_PASSWORD=secret ./run.sh
#
# Idempotent — safe to re-run; will detect existing data and skip.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Make sure the local DB/Redis/backend are up when targeting localhost.
if [[ "${BASE:-}" == "" || "${BASE}" == "http://localhost:3001" ]]; then
  if ! curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "✗ backend at http://localhost:3001 is not responding"
    echo "  start it with: make dev (or pnpm dev in backend/)"
    exit 1
  fi
fi

# Clean the xlsx only if it's older than the source. The script also does
# this on import.mjs startup.
python3 tools/staging-import/clean-xlsx.py

node tools/staging-import/import.mjs
