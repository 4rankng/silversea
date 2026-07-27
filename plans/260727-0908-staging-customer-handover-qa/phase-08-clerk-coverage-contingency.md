---
phase: 8
title: CLERK Coverage Contingency
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 8: CLERK Coverage Contingency

## Overview

Use the user-authorized dedicated CLERK staging account to inspect M10 rather
than substituting ADMIN behavior. Validate quick shipment capture, documents,
containers, readiness/handoff, and strict denial from money and office surfaces.

## Coverage

- `/`, unknown route, `/clerk/shipments/new`,
  `/clerk/shipments/:id/docs`, account/logout.
- M10.1-M10.3: mobile quick-create, validation, B/L/container/customs data,
  readiness, version conflict/retry, handoff notification and single acceptance.
- Negative routes: trips, config, finance, expenses, debt, salary, customer
  portal, driver and forwarder portals; no notification/API 403 noise on normal pages.

## Session procedure

1. Confirm the provisioned identity is exactly CLERK and has no accidental
   broader role; never store its credential in evidence.
2. Sweep at 390px, 320px, tablet, and desktop.
3. Exercise read-only existing fixtures and inspect validation states without
   submitting shipment or document changes.
4. Mark create/save/handoff persistence as execution `NOT_RUN` with reason
   `MUTATION_NOT_AUTHORIZED`.
5. Keep the account active through Sessions 09 and 10. Only after evidence and
   retests close may the controller apply the retain/disable decision and
   capture its sanitized audit result.

## Success Criteria

- [ ] CLERK has a clean role home and only the intended creation/docs surfaces.
- [ ] All forbidden routes deny before protected data renders.
- [ ] No background 403/5xx or unauthorized notification control appears.
- [ ] M10 mutation-dependent coverage and pending Q17 boundaries are not overstated.

## Risks

ADMIN is not an RBAC substitute. If the dedicated CLERK role cannot be
provisioned or scoped correctly, M10 remains `BLOCKED` and the verdict cannot be GO.
