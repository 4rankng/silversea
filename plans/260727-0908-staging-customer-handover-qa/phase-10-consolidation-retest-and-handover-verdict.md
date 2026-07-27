---
phase: 10
title: Consolidation Retest and Handover Verdict
status: completed
priority: P1
dependencies:
  - 9
---

# Phase 10: Consolidation Retest and Handover Verdict

## Overview

Reconcile all session outputs, retest confirmed defects after fixes or staging
changes, independently review coverage/evidence, and issue separate
visual-handover and functional-certification verdicts.

## Consolidation procedure

1. Merge results by test-case ID, role, route, viewport, state, PRD authority,
   severity, environment/build, and evidence path. Reject duplicate ownership
   or result cells without evidence.
2. Reconcile exactly 483 execution rows: 338 module cases, 23 Q cases, and 122
   module-specific HT cells. Classify every row on execution, delivery, and
   authority axes; do not infer pass from nearby screenshots or automated tests.
3. Triage failures: P0 privacy/data corruption; P1 blocked primary/financial
   workflow; P2 secondary UX/edge state; P3 polish. Separate product defect,
   data gap, environment blocker, and pending authority.
4. After any fix/deployment, repeat preflight for the new build and rerun the
   failed case plus adjacent role/route/viewports. Preserve red and green evidence.
5. Have a reviewer independently sample screenshots and exports, verify no
   credential/private data leakage, recalculate totals, and challenge the verdict.
6. Produce `reports/customer-handover-verdict.md` with separate visual-handover
   and functional-certification verdicts, coverage matrix, known gaps, customer
   decisions needed, demo script, avoidance notes, and evidence index.
7. Apply the recorded CLERK retain/disable decision only after all retests and
   evidence close; capture a sanitized audit assertion.

## Success Criteria

- [ ] Exactly 483 rows plus every route/role/viewport cell have a final classification.
- [ ] All P0/P1 defects are closed and re-proved, or the verdict is NO-GO.
- [ ] P2/P3 and pending-authority items have explicit customer impact and disposition.
- [ ] Evidence contains no credentials, secrets, or unredacted private data.
- [ ] Reviewer signs the evidence and verdict; author does not self-approve.
- [ ] Final report distinguishes current behavior, verified controls, product gaps, and unsigned proposals.
- [ ] Any conditional handover names its approver, scope, build fingerprint,
      expiry, and accepted exclusions; unconditional GO is impossible while
      critical functional coverage is blocked/not run or M1.7 is unaccepted.

## Risks

The most dangerous failure is a polished but unsupported GO claim. Missing
evidence, stale-build reruns, or unresolved authority must reduce the verdict.
