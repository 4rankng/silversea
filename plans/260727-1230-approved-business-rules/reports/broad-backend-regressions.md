## Broad Backend Regression Fix Report

### Scope

Two failures from the broad backend run:

1. `app-settings-routes.test.ts`: email-settings GET/PUT returned 500.
2. `customer-portal-routes.test.ts`: concurrent confirmation returned 200/200 instead of 200/409.

No Q03, Q17, Q23, Docker, schema, migration, deployment, or `HANDOFF.md` changes were made.

### Root Causes

- App settings reproduced in isolation. The route test did not own the shared
  `email.resend_api_key` row, so a malformed persisted ciphertext became its
  fixture and `decryptSecret` correctly failed closed. Simultaneous test
  activity was not required.
- Customer confirmation reproduced in isolation. Both requests passed the
  route's pre-transaction `PENDING_CONFIRM` check. The second transaction then
  locked a row already changed to `CONFIRMED`; intentional lifecycle
  same-status idempotency allowed `CONFIRMED -> CONFIRMED`, producing a second
  200. Simultaneous unrelated tests were not required.

### Fixes

- The app-settings route test now snapshots the raw email-setting value,
  clears it through the recovery-safe service path, and restores it in a
  `finally` block while invalidating the runtime cache.
- Debit-note transitions accept an optional `expectedStatus` checked after the
  document row is locked. Existing callers retain same-status idempotency.
- Portal confirm and dispute require the locked row to remain
  `PENDING_CONFIRM`.
- Added concurrent-dispute coverage to prevent the adjacent race.

### QA Evidence

- `qa/2026-07-27_broad-backend-regressions_app-settings-repro.log`
  - Before: 4/5, GET and PUT exposed 500 from malformed shared ciphertext.
  - After: 5/5, exit 0.
- `qa/2026-07-27_broad-backend-regressions_customer-portal-repro.log`
  - Before: 12/13, concurrent confirmation returned 200/200.
  - After: 14/14, confirmation and dispute each accept exactly one request.
- `qa/2026-07-27_broad-backend-regressions_blast-radius-test.log`
  - App settings, email settings/delivery, customer portal, debit-note
    lifecycle/locking, and Q18 governance: 80/80, exit 0.
- `qa/2026-07-27_broad-backend-regressions_backend-typecheck.log`
  - Backend TypeScript: exit 0.
- `qa/2026-07-27_broad-backend-regressions_lint.log`
  - ESLint: 0 errors, 21 existing warnings, exit 0.

### Review

Self-review found no API break: `expectedStatus` is optional, lifecycle
idempotency remains the default, corrupt encrypted credentials still fail
closed in production, and route authorization/response shapes are unchanged.
An independent reviewer agent could not be started because the team thread
limit was reached.
