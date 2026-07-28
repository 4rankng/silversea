# Final Audit — Approved Q12-Q23, O01-O02

**Audit date:** Monday, 2026-07-27  
**Authority:** `docs/prd/business-logic-qa-proposals.md` Q12-Q23, O01-O02, all accepted on 2026-07-27  
**Scope:** read-only audit of the current worktree, cited plan reports, and saved QA artifacts only  
**Rule:** a clause is `PROVED` only when current code plus saved QA evidence cover the reachable production boundary and the required normal / invalid / exception / concurrency / RBAC behavior for that clause.

## Evidence bar

- Same-day proof means current code plus `qa/2026-07-27_*` artifacts or undated current-code inspection.
- The following sources are dated **2026-07-28**, which is **future-dated relative to this audit date** and therefore treated only as supplementary context unless corroborated by current code: `reports/q23-advances-replay.md`, `reports/q23-operational-evidence-replay.md`, `reports/q23-company-expense-replay.md`, `reports/q23-config-crud-replay.md`, and the 2026-07-28 update section inside `reports/q23-material-write-inventory.md`.
- The controller-requested focused artifacts `qa/2026-07-28_final-q12-q14-q20-q21_*` are also future-dated relative to Monday, 2026-07-27. This audit uses them only where the cited current code already corroborates the same behavior.

## Summary

| Q | Overall | Why |
|---|---|---|
| Q12 | INCOMPLETE | Default evidence taxonomy, alias metadata, and explicit trip-or-shipment scope metadata exist, but the mandatory trip-or-shipment boundary is still not fully proved on the reachable boundary. |
| Q13 | INCOMPLETE | Default thresholds, anti-splitting aggregation, and explicit finance-lead/director title routing are proved, but the approval titles are still fixed defaults rather than policy-configurable. |
| Q14 | PROVED | Missing-evidence return, tiered approval, self-approval denial, and mandatory exception reason are all directly proved. |
| Q15 | INCOMPLETE | Governance foundation and several money/price/salary slices are implemented, but the accepted maker/checker envelope is not yet universally proved across the whole surface. |
| Q16 | PROVED | Explicit customer-link authority, default single-customer scope, optional admin-linked multi-customer scope, and portal isolation are all proved. |
| Q17 | INCOMPLETE | Clerk dual-scope and post-dispatch versioning are strongly implemented for shipment edits, but the full accepted editable surface is not yet completely proved. |
| Q18 | INCOMPLETE | Adjustment/reopen governance is strong for bounded trip/AR/debit-note slices, but the accepted no-direct-edit rule is not yet universally proved across all approved/locked data. |
| Q19 | PROVED | Next-business-day processing, preserved contractual date, adjusted overdue/reminder logic, and contract override are all proved. |
| Q20 | INCOMPLETE | Completion-date payroll/revenue attribution and actual-event attendance/expense attribution are partly proved, and start-date search/dispatch is now directly proved, but the full official-totals and in-progress-exclusion rule set is not yet closed. |
| Q21 | PROVED | Shared and frontend contracts now expose the accepted monthly/weekly customer debit-note boundary while preserving legacy compatibility, and the period-lock/late-data rules remain proved. |
| Q22 | INCOMPLETE | The source-authority catalog and key propagation paths are implemented, but the full accepted chain is not yet universally proved end-to-end. |
| Q23 | INCOMPLETE | Many route classes now replay or reject correctly, but universal material-write coverage, durable conflict audit, and all stale-write classes are not closed. |
| O01 | PROVED | Persisted two-way pairing, authoritative pairing checks, explicit cancel/late/cross-day handling, and protected dispatch/driver surfaces are all proved. |
| O02 | PROVED | ACCOUNTANT audit visibility is restricted to approved finance/payroll scope with deterministic redaction and negative-scope proof. |

