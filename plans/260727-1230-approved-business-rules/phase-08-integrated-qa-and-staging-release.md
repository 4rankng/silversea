---
phase: 8
title: "Integrated QA and staging release"
status: pending
priority: P1
dependencies: [3, 4, 5, 6, 7]
---

# Phase 8: Integrated QA and staging release

## Overview

Close the loop with full automated, authenticated-browser, role/RBAC,
responsive and staging verification, then deploy using `make demo`.

## Related Code Files

- Modify: `docs/regression-testing/` coverage/dependency statuses
- Modify: `e2e/` cross-role stateful journeys
- Create: `qa/2026-*_approved-business-rules_*` artifacts
- Modify: `HANDOFF.md`, roadmap and plan status

## Implementation Steps

1. Run focused tests after each phase, then the full mandatory gates.
2. Execute stateful journeys across ADMIN, MANAGER, ACCOUNTANT, DRIVER,
   FORWARDER, CLERK and CUSTOMER with real postconditions.
3. Visually verify affected pages at desktop, tablet and 375px mobile widths.
4. Use simulated GPS on staging as approved; use a safe test mailbox for email
   acceptance evidence.
5. Run independent code review and fix every blocker.
6. Run `make demo`, verify web/API health and containers, then rerun critical
   browser journeys on staging.
7. Update PRD/regression/roadmap/handoff with evidence, not claims.

## Success Criteria

- [ ] Root lint, both typechecks, backend/frontend tests, build and E2E green.
- [ ] Coverage matrix has no unproved Q01-Q23/O01/O02 case.
- [ ] No horizontal overflow; touch targets and wrapping are usable.
- [ ] Staging health and cross-role critical journeys pass after deployment.
- [ ] Independent review verdict is GO and all QA artifacts are under `qa/`.

## Risk Assessment

Staging may contain mutable shared data. Use prefixed reversible fixtures,
avoid credentials in artifacts, and clean up only fixtures created by this
plan.
