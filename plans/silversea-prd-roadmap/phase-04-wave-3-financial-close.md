---
phase: 4
title: "Wave 3 — Financial Close"
status: pending
priority: P1
dependencies: [1, 2, 3]
---

# Phase 4: Wave 3 — Financial Close

## Overview

Close the accountant-side loop: receivables management (M5), payables including fuel AP
(M6), salary period close + ledger posting (M7.3), and disbursement classification
(M4.6/4.7). All of this relies on the clean shipment + pricing data landed in Waves 0–2
and the approved-expense pipeline built in Wave 2's debit-note work.

**PRD modules touched:** M5 (5.1–5.8), M6 (6.1–6.4), M7.3, M4.6, M4.7.

**Already largely built** — this wave is mostly *extending* existing engines, not greenfield.

## Existing code built on

- `ledger` (append-only double-entry) + `financial.service.ts` + `ledger.service.ts`.
- AR aging report (`reports/receivables-aging`) + customer/supplier statements.
- `receivables.service.ts`, `payables.service.ts`, `debtOffset.service.ts`.
- `payments/receive`, `payments/vendor`, `payments/carrier` endpoints.
- `salary_periods` + `salary_confirmations` + `driver_work_days` + driver payout endpoint.
- `trip_expenses` approval workflow + `forwarder_expense_types` (with `vatRate`,
  `defaultMarkup`, `billingLabel`).
- `advance_settlements` with check/approve/reject states.
- The Wave-0 scheduler is now available to host period-close and reminder jobs.

## Requirements (mapped to PRD acceptance codes)

- **M5.1 — AR tracking by debit-note/invoice** (mostly done)
  - Today: AR aging + customer statement work. Gap: surface "paid / outstanding / overdue-
    days / payment history" per document in one view (M05-01-01 detail).
  - Void/adjustment must leave a clear offsetting line, not vanish (M05-01-03).
- **M5.2 — Aging buckets** (mostly done)
  - Buckets <30 / 31–60 / 61–90 / >90 already implemented.
  - Edge cases at exactly 30/60/90 and holidays (M05-02-03) — verify, not rebuild.
- **M5.3 — Credit limit + threshold warnings** (new)
  - `customers.creditLimit` exists. Add: `credit_warning_threshold` (e.g. 80%) configurable
    per customer; warn on near-limit and on exceed (M05-03-01).
  - New sales/shipment blocked at limit unless approver overrides with reason (M05-03-04).
  - Show: limit / current balance / remaining / the orders pushing over (M05-03-01).
- **M5.4 — Freight vs. disbursement split** (new report view)
  - Each AR line keeps its group (freight / service / disbursement / adjustment); sums must
    reconcile: `freight + disbursement + other == total_ar` (M05-04-03).
  - Unallocated payment needs a documented allocation rule; must not corrupt VAT reports
    (M05-04-04).
- **M5.5 — Total AR report incl. freight + disbursement** (extends existing)
  - Opening / activity / receipts / adjustments / closing per customer (M05-05-01).
  - Customers with no activity but a balance still appear (M05-05-03).
- **M5.6 — Payment allocation by trip / shipment** (new)
  - One receipt → many shipments/trips; allocation per customer instruction; default
    oldest-first (M05-06-03).
  - Cannot over-allocate beyond receipt amount or beyond outstanding unless surplus
    acknowledged (M05-06-03).
- **M5.7 — Auto receivable reminders** (new — uses Wave-0 scheduler)
  - Scheduler job: daily, for each overdue or due-soon debit note, send reminder via the
    Wave-2 email + in-app channel.
  - Skip paid / disputed / suspended customers; avoid duplicate sends in same cycle
    (M05-07-03). Failed sends retry and alert the responsible person (M05-07-03).
- **M5.8 — Statement + debit-note export** (extends existing)
  - XLSX exists; PDF needed for debit notes (statements already have PDF). Confirm match
    between screen and export (M05-08-03).
- **M6.1 — Fuel AP tracking** (new report)
  - Reconcile fuel invoices against fuel recorded per truck × period; record AP once per
    invoice (M06-01-01).
  - Adjustment invoices or litre-variance must be explained before approval (M06-01-03).
  - Show: paid / outstanding / due-date / variance vs. fuel data (M06-01-01).
- **M6.2 — AP for carriers, ports, warehouses, services** (extends suppliers)
  - Suppliers already support `linkedCustomerId` and `isFuelSupplier`. Extend with a
    `supplier_type` taxonomy (CARRIER/PORT/WAREHOUSE/SHIPPING_LINE/CUSTOMS/SERVICE/FUEL).
  - Each AP line links the right supplier + source document (M06-02-01).
- **M6.3 — Supplier invoice tracking + payment** (extends existing)
  - Invoice receive date / due date / amount / payment schedule / payment ref.
  - AP aging (mirror of AR aging). Partial payment allowed; no double-record of same payment
    ref (M06-03-03).
  - Pre-payment or overpayment recorded as advance/unallocated, not negative AP (M06-03-03).
- **M6.4 — Bilateral debt offset** (already built)
  - `debt_offsets` table + approve flow exist. Verify against M06-04 rules: offset ≤ smaller
    side; booked only after approval; cancel-after-approve uses reversal entry (M06-04-03).
- **M7.3 — Salary period close + ledger posting** (new close step)
  - Already: salary calculation + `salary_confirmations` (DRAFT/CONFIRMED).
  - Add a *period close* that: requires all drivers confirmed, no missing/conflicted data,
    then posts a single labor-cost ledger entry and locks the period (M07-03-03).
  - Re-open requires controlled flow or adjustment; no duplicate entries (M07-03-03).
  - Two simultaneous close attempts must not double-post (M07-03-05).
