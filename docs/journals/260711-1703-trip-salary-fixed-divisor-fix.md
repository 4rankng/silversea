---
date: 2026-07-11
type: bug-fix
status: fixed
area: trip-salary
---

# Trip salary fixed-divisor fix

## Context

A customer reported that the trip form initially filled **370,370 đ** for driver salary and only changed after selecting the trip wage-day count. For a configured monthly base salary of 10,000,000 đ, the expected one-day allocation is **384,615 đ**.

## What happened

Trip salary auto-fill had drifted into monthly attendance logic: July 2026 used 27 standard workdays, producing `10,000,000 / 27 = 370,370`. The form's wage-day controls also used a hard-coded 10,000,000 đ fallback, while driver options discarded the selected driver's configured base salary. Backend recalculation repeated the variable-divisor behavior.

## Root cause

Two distinct rules were conflated. Per-trip cost allocation requires a fixed 26-day divisor, whereas `standardWorkDays` varies by month and belongs only to monthly attendance and payroll calculations.

## Fix and verification

- Added shared trip-salary calculation and fallback resolution using the fixed divisor 26, with configured driver salary taking precedence over legacy route defaults.
- Preserved each driver's configured `baseSalary` through catalog-to-form option mapping; removed the hard-coded salary fallback.
- Updated the product specification and salary/attendance flow documentation to state the boundary explicitly.
- Passed 5 shared calculation/fallback regression cases and 1 frontend driver-option mapping case.
- Passed shared, frontend, and backend TypeScript checks plus all three production builds.

## Decision

Trip salary is `baseSalary / 26 × tripWageDays`. Variable `standardWorkDays` remains valid only for monthly attendance and payroll. Social insurance remains separately accounted and is excluded from trip salary allocation.

## Next steps

Existing trip records are preserved; this change does not backfill historical salary values. Accounting can manually correct an existing trip when its stored allocation should be updated.
