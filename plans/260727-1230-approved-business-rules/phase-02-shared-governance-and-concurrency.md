---
phase: 2
title: Shared governance and concurrency
status: in-progress
priority: P1
dependencies:
  - 1
---

# Phase 2: Shared governance and concurrency

## Overview

Close reusable governance gaps underpinning Q15-Q23: maker/checker,
multi-customer scope, locked-data adjustments, business dates, source
authority, idempotency, optimistic concurrency, and audit visibility.

## Requirements

- Q15: enforce maker/checker for money, price, debt, exceptions, closes, and
  adjustments.
- Q16: preserve one-customer default and add explicit administrator-managed
  multi-customer links for group/agent accounts.
- Q17: prove CLERK unit + assigned customer/shipment scope and post-dispatch
  versioning boundary.
- Q18/Q22: use adjustment/reversal/version records after approval or lock.
- Q19/Q21: central business-calendar and period-lock authority with contract
  override.
- Q23: idempotency key, stale-version rejection, first-approve-wins, and audit
  of conflicts on every material write.

## Architecture

Prefer reusable policy/application services at write boundaries. Extend
`idempotency_keys`, audit history and row-scope patterns rather than adding
route-local flags. Multi-customer access must use an explicit join table and
deny by default.

## Related Code Files

- Modify: `backend/src/db/schema.ts` and generated Drizzle migration(s)
- Modify: `backend/src/services/idempotency.service.ts`
- Modify: `backend/src/lib/scoped-by-customer.ts`
- Modify: audit, period, business-calendar, approval and adjustment services
- Modify: Casbin policy and affected routes
- Modify: shared schemas and admin/customer-management UI
- Add/modify: focused backend/frontend/E2E tests

## Implementation Steps

1. Inventory material write endpoints and locked entities.
2. Add shared business-calendar/period and adjustment contracts.
3. Add multi-customer link model and admin management flow.
4. Enforce maker/checker and idempotent optimistic writes consistently.
5. Add cross-role, cross-customer, stale-write, double-submit and concurrent
   approval tests.

## Progress

- [x] Q16 explicit administrator-managed multi-customer links, backward-
  compatible authentication claims, deny-by-default portal scoping, deep-link
  persistence, and responsive admin/customer UI.
- [x] Q19 shared business-calendar authority, immutable obligation snapshots,
  exports, responsive configuration UI and independent GO review.
- [x] Q21 shared period-lock authority, salary close mirroring, locked debit-
  note overwrite protection, fuel late-data absorption guard, and fresh-
  database migration proof.
- [x] Q18 bounded append-only governance for trip AR adjustments, exceptional
  pre-posting reopen, immutable approved expenses, and settlement correction
  history; migration 0136 upgrade/fresh proofs and independent review are GO.
- [ ] Q22 source-authority catalog and dependent recompute/adjustment wiring.
  The typed, fail-closed catalog is implemented and independently green;
  issued debit notes can no longer be deleted after leaving DRAFT. Propagation,
  provenance, issued-document binding and linked corrections remain.
- [ ] Q15/Q17/Q23 maker-checker, locked-boundary, and material-write
  concurrency enforcement. Q23 now has a complete 204-endpoint inventory and
  independently green first-winner fixes for debt-offset and trip cancellation,
  including cancel-versus-stale-edit protection; penalty cancellation and the
  universal atomic replay/result model remain.

## Success Criteria

- [ ] Q15-Q23 shared invariants have reusable enforcement, not copy/paste.
- [x] CUSTOMER cannot cross linked-customer boundaries.
- [ ] Locked records cannot be overwritten in place.
- [ ] Replayed writes return the original result without duplicate effects.
- [ ] Conflicts and approval races are audited.
- [ ] RBAC/schema changes pass full gates including E2E.

## Risk Assessment

High blast radius. Use additive migrations, backward-compatible JWT handling,
transactional writes, and per-domain rollout behind existing routes.
