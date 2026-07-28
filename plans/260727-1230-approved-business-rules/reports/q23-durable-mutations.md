# Q23 Durable Mutations

## Status

Reopened for final review findings and re-audited on 2026-07-28. The five owned review items assigned back to Q23 are implemented in code and now have fresh non-DB and DB-backed verification:

- backend typecheck: pass
- focused static tests for registry coverage and expense cache invalidation: pass
- focused DB-backed rollback/replay proofs: pass

## Scope handled in this reopen

- Added the missing forwarder material-write declarations so every actual forwarder `runIdempotent()` mutation is fail-closed at the registry boundary:
  - `POST /api/forwarder/me/trips/:tripId/containers`
  - `POST /api/forwarder/me/expenses`
  - `PATCH /api/forwarder/me/expenses/:id`
  - `DELETE /api/forwarder/me/expenses/:id`
  - `POST /api/forwarder/me/advance-requests`
  - `POST /api/forwarder/me/advance-settlements`
- Hardened actor binding in `runIdempotent()` so legacy idempotency rows with nullable `createdBy` fail closed instead of replaying across actors.
- Added durable `STORAGE_CLEANUP_PENDING` audit persistence for rollback cleanup failures in owned upload/OCR/company-expense/forwarder-photo routes, without adding any new table or migration.
- Corrected 201-response material-write audit status capture for trip-photo, company-logo, and company-expense photo creation routes so the durable audit row matches the actual HTTP response.
- Restored expense report cache invalidation coverage on company-expense create/update/delete while preserving the static regression test’s exact invalidation-call contract.
- Fixed the transaction-local audit test seam so overridden audit-persist handlers are honored for durable material-write inserts without reintroducing the default enrichment race.
- Rehydrated audit request context around multipart material-write handlers (`upload`, `ocr`, company-expense photo, forwarder expense-photo) so atomic audit insertion, rollback cleanup, and fail-closed behavior execute on the intended transaction path.
- Added/updated owned tests for forwarder registry coverage, null-owner replay rejection, cleanup-pending visibility, and 201-status durable audit assertions.

## Reopened item audit

### 1. Forwarder material registry coverage

Status: implemented in code, statically verified and DB-backed rollback proof green

- `backend/src/middleware/material-write.ts` now declares the missing forwarder `runIdempotent()` material routes for:
  - container create
  - expense create / update / delete
  - advance-request create
  - advance-settlement create
- `backend/src/tests/q23-forwarder-material-write-registry.test.ts` enumerates the mounted forwarder material routes and passed in the focused rerun.
- `backend/src/tests/q23-forwarder-durable-material-routes.test.ts` passed and proved audit-insert failure rolls back both business effect and idempotency row for each newly declared route.

### 2. Durable cleanup failure visibility

Status: implemented in code, DB-backed assertions green

- `backend/src/routes/upload.ts`, `backend/src/routes/ocr.ts`, `backend/src/routes/expense.ts`, and `backend/src/routes/forwarder.ts` now persist a durable `STORAGE_CLEANUP_PENDING` audit record when rollback storage deletion fails instead of only logging the error.
- The implementation uses owned audit/idempotency surfaces only; no new table or migration was introduced.
- `backend/src/tests/q23-upload-idempotency.test.ts` passed and proves a failed trip-photo rollback cleanup remains durably discoverable through `STORAGE_CLEANUP_PENDING`.
- `backend/src/tests/q23-field-operations-idempotency.test.ts` passed and confirms the forwarder expense-photo path cleans uploaded storage on rollback without emitting a false cleanup-pending audit when deletion succeeds.

### 3. Nullable-actor replay prevention

Status: implemented in code, DB-backed assertion green

- `backend/src/services/idempotency.service.ts` now rejects replay unless `existing.createdBy === createdBy`, including the legacy null-owner mismatch case.
- `backend/src/tests/q23-durable-command-boundary.test.ts` passed and rejects replay of legacy null-owner keys for authenticated material writes.

### 4. Upload route success status consistency

Status: implemented in code, DB-backed assertions green

