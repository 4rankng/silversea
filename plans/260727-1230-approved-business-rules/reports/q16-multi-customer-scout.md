# Q16 Multi-Customer Scout

Scope: current customer-account relationship model, auth claims, row-scope helper, user-management path, frontend editor, and tests for Q16. Read-only. I only used current repo truth.

## Bottom Line

The repo is still a single-link model for customer accounts.

- `users.customer_id` is the only user/customer relationship in schema today.
- JWT/auth only carries one `customerId`.
- `scopedByCustomer` only understands one customer id.
- The admin user editor can manage driver profile fields, but it does not currently expose a customer link field, so the `customerId` backend support is not reachable from the UI path.

The smallest backward-compatible additive change is:

1. Add a join table for extra customer links.
2. Keep `users.customer_id` as the legacy primary/compatibility pointer.
3. Extend auth/token and scope helpers additively so old single-link sessions still work.
4. Add a multi-select customer link editor to the admin user form.
5. Backfill existing `users.customer_id` values into the new link table.

That gives you a no-break migration path and lets the admin UI manage many links without rewriting the current single-link contracts in one shot.

## Current State

### Schema / relationships

- `backend/src/db/schema.ts:101-115` defines `users.customerId` as a nullable integer FK-like column used as a 1:1 customer link for `CUSTOMER` users.
- There is no `customer_user_links` or equivalent join table anywhere in `backend/src/db`.
- `backend/src/db/schema.ts:166-183` shows the codebase already knows the mirrored 1:1 pattern for supplier/customer linkage, but that is not a user/customer many-to-many model.

### Auth claims

- `backend/src/routes/auth.ts:45-56` mints JWTs with a single `customerId` claim.
- `backend/src/middleware/auth.ts:11-26` documents the claim as a 1:1 CUSTOMER link.
- `backend/src/middleware/auth.ts:45-56` re-reads `users.customerId` and invalidates the token if the role or single customer link changed.

### Row scope

- `backend/src/lib/scoped-by-customer.ts:61-87` only supports one customer id on scoped queries.
- `scopedByCustomer()` overwrites caller filters with `user.customerId`.
- `canAccessCustomer()` is a single-row gate, not a set membership gate.

### User management path

- Backend CRUD is in `backend/src/routes/auth.ts:92-168`, not a dedicated `routes/users.ts`.
- `backend/src/services/user.service.ts:88-133` accepts `customerId` only for `Role.CUSTOMER`, validates the target customer, and persists it onto `users.customerId`.
- `backend/src/services/user.service.ts:169-254` updates the same single column and clears it when the role changes away from `CUSTOMER`.
- Frontend user admin is `frontend/src/pages/UsersPage.tsx:16-202`.
- The editor is `frontend/src/features/users/components/UserForm.tsx:118-483`.
- `frontend/src/features/users/hooks/useUserMutations.ts:24-76` currently sends only role/profile/driver payload; it does not send `customerId` at all.
- `frontend/src/features/users/utils.ts:3-44` has no customer-link list field in `UserRow`, `CreateData`, or `EditData`.

### Tests

Current tests prove the single-link model, not many-link support:

- `backend/src/tests/customer-user-link.test.ts` proves one CUSTOMER account can link to one customer, rejects non-CUSTOMER links, and invalidates tokens when the single customer scope changes.
- `backend/src/tests/scoped-by-customer.test.ts` proves the helper overrides caller-supplied `customerId`, deny-all on missing link, and passthrough for operators.
- `backend/src/tests/cross-customer-isolation.test.ts` proves the same isolation contract against real shipment queries.
- `backend/src/tests/comprehensive.test.ts:172-215` covers `/api/auth/users` create/list/delete.
- `backend/src/tests/customer-portal-routes.test.ts` exercises the portal with a single `customerId` claim.

## What Is Already Present

Already-present support is only adjacent, not user/customer multi-link support:

- 1:1 `users.customerId` for CUSTOMER accounts.
- 1:1 supplier/customer mirroring in `backend/src/services/config.service.ts:207-240`.
- Supplier multi-type support via `suppliers.types` is unrelated to user/customer scope.

There is no existing multi-customer user join table, no `customerIds` token claim, and no multi-customer editor UI.

## Recommended Change

### Ranked choice

1. **Recommended: additive join table + legacy primary column**
   - Add `user_customer_links`.
   - Keep `users.customerId` as the primary/compatibility pointer.
   - Extend the user API to return `customerIds` while still returning `customerId`.
   - Extend auth to carry `customerIds` on new logins, but keep accepting old single-id tokens.
   - Add a customer multi-select to the user editor.

2. **Not recommended as the first step: replace `users.customerId` outright**
   - This is riskier because it breaks the current auth/token/scoping contract in the same release.
   - It also forces a wider frontend and route rewrite for no immediate gain.

### Why #1 is the smallest safe change

