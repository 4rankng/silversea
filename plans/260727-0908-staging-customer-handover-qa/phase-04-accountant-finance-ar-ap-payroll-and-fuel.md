---
phase: 4
title: ACCOUNTANT Finance AR AP Payroll and Fuel
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 4: ACCOUNTANT Finance AR AP Payroll and Fuel

## Overview

Cover the broad ACCOUNTANT surface for pricing, expenses, AR, AP, payroll,
penalties, settlements, fuel, and financial exports. State-changing actions are
not run unless separately authorized.

## Coverage

- M2: pricing tables, weight tiers, lift pricing, ancillary revenue, effective
  dates, boundary validation, override-reason UI.
- M4-M6: expenses, advances/settlements, debt/customer ledgers, debit notes,
  payment allocation, reminders, payables/suppliers, invoices, payments, offsets.
- M7: salary/attendance calendar, salary periods, close/reopen controls,
  penalties, driver drill-down and payslip reconciliation.
- M11/M12: finance/P&L, fuel config/norms, pump evidence/OCR review, invoice
  reconciliation, exports.
- RBAC: user management must remain driver-scoped; audit/App Settings/monitoring
  must not become usable through direct URLs.

## Session procedure

1. Sweep reachable routes at all standard viewports and accountant home at 320px.
2. Check full `vi-VN` money digits, totals, negative/zero states, date/time,
   table/card transformation, sticky controls, dialogs, export affordances,
   and no lost actions on narrow screens.
3. Validate forms up to submit; do not approve, pay, close, unlock, or delete.
4. Give Q01-Q14 and Q18-Q23 authority `pending`; if authority prevents an
   expectation, use execution `BLOCKED` with reason `AUTHORITY`. Neutral
   invariants may still execute independently.
5. Preclassify mutation-dependent M7.2 save, locked-edit, authorization,
   double-submit/concurrency, and audit cases as `NOT_RUN` with reason
   `MUTATION_NOT_AUTHORIZED`. Only fixture-backed display/reconciliation can run.

## Success Criteria

- [ ] Every ACCOUNTANT route and financial action is assigned an evidence/result cell.
- [ ] No financial display rounds incorrectly or disagrees with its visible subtotal.
- [ ] Exports are queued for content/fidelity verification, not passed from button presence.
- [ ] M7.2 and pending business-policy cases are not falsely certified.

## Risks

This lane carries the highest financial risk. Any unexplained total, permission,
or locked-state mismatch is at least P1 until reconciled to source records.
