## Phase Implementation Report

### Executed Phase
- Phase: q03-payment-allocation
- Plan: plans/260727-1230-approved-business-rules
- Status: partial

### Files Modified
- shared/src/schemas/index.ts (+118/-10)
- shared/src/types/index.ts (+43/-1)
- shared/src/index.ts (+30/-3)
- backend/src/db/schema.ts (+349/-0)
- backend/drizzle/0138_careful_shape.sql (28 lines, new)
- backend/drizzle/meta/0138_snapshot.json (13056 lines, new)
- backend/drizzle/meta/_journal.json (+56/-0)
- backend/src/services/idempotency.service.ts (+37/-51)
- backend/src/services/payment-allocation.service.ts (+422/-149)
- backend/src/services/financial.service.ts (+23/-89)
- backend/src/routes/financial/payments.routes.ts (+71/-15)
- backend/src/services/statement.service.ts (+108/-5)
- backend/src/tests/m56-payment-allocation.test.ts (+367/-184)
- backend/src/tests/q03-payment-receipts-route.test.ts (312 lines, new)
- frontend/src/pages/DebtDetailPage.tsx (+46/-31)
- frontend/src/pages/DebtDetailPage.payment.test.tsx (251 lines, new)

### Tasks Completed
- [x] Added shared request/response payment receipt contracts, including amount-only validation and explicit allocation validation.
- [x] Added `payment_receipts` schema, migration `0138_careful_shape`, and `payment_allocations` receipt/order persistence fields.
- [x] Reworked backend receipt allocation flow for canonical payload hashing, receipt replay/conflict handling, legacy ambiguous receipt rejection, customer locking, ordered allocation persistence, unapplied credit persistence, and layered request idempotency.
- [x] Updated `/api/payments/receive` to use receipt-aware idempotent creation, replay semantics, audit entity tagging, cache invalidation, and single-fire notifications.
- [x] Updated statement ordering for amount-only allocation to sort by persisted `processingDueDate`, then issue timestamp, then trip id.
- [x] Updated `DebtDetailPage` to submit amount-only receipts with stable retry keys, allow overpayment, and surface allocated/unapplied results.
- [x] Added focused backend and frontend tests for ordering, explicit instructions, over-outstanding rejection, receipt replay/conflict, request-key replay/conflict, concurrent first submit, legacy ambiguous receipts, and UI request/retry behavior.
- [x] Saved focused QA artifacts under `qa/`.

### Tests Status
- Type check: fail outside Q03 scope
  - `qa/2026-07-27_q03-payment-allocation_backend-typecheck.log`
  - `qa/2026-07-27_q03-payment-allocation_frontend-typecheck.log`
- Unit tests: pass
  - `qa/2026-07-27_q03-payment-allocation_backend-tests.log`
  - `qa/2026-07-27_q03-payment-allocation_frontend-focused-test.log`
- Shared build: pass
  - `qa/2026-07-27_q03-payment-allocation_shared-build.log`
- Lint: pass with pre-existing warnings
  - `qa/2026-07-27_q03-payment-allocation_lint.log`
- Build: pass
  - `qa/2026-07-27_q03-payment-allocation_build.log`
- Migration proof:
  - `qa/2026-07-27_q03-payment-allocation_migration-upgrade.log` pass for isolated 0137->0138 replay on clone
  - `qa/2026-07-27_q03-payment-allocation_migration-fresh.log` fail before 0138 on historical migration-chain collision at `0079_smiling_gorilla_man.sql`

### Issues Encountered
- Backend typecheck is red in concurrent/non-Q03 files: `backend/src/routes/shipments.ts`, `backend/src/services/shipment.service.ts`.
- Frontend typecheck is red in concurrent/non-Q03 files: `frontend/src/pages/clerk/ClerkShipmentDocsPage.tsx`.
- Full fresh migration replay is already broken before Q03: `billing_document_lines.render_data` collision in `0079_smiling_gorilla_man.sql`.
- Local `silversea` source DB had two idle `postgres.js` sessions that blocked `template silversea`; the isolated upgrade probe terminated only those idle sessions to create the clone and verify 0138.

### Next Steps
- Wait for concurrent Q17/shared baseline typecheck fixes, then rerun backend/frontend typecheck artifacts against the same Q03 code.
- Keep the fresh migration replay failure tracked as a pre-existing migration-chain blocker; Q03 only adds the green isolated 0137->0138 upgrade proof.
- If controller wants final closeout, rerun the focused Q03 backend/frontend tests after any shared-file merges touching payments, statements, or shared types.
