# Q17 clerk scope/versioning implementation

**Date:** 2026-07-27  
**Scope:** required frontend/admin assignment controls only after backend checkpoint

## Delivered

- Wired the ADMIN/MANAGER user drawers to the real Q17 backend payload shape:
  `customerIds`, `businessUnitIds`, and `shipmentIds` now round-trip for
  `CLERK` users.
- Extended the frontend auth and user/shipment client types so the Users page
  can consume `businessUnits` from `GET /auth/users` and fetch shipment options
  from `GET /shipments`.
- Added CLERK-only drawer controls for:
  - responsible business units
  - assigned customers
  - explicitly assigned shipments
- Added local validation that an active CLERK must have at least one business
  unit plus at least one assigned customer or shipment before save.
- Updated the Users table summaries so CLERK scope is visible in both desktop
  and mobile layouts.
- Added focused frontend coverage for CLERK create/edit assignment behavior in
  `frontend/src/features/users/components/UserForm.test.tsx`.

## Scope boundary

- Did **not** broaden `ClerkShipmentDocsPage` or other shipment-edit surfaces.
- Did **not** add a business-unit CRUD surface; this pass only consumed the
  existing backend list in the user-management flow.
- Did **not** change `HANDOFF.md`.

## Blocker note

- A polished CLERK shipment-create responsible-unit selector remains blocked by
  backend readability: CLERK does not appear to have access to a readable
  business-unit catalog endpoint, so the UI cannot resolve business-unit names
  without a backend contract change or an additional bootstrap field.
- This blocker does **not** affect the required ADMIN assignment controls
  completed in this slice.

## Files changed

- `frontend/src/api/shipmentClient.ts`
- `frontend/src/api/userClient.ts`
- `frontend/src/features/users/components/UserForm.tsx`
- `frontend/src/features/users/components/UserForm.test.tsx` (new)
- `frontend/src/features/users/components/UserTable.tsx`
- `frontend/src/features/users/hooks/useUserMutations.ts`
- `frontend/src/features/users/utils.ts`
- `frontend/src/hooks/useAuth.tsx`
- `frontend/src/pages/UsersPage.tsx`

## QA

Artifacts:

- `qa/2026-07-27_q17-clerk-scope-versioning_frontend-typecheck.log`
- `qa/2026-07-27_q17-clerk-scope-versioning_userform-frontend-test.log`
- `qa/2026-07-27_q17-clerk-scope-versioning_frontend-test.log`
- `qa/2026-07-27_q17-clerk-scope-versioning_context-check.log`

Final commands:

```text
cd frontend && npx tsc -b
cd frontend && pnpm test -- src/features/users/components/UserForm.test.tsx
cd frontend && pnpm test
pnpm context:check
```

Results:

- Frontend typecheck: exit 0
- Focused UserForm tests: exit 0
- Full frontend tests: exit 0 (62 files, 329 tests)
- Context check: exit 0

Status: DONE_WITH_CONCERNS
Summary: Required ADMIN CLERK assignment controls are implemented, tested, and green on the frontend; the only remaining note is the separate CLERK business-unit-name read blocker for shipment create.
Concerns/Blockers: Optional clerk-create responsible-unit name list still needs a backend-readable catalog or bootstrap field for CLERK.