## Q12 — No-invoice categories and substitute evidence

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Default allowlist of no-invoice categories exists | INCOMPLETE | `shared/src/constants/index.ts:321-329`, `backend/src/services/no-invoice-disbursement.service.ts:89-105`, `backend/src/tests/m47-no-invoice-disbursement.test.ts:175-187`, `qa/2026-07-28_final-q12-q14-q20-q21_m47-backend-test.log`. | The accepted alias set now exists in current code, including the explicit “Vật tư nhỏ phục vụ chuyến” / “Chi phí hiện trường nhỏ lẻ” aliases, and the policy snapshot exposes it. The remaining gap is a reachable-boundary proof that every accepted business label is wired through the seeded category surface, not just internal policy metadata. |
| Accepted substitute evidence taxonomy exists | PROVED | `shared/src/constants/index.ts:292-304` matches receipt, transfer/e-wallet, onsite photo, and signed confirmation; `backend/src/services/no-invoice-disbursement.service.ts:174-194`; `reports/q12-q14-no-invoice.md`. | None. |
| Mandatory amount, date, payee, trip-or-lot, reason, and at least one evidence | INCOMPLETE | `shared/src/constants/index.ts:307-329`, `shared/src/types/index.ts:738-752`, `backend/src/services/no-invoice-disbursement.service.ts:130-152,185-215,321-329`, `qa/2026-07-28_final-q12-q14-q20-q21_m47-backend-test.log`. | Current code now declares the required scope as `TRIP_OR_SHIPMENT` and still enforces date, payee, reason, evidence, and photo backing. The remaining audit gap is a focused reachable proof of the shipment/lot side of that boundary rather than only the existing trip-rooted expense path. |

## Q13 — Per-item and per-day-per-person thresholds

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Defaults are 1,000,000/item and 5,000,000/day/person | PROVED | `shared/src/constants/index.ts:306-311`; `reports/q12-q14-no-invoice.md`; `qa/2026-07-27_q12-q14_m47-test-rerun2.log`. | None. |
| Same person/day/category amounts aggregate to block splitting | PROVED | `backend/src/services/no-invoice-disbursement.service.ts:140-162,261-279`; same focused M47 artifact proves normalized payee aggregation and threshold trips. | None. |
| Thresholds are configurable by category and title | INCOMPLETE | `backend/src/services/no-invoice-disbursement.service.ts:89-105,234-252,332-339`, `backend/src/tests/m47-no-invoice-disbursement.test.ts:267-299`, `qa/2026-07-28_final-q12-q14-q20-q21_m47-backend-test.log`. | Category thresholds and the resulting finance-lead/director title routing are now directly proved. The remaining gap is that the title values themselves are fixed in current code (`FINANCE_LEAD`, `DIRECTOR`) rather than configured per policy. |

## Q14 — Missing evidence and over-threshold approval path

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Missing evidence returns for supplementation, not straight approval | PROVED | `backend/src/services/no-invoice-disbursement.service.ts:258-269`; `backend/src/services/approval.service.ts:116-127`; `qa/2026-07-27_q12-q14_m47-test-rerun2.log`. | None. |
| Over-threshold but complete requests route through tiered approval | PROVED | `backend/src/services/no-invoice-disbursement.service.ts:272-286`; `backend/src/routes/trips.ts:789-815`; focused M47 tests cover accountant vs manager approval and daily/director thresholds. | None. |
| Creator cannot self-approve | PROVED | `backend/src/services/approval.service.ts:94-103`; same approval path is exercised in the no-invoice focused suite. | None. |
| Every exception requires a reason | PROVED | `backend/src/services/no-invoice-disbursement.service.ts:226-232,339-367`, `backend/src/tests/m47-no-invoice-disbursement.test.ts:314-367`, `qa/2026-07-28_final-q12-q14-q20-q21_m47-backend-test.log`. | None. |

## Q15 — Maker/checker/approver/viewer split

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Money/price/debt/exception/period-close/adjustment surfaces use maker/checker/approver separation | INCOMPLETE | `reports/q15-governance-foundation.md`, `reports/q15-maker-checker-implementation.md`, `reports/q15-direct-money-governance.md`, `reports/q15-price-config-governance.md`, `reports/q15-salary-close-governance.md`, `reports/q15-salary-confirmation-governance.md`, and the current governance code/report set prove large parts of this. | The accepted rule is cross-cutting. The saved reports still describe the overall rollout as tranche-based and not yet universal across every money/price/config/debt/close surface. |
| Creator cannot self-approve | INCOMPLETE | Strongly proved on governance actions, direct-money paths, trip expenses, debt offsets, salary close, and salary confirmation. | The accepted clause spans the whole governed surface; current proof is still slice-based, not universal. |
| Ordinary operational updates may self-save, but money or locked-state changes require governance | INCOMPLETE | Q17 and Q18 slices prove this boundary for shipment post-dispatch change requests and trip/debit-note adjustments. | The accepted rule is broader than the presently proved slices. |
| View-only cannot mutate or approve | INCOMPLETE | Many routes enforce role guards and inbox/detail actions derive server-side `allowedActions`. | No single saved proof matrix closes the entire accepted viewer prohibition across all governed surfaces. |

