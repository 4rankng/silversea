#!/usr/bin/env bash
# Run all Silversea E2E test suites.
# Usage:
#   ./e2e/run_all.sh           # Run all
#   ./e2e/run_all.sh 00 20     # Run every script for these suite numbers
#   ./e2e/run_all.sh --list     # List selected scripts without starting the stack

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Check dependencies
if ! command -v python3 &>/dev/null; then
    echo "❌ python3 not found"
    exit 1
fi

# Discover actual files, including multiple scripts sharing a suite number.
LIST_ONLY=false
if [ "${1:-}" = "--list" ]; then
    LIST_ONLY=true
    shift
fi
SUITE_LIST=$(python3 "$DIR/suite_contract.py" list "$DIR" "$@")
if [ "$LIST_ONLY" = true ]; then
    echo "$SUITE_LIST"
    exit 0
fi
SCRIPTS=()
while IFS= read -r script; do
    SCRIPTS+=("$script")
done <<< "$SUITE_LIST"

# Validate explicit pairing before assigning defaults or starting any workflows.
echo "🔍 Checking effective E2E targets..."
python3 "$DIR/target_contract.py"

# Check Playwright
if ! python3 -c "from playwright.sync_api import sync_playwright" 2>/dev/null; then
    echo "📦 Installing Playwright..."
    pip3 install playwright
    python3 -m playwright install chromium
fi

# Defaults are local; paired explicit staging URLs remain supported. Validation
# and connectivity above use the effective targets, not unrelated local ports.
FRONTEND_PORT="${SILVERSEA_FRONTEND_PORT:-7174}"
BACKEND_PORT="${SILVERSEA_BACKEND_PORT:-3001}"
export SILVERSEA_URL="${SILVERSEA_URL:-http://localhost:$FRONTEND_PORT}"
export SILVERSEA_API="${SILVERSEA_API:-http://localhost:$BACKEND_PORT}"
# The persisted dispatch suite uses a deliberately explicit local database URL
# for its bootstrap/cleanup subprocesses; it never falls back to another app.
export SILVERSEA_DATABASE_URL="${SILVERSEA_DATABASE_URL:-postgres://postgres:postgres@localhost:5441/silversea}"
E2E_ARTIFACT_ROOT="${SILVERSEA_SCREENSHOTS:-/tmp/silversea-e2e}"
export SILVERSEA_SCREENSHOTS="$E2E_ARTIFACT_ROOT/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$SILVERSEA_SCREENSHOTS"
echo "✅ Effective frontend and API targets are reachable"

# Run every selected script, retaining individual failures and incomplete results.
FAILED_SUITES=()
SUITE_TIMEOUT_SECONDS="${SILVERSEA_SUITE_TIMEOUT_SECONDS:-300}"

for SCRIPT in "${SCRIPTS[@]}"; do
    echo ""
    if ! python3 - "$SCRIPT" "$SUITE_TIMEOUT_SECONDS" <<'PY'
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
        FAILED_SUITES+=("$(basename "$SCRIPT")")
    fi
done

# Summary
echo ""
echo "============================================================"
echo "  E2E Test Results"
echo "============================================================"

# A zero child exit is insufficient: every selected script must leave a
# non-empty all-PASS result artifact. SKIP/BLOCKED remain visible and fail QA.
if ! python3 "$DIR/suite_contract.py" summarize "$SILVERSEA_SCREENSHOTS" "${#SCRIPTS[@]}"; then
    FAILED_SUITES+=("incomplete-result-evidence")
fi

echo "============================================================"
echo ""
echo "📁 Screenshots & results: $SILVERSEA_SCREENSHOTS"

if [ ${#FAILED_SUITES[@]} -ne 0 ]; then
    exit 1
fi
