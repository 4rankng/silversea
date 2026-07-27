# Q23 Cancel Race Fixes

Date: 2026-07-27
Owner: `/root/q23_cancel_race_fixes`
Scope: `backend/src/services/debtOffset.service.ts`, `backend/src/services/trip-status-machine.service.ts`, focused backend regression tests, `qa/2026-07-27_q23-cancel-races_*`

## Executive summary

Two Q23 race windows were proven and closed:

1. `cancelDebtOffset()` let two concurrent callers both read `APPROVED` before any winner claim, so both posted reversing `ADJUSTMENT` entries.
2. `transitionTripStatus(..., CANCELED)` let two concurrent callers both read `COMPLETED` before the trip row was controlled, so both zeroed the trip and both posted `UNLOCK_REVERSAL`.

Root cause in both cases: stale lifecycle read before the controlling winner check. The fix now acquires the controlling row inside the transaction and rejects the losing cancel with `409` before any duplicate reversal can post.

## Timeline

- 2026-07-27 18:28 +0800: added deterministic race repro tests and ran them against current code. Both defects reproduced with two fulfilled cancels. Evidence: `qa/2026-07-27_q23-cancel-races_repro.log`.
- 2026-07-27 18:29 to 18:31 +0800: patched the two service methods to move winner control into the transaction.
- 2026-07-27 18:31 +0800: reran focused backend tests; both new cancel-race tests passed and no duplicate reversals remained. Evidence: `qa/2026-07-27_q23-cancel-races_focused-tests.log`.
- 2026-07-27 18:31 to 18:32 +0800: ran backend typecheck and lint gates. Broad backend typecheck is still red due unrelated `shipment.service.ts` errors outside this task’s ownership. Targeted lint on owned files is green. Evidence: `qa/2026-07-27_q23-cancel-races_backend-typecheck.log`, `qa/2026-07-27_q23-cancel-races_targeted-lint.log`.

## Hypotheses and elimination

### H1: duplicate reversals are caused by stale lifecycle reads before a winner lock

Confirmed.

- Debt offset repro:
  - Test holds the shared customer/vendor advisory locks first.
  - Both cancel callers still reach the stale `APPROVED` read before blocking.
  - Pre-fix both later succeed and double-post reversal rows.
  - Post-fix one caller wins, the other gets `409`, and exactly one reversing pair remains.
  - Code/tests: `backend/src/services/debtOffset.service.ts:195-255`, `backend/src/tests/m64-debt-offsets.test.ts:337-400`.
- Trip cancel repro:
  - Test holds the trip row `FOR UPDATE` first.
  - Both cancel callers still read `COMPLETED` before blocking on the controlling row.
  - Pre-fix both later succeed and double-post `UNLOCK_REVERSAL`.
  - Post-fix one caller wins, the other gets `409`, and exactly one reversal set remains.
  - Code/tests: `backend/src/services/trip-status-machine.service.ts:22-32,157-188`, `backend/src/tests/trip-ledger-completion.test.ts:186-247`.

### H2: duplicate reversals are caused by `LedgerService.postEntry()` or `postTripUnlock()` themselves

Eliminated.

- The ledger helpers were unchanged.
- Once the service-level winner control was added, the same helpers produced exactly one reversal effect in both repros.

### H3: duplicate reversals require route/cache/notification side effects outside the service transaction

Eliminated.

- Both defects reproduced through direct service calls in backend tests.
- No route middleware, cache invalidation, attendance sync, or notifications were required to trigger the duplicate effects.

## Fix details

### Debt offset cancel

File: `backend/src/services/debtOffset.service.ts:195-255`

- Added `FOR UPDATE` when loading the debt-offset row.
- Changed repeat/losing cancel behavior from `400` to `409`.
- Added a transactional winner claim:
  - `UPDATE debt_offsets SET approval_status='CANCELED' WHERE id=? AND approval_status='APPROVED' RETURNING *`
- If no row is claimed, the caller now gets `409` and no reversal rows are written.
- Reversal entries are posted only after the winner claim succeeds.

### Trip cancel

Files: `backend/src/services/trip-status-machine.service.ts`,
`backend/src/services/trip-mutations.service.ts`

- Added `FOR UPDATE` when loading the trip row.
- Special-cased repeated `CANCELED` requests to return `409` instead of silently short-circuiting.
- Added a conditional winner update on cancel:
  - `UPDATE trips ... WHERE id=? AND status=<locked current status>`
- Cancellation increments `trips.version` in the same winning update, so an
  editor holding the prior version cannot repopulate canceled financial data.
- `updateTripFigures()` now acquires the same controlling trip row before any
  customer ledger advisory lock. This establishes one row-first order for
  completed-trip edit and cancel flows and removes the reviewed deadlock cycle.
- If the update loses, the caller gets `409` and no `postTripUnlock()` runs.

## Test coverage added/updated

- `backend/src/tests/m64-debt-offsets.test.ts:311-400`
  - repeat cancel on `CANCELED` now expects `409`
  - new deterministic concurrent cancel repro
- `backend/src/tests/trip-ledger-completion.test.ts:186-247`
  - new deterministic concurrent completed-trip cancel repro
  - deterministic cancel-versus-stale-edit regression: cancellation owns the
    trip row while waiting on a ledger lock; the stale edit then rejects and
    cannot restore revenue, costs, or duplicate ledger effects
- `backend/src/tests/m64-debt-offsets.test.ts:527-531`
  - tightened the existing concurrent approve row-count assertion to the debt-offset note signature, avoiding false collisions with unrelated shared-dev `ADJUSTMENT` rows that happen to reuse the same numeric `txnId`

## QA evidence

- Red repro: `qa/2026-07-27_q23-cancel-races_repro.log`
- Green focused tests: `qa/2026-07-27_q23-cancel-races_focused-tests.log`
- Broad backend typecheck, blocked by unrelated existing errors: `qa/2026-07-27_q23-cancel-races_backend-typecheck.log`
- Initial `pnpm lint -- ...` attempt, not targetable because the repo script expands to `eslint .`: `qa/2026-07-27_q23-cancel-races_lint.log`
- Green targeted lint on owned files: `qa/2026-07-27_q23-cancel-races_targeted-lint.log`
- Independent first review (NO-GO): `qa/2026-07-27_q23-cancel-races_independent-review.md`
- Review-fix focused tests (26/26):
  `qa/2026-07-27_q23-cancel-races_focused-tests.review-fix.log`
- Review-fix targeted lint:
  `qa/2026-07-27_q23-cancel-races_targeted-lint.review-fix.log`

## Residual risk / prevention

- These two race windows are now closed, but the inventory report still identifies the same stale-read pattern in other cancel/reversal flows, especially `financial.service.ts::cancelPenalty()`. The same proof style should be reused there before any generic Q23 wrapper work.
- The repo-level backend typecheck is not green because `backend/src/services/shipment.service.ts` already has unrelated `string | null` vs `Date` typing errors. This task did not modify that file.
- The Q18 `LOCKED → COMPLETED` direct-reopen prohibition predates this Q23
  slice and was independently approved. It was intentionally preserved; the
  cancel-race work did not introduce or broaden that governance rule.

## Unresolved questions

- None inside this slice. The only remaining blocker is the unrelated backend typecheck failure in `shipment.service.ts`, which needs its owning task to resolve before the full repo backend gate can turn green.
