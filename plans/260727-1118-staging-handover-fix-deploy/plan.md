---
title: Staging Handover Fix and Deploy
description: >-
  Fix confirmed customer-handover defects, close affected QA gates, deploy the
  current working tree to staging, and rerun authenticated visual regressions.
status: completed
priority: P1
branch: main
tags:
  - fix
  - qa
  - deployment
  - staging
blockedBy: []
blocks: []
created: '2026-07-27T03:18:00.000Z'
createdBy: Codex
source: user
---

# Staging Handover Fix and Deploy

## Goal

Fix every confirmed customer-handover defect, verify the affected contracts
locally and in authenticated browsers, deploy with `make demo`, then rerun the
failed and adjacent staging cases.

## Scope

1. Customer portal statement API.
2. Customer logout and mobile account interaction.
3. Manager read access to operational app settings.
4. M01-1.7 two-way dispatch when the accepted data model can prove the rule.
5. Full affected QA gates, deployment health, and post-deploy role/viewport
   regression.

## Non-goals

- No unrelated cleanup or redesign.
- No invention of business rules that lack authoritative fields or decisions.
- No claim that simulated camera, GPS, or offline checks equal real-device
  acceptance.

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 | [Diagnose and Implement](./phase-01-diagnose-and-implement.md) | Completed |
| 2 | [Verify and Review](./phase-02-verify-and-review.md) | Completed |
| 3 | [Deploy and Staging Retest](./phase-03-deploy-and-staging-retest.md) | Completed |

## Acceptance criteria

- Original four defect groups have exact root-cause evidence.
- Regression tests cover every implemented fix.
- Required lint, typecheck, unit, build, and E2E gates are green with artifacts
  under `qa/`.
- Independent review finds no unresolved blocking defect in the changed scope.
- `make demo` succeeds, `/api/health` is healthy, and affected authenticated
  desktop/tablet/mobile staging flows pass.
- Remaining untestable or authority-blocked cases are reported explicitly.

## Outcome

- Fixed and deployed every confirmed CUSTOMER and MANAGER runtime regression.
- Added durable CUSTOMER account linkage with stale-claim and concurrency
  protection, then linked the staging handover account to a controlled demo
  customer.
- Local gates, independent review, deployment health, and responsive staging
  retests are green.
- M01-1.7 remains authority-blocked: the accepted model has neither canonical
  schedule timestamps nor authoritative vehicle-capacity/cargo-weight fields,
  so overlap, order, and capacity rules cannot be implemented honestly.
