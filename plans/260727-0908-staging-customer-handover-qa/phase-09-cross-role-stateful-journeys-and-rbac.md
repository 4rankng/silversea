---
phase: 9
title: Cross-Role Reconciliation RBAC and Optional Stateful Extension
status: completed
priority: P1
dependencies:
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
---

# Phase 9: Cross-Role Reconciliation, RBAC, and Optional Stateful Extension

## Overview

Reconcile existing records across roles and run negative access checks after the
parallel visual lanes. Persistence, lifecycle, duplicate, and concurrency cases
remain not run unless the user separately authorizes disposable business data.

## Read-only journeys

1. **Operating:** trace an existing shipment → trip → MANAGER view → assigned
   DRIVER/FORWARDER view → history/audit where authorized.
2. **Money:** reconcile an existing forwarder expense/settlement → ACCOUNTANT
   source → debit note → CUSTOMER amount/export → AR/AP/dashboard/P&L views.
3. **Payroll:** reconcile an existing attendance/salary/penalty period to DRIVER
   earnings and payslip. M7.2 cases without fixtures stay blocked/unproved.
4. **Fuel:** reconcile existing norm, trip evidence/OCR display, invoice/AP, and
   financial view without saving any change.
5. **Controls:** direct URL/API denial, foreign customer ID, protected-content
   flash, locked-action visibility, and forbidden export.

## Execution rules

- One reconciliation at a time. Record fixture aliases, not private identifiers.
- No raw SQL. Use supported read-only UI/API behavior only.
- Capture both source and destination views plus exported output when offered.
- Proposed Q01-Q23 thresholds/policies are not pass criteria unless the customer
  has accepted them in writing. Test neutral invariants separately.
- M1.7 must remain a named product gap. M7.2 requires direct evidence, not a
  delivery label.
- Optional stateful extension: only after separate explicit authorization,
  create unique disposable business records and serialize create/dispatch/
  upload/approve/pay/close/cleanup flows. Preserve red-to-green evidence.

## Success Criteria

- [ ] Existing operating and money chains match across authorized role views.
- [ ] Every unauthorized route/API/data-scope attempt denies without data leakage.
- [ ] Money, payroll, fuel, exports, and audit reconcile to observable sources.
- [ ] Every mutation-only case is visibly not run unless separately authorized.

## Risks

Read-only data may not contain every required lifecycle state. Missing fixtures
must reduce functional coverage, not trigger unauthorized staging mutation.
