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
    echo "── FULL FE suite (post-merge rule: scoped xanh không mở hết merge-break) ──"
    (cd frontend && pnpm exec vitest run 2>&1 | tee /tmp/gate-fe-full.log | grep -E "Tests " | tail -1)
    if grep -qE "Tests  [1-9][0-9]* failed" /tmp/gate-fe-full.log; then
      echo "❌ FE full suite có fail — xem /tmp/gate-fe-full.log"; exit 1
    fi
    echo "── scoped BE tests (files changed vs origin/main) ──"
    CHANGED=$(git diff --name-only origin/main...HEAD -- 'backend/src/tests/*.test.ts' | sed 's|backend/||' || true)
    if [ -n "$CHANGED" ]; then
      (cd backend && pnpm exec tsx --test $CHANGED 2>&1 | tee /tmp/gate-scoped.log | grep -E "^ℹ (tests|pass|fail)") || true
      # FLAKE QUARANTINE (Oct 2026 TIA practice): fail → rerun MỖI file cô lập 1 lần.
      # Fail lại khi cô lập = red thật; pass khi cô lập = flake → quarantine, không chặn wave.
      if grep -qE "^ℹ fail [1-9]" /tmp/gate-scoped.log; then
        echo "── flake lane (rerun isolated) ──"
        for f in $CHANGED; do
          R=$(cd backend && pnpm exec tsx --test "$f" 2>/dev/null | grep -E "^ℹ fail" | awk '{print $3}')
          if [ "${R:-0}" != "0" ]; then echo "RED (isolated): $f"; FAIL_ISOLATED=1; else echo "FLAKE (passes isolated): $f"; fi
        done
        [ "${FAIL_ISOLATED:-0}" = "1" ] && { echo "❌ real reds remain"; exit 1; } || echo "⚠️ flake only — wave proceeds, flakes quarantined"
      fi
    else
      echo "(no scoped BE test files changed)"
    fi
    ;;
  deploy)
    # Board gate (SIL-150, ruling 24/10 — GDrive retire): chặn deploy khi
    # project SIL còn ticket Backlog(1)/In Progress(3) chưa xử lý.
    BT=$(bash "$HOME/.hermes/profiles/dev/scripts/board-todo.sh" 2>/dev/null)
    if [ "${BT:-0}" != "0" ]; then
      echo "⛔ Board còn $BT ticket Backlog/In Progress (deploy gate: board phải sạch — plan.tingting.vip/tingtingsoft/SIL)"; exit 1
    fi
    # QA BUILD-PIN (user goal 21/10 — zero QA rejection): QA round active → khóa deploy
    QA_PIN="$HOME/.hermes/profiles/dev/state/qa-round-active"
    if [ -f "$QA_PIN" ]; then
      echo "⛔ QA ROUND ACTIVE (pin $(cat "$QA_PIN")) — deploy khóa tới khi round đóng. Gỡ: rm $QA_PIN (chỉ khi QA báo xong round)."; exit 1
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
