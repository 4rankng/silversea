## Phase Implementation Report

### Executed Phase
- Phase: durable-effect-integration
- Plan: plans/260727-1230-approved-business-rules
- Status: completed

### Files Modified
- `backend/src/routes/upload.ts`
- `backend/src/routes/ocr.ts`
- `backend/src/routes/forwarder.ts`
- `backend/src/routes/expense.ts`
- `backend/src/routes/driver.ts`
- `backend/src/routes/config.ts`
- `backend/src/services/idempotency.service.ts`
- `backend/src/services/governance-transition.service.ts`
- `backend/src/services/app-settings.service.ts`
- `backend/src/services/price-config-governance.service.ts`
- `backend/src/services/storage.service.ts`
- `backend/src/services/durable-effect.service.ts`
- `backend/src/tests/q23-upload-idempotency.test.ts`
- `backend/src/tests/q23-field-operations-idempotency.test.ts`
- `backend/src/tests/q15-price-config-governance.test.ts`
- `backend/src/tests/storage-service-path-guard.test.ts`

### Tasks Completed
- [x] Replaced governed post-commit callbacks with transactional durable-effect enqueue on governed approvals and singleton config flows.
- [x] Moved trip-photo, OCR, expense-photo, forwarder-photo, and driver-photo cleanup paths onto durable storage-delete jobs.
- [x] Added guard replay handling so exact same-key replays wait for committed idempotency rows instead of surfacing active-lease `409`.
- [x] Bound orphan-guard dedupe identity to immutable `storageKey` so same request key can safely leak separate `.png` and `.jpg` objects before worker cleanup.
- [x] Hardened local storage path resolution against traversal/escape keys.
- [x] Added focused regression coverage for replay-after-worker-cleanup, immutable storage-key dedupe, forwarder durable cleanup/final delete, governance durable cache invalidation, and storage traversal rejection.

### Tests Status
- Type check: pass
  - `qa/2026-07-28_durable-effect-integration_backend-typecheck.log`
- Unit tests: pass
  - `qa/2026-07-28_durable-effect-integration_storage-service-path-guard_backend-test.log`
  - `qa/2026-07-28_durable-effect-integration_q23-upload-idempotency_backend-test.log`
  - `qa/2026-07-28_durable-effect-integration_q23-field-operations-idempotency_backend-test.log`
  - `qa/2026-07-28_durable-effect-integration_q15-price-config-governance_backend-test.log`
- Integration tests: not run

### Issues Encountered
- Exact upload replay briefly regressed to `409` because orphan-guard acquisition happened before the idempotency replay path; fixed by waiting for the committing idempotency row on active-lease conflicts.
- Foundation-owned files `backend/src/services/durable-effect.service.ts` and `backend/src/services/storage.service.ts` were patched under root approval to close audit blockers 5 and 6.
- Full backend suite, lint, build, and e2e were not run in this subtask; focused backend QA only.

### Next Steps
- Root can fold these focused artifacts into the final closure review and decide whether to run broader repo QA (`backend pnpm test`, root lint/build, e2e) before merge.
