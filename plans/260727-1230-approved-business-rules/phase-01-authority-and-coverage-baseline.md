---
phase: 1
title: Authority and coverage baseline
status: completed
priority: P1
dependencies: []
---

# Phase 1: Authority and coverage baseline

## Overview

Record SilverSea's written approval, remove stale authority blockers, and
produce an evidence-backed coverage matrix so later phases change only real
gaps.

## Requirements

- Mark Q01-Q23 accepted exactly as proposed; record the 2026-07-27 approval.
- Record O01/O02 as accepted implementation decisions and simulated GPS as
  staging-approved.
- Reconcile ROADMAP and regression dependencies without claiming unproved
  behavior.
- Map every rule to current schema/service/route/UI/tests and classify it
  `PROVED`, `PARTIAL`, or `MISSING`.

## Related Code Files

- Modify: `docs/prd/business-logic-qa-proposals.md`
- Modify: `ROADMAP.md`
- Modify: affected `docs/regression-testing/*.md`
- Create: `plans/260727-1230-approved-business-rules/reports/coverage-baseline.md`
- Modify: `HANDOFF.md` (controller only)

## Implementation Steps

1. Replace all Q01-Q23 `pending` statuses with `accepted`, preserving proposal
   wording and adding approval metadata.
2. Update roadmap authority language and unblock the matching waves without
   changing implementation status.
3. Audit current code and tests; link exact evidence for each Q and O item.
4. Hydrate the execution matrix with separate authority and implementation
   status columns.
5. Run documentation/context validation and independent plan review.

## Success Criteria

- [x] Q01-Q23 are recorded as accepted with no proposal wording changed.
- [x] O01/O02 and simulated-GPS decisions are durably recorded.
- [x] No authority-pending blocker remains for these items.
- [x] Coverage matrix distinguishes proved, partial, and missing behavior,
  including the controller correction of six initially overstated anchors.
- [x] `pnpm context:check` and relevant documentation checks pass.

## Risk Assessment

The key risk is turning approval into a false implementation claim. Keep
authority status separate from code/test status and retain every known gap.