- Existing customer accounts keep working because `users.customerId` remains valid.
- Existing code that reads a single customer id keeps working.
- New multi-link accounts can be enabled gradually.
- The auth and scoping layers can move over in a second step without forcing a destructive migration.

## Exact Implementation Shape

### Data model

Add a new table, conceptually:

- `user_customer_links`
  - `user_id` FK → `users.id`
  - `customer_id` FK → `customers.id`
  - `created_at`
  - optional `created_by` if you want attribution from day one
  - unique `(user_id, customer_id)`

Backfill:

- For every existing `users.customerId`, insert one link row.
- Keep `users.customerId` intact as the compatibility pointer.
- Do not drop or rename the existing column in the first rollout.

### Token behavior

Recommended claim shape:

- keep `customerId` for backwards compatibility
- add `customerIds: number[]` for new tokens
- keep `role`, `userId`, `username`, `fullName` unchanged

Validation behavior:

- old tokens without `customerIds` remain valid if their single `customerId` still matches the DB
- new tokens validate against the current linked customer set
- if a link is removed, a stale token must fail on the next request
- if a link is added, re-login should mint a token with the expanded `customerIds`

That keeps the rollout backward-compatible without introducing a separate scope-version column in the first pass.

### Scope helpers

Update `backend/src/lib/scoped-by-customer.ts` to support a set-based path for list queries while preserving the current single-id helper for old callers.

Recommended shape:

- keep `scopedByCustomer()` for legacy single-customer callers
- add a set-aware helper for customer portal lists and detail checks, e.g. `scopedByCustomers()` / `canAccessCustomerIds()`
- preserve deny-all semantics for unmapped CUSTOMER accounts

### API / service surface

Update the user CRUD path in `backend/src/routes/auth.ts` and `backend/src/services/user.service.ts` so it can read/write:

- `customerId` for the primary/legacy link
- `customerIds` for the many-link set

Keep this rule:

- if `customerIds` is omitted, existing one-link behavior stays as-is
- if `customerIds` is present, it becomes the source of truth for the link table
- `customerId` must be a member of `customerIds` when both are supplied

### Frontend UI

Update the admin user editor path:

- `frontend/src/pages/UsersPage.tsx`
- `frontend/src/features/users/components/UserForm.tsx`
- `frontend/src/features/users/hooks/useUserMutations.ts`
- `frontend/src/features/users/utils.ts`

Add:

- customer multi-select or chip selector for CUSTOMER-role users
- list display of linked customers in the table
- keep the current driver-profile editing untouched

## Migration Constraints

Hard constraints for the first migration:

- additive only
- no dropping `users.customerId`
- no renaming existing auth claims in the same release
- no forcing existing sessions to reauthenticate just because the schema changed
- no destructive backfill
- all link changes should be saved in one transaction with the user row update

If you want stricter revocation semantics later, add a scope version or full set-hash in a follow-up migration. Do not make that the first move unless you need hard realtime revocation on every link edit.

## Exact File List

### Backend

- `backend/src/db/schema.ts`
- `backend/src/middleware/auth.ts`
- `backend/src/routes/auth.ts`
- `backend/src/services/user.service.ts`
- `backend/src/lib/scoped-by-customer.ts`
- `backend/src/routes/portal/index.ts`
- `backend/src/tests/customer-user-link.test.ts`
- `backend/src/tests/cross-customer-isolation.test.ts`
- `backend/src/tests/scoped-by-customer.test.ts`
- `backend/src/tests/comprehensive.test.ts`

### Frontend

- `frontend/src/pages/UsersPage.tsx`
- `frontend/src/features/users/components/UserForm.tsx`
- `frontend/src/features/users/components/UserTable.tsx`
- `frontend/src/features/users/hooks/useUserMutations.ts`
- `frontend/src/features/users/utils.ts`
- `frontend/src/api/userClient.ts`
- `frontend/src/hooks/useCatalogQueries.ts` if the multi-select needs customer lookup data from a query hook

## Test Matrix

Minimum matrix for the rollout:

1. Schema
   - join table exists
   - `(user_id, customer_id)` unique
   - backfill from existing `users.customerId`
2. Auth
   - single-link token still works
   - multi-link token contains all linked customer ids
   - token fails after link removal
3. Scope
   - single-link customer sees only one customer
   - multi-link customer can access all linked customers
   - unmapped customer still sees nothing
   - operator passthrough still works
4. Admin user CRUD
   - create user with one customer
   - create user with many customers
   - update customer links
   - remove customer links
   - non-CUSTOMER role cannot receive customer links
5. Frontend
   - user editor can add/remove multiple customer links
   - existing single-link path still renders and saves
   - list view shows linked customer summary

## Final Assessment

Q16 is not currently a many-customer implementation. It is a clean single-customer implementation with enough isolated code to extend safely.

The best next step is the additive join-table path above, with `users.customerId` preserved as the compatibility bridge until the admin UI, token shape, and portal scoping all understand multiple links.
