# Q21 fuel period late-approval implementation

Date: 2026-07-28
Status: DONE

## Scope

- Close the accepted Q21 fuel-period governance gap from
  `pm-260728-q18-o02-completion-audit.md`.
- Persist immutable fuel late-approval source→target period links.
- Reject direct mutation into the same closed fuel month.
- Explicitly disallow fuel reopen.

## Changes

- Added `fuel_period_adjustments` for immutable source-lock → target-period
  fuel late-approval links, keyed to the approving governance action and fuel
  invoice effect.
- Extended `period-lock.service.ts` so fuel reopen fails closed and
  `resolveFuelLateApprovalLinks()` returns the exact locked source periods that
  must land in a different open target month.
- Integrated fuel-invoice approval with the shared period-lock authority:
  approval now rejects direct same-month closed-period mutation, captures late
  source-period metadata in the governance payload, and writes
  `fuel_period_adjustments` during approval application.
- Added focused proof:
  - route-level governed approval writes `sourcePeriod=2026-05`,
    `targetPeriod=2026-06`, keeps May locked, and preserves the governance
    reason/maker/approver/effect references.
  - service-level rejection for direct closed-month mutation.
  - service-level proof that fuel reopen is not allowed.

## Files

- `backend/src/db/schema.ts`
- `backend/src/services/period-lock.service.ts`
- `backend/src/services/fuel-invoice.service.ts`
- `backend/src/tests/q06-fuel-invoice-routes.test.ts`
- `backend/src/tests/q21-period-authority.test.ts`
- `backend/drizzle/0162_lethal_dracula.sql`
- `backend/drizzle/meta/0162_snapshot.json`
- `backend/drizzle/meta/_journal.json`

## Verification

- `cd backend && npx tsc --noEmit`
  - PASS
- `cd backend && pnpm db:generate`
  - PASS
  - Generated `drizzle/0162_lethal_dracula.sql`
- `cd backend && pnpm db:migrate`
  - PASS
- `cd backend && npx tsx --test --test-concurrency=1 src/tests/q21-period-authority.test.ts src/tests/q06-fuel-invoice-routes.test.ts src/tests/m61-fuel-ap-recon.test.ts`
  - PASS
  - 37 tests, 37 passed, 0 failed

## Notes

- I did not touch `HANDOFF.md`, plan state, frontend files, or QA artifacts.
- The focused route test still logs the pre-existing intentional idempotency
  rollback error path from `fuel invoice create rolls back when idempotency
  persistence fails after the business callback`; the test itself remains green.