## Q16 — Customer account scope

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Default one account → one customer entity | PROVED | `reports/q16-multi-customer-implementation.md`; `backend/src/services/user.service.ts`; `qa/2026-07-27_q16-multi-customer_post-fix-backend-targeted-test.log`. | None. |
| Multi-customer access is allowed only by explicit admin-linked customer assignments | PROVED | Same Q16 report and backend tests; admin UI/browser proof in `qa/2026-07-27_q16-multi-customer_visual-browser.log`. | None. |
| Data, documents, and receivables stay segregated per entity | PROVED | Q16 backend tests plus browser proof of separate portal requests for both entities and persisted selected-entity scope. | None. |
| No grant by email-domain alone | PROVED | Q16 implementation is explicit user-customer join based, not email-domain derived; independent review artifact retained in `qa/2026-07-27_q16-multi-customer_independent-review.md`. | None. |

## Q17 — Clerk editable surface and dual scope

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Clerk may edit the accepted shipment/document/container scope | INCOMPLETE | `reports/q17-clerk-scope-versioning-implementation.md`, `reports/q17-clerk-scope-versioning-fix.md`, `backend/src/services/shipment.service.ts`, and `backend/src/tests/shipment-routes.test.ts` strongly prove shipment-level scope/versioning. | The accepted business list is broader than the currently proved shipment route matrix. The audit does not have full current proof for every listed surface such as all seal/photo/document variants. |
| Before dispatch, direct edits are allowed; after dispatch, plan-changing edits become versioned requests | PROVED | Shipment service change classification and source-version request flow are explicitly covered in the Q17 fix report and focused shipment route tests. | None. |
| Scope is restricted simultaneously by responsible unit and assigned customer/shipment | PROVED | `backend/src/services/user.service.ts`, `backend/src/services/shipment.service.ts`, and focused route tests prove dual-scope enforcement. | None. |
| Clerk cannot write price, cost, debt, or salary | INCOMPLETE | Current route/service work centers on shipment/document operations and denies accountant review of change requests. | There is not yet a single saved negative-permission matrix proving all forbidden money/debt/salary surfaces for the clerk role. |

## Q18 — Editing approved or locked data

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Approved/locked data is not directly edited | INCOMPLETE | `reports/q18-adjustment-governance-implementation.md`, Q15 foundation compatibility tests, and current adjustment governance code strongly prove this for trip AR, trip reopen, issued debit-note, and settlement-history slices. | The accepted rule is universal. The current proof is still bounded to selected operational and financial surfaces, not all approved/locked data in the repo. |
| Adjustment/reversal is required; reopen is exceptional and only pre-issue/pre-posting | PROVED | Same Q18 report and focused backend tests prove reopen blockers and adjustment-only paths after issue/post/payment milestones for the governed slices. | None for the governed slices. |
| Reason, before/after, actor, and approver are retained | PROVED | Q18/Q15 governance foundation persists reason, optimistic version, application result, and audit timestamps; focused tests prove lifecycle and durable decision history. | None for the governed slices. |
| Operational vs money vs period-reopen authority splits are enforced | INCOMPLETE | Strongly implemented for trip operational reopen, trip AR adjustment, and salary-period reopen. | The full accepted authority split is not yet universally proved across every locked surface. |

## Q19 — Weekend and holiday processing dates

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Default processing due date rolls to the next business day | PROVED | `reports/q19-business-calendar-implementation.md`; `qa/2026-07-27_q19-business-calendar_authority-paths-final.log` proves 22/22 focused cases. | None. |
| Original contractual date is still preserved and shown | PROVED | Same Q19 report proves both original and processing due dates on billing documents, exports, statements, and PDFs. | None. |
| Overdue/reminder logic uses the adjusted date | PROVED | Same report and focused authority-path tests prove adjusted-date reminder/overdue behavior. | None. |
| Contract override wins when calendar-date handling is contractually required | PROVED | Same Q19 implementation report and focused tests cover contract override behavior. | None. |

## Q20 — Cross-period trip attribution

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Revenue, trip salary, trip count, and profit belong to the completion-date period | INCOMPLETE | `reports/q09-q11-q20-payroll.md` proves salary-period total attribution by completion date; `reports/q22-source-propagation.md` proves debit-note membership uses completion business date, not departure. | The accepted rule also names official trip count and profit surfaces. This audit does not have one focused saved proof that all official trip-count/profit reporting paths now consistently use completion date. |
| Attendance, fuel, and expense belong to actual event date | INCOMPLETE | Same payroll report proves trip-derived attendance sync by actual completion day; Q22 source propagation proves approved service-fee membership uses `trip_expenses.expense_date`. | Fuel-period attribution is not separately proved in a focused Q20 artifact, and the full actual-event matrix is not closed in one place. |
| Start date remains for search and dispatch | PROVED | `backend/src/services/trip-queries.service.ts:153-188`, `backend/src/tests/q20-start-date-trip-query.test.ts:74-116`, `qa/2026-07-28_final-q12-q14-q20-q21_q20-backend-test.log`. | None. |
| In-progress trips are excluded from official period totals | INCOMPLETE | Payroll close and readiness logic operate on completed data. | There is no focused saved Q20 artifact proving exclusion from all official totals/reporting surfaces. |

