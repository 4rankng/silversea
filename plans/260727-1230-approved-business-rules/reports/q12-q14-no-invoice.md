## Phase Implementation Report

### Executed Phase
- Phase: `phase-06-no-invoice-disbursements`
- Plan: `plans/260727-1230-approved-business-rules`
- Status: `completed`

### Files Modified
- `shared/src/constants/index.ts`
- `shared/src/index.ts`
- `shared/src/schemas/index.ts`
- `shared/src/types/index.ts`
- `backend/src/db/schema.ts`
- `backend/src/routes/config.ts`
- `backend/src/routes/forwarder.ts`
- `backend/src/routes/trips.ts`
- `backend/src/seed.ts`
- `backend/src/services/approval.service.ts`
- `backend/src/services/forwarder-trip-query.service.ts`
- `backend/src/services/forwarder.service.ts`
- `backend/src/services/no-invoice-disbursement.service.ts`
- `backend/src/tests/m47-no-invoice-disbursement.test.ts`
- `frontend/src/api/forwarderClient.ts`
- `frontend/src/api/tripClient.ts`
- `frontend/src/hooks/useForwarderQueries.ts`
- `frontend/src/pages/ForwarderTripDetailPage.tsx`
- `frontend/src/pages/config/ForwarderExpenseTypesConfigPage.tsx`
- `frontend/src/pages/forwarder-trip-detail-sections.tsx`

### Tasks Completed
- [x] Added configurable no-invoice policy fields to shared contracts, schemas, backend schema model, seed defaults, and config CRUD normalization.
- [x] Added structured no-invoice evidence capture to trip-expense create/update paths and forwarder mobile UI.
- [x] Added approval-time no-invoice review with minimum-evidence checks, same-payee same-day aggregation, policy snapshot persistence, and `RETURNED_FOR_EVIDENCE` handling.
- [x] Updated forwarder read models and UI rendering for evidence-return reasons and no-invoice metadata.
- [x] Reworked `m47-no-invoice-disbursement` tests toward Q12-Q14 rules, including fail-closed handling for unknown categories.
- [x] Verified the shared test DB contains the required no-invoice columns.
- [x] Re-ran focused runtime tests on the updated schema.
- [x] Closed the server-side invoice-policy bypass: a category configured with
  `requiresInvoice=true` now rejects a missing invoice both when the expense is
  created/updated and again at approval.
- [x] Normalized payee names by case and repeated whitespace before same-day,
  same-category aggregation, so superficial spelling variants cannot bypass
  the Q13 anti-splitting total.
- [x] Added explicit configured per-item/per-day threshold decisions to the
  approval result and covered custom category thresholds in regression tests.

### Tests Status
- Type check: `backend pass, frontend unrelated baseline fail`
- Unit tests: `M47 pass (28/28 after red-to-green fix loop)`
- Integration tests: `not run`

### Issues Encountered
- `backend` typecheck is clean for this slice and the focused M47 regression is green.
- `frontend` typecheck still has unrelated baseline failure in `src/pages/config/AppSettingsConfigPage.tsx`.
- Existing `trip_expenses.approval_status` storage is only `varchar(20)`, so the implementation had to use persisted status value `RETURN_FOR_EVIDENCE` for trip-expense approvals while leaving the separate governance-action status domain unchanged.

### Next Steps
- Optional follow-up outside this slice: clear the unrelated frontend baseline in `src/pages/config/AppSettingsConfigPage.tsx`.

### QA Artifacts
- `qa/2026-07-27_q12-q14_backend-typecheck.log`
- `qa/2026-07-27_q12-q14_frontend-typecheck.log`
- `qa/2026-07-27_q12-q14_m47-test.log`
- `qa/2026-07-27_q12-q14_schema-check.log`
- `qa/2026-07-27_q12-q14_backend-typecheck-rerun.log`
- `qa/2026-07-27_q12-q14_backend-typecheck-rerun2.log`
- `qa/2026-07-27_q12-q14_frontend-typecheck-rerun.log`
- `qa/2026-07-27_q12-q14_m47-test-rerun.log`
- `qa/2026-07-27_q12-q14_m47-test-rerun2.log`
- `qa/2026-07-27_q12-q14-trust-boundary_backend-test.log`
- `qa/2026-07-27_q12-q14-trust-boundary_backend-test.rerun.log`
- `qa/2026-07-27_q12-q14-trust-boundary_typecheck-backend.log` (red because
  concurrent Q11 files were mid-edit; rerun is part of the integrated gate)
