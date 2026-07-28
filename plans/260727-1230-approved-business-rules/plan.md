---
title: SilverSea approved TingTing business rules Q01-Q23
description: >-
  Dependency-safe implementation and proof plan for Q01-Q23 plus O01/O02 after
  SilverSea accepted every TingTing proposal on 2026-07-27.
status: completed
priority: P1
branch: main
tags:
  - silversea
  - business-rules
  - prd
  - financial-controls
  - rbac
  - staging
blockedBy: []
blocks: []
created: '2026-07-27T04:29:52.448Z'
createdBy: 'ck:plan'
source: skill
---

# SilverSea approved TingTing business rules Q01-Q23

## Overview

SilverSea approved every `TingTing đề xuất` in
`docs/prd/business-logic-qa-proposals.md` on 2026-07-27. This plan converts
Q01-Q23, O01 two-way dispatch, and O02 ACCOUNTANT audit visibility from
proposals into verified product behavior.

The implementation is a re-baseline, not a rewrite. Current services and tests
already cover meaningful slices of credit limits, reminders, supplier types,
fuel/AP reconciliation, debt offsets, salary close, no-invoice controls,
CLERK workflows, optimistic locking, audit logs, and idempotency. Phase 1
classifies each rule as proved, partial, or missing; later phases close only
the remaining gaps.

## Delivery contract

- **Expected output:** accepted PRD authority records; configuration-driven
  Q01-Q23/O01/O02 behavior across backend, shared contracts and frontend;
  migrations where required; automated and authenticated-browser evidence;
  deployment to staging with a customer-handover matrix.
- **Acceptance criteria:** every rule has at least one normal, invalid,
  exception/concurrency, and RBAC proof where applicable; financial totals
  remain exact; post-lock changes are append-only adjustments; double-submit
  cannot duplicate effects; responsive role workflows pass at desktop,
  tablet, and mobile widths.
- **Scope boundary:** no unrelated redesign, no historical-data import, no
  production deployment, and no fabricated customer master data. Staging may
  use simulated GPS as explicitly approved.
- **Constraints:** Drizzle only; Vietnamese product copy; thresholds and
  schedules configuration-driven; preserve existing public contracts unless
  versioned deliberately; preserve user-owned worktree changes; save every QA
  run under `qa/`.
- **Touchpoints:** `docs/prd/`, `ROADMAP.md`, shared schemas/navigation,
  Drizzle schema/migrations, financial and attendance services/routes,
  scheduler/email/notifications, Casbin and row-scope helpers, affected React
  pages/API clients, E2E suites, regression matrix, and staging release gates.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Authority and coverage baseline](./phase-01-authority-and-coverage-baseline.md) | Completed |
| 2 | [Shared governance and concurrency](./phase-02-shared-governance-and-concurrency.md) | Completed |
| 3 | [AR credit and reminders](./phase-03-ar-credit-and-reminders.md) | Completed |
| 4 | [AP fuel suppliers and offsets](./phase-04-ap-fuel-suppliers-and-offsets.md) | Completed |
| 5 | [Payroll attendance and close](./phase-05-payroll-attendance-and-close.md) | Completed |
| 6 | [No-invoice disbursements](./phase-06-no-invoice-disbursements.md) | Completed |
| 7 | [Two-way dispatch and audit access](./phase-07-two-way-dispatch-and-audit-access.md) | Completed |
| 8 | [Integrated QA and staging release](./phase-08-integrated-qa-and-staging-release.md) | Completed |

## Dependencies

- Executes the accepted cross-cutting decisions referenced by
  `plans/silversea-prd-roadmap/`; it does not replace that broader 12-module
  roadmap.
- Reuses evidence and unresolved coverage from
  `plans/260727-0908-staging-customer-handover-qa/`.
- Phases 3-7 depend on the authority/coverage baseline. Financial-domain
  phases depend on shared governance where they use common configuration,
  period locks, adjustment records, or idempotency.
- Phase 8 depends on all implementation phases and is the only staging release
  gate.

## Completion rule

The plan is complete only when the Q01-Q23/O01/O02 matrix contains no
`AUTHORITY_PENDING`, `NOT_RUN`, or unproved acceptance rows; all affected
quality gates are green; an independent code review is GO; and the deployed
staging build is verified across all affected roles and responsive widths.

## Completion evidence

Completed on 2026-07-29 against clean commit `8c0f09f`.

- Independent source review: PASS, no P0/P1 findings
  (`qa/2026-07-28_release-candidate-final-rereview.md`).
- Automated gates: lint, backend/frontend typecheck, 1,843 backend tests,
  416 frontend tests, build, and 249/0/3-skip E2E all green.
- Staging visual matrix: 17 sections, 180 applicable checks passed, 0 failed;
  the only pause is the explicitly optional debt-detail PDF export.
- Real logout verification: ADMIN, MANAGER, ACCOUNTANT, DRIVER, FORWARDER,
  CUSTOMER, and CLERK passed at 1440×900 and 390×844, including token clearing
  and protected-route re-entry prevention.
- Staging deployment: clean image tag `8c0f09f`; frontend and API healthy,
  containers running with zero restarts, and no critical log patterns.