## Q21 — Period lock granularity and late data

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Salary and fuel lock monthly | PROVED | `reports/q21-period-authority-implementation.md`; focused and full backend QA artifacts are green. | None. |
| Debit notes follow customer payment cycle, default monthly and weekly only by contract | PROVED | `shared/src/types/index.ts:74,738-752`, `shared/src/schemas/index.ts:610`, `shared/src/schemas/customerSchema.test.ts:9-30`, `frontend/src/lib/customerDebitNoteMode.ts:1-37`, `frontend/src/lib/customerDebitNoteMode.test.ts:7-30`, `frontend/src/pages/CustomersPage.tsx:72-125`, `frontend/src/pages/config/CustomersConfigPage.tsx:44-166`, `qa/2026-07-28_final-q12-q14-q20-q21_shared-test.log`, `qa/2026-07-28_final-q12-q14-q20-q21_frontend-mode-test.log`, `qa/2026-07-28_final-q12-q14-q20-q21_frontend-typecheck.log`. | None. |
| Late data posts to the current open period as an adjustment linked to the original period | PROVED | Same Q21 report proves late-period adjustment linkage and locked-period rejection. | None. |
| Old closed period is not directly edited; reopen is only pre-issue/pre-payment and approved | PROVED | Same Q21 report proves locked-period write rejection plus reopen rejection after issue/payment. | None. |

## Q22 — Source-of-truth chain and pre/post-lock behavior

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| The shipment → trip → approved expense → issued debit note → receipt allocation source chain is explicitly cataloged | PROVED | `shared/src/governance/source-authority.ts:1-239`; `reports/q22-authority-catalog-implementation.md`. | None. |
| Pre-lock changes recompute dependent draft values | INCOMPLETE | `shared/src/governance/source-authority.ts:108-190` declares `RECOMPUTE` pre-milestone actions; `reports/q22-source-propagation.md` proves several draft recompute paths. | The accepted rule is whole-chain. Current proof is strong but not universal for every accepted field family and every draft dependent. |
| Post-lock or post-issue changes use version/adjustment/reversal instead of overwrite | INCOMPLETE | The authority catalog is fail-closed; Q18/Q21/Q22 reports prove adjustment/reversal behavior for issued debit notes, AR, paid/outstanding, and selected expense flows. | The full accepted post-lock behavior is not yet proved for every dependent surface in the chain. |
| All related history remains intact | INCOMPLETE | Governance and period-lock slices retain history for the paths they touch. | No single saved end-to-end proof closes the entire accepted cross-module history guarantee. |

## Q23 — Double submit, flaky network, and concurrent edit/approve

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Same transaction key replays the original result without creating a second effect | INCOMPLETE | `backend/src/services/idempotency.service.ts:221-317`; many current routes now wrap writes with `runIdempotent()`, including trip-expense approve/reject, shipments, trips, advances, config CRUD, direct-money, salary confirmation/close, geotag/upload/OCR, and company expense slices. | Q23 is universal. `reports/q23-material-write-inventory.md` still leaves other material endpoint classes open, and several closure reports are future-dated supplementary evidence only. |
| Duplicate business identifiers are blocked | INCOMPLETE | The inventory report and current schema prove selected unique business identities for trips, shipments, debit-note periods, salary close/confirm, and some settlement links. | The report also documents many material writes that still lack natural uniqueness and rely on route-specific replay instead. |
| Stale editors must reload the new version and cannot silently overwrite | INCOMPLETE | Shipments, trips, governance actions, and generated config CRUD now have strong stale-write proof. | The inventory still leaves mutable billing-document edits, settlement edits, and other mutable surfaces without universal expected-version proof. |
| First valid approval/transition wins; later attempts are rejected | INCOMPLETE | Current code strongly proves this for many approval and transition paths, including debt-offset approve, trip-expense approve/reject, governance actions, advance transitions, portal confirm/dispute, and several route classes named in the inventory. | The inventory still documents remaining race windows and not every material transition class is closed. |
| All attempts and conflicts are logged | INCOMPLETE | `reports/q23-material-write-inventory.md` shows common audit middleware records success/replay/reject/conflict metadata. | The same report explicitly states conflict audit is best-effort async and not transactionally durable; process failure can still lose the attempt record. |

