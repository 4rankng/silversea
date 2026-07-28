# Final Audit — Approved Q01-Q11

**Audit date:** 2026-07-27  
**Authority:** `docs/prd/business-logic-qa-proposals.md` Q01-Q11, all accepted on 2026-07-27  
**Scope:** read-only audit of the current worktree, cited plan reports, and saved QA artifacts only  
**Rule:** a clause is `PROVED` only when current code plus saved QA evidence cover the reachable production boundary and the required normal / invalid / exception / concurrency / RBAC behavior for that clause.

## Summary

| Q | Overall | Why |
|---|---|---|
| Q01 | PROVED | Exposure math and the accepted shared-default/per-customer configuration path are both now proved at the live route boundary. |
| Q02 | PROVED | Tiered override workflow and explicit non-office denial are both now directly proved at the route boundary. |
| Q03 | PROVED | Allocation, replay, unapplied credit, and governed refund of unapplied credit are all proved. |
| Q04 | PROVED | Schedule, working-window, holiday rollover, 09:00 rolled send, one-summary-per-day, and stop conditions are all covered by current code and focused QA. |
| Q05 | PROVED | Retry timing, fallback, and terminal escalation to the repository's CUS-equivalent `CLERK` role plus finance are proved. |
| Q06 | PROVED | Multi-truck invoice header + allocation rows, actual-litre pricing, no equal split, and approval blocking on incomplete evidence are all proved. |
| Q07 | PROVED | Multi-type + reporting primary are proved, and a focused regression now proves primary-type edits do not reclassify existing trip expenses. |
| Q08 | PROVED | Manual offset rules are proved, and focused CRUD/route coverage now proves canonical shared-partner convergence by normalized tax code. |
| Q09 | PROVED | Company-wide or configured payroll-unit scope and Ready/Pending readiness are proved. |
| Q10 | PROVED | Whole-period blocking, approved exclusion, persisted pending follow-up, and evidence-gated completion are proved end-to-end. |
| Q11 | PROVED | Reopen blockers, governed reopen, post-close adjustment path, issued-only payslip visibility, and append-only history are all proved. |

## Q01 — Early-warning threshold for credit limit

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Early warning at 80%, over-limit at 100% | PROVED | `backend/src/services/credit-limit.service.ts:137-142,177-215`; `qa/2026-07-27_q01-q02-credit-decisions_backend-test.rerun3.log` proves warning/limit behavior in `m53`. | None. |
| Shared default for new customers plus per-customer override | PROVED | `backend/src/routes/app-settings.ts:40-47`, `backend/src/routes/financial/credit-overrides.routes.ts:55-86`, `backend/src/routes/config.ts:422-430`, and `qa/2026-07-28_final-q01-q02-q07-q08_backend-test.log` prove app-settings persistence, customer-threshold persistence, and live credit-override snapshots reading first the shared default then the per-customer override. | None. |
| Exposure includes posted AR + approved/uncollected commitments + proposed new shipment/trip value | PROVED | `backend/src/services/credit-limit.service.ts:187-215`; `qa/2026-07-27_q01-q02-credit-decisions_backend-test.rerun3.log` proves posted AR, reserved shipment approvals, and proposed amount in one focused suite. | None. |

## Q02 — Who can approve service continuation beyond credit limit; tiered approval

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| CUS and dispatch cannot approve over-limit continuation | PROVED | `backend/src/routes/financial/credit-overrides.routes.ts:55-116`, `backend/src/middleware/casbin.ts`, and `qa/2026-07-28_final-q01-q02-q07-q08_backend-test.log` prove explicit HTTP `403` denials for `CUSTOMER`, `DRIVER`, `FORWARDER`, and `CLERK` on list/detail/create/approve/reject routes. | None. |
| Finance tier 1 only when over-limit ratio is at most 10% and within configured amount cap | PROVED | `backend/src/services/credit-limit.service.ts:218-227`; `qa/2026-07-27_q01-q02-credit-decisions_backend-test.rerun3.log` proves repeat escalation, tier routing, and create-trip enforcement. | None. |
| Larger or repeat cases escalate to director tier | PROVED | `backend/src/services/credit-limit.service.ts:160-168,218-227`; `qa/2026-07-27_q01-q02-credit-decisions_backend-test.rerun3.log` proves repeat exceptions escalate. | None. |
| Approval is bound to one shipment/trip or to an expiry date, and reason is mandatory | PROVED | `backend/src/services/credit-limit.service.ts:235-290,440-466`; `backend/src/db/schema.ts:2386-2450`; same focused backend artifact proves shipment-scoped consumption and expiry overrides. | None. |
| Creator cannot self-approve; first decision wins under concurrency | PROVED | `backend/src/services/credit-limit.service.ts:295-339,347-396`; `qa/2026-07-27_q01-q02-credit-decisions_backend-test.rerun3.log` proves self-approval block, stale version loss, reject path, and first-winner approval. | None. |

