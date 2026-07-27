---
phase: 5
title: "Payroll attendance and close"
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 5: Payroll attendance and close

## Overview

Complete Q09-Q11 and attendance-specific Q18/Q20/Q21: company/unit period
close, explicit exception handling, append-only post-close corrections, and
trip-derived attendance.

## Related Code Files

- Modify: `backend/src/services/salary-period-close.service.ts`
- Modify: `backend/src/services/attendance.service.ts`
- Modify: `backend/src/services/trip-attendance-sync.service.ts`
- Modify: `backend/src/routes/salary.ts` and salary-period routes
- Modify: salary/attendance frontend and API client
- Modify: `backend/src/tests/m73-salary-period-close.test.ts`

## Implementation Steps

1. Rebaseline existing close/reopen and ledger-posting behavior.
2. Enforce whole-company or configured payroll-unit close, never per-driver.
3. Block close on money-affecting errors; allow explicit approved exclusion
   into supplementary/adjustment handling.
4. Allow reopen only before payslip/payment/posting and only by authorized
   director/delegate.
5. Prevent manual override of trip days; require notes for personal leave and
   approved adjustment for post-close changes.
6. Assign trip revenue/salary/count to completion period and attendance to
   actual event date.
7. Add calendar UI, permissions, totals and conflict/concurrency tests.

## Success Criteria

- [ ] Every active driver is Ready or Pending before close.
- [ ] Errors are never silently excluded.
- [ ] Closed/paid/posted periods are immutable and corrected append-only.
- [ ] DRIVER is read-only and cannot see another driver's attendance.
- [ ] Cross-midnight and cross-period cases follow Q20 exactly.

## Risk Assessment

Payroll correctness is high stakes. Verify ledger invariants and compare
pre/post totals; never direct-write partial salary state.
