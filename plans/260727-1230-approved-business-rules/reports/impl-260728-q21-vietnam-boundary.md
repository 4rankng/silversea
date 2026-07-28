# Q21 Vietnam month-boundary fix

Status: DONE

## Scope

- `backend/src/services/fuel-invoice.service.ts`
- `backend/src/tests/q21-period-authority.test.ts`

No other product files or `HANDOFF.md` were modified.

## Root cause

`currentApprovalDate()` formatted `new Date(Date.now())` with
`toISOString().slice(0, 10)`, so it selected the UTC calendar date. At
`2027-07-01 00:30` in Vietnam (`2027-06-30T17:30:00Z`), late fuel approval
therefore targeted June instead of July and was rejected when June was closed.

## Implementation

- The fuel approval path now obtains its calendar date from the existing
  centralized `todayIsoVn()` authority, which formats the current instant in
  `Asia/Ho_Chi_Minh`.
- The Q21 regression freezes the clock immediately before and after the
  Vietnam-local month boundary:
  - `2027-06-30 23:30` Vietnam targets `2027-06`.
  - June is then closed.
  - `2027-07-01 00:30` Vietnam targets the open `2027-07` period.
- Both late invoices retain their immutable source invoice date
  (`2026-05-20`), liters, amount, and pending status.

## QA

- Pre-fix failure captured in
  `qa/2026-07-28_q21-vietnam-boundary_prefx-failure.log`.
- Focused Q21/Q06/fuel-AP suite:
  `37 passed, 0 failed`.
  Artifact: `qa/2026-07-28_q21-vietnam-boundary_backend-test.log`.
- Backend typecheck: exit 0.
  Artifact: `qa/2026-07-28_q21-vietnam-boundary_backend-typecheck.log`.
- `git diff --check` for the two owned files: pass.

## Review notes

The public service signature, persisted invoice contract, and schema are
unchanged. The behavioral change is limited to deriving the target operational
month from the Vietnam business calendar instead of UTC.

Status: DONE
Summary: Q21 late fuel approval now selects the correct Vietnam calendar month at the rollover boundary and preserves the immutable source invoice data.
Concerns/Blockers: None.
