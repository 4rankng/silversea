# Remaining domain gap map — Q01–Q14, Q20, O01/O02

**Read-only source audit:** 2026-07-27  
**Authority:** `docs/prd/business-logic-qa-proposals.md` (all listed rules accepted)  
**Scope boundary:** current working tree only; no code, migrations, QA artifacts, plan status, or `HANDOFF.md` changed. Concurrent Phase 2 work is present, so uncommitted source is treated as current implementation, not as green QA proof.

## Baseline corrections

The Phase 1 baseline overstates exact accepted-rule coverage:

- **Q01 is not PROVED:** `checkCreditLimit()` reads only posted AR outstanding, has no proposed shipment/trip value, and `assertCreditLimit()` has no production caller.
- **Q03 is not PROVED:** `allocatePayment()` sorts by `trips.departureDate, trips.id`, not persisted due date then issue date.
- **Q07 is not PROVED:** supplier multi-type storage exists, but there is no primary supplier type.
- **Q09 is not PROVED:** company-period close exists, but no per-driver Ready/Pending readiness model or pre-close completeness gate exists.
- **Q11 is not PROVED:** reopen is role-gated but does not check payslip issuance, payment, or posting; the current reversal is a company-summary reversal, not the accepted post-close adjustment lifecycle.
- **Q12 is not PROVED:** category flags and a non-empty note are enforced, but the accepted evidence taxonomy and mandatory payee/date/reason/evidence fields are not modeled.

The remaining baseline classifications (Q02/Q04/Q05/Q06/Q08/Q10/Q13/Q14/Q20/O01/O02 as partial) are directionally correct, but several “primary evidence” files prove only isolated helpers, not reachable end-to-end behavior.

## Rule-by-rule implementation map

### Q01 — credit exposure and warning

- **Verified existing:** `customers.creditLimit` and `customers.creditWarningThreshold` in `backend/src/db/schema.ts`; `checkCreditLimit()`/`assertCreditLimit()` in `backend/src/services/credit-limit.service.ts`; threshold unit coverage in `backend/src/tests/m53-credit-limit.test.ts`; credit-limit edit/display in `frontend/src/pages/CustomersPage.tsx`.
- **Exact remaining gap:** exposure is only `getCustomerArSummary().outstanding`; approved-but-uncollected commitments and the proposed shipment/trip value are absent. The 80% default is a code fallback, not seeded/configured authority; `customerSchema` and customer UI do not expose `creditWarningThreshold`; neither credit helper is called by a create/dispatch path.
- **Implementation:** introduce one server-owned exposure calculation accepting a proposed material amount and counting posted AR plus approved commitments; call it transactionally before shipment dispatch/trip creation or other service-continuation writes. Add global seeded warning policy plus per-customer override to shared schema/API/UI.
- **Migration/tests:** additive credit-policy/app-config seed and, if approved commitments are not derivable from authoritative rows, an explicit commitment projection/status. Extend `m53-credit-limit.test.ts`; add route/service integration and E2E for 79.99%, 80%, 99.99%, 100%, proposed-value crossing, and concurrent creates.

### Q02 — tiered credit override

- **Verified existing:** `checkCreditLimit(customerId, approverOverride: boolean)` can mark a result overridden; `m53-credit-limit.test.ts` proves only the boolean helper. No caller was found outside that service/test.
- **Exact remaining gap:** a caller-supplied boolean is not approval. There is no approver identity/authority tier, ≤10% plus configured money cap, repeat-exception escalation, shipment/trip scope, expiry, reason, persisted decision, maker-checker rule, or first-approve-wins state.
- **Implementation:** add a `credit_override_requests` workflow linked to exactly one shipment/trip or a bounded expiry, with requested exposure snapshot, over-limit amount/ratio, reason, requester, tier, approver, decision and expiry. Server derives required tier; finance-lead authority handles both configured caps, director/delegate handles larger or repeated cases. Q01’s gate consumes only a valid approved, unexpired, matching request.
- **Migration/tests:** additive table, decision/status checks, active-scope indexes and optimistic/row locking; do not encode thresholds in code. Add focused service/route tests plus AR UI/E2E; prove CUS/dispatcher cannot bypass, creator cannot approve, wrong scope/expired approval fails, repeat escalates, and two approvers yield one decision.

