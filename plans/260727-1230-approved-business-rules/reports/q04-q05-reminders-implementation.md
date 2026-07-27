## Phase Implementation Report

### Executed Phase
- Phase: `phase-03-ar-credit-and-reminders`
- Plan: `plans/260727-1230-approved-business-rules`
- Status: `completed for Q04/Q05 reminder hardening slice`

### Files Modified
- `backend/src/services/email.service.ts` (+295 / -88)
- `backend/src/services/receivable-reminder.service.ts` (+1093 / -136)
- `backend/src/tests/email-service.test.ts` (+94 / -1)
- `backend/src/tests/m57-receivable-reminder.test.ts` (+679 / -54)
- `plans/260727-1230-approved-business-rules/reports/q04-q05-reminders-implementation.md` (+7 / -5)

### Tasks Completed
- [x] Implemented Q04 business-date reminder scheduling from persisted `processingDueDate`
- [x] Enforced one-summary-per-customer-per-business-date dedupe with durable claim rows plus transaction advisory locks
- [x] Added weekend/holiday rollover with 09:00 earliest send on the resolved working day
- [x] Added recurring post-due reminders every 7 days after `T+3` (`T+10`, `T+17`, ...)
- [x] Replaced the false customer-credit dispute proxy with authoritative rejected debit-note state scoped to disputed obligations only
- [x] Added Q05 customer-scoped in-app fallback independent of email success, missing-email, and retry-success paths
- [x] Added bounded Resend provider timeout and stale `PENDING` reminder-log recovery into the retry scheduler
- [x] Prevented duplicate outstanding totals when multiple rolled stages land on the same working day
- [x] Narrowed terminal failure escalation to the accepted repo authority for missing CUS role: `ADMIN` plus `ACCOUNTANT`
- [x] Batched active-customer obligation loading, dispute resolution, and customer-portal user lookup to remove the old per-customer N+1 reminder path
- [x] Extended `m57` plus `email-service` tests to cover rejected-debit-note disputes, customer fallback on all failure paths, stale pending recovery, timeout handling, stage-collision totals, and exact escalation recipients
- [x] Hardened obligation identity to `entityType + customerId + txnId` so trip, debit-note-adjustment, and service-fee rows cannot merge on numeric ID collisions
- [x] Moved retry ownership to per-attempt lease claims plus conditional completion updates so concurrent retry callers cannot double-send the provider request
- [x] Added durable customer-fallback repair state on existing `customer_email_logs` rows and taught the retry runner to repair SENT logs idempotently without re-sending email
- [x] Bounded retry scans to 200 rows and batched business-calendar resolution once per retry run
- [x] Replaced the old `ADJUSTMENT => BILLING_DOCUMENT` shortcut with authoritative customer-adjustment domain resolution across trip AR adjustments, service-fee adjustments, debt offsets, and verified debit-note links; ambiguous rows now fail closed and stay out of reminders
- [x] Derived the customer-portal fallback occurrence from the immutable email-log ID and embedded it in the notification, so cross-day repairs dedupe the exact occurrence even if obligations change after a crash
- [x] Added regression coverage for numeric ID collisions across trip adjustments, debt offsets, and debit-note adjustments, plus a D+1 marker-clear crash, intervening obligation mutation, and D+2 replay without duplicate notification or email resend

### Tests Status
- Backend typecheck: `pass` via `qa/2026-07-27_q04-q05-reminders_backend-typecheck-final.log`
- Focused backend tests: `pass` via `qa/2026-07-27_q04-q05-reminders_backend-test-final-rerun.log`
- Final immutable-occurrence focused rerun: `pass (38/38)` via `qa/2026-07-27_q04-q05-reminders_immutable-occurrence-test.log`
- Lint: `pass with 21 pre-existing warnings, 0 errors` via `qa/2026-07-27_q04-q05-reminders_lint-final.log`
- Final changed-file lint: `pass` via `qa/2026-07-27_q04-q05-reminders_immutable-occurrence-lint.log`
- Independent review: `GO` via `qa/2026-07-27_q04-q05-reminders_independent-review.md`
- Integration tests: `not run` for this slice

### Issues Encountered
- Full backend test runs were intentionally avoided after the scoped DB-backed reminder/email rerun, per Q18 coordination.
- No schema migration was required for the reminder fixes; DB-level hardening stayed inside existing `customer_email_logs` columns plus advisory locks/conditional updates.
- There is still no dedicated `CUS` enum/role in this repo; terminal manual-handling authority now follows the documented stand-in rule (`ADMIN` when CUS is required and absent).
- The cross-day fallback-repair regression test had to assert target-log invariants (`status`, `retryCount`, `providerMessageId`, marker clear, notification cardinality) instead of global retry counters because the shared DB retry scan can legitimately process unrelated FAILED logs in the same suite run.

### Next Steps
- After the concurrent shared fixes settle, rerun repo-wide backend/build gates from the controller/root session for final cross-slice green status.