- `backend/src/routes/upload.ts` and `backend/src/routes/expense.ts` now pass `responseStatusCode: 201` into `runIdempotent()` for the affected create routes and return `outcome.statusCode` from the route.
- `backend/src/tests/q23-upload-idempotency.test.ts` now asserts that the persisted idempotency row and durable audit payload record `201` for first execution and replay of trip-photo and company-logo uploads.

### 5. Expense cache invalidation

Status: implemented in code, statically verified

- `backend/src/routes/expense.ts` now invalidates financial report caches on create, update, and delete through dedicated helpers that preserve the route file’s exact static invalidation-call contract.
- `backend/src/tests/agent-latency-regressions.test.ts` passed in the focused rerun and confirmed the expected three `await invalidateReportCaches()` call sites remain present.

## Owned files changed in this reopen

- `backend/src/services/audit-types.ts`
- `backend/src/services/audit-templates.ts`
- `backend/src/services/audit.service.ts`
- `backend/src/middleware/material-write.ts`
- `backend/src/services/idempotency.service.ts`
- `backend/src/routes/expense.ts`
- `backend/src/routes/upload.ts`
- `backend/src/routes/ocr.ts`
- `backend/src/routes/forwarder.ts`
- `backend/src/tests/q23-upload-idempotency.test.ts`
- `backend/src/tests/q23-durable-command-boundary.test.ts`
- `backend/src/tests/q23-field-operations-idempotency.test.ts`
- `backend/src/tests/q23-forwarder-material-write-registry.test.ts`
- `backend/src/tests/q23-forwarder-durable-material-routes.test.ts`

## QA artifacts from this reopen

- `qa/2026-07-28_q23-durable-mutations-reopen_backend-typecheck.log`
- `qa/2026-07-28_q23-durable-mutations-audit_backend-typecheck.log`
- `qa/2026-07-28_q23-durable-mutations-audit_backend-static-tests.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-durable-command-boundary.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-durable-command-boundary-rerun.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-upload-idempotency.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-upload-idempotency-rerun.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-field-operations-idempotency.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-field-operations-idempotency-rerun.log`
- `qa/2026-07-28_q23-durable-mutations-db_q23-forwarder-durable-material-routes.log`
- `qa/2026-07-28_q23-durable-mutations-db_backend-typecheck-rerun.log`
- `qa/2026-07-28_q23-durable-mutations-db_backend-typecheck-final.log`

Results:

- Backend typecheck: pass
- Focused backend static tests: pass
  - `q23-forwarder-material-write-registry.test.ts`
  - `agent-latency-regressions.test.ts`
- DB-backed tests: pass
  - `q23-durable-command-boundary.test.ts`
  - `q23-upload-idempotency.test.ts`
  - `q23-field-operations-idempotency.test.ts`
  - `q23-forwarder-durable-material-routes.test.ts`
- Red-to-green root-cause fixes captured in artifacts:
  - `q23-durable-command-boundary`: transaction-local material-write audit had to honor the overridden test persistence hook
  - `q23-upload-idempotency`: multipart material-write handlers needed explicit audit-context rehydration so atomic audit/rollback executed before post-response audit
  - `q23-field-operations-idempotency`: forwarder cleanup assertion was corrected to the real contract, with hook cleanup guarded in `finally`

## DB-lane status

- No DB-backed test is currently running from this lane.
- Serialized DB sequence completed green:
  - `q23-durable-command-boundary.test.ts`
  - `q23-upload-idempotency.test.ts`
  - `q23-field-operations-idempotency.test.ts`
  - `q23-forwarder-durable-material-routes.test.ts`

## External / non-owned follow-up

- Credit override N+1 remains outside owned scope in `backend/src/services/credit-limit.service.ts`. I did not patch it here.
- The broader reviewer finding about a true durable cleanup/outbox mechanism remains a product/architecture decision beyond the narrowed reopened Q23 assignment in this lane. The owned reopen scope implemented durable cleanup-failure visibility and tested discoverability on the existing audit/idempotency surfaces.