### Q03 — unspecified payment allocation

- **Verified existing:** `allocatePayment()` in `backend/src/services/payment-allocation.service.ts` serializes per customer, prevents over-allocation, writes allocation plus ledger entries atomically, supports manual instructions, and returns unapplied excess. `backend/src/tests/m56-payment-allocation.test.ts` covers these mechanics.
- **Exact remaining gap:** “oldest due, then oldest issue date” is not implemented; ordering uses trip departure date/id. Receipt idempotency is not database-enforced (`payment_allocations.receiptId` is only indexed), so the same receipt can allocate again while other debt remains.
- **Implementation:** order from immutable obligation `processingDueDate`, then authoritative issue/post timestamp/id; retain explicit customer instructions as `MANUAL`. Make receipt identity unique at the receipt/application boundary and return the original result on replay.
- **Migration/tests:** likely a receipt/application header with unique `(customerId, receiptId)` and child allocations, or an equivalent unique registry; backfill existing allocation groups. Add equal-due/different-issue, due-date-vs-departure, partial replay, and concurrent replay tests.

### Q04 — reminder schedule

- **Verified existing:** current concurrent work in `receivable-reminder.service.ts` adds deterministic `now`, business-calendar use, 08:00–17:30 gating, one-summary/day, and T-3/due/T+3 matching from frozen `processingDueDate`; scheduler wiring is in `backend/src/index.ts`. Existing `m57-receivable-reminder.test.ts` proves the older skip/send/dedupe surface, not the complete new schedule.
- **Exact remaining gap:** `REMINDER_STAGES` has no “every 7 days after T+3”; weekend/holiday rollover matches a date but does not enforce **09:00** (the 15-minute scheduler can send at 08:00); dispute remains an overpayment proxy rather than explicit dispute state. New concurrent behavior has no complete focused test proof yet.
- **Implementation:** add recurring post-T+3 stage calculation, exact per-item scheduled instant/business-date semantics, explicit dispute/suspension authority, and a durable per-customer/per-scheduled-day dedupe key rather than `createdAt::date`.
- **Migration/tests:** add explicit dispute state and reminder occurrence/schedule key if not carried by the email log; unique dedupe index. Extend `m57-receivable-reminder.test.ts` for T-3/due/T+3/+10/+17, 08:00/17:30 boundaries, weekend/holiday 09:00 roll, make-up weekend, mixed-summary, paid/disputed/suspended stops, timezone, and concurrent scheduler ticks.

### Q05 — channel, retry, fallback

- **Verified existing:** current `sendEmail()`/`retryEmail()` persistence and `runReceivableReminderRetries()` implement 15m/2h/24h retry intent; internal notification evidence and terminal CLERK/finance alert are present in `receivable-reminder.service.ts`; retry scheduler is registered in `index.ts`.
- **Exact remaining gap:** the simultaneous in-app notification targets internal financial roles, not the customer account promised as customer fallback; the full retry clock/terminal-once behavior is not covered by focused current tests. Internal evidence copy correctly says it is not provider delivery proof, but customer-visible delivery remains absent.
- **Implementation:** create a customer-scoped portal notification at the same reminder occurrence while retaining separate provider email status; keep internal escalation as a distinct event. Make each retry attempt and terminal escalation idempotent/auditable.
- **Migration/tests:** reuse notifications only if it can enforce customer scope; otherwise add customer notification recipient/link plus retry-attempt/terminal marker fields. Test customer isolation, email failure with in-app success, exact retry eligibility, stop-condition suppression between attempts, terminal alert once, and no false SENT evidence.

### Q06 — multi-truck fuel invoice

