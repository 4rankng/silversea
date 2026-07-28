# Q15 profit transaction integrity

**Status:** PARTIAL  
**Task owner:** `/root/q15_profit_tx_integrity`  
**Date:** 2026-07-28

## Scope

- `backend/src/services/profit-distribution.service.ts`
- `backend/src/tests/q15-profit-distribution-governance.test.ts`
- `qa/2026-07-28_q15-profit-tx-integrity_backend-typecheck.log`
- `qa/2026-07-28_q15-profit-tx-integrity_lint.log`
- `qa/2026-07-28_q15-profit-tx-integrity_profit-natural-exit.log`

## Root cause

The reviewed Q15 blocker was real:

1. `requestProfitDistributionGovernance()` computed the plan before entering the transaction.
2. `applyProfitDistributionGovernanceAction()` recomputed through the global `db` executor instead of the supplied approval transaction.
3. The approval flow compared only a derived `planHash`, so a changed underlying trip snapshot could still slip through if the same aggregate plan recomputed.
4. The focused test over-constrained the durable `PROFIT_DISTRIBUTED` audit lookup to `entityId === action.id`, which is not required for this route's persisted audit proof.

## Implemented change

- Kept request-side and approval-side plan computation inside the supplied transaction.
- Removed the broad `SHARE` table locks on `trips`, `truck_cap_table`, and `trucks`.
- Added a profit-only serializable transaction path at the real entry points:
  - request route uses `runIdempotent(..., { isolationLevel: 'serializable' })`;
  - approval route does the same only for `PROFIT_DISTRIBUTION`.
- Added a profit-only retry wrapper for PostgreSQL serialization failures (`40001`) so concurrent source writes fail cleanly with a user-facing 409 instead of surfacing a raw database error.
- Refactored distribution reads to use the supplied executor so request/approval no longer read source state through the global `db`.
- Kept the derived `sourceFingerprint` snapshot covering qualifying trips, resolved ownership snapshots, and truck plates; persisted it in `afterSnapshot` and revalidated it during approval.
- Kept `planHash` validation in place so both source drift and recomputed-plan drift reject approval with the same 409 contract.
- Updated the focused test to:
  - assert the durable approval audit without assuming the audit row's `entityId` must equal the governance action id;
  - keep the same-plan/source-drift regression;
  - add a direct service-level concurrency check that holds a profit request transaction open while an unrelated-quarter trip write runs with `lock_timeout`, proving the profit path no longer relies on broad table locks.

## Verification

- `pnpm lint`
  - artifact: `qa/2026-07-28_q15-profit-tx-integrity_lint.log`
  - result: pass, 0 errors / existing warnings only
- `cd backend && npx tsc --noEmit`
  - artifact: `qa/2026-07-28_q15-profit-tx-integrity_backend-typecheck.log`
  - result: initial fail on missing `createdAt` field for `resolveTruckCapSnapshot()` input, then rerun pass after the narrow fix
- `git diff --check -- backend/src/services/idempotency.service.ts backend/src/routes/financial/reports.routes.ts backend/src/routes/financial/payments.routes.ts backend/src/services/profit-distribution.service.ts backend/src/tests/q15-profit-distribution-governance.test.ts`
  - artifact: `qa/2026-07-28_q15-profit-tx-integrity_static-check.log`
  - result: pass
- `cd /Users/dev/Documents/projects/silversea/backend && npx tsx --test --test-concurrency=1 src/tests/q15-profit-distribution-governance.test.ts`
  - artifact: `qa/2026-07-28_q15-profit-tx-integrity_profit-natural-exit.log`
  - result:
    - first run: all 5 assertions passed, but the process did not terminate cleanly; controller SIGUSR2 evidence traced the remaining live handle to Redis TCP `::1 -> 6391`
    - follow-up fix: added `disconnectRedis()` before `client.end()` in the test `after()` hook
    - rerun: 5/5 pass, suite exits naturally with status 0

## Current reopen status

- The original table-lock implementation from this report is superseded; the lane is reopened because the final durability review correctly flagged the production deadlock / fleet-wide blocking risk.
- Non-DB verification for the new serializable entry-point strategy is green.
- One focused DB rerun on the serializable revision failed with two narrow issues captured in `qa/2026-07-28_q15-profit-tx-integrity_profit-natural-exit.log`:
  - the retry helper only inspected top-level `error.code`, so a Drizzle-wrapped serialization failure leaked through the concurrent-approval test;
  - the new no-broad-lock test accidentally reused an already-distributed Q1 fixture and hit the expected duplicate-quarter guard before exercising the unrelated write.
- Both local causes were patched:
  - serialization detection now walks wrapped `cause` chains for SQLSTATE `40001`;
  - the no-broad-lock test now uses an isolated year / request quarter.
- After those follow-up changes, non-DB verification reran green again; the next step is one more exact DB rerun of the focused test file.

## Out of scope follow-up

- The final review's remaining credit-override performance findings are outside this profit-owned lane in `backend/src/services/credit-limit.service.ts`:
  - in-memory full-ledger aggregation around lines 190-209;
  - N+1 governance-decision loading around lines 589-610.
