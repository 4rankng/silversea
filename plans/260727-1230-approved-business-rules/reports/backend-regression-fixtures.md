## Backend regression fixtures diagnosis

- Scope: `backend/src/tests/chiho-reconciliation.test.ts`, `backend/src/tests/comprehensive.test.ts`, `backend/src/tests/customer-portal-routes.test.ts`, `backend/src/tests/q03-payment-receipts-route.test.ts`
- Evidence source: `qa/2026-07-28_final-full_backend-test.log`, current route/service contracts in `backend/src/routes/trips.ts`, `backend/src/routes/portal/index.ts`, `backend/src/routes/financial/payments.routes.ts`, `backend/src/services/customer-receivable-authority.service.ts`, `backend/src/services/statement.service.ts`, `backend/src/services/trip-status-machine.service.ts`

### Confirmed root causes

1. `comprehensive.test.ts` was written before write-route idempotency became mandatory and before trip completion moved behind governance approval. The failing full-suite artifact already shows the first symptom: `400 Idempotency-Key là bắt buộc...` during the trip lifecycle flow.
2. `customer-portal-routes.test.ts` still expected pre-idempotency portal mutations and an empty statement for customers who only had debit-note obligations. Current portal confirm/dispute routes call `runIdempotent`, and current statement data computes outstanding obligations from issued debit notes even when ledger rows are empty.
3. `q03-payment-receipts-route.test.ts` still expected the old duplicate-active path without a header. Current `/api/payments/receive` rejects missing `Idempotency-Key` before duplicate detection.
4. `chiho-reconciliation.test.ts` still drove `IN_TRANSIT -> COMPLETED` directly through `transitionTripStatus`. Current status-machine rules require an approved governance close action before a trip can become `COMPLETED`.

### Implemented fixture updates

- Added idempotency headers to comprehensive write calls.
- Updated comprehensive completion flow to request/check/approve governed close before lock.
- Updated auth delete calls to include the required optimistic-concurrency header.
- Reworked the comprehensive customer-duplicate fixture to seed direct DB rows, because route-created customer payloads now enter governed create flows before the test can rely on returned entity ids.
- Updated comprehensive profit-distribution assertions to the current governed-request contract (`PROFIT_DISTRIBUTION`, `PENDING_CHECK`) and cleared prior pending requests for the same quarter inside the fixture.
- Updated portal statement expectation to assert debit-note outstanding with empty ledger rows.
- Updated the portal non-pending confirm case to send an idempotency key so it reaches the intended status guard instead of the header guard.
- Updated portal confirm/dispute no-header cases to assert mandatory-header rejection and no state change.
- Updated Q03 no-header case to assert mandatory-header rejection.
- Updated chiho helpers to close trips through governed approval before optional lock.
- Hardened `chiho-reconciliation.test.ts` teardown to:
  - delete GPS/governance side-effect rows (`trip_gps_capture_jobs`, `trip_gps_tracks`, `route_polylines`, `trip_photos`, `notifications`, audit rows) before deleting trips/users;
  - always run `disconnectRedis()` and `client.end()` in `finally`;
  - emit teardown diagnostics instead of hanging silently on a cleanup FK failure.

### Verification status

- Static checks:
  - `qa/2026-07-28_backend-regression-fixtures_diff-check.log` — green
  - `qa/2026-07-28_backend-regression-fixtures_backend-typecheck.log` — green
- Focused DB-backed reruns:
  - `qa/2026-07-28_backend-regression-fixtures_comprehensive-backend-test.log` — red (initial drift evidence)
  - `qa/2026-07-28_backend-regression-fixtures_comprehensive-backend-test-rerun.log` — red (remaining header/version/governed-request drift)
  - `qa/2026-07-28_backend-regression-fixtures_comprehensive-backend-test-rerun-2.log` — green
  - `qa/2026-07-28_backend-regression-fixtures_customer-portal-backend-test.log` — red (non-pending confirm still missing idempotency header)
  - `qa/2026-07-28_backend-regression-fixtures_customer-portal-backend-test-rerun.log` — green
  - `qa/2026-07-28_backend-regression-fixtures_q03-payment-receipts-backend-test.log` — green
  - `qa/2026-07-28_backend-regression-fixtures_chiho-reconciliation-backend-test.log` — red at process level after assertions passed; teardown was not failure-safe
  - `qa/2026-07-28_backend-regression-fixtures_chiho-reconciliation-backend-test-rerun.log` — green with natural exit

### Final outcome

- All four owned focused suites are green on current production contracts:
  - `src/tests/comprehensive.test.ts`
  - `src/tests/customer-portal-routes.test.ts`
  - `src/tests/q03-payment-receipts-route.test.ts`
  - `src/tests/chiho-reconciliation.test.ts`
- No production files were edited for this subtask.
