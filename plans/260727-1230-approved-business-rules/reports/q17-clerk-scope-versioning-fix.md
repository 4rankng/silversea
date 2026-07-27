## Phase Implementation Report

### Executed Phase
- Phase: q17-clerk-scope-versioning-fix
- Plan: plans/260727-1230-approved-business-rules
- Status: implemented; independent race finding fixed; focused QA, backend typecheck, and lint green; broader sequential gates remain with the controller

### Scope Boundary
- Q17 clerk assignment lifecycle, shipment scope, document replacement, change-request decisions, and notification delivery only.
- No Q03 payment/idempotency, Q23, Dockerfile, schema, migration, unrelated documentation, or `HANDOFF.md` changes were made by this workstream.

### Files Modified
- `backend/src/routes/shipments.ts`
- `backend/src/services/notification.service.ts`
- `backend/src/services/shipment-edit-boundary.service.ts`
- `backend/src/services/shipment.service.ts`
- `backend/src/services/user.service.ts`
- `backend/src/tests/customer-user-link.test.ts`
- `backend/src/tests/m32-doc-expiry.test.ts`
- `backend/src/tests/shipment-audit.test.ts`
- `backend/src/tests/shipment-routes.test.ts`
- `frontend/src/api/shipmentClient.ts`
- `frontend/src/pages/clerk/ClerkShipmentDocsPage.tsx`
- `frontend/src/pages/clerk/ClerkShipmentDocsPage.test.tsx`
- `plans/260727-1230-approved-business-rules/reports/q17-clerk-scope-versioning-fix.md`

### Fixes Implemented
- Business-unit deactivation now locks and checks the active-CLERK invariant transactionally. A unit cannot become inactive when it is an active clerk's only active unit.
- Active clerk assignment validation holds PostgreSQL `FOR SHARE` locks on assigned active units. This conflicts with unit deactivation and closes the assignment-versus-deactivation race; the regression test proves exactly one conflicting operation commits.
- Independent re-review reproduced a second deactivation race: two transactions retiring different units assigned to the same ACTIVE clerk locked disjoint unit rows, so both could count the other's unit and commit. Deactivation now acquires deterministic, transaction-scoped advisory locks keyed by affected clerk ID (namespace `6120`, sorted by user ID) before evaluating alternatives. This serializes the shared clerk invariant without introducing the user-row/unit-row lock-order cycle that a late user-row lock would create.
- Change-request creation and decision notifications are persisted in the same domain transaction as the request/decision. A notification persistence failure therefore rolls back the material workflow instead of leaving an unnotified committed request or resolution.
- Explicit `targetUserId` notifications no longer inherit the default financial-role audience. Decision notifications reach only the requesting clerk; driver-target behavior keeps its existing financial-role audience contract.
- Stale change requests cannot be applied, but may still be rejected and closed. The source-version check now guards only `APPLIED`.
- Review rows and shipment rows are locked before decision processing. Concurrent ADMIN/MANAGER decisions produce one winner, delete the pending request once, and persist one decision notification.
- Document replacement is bound to both path `shipmentId` and `documentId`, requires `expectedVersion`, locks the shipment and document, rejects already-replaced documents, conditionally links one successor, and increments the shipment version.
- The frontend replacement API and clerk document page send the current shipment version and reload detail after success.
- Clerk scope regression coverage now proves the full rule:
  assigned business unit AND (assigned customer OR explicitly assigned shipment).
  It checks list membership, total count, detail denial, update denial, container denial, document attach/replacement denial, and declaration create/update denial.
- The shipment audit fixture now supplies the required optimistic version and a valid ISO 6346 container number; the audit assertion remains unchanged.

### QA Evidence
- Backend typecheck: green.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-backend-typecheck.log`
  - The artifact includes an initial shell-harness error caused by using zsh's read-only `status` variable, followed by successful reruns with exit 0. This was not a TypeScript failure.
- Frontend typecheck: green, exit 0.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-frontend-typecheck.log`
- Focused backend regression matrix: green, 91/91 on the final combined run.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-backend-test.log`
  - The initial broad backend invocation was red: 1546 passed / 3 failed.
  - Relevant failure: `shipment-audit.test.ts` container update returned 400 because the fixture omitted the route's required shipment version. The fixture was corrected without weakening the expected 200/audit assertions.
  - The other two initial failures were outside Q17: app-settings email read returned 500 and a customer-portal concurrent-confirmation test returned two 200 responses instead of 200/409.
  - A first focused rerun remained red only on the same stale audit fixture. The narrow audit rerun then passed 8/8, and the final combined Q17 run passed 91/91.
  - The artifact also contains the added assignment/deactivation concurrency rerun passing 14/14.
- Frontend tests: green, 63 files / 331 tests, exit 0.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-frontend-test.log`
- Lint: green by repository bar, 0 errors / 21 pre-existing warnings, exit 0.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-lint.log`
  - The touched-file unused import warning was removed before the final rerun.
- Different-unit deactivation race, pre-fix: red as expected, exit 1.
  - `qa/2026-07-27_q17-unit-deactivation-race_pre-fix.log`
  - All 20 fresh trials reproduced the unsafe result: two committed deactivations and zero remaining active units.
- Different-unit deactivation race, post-fix: green, 15/15 tests, exit 0.
  - `qa/2026-07-27_q17-unit-deactivation-race_post-fix.log`
  - The deterministic regression runs 20 trials; every trial has exactly one committed deactivation, one rejected operation, and at least one active unit.
- Q17 race lint rerun: green by repository bar, 0 errors / 21 pre-existing warnings, exit 0.
  - `qa/2026-07-27_q17-unit-deactivation-race_lint.log`
- Q17 race backend typecheck: green on final rerun, exit 0.
  - `qa/2026-07-27_q17-unit-deactivation-race_backend-typecheck.log`
  - The artifact retains an initial failure from an unrelated concurrent `backend/src/services/driver.service.ts` edit (`Tx` was temporarily undefined at five lines). After that parallel edit stabilized, the appended rerun passed with exit 0.
- Production build: green, exit 0.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-build.log`
- E2E: incomplete, not claimed green.
  - `qa/2026-07-27_q17-clerk-scope-versioning_review-fix-e2e.log`
  - The command progressed green through suites 00-09, then was interrupted when the controller requested immediate handoff. The artifact has no final exit status and must not be treated as a completed gate.

### Review Notes
- Self-review checked concurrency, error propagation, API version contracts, backward compatibility, external input validation, ADMIN/MANAGER decision authorization, clerk scope leakage, notification audience leakage, and bounded query behavior.
- The controller's independent re-review found and reproduced the different-unit deactivation race described above. The added deterministic regression is green after invariant-level serialization.
- The backend package test script expands to the entire backend suite even when file arguments are supplied. Focused evidence therefore uses direct `npx tsx --test --test-concurrency=1 <files>` invocations.

### Remaining Controller Actions
- Record the controller's final independent Q17 disposition against this race fix.
- Re-run the broader sequential backend and E2E gates in a stable, non-parallel environment.
- Classify the two non-Q17 failures from the initial broad backend run against the controller's other workstreams or baseline.