- **Verified existing:** `getFuelApReconciliation()` and `m61-fuel-ap-recon.test.ts` report expected/invoiced amounts per supplier/truck. `fuel-recon-guard.service.ts` blocks unexplained variances.
- **Exact remaining gap:** `trip_expenses` is one trip/truck expense row with optional invoice number/date and buy amount. There is no invoice header, allocation lines, invoice litres/unit price, voucher link, allocation completeness, or approval state for a single invoice spanning trucks. Current per-truck reporting infers truck through each trip and can duplicate header data; it does not prove the accepted allocation rule.
- **Implementation:** add immutable fuel-invoice header and per-truck allocation lines linked to actual fuel voucher/log evidence (plate, event date, litres). Compute line amount from actual litres × invoice unit price using shared rounding; header approval requires exact litres/amount reconciliation and no unallocated remainder. Never equal-split.
- **Migration/tests:** additive `fuel_invoices` + `fuel_invoice_allocations` (and voucher link) with unique supplier/invoice identity, currency, totals and approval metadata. Backfill existing single-truck invoiced expenses one header/line where unambiguous; quarantine ambiguous duplicates as unallocated, never invent litres. Extend `m61` and guard tests; add API/UI/E2E for two trucks, partial evidence, rounding remainder, duplicate invoice, and concurrent approval.

### Q07 — supplier categories and primary

- **Verified existing:** `suppliers.types text[]`, `normalizeSupplierTypes()`, `syncFuelFlag()`, and `m62-supplier-types.test.ts` prove multi-type taxonomy and legacy fuel-flag synchronization. Transactions retain their own `expenseType`.
- **Exact remaining gap:** no primary type column, invariant that primary belongs to `types`, reporting/default behavior, or UI/API field exists. Therefore the baseline’s “primary reporting semantics” claim is false.
- **Implementation:** add `primaryType` as reporting/default metadata only; validate `primaryType ∈ types`, and never rewrite an existing expense/invoice classification when it changes.
- **Migration/tests:** additive nullable primary type, deterministic backfill only for suppliers with exactly one type (leave multi/none unresolved), then service/shared/API/UI tests for invariant, reporting default, and transaction-classification immutability.

### Q08 — legal partner duality and manual offset

- **Verified existing:** customer/supplier mutual link ids; debt-offset create/approve/cancel in `debtOffset.service.ts`; bounded amount, paired ledger entries/reversals, maker-checker and concurrent approval tests in `m64-debt-offsets.test.ts`; routes in `routes/financial/debt-offsets.routes.ts`.
- **Exact remaining gap:** links are manually paired ids, not one legal-partner authority keyed by normalized tax code and can drift. No currency exists on ledgers/offsets; no minutes/document evidence is required; `note` is optional. Approval checks balances and roles but not legal-entity equality, currency equality, or signed minutes.
- **Implementation:** introduce canonical `partners` keyed by normalized nonblank tax code; customer and supplier roles reference it while AR/AP ledgers remain separate. Offset creation must select balances for the same partner and currency, require minutes evidence, reason and approval, and remain manual.
- **Migration/tests:** additive partner and partner-role links, currency snapshots on ledger/offset, minutes evidence reference/hash, approval metadata. Backfill only exact normalized tax-code matches; preserve unmatched/conflicting records for manual resolution. Add negative tests for cross-entity, cross-currency, missing minutes, self-approval, excessive amount, cancellation/reversal, stale balances and concurrent approval.

### Q09 — company/payroll-unit close

- **Verified existing:** `salary_period_closes.period` is unique; `closeSalaryPeriod()` aggregates all driver salary ledger rows for the period under one lock; `m73-salary-period-close.test.ts` proves idempotent company-summary close. Current Phase 2 `period-lock.service.ts` adds shared period authority.
- **Exact remaining gap:** no configured payroll unit scope and no Ready/Pending state per active driver before close. Per-driver `salaryConfirmations` are DRAFT/CONFIRMED but are not a close-readiness authority and are not checked by `closeSalaryPeriod()`.
- **Implementation:** model a close run scoped to company or configured payroll unit, materialize every in-scope active driver’s readiness result, and require all drivers to be Ready or explicitly handled by Q10 before closing.
- **Migration/tests:** additive payroll-unit/scope and close-run driver readiness rows with diagnostic codes and frozen totals. Backfill existing closes as legacy global snapshots without fabricating readiness. Extend `m73` plus API/UI/E2E for global/unit cohort completeness and prohibition of independent driver close.

### Q10 — money-affecting error gate and approved exclusion

