#!/usr/bin/env bash
# Run all NEPO E2E test suites
# Usage:
#   ./e2e/run_all.sh           # Run all
#   ./e2e/run_all.sh 00 13     # Run specific suites

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Check dependencies
if ! command -v python3 &>/dev/null; then
    echo "❌ python3 not found"
    exit 1
fi

# Check Playwright
if ! python3 -c "from playwright.sync_api import sync_playwright" 2>/dev/null; then
    echo "📦 Installing Playwright..."
    pip3 install playwright
    python3 -m playwright install chromium
fi

# Check server connectivity
check_port() {
    # Try IPv4 first, then IPv6 — vite/node often binds to only one stack.
    python3 -c "
import socket
for fam, addr in ((socket.AF_INET, ('127.0.0.1', $1)), (socket.AF_INET6, ('::1', $1))):
    s = socket.socket(fam)
    s.settimeout(2)
    try:
        s.connect(addr)
        s.close()
        exit(0)
    except OSError:
        continue
exit(1)
" 2>/dev/null
}

echo "🔍 Checking servers..."
# Default to the silversea stack ports (7174 frontend, 3001 backend) but allow
# override via NEPO_FRONTEND_PORT / NEPO_BACKEND_PORT for the legacy
# nepocorp stack (7173 / 3090). helpers.py reads BASE_URL/API_URL from
# NEPO_URL / NEPO_API env vars.
FRONTEND_PORT="${NEPO_FRONTEND_PORT:-7174}"
BACKEND_PORT="${NEPO_BACKEND_PORT:-3001}"
if ! check_port "$FRONTEND_PORT"; then
    echo "❌ Frontend not running on :$FRONTEND_PORT. Run 'make dev' first."
    exit 1
fi
if ! check_port "$BACKEND_PORT"; then
    echo "❌ Backend not running on :$BACKEND_PORT. Run 'make dev' first."
    exit 1
fi
export NEPO_URL="${NEPO_URL:-http://localhost:$FRONTEND_PORT}"
export NEPO_API="${NEPO_API:-http://localhost:$BACKEND_PORT}"
E2E_ARTIFACT_ROOT="${NEPO_SCREENSHOTS:-/tmp/tingting-e2e}"
export NEPO_SCREENSHOTS="$E2E_ARTIFACT_ROOT/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$NEPO_SCREENSHOTS"
echo "✅ Servers ready (frontend :$FRONTEND_PORT, backend :$BACKEND_PORT)"

# Determine which suites to run
SUITES=()
if [ $# -eq 0 ]; then
    for i in $(seq 0 15); do
        SUITES+=("$(printf '%02d' $i)")
    done
else
    for arg in "$@"; do
        SUITES+=("$(printf '%02d' $arg)")
    done
fi

# Run suites
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0
FAILED_SUITES=()

for suite in "${SUITES[@]}"; do
    SCRIPT="$DIR/test_${suite}_*.py"
    MATCH=$(ls $SCRIPT 2>/dev/null | head -1)
    if [ -z "$MATCH" ]; then
        echo "⚠️  No test script for suite $suite"
        continue
    fi
    echo ""
    python3 "$MATCH"
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        FAILED_SUITES+=("$suite")
    fi
done

# Summary
echo ""
echo "============================================================"
echo "  E2E Test Results"
echo "============================================================"

# Aggregate from JSON results
python3 -c "
import json, glob, os
files = sorted(glob.glob(os.path.join(os.environ['NEPO_SCREENSHOTS'], '*_results.json')))
total = passed = failed = skipped = 0
for f in files:
    d = json.load(open(f))
    total += d['total']
    passed += d['passed']
    failed += d['failed']
    skipped += d['skipped']
print(f'  Suites: {len(files)}  |  Total: {total}  |  ✅ Pass: {passed}  |  ❌ Fail: {failed}  |  ⏭️  Skip: {skipped}')
if failed > 0:
    print()
    for f in files:
        d = json.load(open(f))
        if d['failed'] > 0:
            print(f'  ❌ {d[\"suite\"]}: {d[\"failed\"]} failures')
            for r in d['results']:
                if r['status'] == 'FAIL':
                    print(f'     - {r[\"tc_id\"]}: {r[\"detail\"]}')
"

echo "============================================================"
echo ""
echo "📁 Screenshots & results: $NEPO_SCREENSHOTS"