### Q23 exact remaining residual classes

The current inventory plus superseding route-class reports leave Q23 incomplete for these still-open classes:

1. Dedicated identity/admin/settings/config endpoints not explicitly closed by a later replay/stale-write proof, including `/api/auth/*` user/business-unit mutations, `/api/road-config`, `/api/fuel-config`, `/api/company-info`, `/api/salary-periods/default|POST|PUT|DELETE`, `/api/debit-note-templates`, `/api/admin/app-settings`, `/api/admin/app-settings/email`, `/api/admin/gps-settings`, `/api/admin/llm-settings`, `/api/admin/onboarding-settings`, and `/api/admin/faq-entries`.
2. Forwarder and driver operational mutation classes not closed by the later named reports, especially container/seal/photo replacement variants outside the upload/OCR/geotag slice.
3. Mutable billing-document edits where same-key replay and stale-write protection are not yet universally proved for all update/delete paths.
4. Durable conflict-attempt audit logging, which remains best-effort async rather than transactionally coupled to the winning or rejected mutation.

## O01 — Two-way dispatch authority

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| Candidate trip requires planned window, canonical endpoints, cargo weight, and vehicle capacity | PROVED | `backend/src/services/trip-pairs.service.ts`; `reports/o01-two-way-dispatch.md`; `qa/2026-07-27_o01-two-way-dispatch_backend-route-test.rerun5.log`. | None. |
| Pairing blocks overlap, insufficient reposition time, incompatible next origin, and overload | PROVED | Same service/report plus the authority-hardening rerun artifact. | None. |
| Pairing preserves each trip's own status, revenue, and cost | PROVED | The O01 report proves persisted pair linkage instead of financial/status merge; pairing data is stored separately and read back on list/detail/driver surfaces. | None. |
| Cancellation, late completion, cross-day operation, and concurrent pairing are explicitly handled | PROVED | Same O01 report plus focused route/service/driver/dispatch tests and green build. | None. |

## O02 — ACCOUNTANT audit-log access

| Clause | Status | Evidence | Exact gap |
|---|---|---|---|
| ACCOUNTANT may read money/receivable/payment/salary audit entries within assigned scope | PROVED | `backend/src/services/audit-query.service.ts:255-353`; `reports/o02-accountant-audit-scope-implementation.md`; `qa/2026-07-27_o02-accountant-audit-scope_backend-test.log`; `qa/2026-07-27_o02-accountant-assignment_backend-test.rerun2.log`. | None. |
| ACCOUNTANT cannot see security configuration, login-sensitive information, or unrelated operational data | PROVED | Same audit-query service redacts method/path/payload/IP for accountants and filters by finance-domain classification plus assignment condition; focused backend/frontend tests prove negative scope and redaction. | None. |
| Admin/manager broad visibility is preserved while accountant-specific nav is exposed | PROVED | Same O02 report plus frontend route/layout tests. | None. |

## Exact remaining gaps to close

1. Q12: prove the accepted default business category list and the mandatory trip-or-lot support as explicit reachable-boundary invariants, not only internal policy fields.
2. Q13: add configurable-by-title authority or explicitly narrow the accepted rule to category-driven thresholds.
3. Q15: complete and prove the maker/checker/viewer matrix across every accepted governed surface, not only tranche-delivered slices.
4. Q17: close the full clerk editable-surface matrix, especially non-shipment document/seal/photo variants and the forbidden-surface negative proof.
5. Q18: extend the no-direct-edit adjustment-only rule from current trip/AR/debit-note slices to the remaining approved/locked surfaces.
6. Q20: add focused official-reporting proof for completion-date trip count/profit, actual-event fuel attribution, and in-progress exclusion.
7. Q22: close the full end-to-end source-authority matrix across all accepted field families and dependent surfaces.
8. Q23: finish the remaining endpoint classes and replace best-effort conflict audit with durable attempt recording.

## Verdict

Within Q12-Q23 and O01-O02, the currently fully proved accepted items are **Q14, Q16, Q19, Q21, O01, and O02**. All other items in this range are implemented at least partially, often strongly, but remain `INCOMPLETE` because the accepted clause is broader than the proved slice or because a concrete residual gap remains on the reachable production boundary.