- **Verified existing:** close transaction/role/period locking exists; attendance and salary computation can return per-driver results. No readiness/error scan is called from `closeSalaryPeriod()`.
- **Exact remaining gap:** any period can close even with missing/null salary computations, incomplete attendance, unresolved money-affecting errors, or unconfirmed drivers. There is no authorized exclusion request, reason, Pending supplement state, supplementary period/link, or audit trail.
- **Implementation:** create a deterministic readiness evaluator with money-affecting vs informational diagnostics. Close defaults to whole-period rejection on any blocking driver. An authorized exclusion is a separate approved record with maker-checker, reason, original period, driver and follow-up supplementary/adjustment target; it must never silently drop the driver.
- **Migration/tests:** readiness/exclusion/supplement linkage tables or equivalent append-only close-run children; indexes preventing duplicate active exclusions. Tests for one bad driver blocking all, informational warning not blocking, unauthorized/self exclusion, approved exclusion totals, follow-up linkage, and concurrent close/exclusion.

### Q11 — reopen and post-close correction

- **Verified existing:** `reopenSalaryPeriod()` is ADMIN/MANAGER-only, serialized and idempotent; it writes a reversing company-summary ledger entry; Phase 2 period authority mirrors CLOSED/REOPENED.
- **Exact remaining gap:** reopen does not inspect payslip issued, salary paid, or official posting state. It permits reopen whenever a close exists. No “prefer adjustment in current open period,” original-period linkage, director/delegate authority, versioned before/after values, or immutable post-payment path is enforced.
- **Implementation:** persist issuance/payment/posting milestones on the close run. Allow reopen only before all three and only to configured director/delegate authority with reason. Otherwise create an append-only adjustment/reversal in an open supplementary/current period linked to the original close and driver.
- **Migration/tests:** lifecycle milestone and salary-adjustment tables/links; preserve existing closes as legacy with unknown milestones and require explicit reconciliation before reopening. Test each milestone boundary, authorized delegate, adjustment totals/linkage, no direct mutation, and concurrent reopen/adjust.

### Q12 — allowed categories and substitute evidence

- **Verified existing:** `requiresInvoice`/`substituteEvidenceAllowed` on expense types/categories; invoice-required and no-invoice guards; trip/amount/note and optional photos exist; `m37-invoice-required.test.ts` and `m47-no-invoice-disbursement.test.ts` cover isolated flags/note checks.
- **Exact remaining gap:** no seeded accepted default category policy is authoritative; no per-category evidence taxonomy; a note alone is treated as evidence. Payee/recipient, actual expense date, explicit reason, typed evidence, evidence occurred-at/location/signature/payment proof, and policy snapshot are absent for `trip_expenses`.
- **Implementation:** versioned no-invoice policy per category containing allowed evidence types. Request requires amount, actual date, payee, trip/shipment, reason, and at least one typed evidence record satisfying that category’s policy.
- **Migration/tests:** additive policy/version, request metadata and evidence child rows; seed accepted defaults; retain legacy rows with a legacy-policy marker, not invented evidence. Test every required field/evidence type, category disallow, policy version retention, mobile upload and server-side enforcement.

### Q13 — configurable thresholds and anti-splitting

- **Verified existing:** constants `PER_ITEM_THRESHOLD = 1_000_000` and `DIRECTOR_THRESHOLD = 5_000_000`; report flags only >5M. The service explicitly says daily aggregation is deferred.
- **Exact remaining gap:** 1M/item and 5M/person/day are hard-coded/non-enforcing; no category/title overrides, explicit payee identity, same-person/date/category aggregation, anti-splitting lock, or policy snapshot exists.
- **Implementation:** build on Q12’s payee/category/date and versioned policy. Resolve per-item and per-day caps by category and title, aggregate all non-canceled relevant states for the same key inside a transaction, and serialize that key before submit/approval.
- **Migration/tests:** policy threshold columns plus immutable applied-policy snapshot; supporting composite index and advisory/row locking. Test exact boundaries, split 3× below item cap, cross-category/day/person separation, cancellation, concurrent splits, and policy changes after submission.

### Q14 — evidence return and approval tiering