## Q03 — Payment allocation when customer does not specify

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Explicit customer instructions take priority | PROVED | `backend/src/services/payment-allocation.service.ts:411-420`; `backend/src/tests/m56-payment-allocation.test.ts` explicit-order cases are green in `qa/2026-07-27_q03-payment-allocation.review-fix-2_m56-backend-test.log`. | None. |
| Default allocation is oldest processing due date, then original due date, then oldest issue timestamp | PROVED | `backend/src/services/payment-allocation.service.ts:162-163,396-409`; `qa/2026-07-27_q03-payment-allocation.review-fix-2_m56-backend-test.log` includes the focused oldest-due ordering case. | None. |
| No proportional split and no implicit freight-priority default | PROVED | Same allocation service and focused `m56` artifact; no proportional allocator exists on the production path. | None. |
| Overpayment stays as unapplied customer credit | PROVED | `backend/src/services/payment-allocation.service.ts:473-530`; `qa/2026-07-27_q03-payment-allocation.review-fix-2_m56-backend-test.log` proves persisted unapplied credit. | None. |
| Refund only on request and approval | PROVED | `backend/src/services/payment-allocation.service.ts`, `backend/src/services/governance-transition.service.ts`, `backend/src/routes/financial/payments.routes.ts`, and migration `0146_powerful_proteus.sql`; `qa/2026-07-28_q03-payment-refund_backend-test.log` proves over-refund denial, distinct maker/checker/approver, immutable refund + ledger rows, receipt versioning, amount conservation, and stale replay denial. | None. |
| Replay / flaky network / concurrent same-receipt submission create one business effect | PROVED | `backend/src/services/payment-allocation.service.ts:357-383,697-718`; `qa/2026-07-27_q03-payment-allocation.review-fix-2_q03-route-test.log` proves header replay, no-header replay, same-receipt races, and customer-lock serialization. | None. |

## Q04 — Reminder schedule, frequency, quiet hours, holidays

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Default cadence is T-3, due date, T+3, then every 7 days | PROVED | `backend/src/services/receivable-reminder.service.ts:15-20,791-805,1393-1399`; `qa/2026-07-27_q04-q05-reminders_backend-test-final-rerun.log` proves T-3 / due / T+3 / T+10 / T+17 behavior. | None. |
| New reminders only during 08:00-17:30 on working days | PROVED | `backend/src/services/receivable-reminder.service.ts:15-20,46,791-805`; same focused backend artifact covers working-window gating. | None. |
| Weekend/holiday reminder rolls to 09:00 on the next working day | PROVED | `backend/src/services/receivable-reminder.service.ts:17-18`; same focused backend artifact proves held-until-09:00 rolled sends. | None. |
| At most one summary per customer per day | PROVED | `backend/src/services/receivable-reminder.service.ts:1359-1379`; focused reminder artifact proves one-summary-per-customer-day dedupe and same-day rerun no-dup. | None. |
| Stop when fully paid, disputed, or suspended | PROVED | `backend/src/services/receivable-reminder.service.ts:150,270-278,853-900`; focused reminder artifact proves paid, rejected-debit-note dispute, and locked/suspended suppression. | None. |