- **M4.6 — Invoice-backed disbursement classification** (extends expenses)
  - Categories requiring an invoice must have full invoice data before approval; never guess
    VAT when missing (M04-06-03).
  - Adjustment / replacement / multi-line invoices link clearly, no double-count (M04-06-03).
- **M4.7 — Non-invoice disbursement classification** (extends expenses)
  - Only allowed for permitted categories; mandatory reason + substitute evidence (M04-07-03).
  - Over-threshold or no-evidence items rejected or sent for approval (M04-07-03).
  - Report separates no-invoice items, still traceable to approver (M04-07-01).

## Architecture

Most work is service-layer extensions + new reports + scheduler jobs. Few schema changes:

- `customers`: add `creditWarningThreshold`, `paymentTermDays`.
- New `payment_allocations` table: paymentId, entityType (SHIPMENT/TRIP/DEBIT_NOTE),
  entityId, amount, allocatedBy, allocatedAt — supports M5.6.
- New `supplier_type` enum or column on `suppliers`.
- New `salary_period_closes` table: period, closedBy, closedAt, ledgerEntryId, snapshot.
- `expense_categories` (already exists): add `requiresInvoice` boolean (M4.6/4.7 rule
  source-of-truth) + `substituteEvidenceAllowed` boolean.
- Reminder scheduler job registered in the Wave-0 scheduler.

## Related Code Files

- Modify: `backend/src/db/schema.ts` (small additions)
- Modify: `backend/src/services/receivables.service.ts`, `payables.service.ts`,
  `financial.service.ts`, `salary.service.ts`, `expense.service.ts`
- Create: `backend/src/services/credit-limit.service.ts`, `payment-allocation.service.ts`,
  `salary-close.service.ts`, `fuel-ap.service.ts`, `reminder.service.ts`
- Create: scheduler jobs registered in `backend/src/scheduler/registry.ts`
- Modify: `backend/src/routes/financial/reports.routes.ts` (new report endpoints)
- Modify: `backend/src/routes/financial/payments.routes.ts` (allocation endpoint)
- Modify: `backend/src/routes/salary.ts` (period close endpoint)
- Frontend: extend FinancePage, DebtListPage, PayableListPage, SalaryAttendancePage;
  add credit-limit widget; add fuel-AP reconciliation page.

## Implementation Steps

1. Schema: credit-limit threshold, payment_allocations, supplier_type, salary_period_closes,
   expense-category flags.
2. Credit-limit service + blocking hook on shipment/trip create.
3. Payment-allocation service + endpoint; AR line-group reconciliation check.
4. Reminder scheduler job + template + customer-suspend rule.
5. Fuel-AP reconciliation report (joins fuel invoices ↔ trip fuel figures by truck/period).
6. Salary period-close service + endpoint + ledger posting + lock.
7. Expense-category `requiresInvoice` enforcement on approval (M4.6/4.7).
8. AR report extension: opening/activity/receipts/adjustments/closing per customer.
9. Frontend widgets and report pages.
10. Reconciliation tests: AR sum = ledger sum; AP sum = ledger sum; salary close posts once.

## Success Criteria

- [ ] M05-03-04: new shipment blocked at credit limit unless approver overrides with reason.
- [ ] M05-04-03: `freight + disbursement + other == total_ar` for every customer.
- [ ] M05-06-03: cannot over-allocate a receipt; surplus requires acknowledgement.
- [ ] M05-07-03: reminders skip paid/disputed/suspended; no duplicate in cycle.
- [ ] M06-01-03: fuel-invoice variance blocks approval until explained.
- [ ] M06-03-03: same payment ref cannot be recorded twice; overpayment stays unallocated.
- [ ] M07-03-03: salary close posts exactly one ledger entry; locked period rejects edits.
- [ ] M07-03-05: two concurrent close attempts do not double-post.
- [ ] M04-06-03: invoice-required category blocks approval without full invoice data.
- [ ] M04-07-03: no-invoice item over threshold routed to approval; not silently accepted.

## Risk Assessment

- **Reminder noise / customer fatigue** — over-sending reminders damages the relationship.
  Mitigation: per-cycle dedupe, configurable frequency, mandatory opt-out for disputed items.
- **Salary double-posting** — highest financial risk in the wave. Mitigation: idempotent
  close (unique constraint on `salary_period_closes(period, driver)`; ledger entry id
  recorded; re-close is a no-op or reversal).
- **Payment-allocation correctness** — allocating one receipt across many shipments is easy
  to get wrong. Mitigation: post-allocation invariant check
  `Σ(allocations for receipt) == receipt.amount`; atomic transaction.
- **Fuel-AP reconciliation edge cases** — invoices spanning many trucks, credit notes,
  cross-period trips. Mitigation: keep the reconciliation *advisory* first (a report that
  flags variance) before making it *enforcing*; let accountants resolve variances manually.

## Open PRD questions to confirm before this wave

- M5.3 §1: confirm credit-warning threshold default (80%? per customer?).
- M5.3 §5: confirm who can approve an over-limit exception.
- M5.4 §5: confirm the allocation rule for unallocated payments (proportional? oldest-first?
  freight-priority?).
- M5.7 §4: confirm reminder frequency and quiet-hours; confirm email vs. in-app priority.
- M6.1 §1: confirm whether fuel invoices are per-truck or aggregated (affects reconciliation
  granularity).
- M6.2 §1: confirm the supplier-type taxonomy and whether a supplier can have multiple types.
- M7.3 §1: confirm whether period close is per-driver or per-company-period (assumed per
  company period covering all confirmed drivers).
- M4.7 §2: confirm which categories permit substitute evidence and what counts as evidence.
- M4.7 §5: confirm the over-threshold rule (auto-reject vs. route-to-approval).
