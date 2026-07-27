## Phase Implementation Report

### Executed Phase
- Phase: q03-payment-allocation
- Plan: plans/260727-1230-approved-business-rules
- Status: completed

### Files Modified
- shared/src/schemas/index.ts (+118/-10)
- shared/src/types/index.ts (+43/-1)
- shared/src/index.ts (+30/-3)
- backend/src/db/schema.ts (+349/-0)
- backend/drizzle/0138_careful_shape.sql (28 lines, new)
- backend/drizzle/meta/0138_snapshot.json (13056 lines, new)
- backend/drizzle/meta/_journal.json (+56/-0)
- backend/src/services/idempotency.service.ts (+37/-51)
- backend/src/services/shipment.service.ts (+43/-9)
- backend/src/services/driver.service.ts (+59/-30)
- backend/src/services/payment-allocation.service.ts (+422/-149)
- backend/src/services/financial.service.ts (+23/-89)
- backend/src/routes/financial/payments.routes.ts (+71/-15)
- backend/src/services/statement.service.ts (+108/-5)
- backend/src/tests/m56-payment-allocation.test.ts (+367/-184)
- backend/src/tests/q03-payment-receipts-route.test.ts (312 lines, new)
- backend/src/tests/shipment-quick-create.test.ts (+93/-0)
- backend/src/tests/m84-driver-progress.test.ts (+95/-8)
- backend/src/tests/m84-incidental-cost.test.ts (+1/-1)
- frontend/src/pages/DebtDetailPage.tsx (+46/-31)
- frontend/src/pages/DebtDetailPage.payment.test.tsx (251 lines, new)

### Tasks Completed
- [x] Added shared request/response payment receipt contracts, including amount-only validation and explicit allocation validation.
- [x] Added `payment_receipts` schema, migration `0138_careful_shape`, and `payment_allocations` receipt/order persistence fields plus allocation authority snapshots (`original_due_date_snapshot`, `processing_due_date_snapshot`, `issue_timestamp_snapshot`).
- [x] Reworked backend receipt allocation flow for canonical payload hashing, transaction-aware request idempotency, legacy ambiguous receipt rejection, customer locking, active-customer validation, authoritative outstanding calculation (`TRIP_REVENUE` + `ADJUSTMENT` + `UNLOCK_REVERSAL` - `PAYMENT_RECEIVED`), ordered allocation persistence, unapplied credit persistence, and replay from persisted receipt/allocation state only.
- [x] Updated `/api/payments/receive` to use receipt-aware idempotent creation, replay semantics, audit entity tagging, cache invalidation, and single-fire notifications.
- [x] Updated statement ordering and payment allocation fallback ordering to use `processingDueDate ?? originalDueDate ?? issue date`, while preserving explicit caller allocation order.
- [x] Updated `DebtDetailPage` to submit amount-only receipts with semantic retry-key rotation for both manual edits and agent prefill, allow overpayment, and surface allocated/unapplied results.
- [x] Expanded backend and route tests for authoritative balance adjustments/reversals, exact replay equality, no-header replay, different-key same-receipt races, same-customer different-receipt races, rollback atomicity, pool-sized idempotent concurrency, customer lifecycle rejection, and allocation snapshot postconditions.
- [x] Verified `backend/drizzle/meta/0138_snapshot.json` contains the three new allocation snapshot fields.
- [x] Saved focused `.review-fix` QA artifacts under `qa/`.
- [x] Tightened shared `runIdempotent` so keyed and non-keyed callers always receive one transaction/connection, then moved shipment quick-create plus both driver idempotent writers onto that contract.
- [x] Bounded default oldest-due allocation to 200 posted trips per receipt and replaced per-allocation `LedgerService.postEntry` calls with one customer-ledger batch insert using a single starting balance read.
- [x] Added audit proof for keyed payment receipt success/replay/conflict and fixed focused route teardown so repeated runs do not leak the test admin user.
- [x] Added shipment quick-create and driver-progress pool-sized concurrency regressions plus shipment/driver rollback assertions, and fixed driver-test teardown ordering for idempotency-key cleanup.

### Tests Status
- Backend typecheck: pass
  - `qa/2026-07-27_q03-payment-allocation.review-fix_backend-typecheck.log`
- Frontend typecheck: pass
  - `qa/2026-07-27_q03-payment-allocation.review-fix_frontend-typecheck.log`
- Target lint: pass
  - `qa/2026-07-27_q03-payment-allocation.review-fix_lint.log`
- Focused backend tests: pass
  - `qa/2026-07-27_q03-payment-allocation.review-fix_backend-tests.log`
- Focused frontend tests: pass
  - `qa/2026-07-27_q03-payment-allocation.review-fix_frontend-tests.log`
- Migration proof:
  - `qa/2026-07-27_q03-payment-allocation.review-fix_migration-upgrade.log` pass for isolated `0137_salty_black_crow -> 0138_careful_shape`, including legacy-row preservation and named FK/check/index verification
  - `qa/2026-07-27_q03-payment-allocation.review-fix_migration-fresh.log` still fails before Q03 at historical `0079_smiling_gorilla_man.sql` `render_data` collision
- Second-pass focused backend proof: pass
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_backend-typecheck.log`
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_m56-backend-test.log`
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_q03-route-test.log`
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_shipment-quick-create-test.log`
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_m84-driver-progress-test.log`
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_m84-incidental-cost-test.log`
  - `qa/2026-07-27_q03-payment-allocation.review-fix-2_diff-check.log`

### Issues Encountered
- Full fresh migration replay is already broken before Q03: `billing_document_lines.render_data` collision in `0079_smiling_gorilla_man.sql`.
- Q17 concurrently edited `backend/src/db/schema.ts` and `backend/drizzle/0138_careful_shape.sql`; Q03 changes were kept scoped to the payment-allocation sections and left the combined file content intact.
- Broad build/full-suite/E2E/deploy gates were intentionally not rerun in this second pass because the controller limited scope to the re-review blockers and focused proof only.

### Next Steps
- Keep the fresh migration replay failure tracked as a pre-existing migration-chain blocker outside Q03.
- If shared schema/migration files move again before merge, rerun the focused Q03 backend test artifact and the isolated `0137 -> 0138` upgrade proof against the merged content.
- Controller can hand the fresh focused proof back to independent review; no open Q03 blocker remains in the scoped second-pass ownership set.
