# Backend fix — portal statement + app-settings RBAC

## Scope

- `backend/src/routes/app-settings.ts`
- `backend/src/index.ts`
- `backend/src/routes/portal/index.ts`
- `backend/src/tests/app-settings-routes.test.ts`
- `backend/src/tests/customer-portal-routes.test.ts`

## Root cause

1. `GET /api/admin/app-settings` was mounted behind `requireRoles(Role.ADMIN)` at the app level, so manager pages that only needed a read call still got `403`.
2. `GET /api/portal/statement` returned `404` whenever the authenticated CUSTOMER had no linked customer row / no resolvable statement target. That turned the portal page into an error state instead of an empty statement.

## Fix

- Split app-settings auth by method:
  - read: ADMIN / MANAGER / ACCOUNTANT
  - write + email settings: ADMIN only
- Keep the app-settings mount under `casbinAuthz('config')`, but remove the extra mount-level ADMIN gate.
- Change customer statement routes to return an empty statement payload when no customer record is resolvable, so the portal renders a usable empty state and exports still work.
- Added backend regressions for both behaviors.

## QA

Passed:

- `cd backend && npx tsx --test --test-concurrency=1 src/tests/customer-portal-routes.test.ts src/tests/app-settings-routes.test.ts`
- `cd backend && npx tsc --noEmit`
- `cd backend && pnpm test`
- `make build`

Artifacts:

- `qa/2026-07-27_backend-portal-settings_tests.log`
- `qa/2026-07-27_backend-portal-settings_tsc.log`
- `qa/2026-07-27_backend-portal-settings_tsc-rerun.log`
- `qa/2026-07-27_backend-portal-settings_backend-test.log`
- `qa/2026-07-27_backend-portal-settings_build.log`

## Notes

- Unrelated pre-existing worktree changes were preserved.
- No frontend, staging deployment, or docs changes were made for this fix.
