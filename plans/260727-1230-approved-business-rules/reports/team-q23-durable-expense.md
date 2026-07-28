# Q23 Durable Expense Focused Report

## Executive Summary
- **Issue:** Focused regressions remained in `q23-durable-command-boundary.test.ts` and `q23-expense-idempotency.test.ts`.
- **Impact:** Backend focused gate stayed red even though the current route behavior was already correct.
- **Root cause:** Both reds were stale test expectations after earlier Q23 route changes: expense path-level registry matching now resolves to governed update/delete, and expense-photo delete now queues durable storage removal instead of deleting storage inline.
- **Status:** Resolved.
- **Fix:** Updated only the two focused tests to assert the current shipped contract; no runtime/backend production logic changed in this task.

## Timeline
- **2026-07-28 17:49 +08** Ran focused repro for `q23-durable-command-boundary` + `q23-expense-idempotency`; reproduced 2 failures in `qa/2026-07-28_team-q23-durable-expense_focused-tests.log`.
- **2026-07-28 17:50 +08** Verified code paths in `backend/src/middleware/material-write.ts` and `backend/src/routes/expense.ts`.
- **2026-07-28 17:50 +08** Updated focused tests only.
- **2026-07-28 17:50 +08** Re-ran focused tests green in `qa/2026-07-28_team-q23-durable-expense_focused-tests.rerun.log`.
- **2026-07-28 17:50 +08** Re-ran backend typecheck green in `qa/2026-07-28_team-q23-durable-expense_backend-typecheck.log`.

## Technical Analysis

### Finding 1: registry expectation was stale
- **Symptom:** `PUT /api/expenses/1` expected `expenses.update` but matcher returned `expenses.governed-update`.
- **Evidence:** `qa/2026-07-28_team-q23-durable-expense_focused-tests.log` recorded:
  - `actual: 'expenses.governed-update'`
  - `expected: 'expenses.update'`
- **Code path:** `backend/src/middleware/material-write.ts`
  - `matchDeclaredMaterialWrite()` uses first matching rule only.
  - The current registry deliberately lists both governed and direct expense endpoints on the same path; governed update/delete are first.
- **Conclusion:** The failing assertion was stale relative to the current matcher contract. This was not DB pollution and not a runtime regression in the matcher.

### Finding 2: expense-photo delete expectation was stale
- **Symptom:** company-expense photo delete expected immediate `storageService.delete()` side effects, but `deletedStorageKeys` stayed empty.
- **Evidence:** `qa/2026-07-28_team-q23-durable-expense_focused-tests.log` recorded:
  - `actual: []`
  - `expected: ['expense-photos/...png']`
- **Code path:** `backend/src/routes/expense.ts`
  - photo delete now calls `enqueueStorageDelete(...)`
  - it does **not** call `storageService.delete()` inline
- **Reference behavior:** `backend/src/tests/q23-upload-idempotency.test.ts` already proves the intended contract:
  - DB row removed immediately
  - durable effect job created with `STORAGE_DELETE_MODE.FINAL_DELETE`
  - worker performs storage deletion later
- **Conclusion:** The failing assertion lagged behind the durable-delete design. This was not DB pollution and not a product regression.

### Hypotheses checked
- **Hypothesis A:** runtime company-expense code regressed.  
  Eliminated: focused rerun after test correction passed without touching runtime code.
- **Hypothesis B:** test pollution or DB leftovers caused the two failures.  
  Eliminated: failures reproduced deterministically from current assertions against current code paths; they were semantic mismatches, not order-dependent state leaks.
- **Hypothesis C:** route behavior had changed and tests were stale.  
  Confirmed by direct source inspection and green rerun after aligning assertions.

## Files Changed
- `backend/src/tests/q23-durable-command-boundary.test.ts`
- `backend/src/tests/q23-expense-idempotency.test.ts`

## Verification
- Focused repro before fix: `qa/2026-07-28_team-q23-durable-expense_focused-tests.log`
- Focused rerun after fix: `qa/2026-07-28_team-q23-durable-expense_focused-tests.rerun.log`
- Backend typecheck: `qa/2026-07-28_team-q23-durable-expense_backend-typecheck.log`

## Prevention / Follow-up
- Keep the expense-path registry test aligned with the actual matcher contract: path-level matching, first rule wins.
- When durable-effect routes move from inline side effects to queued workers, update focused tests to prove queue/job semantics, not immediate external deletion.
- If the team wants path-level expense matcher semantics to distinguish governed vs direct update/delete automatically, that needs a separate runtime design change because `matchDeclaredMaterialWrite()` is currently path/method-only.

## Unresolved Questions
- None for this owned scope.
