## Phase Implementation Report

### Executed Phase
- Phase: q23-direct-money-idempotency
- Plan: `/Users/dev/Documents/projects/silversea/plans/260727-1230-approved-business-rules`
- Status: completed

### Files Modified
- `backend/src/routes/financial/payments.routes.ts`
- `backend/src/routes/financial/penalties.routes.ts`
- `backend/src/services/financial.service.ts`
- `backend/src/services/idempotency.service.ts`
- `backend/src/tests/q23-direct-money-idempotency.test.ts`

### Tasks Completed
- [x] Restored unkeyed `POST /api/payments/vendor` and `POST /api/payments/carrier` compatibility to HTTP 200 while keeping keyed create responses explicit and keyed replays at HTTP 200.
- [x] Replaced duplicate route-local idempotency-key helpers with one shared parser that trims input, prefers the header over `_requestId`, rejects keys longer than 100 characters, and returns HTTP 400 before any write.
- [x] Made penalty-create replay immutable across later cancellation by reconstructing the original create response from persisted immutable penalty fields instead of replaying the mutable canceled row.
- [x] Removed duplicate audit middleware mounting from the focused test harness so penalty cancel traverses one audit layer in isolation tests.
- [x] Extended the focused direct-money suite without increasing test count: all 9 tests now also prove unkeyed compatibility for the owned endpoints, long-key rejection before writes, and penalty-create replay stability after cancellation.
- [x] Preserved existing atomicity, replay side-effect suppression, vendor-lock overpay serialization, and penalty-cancel first-winner behavior.
- [x] Captured fresh focused-test, backend typecheck, and lint artifacts under `qa/`.

### Tests Status
- Type check: pass
  - Artifact: `qa/2026-07-27_q23-direct-money_backend-typecheck.log`
  - Exit: `0`
- Unit/integration tests: pass
  - Artifact: `qa/2026-07-27_q23-direct-money_focused-test.log`
  - Result: `9/9` passing
  - Exit: `0`
- Lint: pass
  - Artifact: `qa/2026-07-27_q23-direct-money_lint.log`
  - Exit: `0`
  - Notes: 21 pre-existing repository warnings, 0 errors

### Issues Encountered
- The first artifact-writing attempt used a relative `qa/` path after `cd backend`, so the shell wrapper failed before saving the new logs. No source rollback was needed; the final artifact rerun used absolute paths and completed cleanly.
- The focused suite briefly logged a cleanup warning after the new unkeyed penalty coverage added extra notification rows. Cleanup was tightened in the owned test file and the final rerun completed without warnings.

### Next Steps
- Q23 direct-money blocker set is closed from this tranche’s side.
- If the controller wants a broader regression pass later, it should happen in the owning broader-work tranche, not by reopening this focused direct-money scope.
