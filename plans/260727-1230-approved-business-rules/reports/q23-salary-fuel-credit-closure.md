# Q23 salary/fuel/credit atomicity closure

Date: 2026-07-28
Lane: A
Review source: `qa/2026-07-28_q23-boundary_review.md`

## Scope fixed

- Fixed the P0 atomicity defect where salary-period, fuel-invoice, and credit-override commands could commit business effects outside `runIdempotent()`'s transaction.
- Updated each owned `runIdempotent()` callback to use the supplied transaction and propagated that transaction through the owned salary/fuel/credit service entry points.
- Added failpoint tests that force the `idempotency_keys` insert to fail after the business callback, then proved the business mutation rolls back with no leaked domain row and no stored idempotency row.

## Files changed

- `backend/src/routes/financial/credit-overrides.routes.ts`
- `backend/src/routes/financial/fuel-invoices.routes.ts`
- `backend/src/routes/salary.ts`
- `backend/src/services/credit-limit.service.ts`
- `backend/src/services/fuel-invoice.service.ts`
- `backend/src/services/salary-period-close.service.ts`
- `backend/src/services/salary-period-adjustment.service.ts`
- `backend/src/services/salary-confirmation-governance.service.ts`
- `backend/src/tests/q01-credit-override-routes.test.ts`
- `backend/src/tests/q06-fuel-invoice-routes.test.ts`
- `backend/src/tests/q15-salary-period-routes.test.ts`

## Root cause

- The owned routes passed `create: () => ...` into `runIdempotent()`, so the helper's transaction was ignored.
- The called services then opened their own `db.transaction(...)` blocks and committed independently.
- If the later `idempotency_keys` insert or outer commit failed, the business write could already be durable, violating the helper's documented atomicity guarantee and risking retry duplicates.

## Fix applied

- Credit override service methods now accept an optional `transaction?: Tx` and reuse it for reads, row locks, inserts, and status updates.
- Fuel invoice service methods now accept an optional `transaction?: Tx` and reuse it across invoice writes, allocation writes, and approval-side validations.
- Salary-period close, adjustment, and confirmation governance service methods now accept an optional `transaction?: Tx` and reuse it for issue/post/request/check/approve flows.
- Each owned route now passes the `runIdempotent()` transaction into the service callback instead of opening a nested transaction boundary.
- No `idempotency.service.ts` change was required; the helper contract was already correct once callers honored the supplied `tx`.

## QA evidence

- Red proof:
  - `qa/2026-07-28_q23-salary-fuel-credit_atomicity-red.log`
- Green proof:
  - `qa/2026-07-28_q23-salary-fuel-credit_salary-focused.log`
  - `qa/2026-07-28_q23-salary-fuel-credit_atomicity-green.log`
  - `qa/2026-07-28_q23-salary-fuel-credit_backend-typecheck.log`

## Result

- Credit override, fuel invoice, and every mutating `runIdempotent()` callback in `backend/src/routes/salary.ts` now honor the shared idempotency transaction.
- `rg` over `backend/src/routes/salary.ts` confirms there are no remaining `create: () =>` or `create: async () =>` callbacks; every route callback now receives `tx`.
- The review P0 from `qa/2026-07-28_q23-boundary_review.md` is closed for Lane A scope.
- Backend typecheck currently fails in untouched `backend/src/routes/admin-gps.ts` with `TS2322` around `GpsCommandSnapshot<T> | null`; that is an unrelated baseline issue, not a regression from this lane.
