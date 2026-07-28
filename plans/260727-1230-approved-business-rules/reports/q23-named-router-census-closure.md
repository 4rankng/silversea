# Q23 named-router census closure

Date: 2026-07-28

## Root cause

The mutation inventory used a hand-written route-file-to-prefix map and a
regular expression that only recognized receivers named `router` or `app`.
Mounted named routers (`onboardingRouter`, `uploadRouter`,
`salaryPeriodsAdminRouter`, and others) and nested imported routers could
therefore disappear from the census without failing the test.

## Implementation

- Replaced the manual mount table with TypeScript AST traversal rooted at
  `backend/src/index.ts`.
- Recursively resolves default and named router exports, nested `use()` mounts,
  local child routers, factory-returned routers, and statically registered
  template paths.
- Added explicit regression assertions for onboarding, upload, app settings,
  nested financial, and salary-period admin mounts.
- Classified onboarding tutorial state and analytics as reviewed non-material
  UX/telemetry writes.
- Added registry coverage for four already-durable salary issue/post decision
  routes.
- The new inventory exposed ten salary-period admin commands that were material
  but not durable. Each now uses a stable endpoint and `runIdempotent`.
- Added optional transaction plumbing to salary exclusion services so the
  business effect, idempotency row, and material audit share one transaction.
- Added HTTP proof for exact replay and fail-closed rollback when audit
  persistence fails.

## Files changed

- `backend/src/tests/material-write-registry-exhaustive.test.ts`
- `backend/src/middleware/material-write.ts`
- `backend/src/routes/config.ts`
- `backend/src/services/salary-period-close.service.ts`
- `backend/src/tests/q10-salary-exclusion-routes.test.ts`

## Verification

- Focused census + salary exclusion + governed salary routes: 14 passed,
  0 failed.
- Final standalone census: 6 passed, 0 failed.
- Backend TypeScript check: passed with exit status 0.
- `git diff --check`: passed.

Artifacts:

- `qa/2026-07-28_q23-named-router-census_backend-test.log`
- `qa/2026-07-28_q23-named-router-census_typecheck.log`

Status: DONE
Summary: Production mount topology now drives the exhaustive mutation census,
named routers are covered, and all newly exposed material salary commands have
atomic idempotency/audit boundaries.
Concerns/Blockers: None in the assigned scope.