- **Verified existing:** `assertNoInvoiceDisbursementAllowed()` blocks missing note and requires MANAGER/ADMIN above 5M; `transitionApproval()` is row-locked; `m47-no-invoice-disbursement.test.ts` covers this narrow behavior.
- **Exact remaining gap:** missing evidence throws a generic 400; there is no RETURNED_FOR_EVIDENCE state, return reason, resubmission/version history, or UI distinction. ≤5M “finance lead” vs >5M or >10M/day “director” is approximated by broad roles and ignores daily aggregate. `trip_expenses` lacks creator attribution for accountant-created rows, so self-approval cannot be enforced.
- **Implementation:** after Q12/Q13, validation first routes incomplete evidence to a return/resubmit lifecycle; only complete over-limit requests enter tiered approval. Derive tier from per-item and aggregated day totals, use configured approval authority/delegation, record reason, and enforce creator ≠ approver.
- **Migration/tests:** request lifecycle/history, createdBy/returnedBy/approvedBy, decision reason, required tier and policy snapshot. Test missing evidence never enters approval, resubmit preserves history, 5M/5M+1 and 10M/day boundaries, creator self-approval, delegated authority, and concurrent first approval.

### Q20 — completion-period/event-date attribution

- **Verified existing:** trip transition stamps `trips.completedAt`; completion posts trip revenue/salary ledger entries; in-progress trips are excluded from `pnl.service.ts` official P&L by status. Attendance rows can cover departure through an arrival date.
- **Exact remaining gap:** major consumers still filter trips by `departureDate`: `pnl.service.ts`, `dashboard-stats.service.ts`, `billing-line-assembly.service.ts`, `billingDocument.service.ts`, `profit-distribution.service.ts`, driver earnings and fuel reconciliation. Salary close groups ledger by posting timestamp, not an explicit completion-period snapshot. Completion routes pass `actualArrivalDate = null`, so attendance collapses to departure day. Fuel/expense event dates are inconsistent (`departureDate`, invoice date, created date). No cross-period contract test exists.
- **Implementation:** define a shared attribution authority: revenue/salary/trip-count/profit use immutable completion business date; attendance/fuel/expense use their actual event date; incomplete trips are excluded from official totals. Persist event/attribution dates on ledger/derived records and migrate every report/query to the same helper/columns.
- **Migration/tests:** additive completion/attribution/event-date snapshots and indexes; backfill from `completedAt` where present, otherwise mark legacy-unresolved rather than substitute departure date silently. Add cross-midnight/month tests covering trip, ledger, salary close, P&L, dashboard, debit note, profit distribution, attendance, fuel and expense in one end-to-end fixture.

### O01 — actual two-way dispatch pairing

- **Verified existing but distinct:** `dispatch-handoff.service.ts` and `dispatch_handoffs` implement **shipment handoff** UNSEEN→SEEN→ACCEPTED/REJECTED; `m103-handoff-service.test.ts` and `wave4-handoffs-schema.test.ts` prove that flow. Separately, `getDriverTwoOrdersView()`/`DriverTwoOrdersPage.tsx`, `m83-two-orders.test.ts`, and `DriverTwoOrdersPage.test.tsx` show independent same-day trips. Trip legs support origin/destination and containers carry cargo weight.
- **Exact remaining gap:** neither flow is O01 pairing. There is no trip-pair entity, server eligibility, planned start/end timestamps, canonical location ids, vehicle capacity, cargo-total snapshot, reposition-time calculation, ordered pair API, cancellation/delay propagation, cross-day support, concurrent pair lock, dispatcher UI, or paired driver view. Current two-orders query is today-only by `departureDate`/`createdAt`, and `firstOrderLate` is advisory.
- **Implementation:** first establish canonical inputs on each candidate trip/vehicle; then a deterministic pairing service validates no overlap, reposition buffer, location compatibility and capacity. Persist only the relationship/order and pairing decision snapshot; keep each trip’s status, revenue, cost and ledger independent. Cancellation unpairs or marks the relationship while preserving the survivor.
- **Migration/tests:** additive canonical location references, planned timestamps, vehicle capacity, cargo snapshot and `trip_pairs` with ordered unique membership/version fields. Backfill no pairs; legacy trips remain unpaired until inputs are complete. Add pure eligibility tests, transactional service/route/RBAC tests, dispatcher + driver responsive tests/E2E for valid return, overlap, impossible reposition, overload, delay, cancellation, cross-day, concurrent pairing and FORWARDER denial.