## Q05 — Channel priority: email vs in-app; retry & fallback

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Customer email is primary and in-app notification is created simultaneously as fallback/audit trail | PROVED | `backend/src/services/receivable-reminder.service.ts:1359-1379`; `qa/2026-07-27_q04-q05-reminders_backend-test-final-rerun.log` proves email + customer-scoped fallback and provider-failure fallback. | None. |
| Internal users use in-app notification as the primary channel | PROVED | Same reminder service and focused artifact prove internal evidence notifications without treating them as email-delivery proof. | None. |
| Email retry cadence is 15 minutes, 2 hours, 24 hours | PROVED | `backend/src/services/receivable-reminder.service.ts:6-20,426-494`; `qa/2026-07-27_q04-q05-reminders_backend-test-final-rerun.log` proves the 15m / 2h / 24h schedule. | None. |
| After terminal failure, mark failed and notify CUS for manual handling | PROVED | `backend/src/services/receivable-reminder.service.ts` maps the product's CUS/documentation team to the existing `CLERK` role and also retains finance fallback owners; `qa/2026-07-28_q05-cus-terminal-escalation_backend-test.log` proves CLERK, ADMIN, and ACCOUNTANT each receive exactly one terminal alert after 15m / 2h / 24h retries. | None. |
| In-app notification must not be treated as proof that email succeeded | PROVED | `qa/2026-07-27_q04-q05-reminders_independent-review.md` explicitly re-verifies this invariant against current code and focused tests. | None. |

## Q06 — Multi-truck fuel invoices and allocation basis

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| One fuel invoice may cover multiple trucks | PROVED | `backend/src/db/schema.ts:1447-1515`; `qa/2026-07-27_q06-fuel-invoice-operability_backend-test.log` proves one header with multiple allocations. | None. |
| Invoice stored once, with per-truck allocation rows underneath | PROVED | Same schema plus `frontend/src/pages/payables-fuel-invoices.tsx:483-757`; focused backend operability artifact proves create/read/approve on one header with multiple rows. | None. |
| Allocation basis uses actual voucher/log evidence by truck/date/litres and server-computed amount = litres × unit price | PROVED | `backend/src/services/fuel-invoice.service.ts` current route/service behavior is exercised by `qa/2026-07-27_q06-fuel-invoice-operability_backend-test.log` and `qa/2026-07-27_q06-fuel-invoice-voucher-integrity_backend-test-rerun.log`. | None. |
| No equal split; incomplete evidence remains pending and cannot be approved | PROVED | `qa/2026-07-27_q06-fuel-invoice-operability_backend-test.log` proves pending drafts, replacement, and blocked approval until exact reconciliation. | None. |

## Q07 — Multiple service categories per supplier and primary category

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Supplier may belong to multiple categories | PROVED | `backend/src/db/schema.ts:204-215`; `qa/2026-07-27_q06-q08-ap-fuel-offsets_m62_rerun.log` proves multi-type normalization and DB queries. | None. |
| One primary category exists for reporting/defaults | PROVED | `backend/src/services/supplier-types.service.ts:59-69`; same focused `m62` artifact proves valid primary-type normalization and persistence. | None. |
| Primary category must not silently reclassify actual expense/invoice transactions | PROVED | `backend/src/routes/config.ts:422-430`, `backend/src/services/supplier-types.service.ts:56-69`, and `qa/2026-07-28_final-q01-q02-q07-q08_backend-test.log` prove a supplier `types` / `primaryType` edit through production CRUD leaves an existing `trip_expenses.expenseType` row unchanged. | None. |

## Q08 — Customer/supplier duality and manual AR/AP offset

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| One shared partner profile keyed by tax code with separate customer/supplier roles | PROVED | `backend/src/routes/config.ts:78-138,422-430`, `backend/src/services/legal-partner.service.ts:21-68`, and `qa/2026-07-28_final-q01-q02-q07-q08_backend-test.log` prove customer create/update and supplier create converge onto one `partners` row keyed by normalized tax code. | None. |
| AR and AP ledgers remain separate | PROVED | `backend/src/services/debtOffset.service.ts:176-213,229-270`; `qa/2026-07-27_q06-q08-ap-fuel-offsets_m64_rerun.log` proves paired but separate CUSTOMER/VENDOR entries. | None. |
| Offset allowed only manually, same legal entity, same currency, with minutes, and amount not exceeding the smaller side | PROVED | Same debt-offset service and `qa/2026-07-27_q06-q08-ap-fuel-offsets_m64_rerun.log` prove min(AR, AP), same canonical partner, VND-only, minutes required, role guard, and concurrent first-winner approval. | None. |

