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
    python3 -c "
import socket
s = socket.socket()
s.settimeout(2)
try:
    s.connect(('localhost', $1))
    s.close()
    exit(0)
except:
    exit(1)
" 2>/dev/null
}

echo "🔍 Checking servers..."
if ! check_port 7173; then
    echo "❌ Frontend not running on :7173. Run 'make dev' first."
    exit 1
fi
if ! check_port 3090; then
    echo "❌ Backend not running on :3090. Run 'make dev' first."
    exit 1
fi
echo "✅ Servers ready"

# Determine which suites to run
SUITES=()
if [ $# -eq 0 ]; then
    for i in $(seq 0 13); do
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
import json, glob
files = sorted(glob.glob('/tmp/tingting-e2e/*_results.json'))
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
echo "📁 Screenshots & results: /tmp/tingting-e2e/"