### O02 — ACCOUNTANT audit parity and scope

- **Verified existing:** Casbin grants ACCOUNTANT `audit_logs` read; `/api/audit-logs` is mounted with that resource; `App.tsx` admits ACCOUNTANT through `officeStaffOnly`; `AuditLogPage` is read-only.
- **Exact remaining gap:** `queryAuditLogs()` returns the same broad log set (including actor, path, payload and IP) for every admitted role; no assigned-scope or financial/payroll category constraint is applied. `Layout.tsx` exposes the audit navigation item only to ADMIN/MANAGER, so ACCOUNTANT lacks desktop and mobile discovery.
- **Implementation:** pass authenticated viewer context into `queryAuditLogs()` and apply a server-owned ACCOUNTANT allowlist for money/receivables/payments/salary plus assigned scope; explicitly exclude auth/security/config/sensitive payload fields. Add ACCOUNTANT to the single responsive nav source while keeping the page read-only.
- **Migration/tests:** no schema migration is required if existing audit event/category metadata and assignment scope are sufficient; otherwise add normalized audit domain/scope columns and backfill only deterministically classifiable rows. Add backend positive/negative scope tests, payload redaction tests, Layout desktop/mobile tests, direct-route test and ACCOUNTANT E2E; assert ADMIN/MANAGER behavior is unchanged.

## Dependency-safe execution order

1. **Consume Phase 2 authorities first:** do not duplicate business calendar, period locks, maker-checker/concurrency, idempotency or customer-scope work already in progress. Rebase each lane on the final Phase 2 schema and green QA.
2. **AR lane:** Q01 exposure authority → Q02 override workflow; independently correct Q03 obligation ordering/idempotency; then finish Q04 schedule and Q05 customer/internal delivery on the frozen due-date authority.
3. **AP lane:** Q07 primary-type invariant (small prerequisite) → Q06 invoice header/allocation → Q08 canonical partner/currency/minutes. Q06 can develop in parallel with the partner backfill design, but offset release waits for the canonical partner authority.
4. **Payroll/time lane:** Q20 canonical attribution first → Q09 scoped close/readiness → Q10 blocking/exclusion → Q11 reopen/adjustment lifecycle. This prevents close/readiness code from freezing the wrong departure-date cohort.
5. **No-invoice lane:** Q12 policy/payee/evidence model → Q13 aggregation/locking → Q14 return/resubmit and tiered approval. Do not bolt Q13/Q14 onto the current note-only record.
6. **Audit/dispatch lane:** O02 is independent and low-migration; ship it before O01. For O01: canonical schedule/location/capacity/cargo → pure eligibility → persisted pairing/concurrency → APIs/RBAC → dispatcher and driver responsive UI.
7. **Integrated proof:** cross-module Q20 fixture, financial invariants, all affected typechecks/tests/build/E2E, responsive role matrix, migration on clean and upgraded databases, and artifacts under `qa/`.

## Migration discipline

- Add new Drizzle migrations after the current journal head; do not modify historical migrations.
- Use additive nullable columns/tables first, deterministic backfills second, validation/reporting of unresolved legacy rows third, and only then tighten constraints.
- Never infer legal-entity identity, litres, evidence, readiness, completion date, currency or approval from ambiguous legacy text.
- Q06, Q08, Q09–Q14, Q20 and O01 are schema-bearing. Q01/Q02/Q03/Q04/Q05 likely need schema for durable policy/workflow/idempotency; O02 may remain code-only if existing audit metadata is sufficient.

Status: DONE  
Summary: Current source/tests were traced for every assigned rule, six false “PROVED” baseline claims were corrected, and exact implementation/migration/test gaps were ordered into dependency-safe lanes.  
Concerns/Blockers: Concurrent Phase 2 and reminder work is uncommitted; re-read those touched files and require green QA before treating the current WIP as proven.
