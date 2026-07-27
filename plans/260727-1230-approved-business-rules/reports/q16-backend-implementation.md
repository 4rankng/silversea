# Q16 Backend Implementation

## Scope
- Added multi-customer support for CUSTOMER accounts in the backend/shared contracts.
- Enforced the approved business rule: ACTIVE CUSTOMER accounts must have at least one linked customer.
- Kept legacy unmapped CUSTOMER rows deny-all and allowed INACTIVE CUSTOMER rows to remain temporarily unmapped.

## Implemented
- Added the `user_customer_links` join table and migration backfill for existing single-link users.
- Extended shared user schemas/types to accept and expose `customerIds` alongside legacy `customerId`.
- Updated authentication, authorization, scoped-customer helpers, shipment listing, and portal route resolution to understand multi-customer scope.
- Updated backend tests to cover active/unmapped rejection, inactive/unmapped allowance, token-scope invalidation, portal customer selection, and customer-scope exposure.

## QA
- `cd shared && npx tsc --noEmit` passed.
- `cd backend && npx tsc --noEmit` passed.
- `pnpm lint` passed with existing warnings only.
- `cd backend && pnpm test -- src/tests/customer-user-link.test.ts src/tests/customer-portal-routes.test.ts src/tests/comprehensive.test.ts` passed.

## Notes
- No frontend changes were required for this backend/shared scope.
- The repo has pre-existing unrelated worktree changes; they were left intact.
