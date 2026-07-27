# Customer portal repair

Status: complete for the customer portal scope

## Outcome

Restore the CUSTOMER experience so authenticated customers land in a lean portal,
see only their own shipments and debit notes, can confirm or dispute eligible debit
notes, and can download debit notes and their account statement.

## Acceptance criteria

- CUSTOMER `/`, `/dashboard`, unknown, and office routes resolve to `/portal/shipments`.
- Customer navigation exposes only shipments, debit notes, statement, and account actions.
- Portal API derives `customerId` from the authenticated user and returns 404 for foreign IDs.
- Debit notes expose lifecycle status; only `PENDING_CONFIRM` notes can be confirmed/disputed.
- Own debit notes support authenticated XLSX/PDF download.
- Statement page supports an optional date range and authenticated XLSX/PDF download.
- Honest loading, empty, error, and success states work at desktop and mobile widths without overflow.
- Affected frontend/backend gates and the focused customer-portal E2E suite are
  green with artifacts under `qa/`.

## Scope boundary

- In scope: CUSTOMER routing, portal shell, portal endpoints, debit-note actions/exports,
  statement surface, seed linkage, regression coverage.
- Out of scope: customer messaging, shipment document permission redesign, office dashboard redesign,
  unrelated product-wide E2E normalization already present in the worktree.

## Phases

1. [Complete](phase-01-portal-contract.md) — secure API contract and customer UI.
2. Complete — focused backend/frontend/E2E regression tests and fix loop.
3. Complete for the affected portal scope — lint, typechecks, full frontend and
   backend suites, build, authenticated browser QA, independent review, focused
   E2E, tenant-isolation, PDF, and concurrency checks are recorded under `qa/`.
   Unrelated product-wide E2E fixture/idempotency failures are preserved in their
   owning QA artifacts.
