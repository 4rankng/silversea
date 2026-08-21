#!/usr/bin/env bash
# Run all Silversea E2E test suites.
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
# The runner targets the local Silversea stack only. Every override remains in
# the SILVERSEA namespace so an adjacent checkout cannot redirect this suite.
FRONTEND_PORT="${SILVERSEA_FRONTEND_PORT:-7174}"
BACKEND_PORT="${SILVERSEA_BACKEND_PORT:-3001}"
if ! check_port "$FRONTEND_PORT"; then
    echo "❌ Frontend not running on :$FRONTEND_PORT. Run 'make dev' first."
    exit 1
fi
if ! check_port "$BACKEND_PORT"; then
    echo "❌ Backend not running on :$BACKEND_PORT. Run 'make dev' first."
    exit 1
fi
export SILVERSEA_URL="${SILVERSEA_URL:-http://localhost:$FRONTEND_PORT}"
export SILVERSEA_API="${SILVERSEA_API:-http://localhost:$BACKEND_PORT}"
# The persisted dispatch suite uses a deliberately explicit local database URL
# for its bootstrap/cleanup subprocesses; it never falls back to another app.
export SILVERSEA_DATABASE_URL="${SILVERSEA_DATABASE_URL:-postgres://postgres:postgres@localhost:5441/silversea}"
E2E_ARTIFACT_ROOT="${SILVERSEA_SCREENSHOTS:-/tmp/silversea-e2e}"
export SILVERSEA_SCREENSHOTS="$E2E_ARTIFACT_ROOT/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$SILVERSEA_SCREENSHOTS"
echo "✅ Servers ready (frontend :$FRONTEND_PORT, backend :$BACKEND_PORT)"

# Determine which suites to run
SUITES=()
if [ $# -eq 0 ]; then
    for i in $(seq 0 19); do
        SUITES+=("$(printf '%02d' $i)")
    done
else
    for arg in "$@"; do
        SUITES+=("$(printf '%02d' "$((10#$arg))")")
    done
fi

# Run suites
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0
FAILED_SUITES=()
SUITE_TIMEOUT_SECONDS="${SILVERSEA_SUITE_TIMEOUT_SECONDS:-300}"

for suite in "${SUITES[@]}"; do
    SCRIPT="$DIR/test_${suite}_*.py"
    MATCH=$(ls $SCRIPT 2>/dev/null | head -1)
    if [ -z "$MATCH" ]; then
        echo "⚠️  No test script for suite $suite"
        continue
    fi
    echo ""
    if ! python3 - "$MATCH" "$SUITE_TIMEOUT_SECONDS" <<'PY'
import subprocess
import sys
import os
import signal

script, timeout_seconds = sys.argv[1], int(sys.argv[2])
process = subprocess.Popen([sys.executable, script], start_new_session=True)
try:
    sys.exit(process.wait(timeout=timeout_seconds))
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    print(f'❌ Suite exceeded {timeout_seconds}s and was terminated: {script}', file=sys.stderr)
    sys.exit(124)
PY
    then
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
files = sorted(glob.glob(os.path.join(os.environ['SILVERSEA_SCREENSHOTS'], '*_results.json')))
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
echo "📁 Screenshots & results: $SILVERSEA_SCREENSHOTS"

if [ ${#FAILED_SUITES[@]} -ne 0 ]; then
    exit 1
fi