## Q09 — Salary period scope: company-wide or per-driver

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Close is for the whole company or a configured payroll unit, not per-driver | PROVED | `shared/src/schemas/app-settings.ts`, `backend/src/services/app-settings.service.ts`, `backend/src/services/salary-period-close.service.ts`, and `frontend/src/pages/config/AppSettingsConfigPage.tsx`; `qa/2026-07-28_q09-payroll-unit_backend-test.log` proves an outside driver is excluded from readiness and totals when a payroll unit is configured. | None. |
| Drivers have explicit Ready / Pending readiness before close | PROVED | `backend/src/services/salary-period-close.service.ts:83-85,337-386`; `qa/2026-07-27_q09-q11-q20-payroll_backend-test.log` proves Ready/Pending entries and blocking-driver detection. | None. |

## Q10 — Block entire period on driver error or allow partial close

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Default behavior blocks the whole period on money-affecting driver errors | PROVED | `backend/src/services/salary-period-close.service.ts:386-387,621,979`; `qa/2026-07-27_q09-q11-q20-payroll_backend-test.log` proves one pending driver blocks close. | None. |
| Partial close is allowed only through an approved exclusion | PROVED | `backend/src/services/salary-period-close.service.ts:1216-1392`; same payroll artifact proves request/check/approve exclusion before close succeeds. | None. |
| Excluded drivers are explicitly marked for supplementary-period or adjustment follow-up, not silently skipped | PROVED | `backend/src/services/salary-period-close.service.ts` persists `PENDING` follow-up state at approval and permits completion only after the driver is READY in a different supplementary period or an approved adjustment exists; `backend/src/routes/config.ts` exposes the completion path. `qa/2026-07-28_q10-salary-exclusion-followup_backend-test.log` proves premature completion is blocked and successful evidence-gated completion remains visible in exclusion history. | None. |
| Driver is not silently omitted | PROVED | `backend/src/services/salary-period-close.service.ts:547-550` returns `excludedDriverIds`; focused payroll artifact proves explicit approved exclusions are surfaced. | None. |

## Q11 — Post-close changes: reopen or adjustment

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| After close, prefer append-only adjustment in an open period | PROVED | `backend/src/services/salary-period-adjustment.service.ts:235-415`; `qa/2026-07-27_q11-post-close_backend-test.log` proves governed adjustment creation and approval. | None. |
| Reopen allowed only before payslip issuance, payment, and official posting | PROVED | `backend/src/services/salary-period-close.service.ts:458-475,720-727,921-923`; `qa/2026-07-27_q11-post-close_backend-test.log` and `qa/2026-07-27_q09-q11-q20-payroll_backend-test.log` prove issue/payout/post blockers. | None. |
| Reopen is restricted to director/delegate authority | PROVED | `backend/src/services/salary-period-close.service.ts:1075-1125`; `backend/src/tests/q11-salary-post-close.test.ts` green in `qa/2026-07-27_q11-post-close_backend-test.log` proves accountant cannot request reopen and governed distinct-actor reopen is required. | None. |
| After payment or posting, only adjustment/reversal path remains | PROVED | Same reopen-blocker logic plus adjustment service; `qa/2026-07-27_q11-post-close_backend-test.log` proves reopen is blocked after issue and adjustment remains the allowed path. | None. |
| Before/after values, actor chain, approver, and append-only history are retained | PROVED | `backend/src/db/schema.ts:2548-2580`, `backend/src/services/salary-period-adjustment.service.ts:277-415`; focused backend tests and frontend tests (`qa/2026-07-27_q11-post-close_frontend-test.log`, `qa/2026-07-27_q15-salary-close-governance_frontend-test.log`) prove surfaced lifecycle and adjustment history. | None. |

## Verdict

Q01-Q11 are fully proved against the accepted clauses in the current worktree.
