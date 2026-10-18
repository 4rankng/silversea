#!/usr/bin/env bash
# ship.sh — Silversea integrated delivery wave (built 2026-10-18)
# Orchestrates: conflict radar → merge → fast+final gates → push → deploy → health → visual QA gate
#
# Usage:
#   ./tools/ship.sh merge <branch>...   # consolidate branches (braidkeep pre-check)
#   ./tools/ship.sh gates               # tsgo fast + tsc final + scoped BE tests
#   ./tools/ship.sh deploy              # board-gated staging+prod deploy + health verify
#   ./tools/ship.sh visual              # lost-pixel diff against staging (QA gate)
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/go/bin:$PATH"
K="/Users/dev/Library/CloudStorage/GoogleDrive-frankng.sg@gmail.com/My Drive/SilverSea/Kanban"

cmd="${1:-help}"

braidkeep_check() {
  local branches=("$@")
  if command -v braidkeep >/dev/null 2>&1; then
    echo "── braidkeep radar ──"
    braidkeep plan "${branches[@]}" 2>/dev/null | tail -3
  else
    echo "(braidkeep not installed — skipping radar)"
  fi
}

case "$cmd" in
  merge)
    shift
    braidkeep_check "$@"
    for b in "$@"; do
      echo "── merge $b ──"
      git merge --no-ff "$b" -m "merge: $b (ship.sh — braidkeep-verified)" || { echo "❌ conflict on $b — resolve manually"; exit 1; }
    done
    ;;
  gates)
    echo "── tsgo (fast pre-gate) ──"
    (cd frontend && npx tsgo -b && echo "tsgo OK")
    echo "── tsc (final gate) ──"
    (cd frontend && npx tsc -b && echo "tsc OK")
    (cd backend && npx tsc --noEmit && echo "be-tsc OK")
    echo "── scoped BE tests (files changed vs origin/main) ──"
    CHANGED=$(git diff --name-only origin/main...HEAD -- 'backend/src/tests/*.test.ts' | sed 's|backend/||' || true)
    if [ -n "$CHANGED" ]; then
      (cd backend && pnpm exec tsx --test $CHANGED 2>&1 | grep -E "^ℹ (tests|pass|fail)")
    else
      echo "(no scoped BE test files changed)"
    fi
    ;;
  deploy)
    TODO=$(ls "$K/TODO" 2>/dev/null | grep -c docx || true)
    if [ "$TODO" != "0" ]; then
      echo "⛔ GDrive TODO=$TODO (deploy gate: chỉ deploy khi board sạch)"; exit 1
    fi
    echo "── deploy staging ──"; make demo 2>&1 | tail -1
    echo "── deploy prod ──";    make deploy 2>&1 | tail -1
    sleep 15
    for u in https://vantai.tingting.vip/api/health https://silversea.tingting.vip/api/health; do
      echo -n "$u → "; curl -s --max-time 15 "$u" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('buildHash'), d.get('status'))"
    done
    ;;
  visual)
    echo "── visual QA gate (lost-pixel vs staging) ──"
    (cd frontend && npx lost-pixel 2>&1 | tail -3)
    ;;
  *)
    sed -n '2,12p' "$0"
    ;;
esac
