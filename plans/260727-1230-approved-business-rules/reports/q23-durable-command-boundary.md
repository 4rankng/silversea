# Q23 durable command boundary

## Phase Implementation Report

### Executed Phase
- Phase: lane-0-shared-durable-command-audit-boundary
- Plan: `plans/260727-1230-approved-business-rules/`
- Status: completed

### Files Modified
- `backend/src/db/schema.ts`
- `backend/drizzle/0150_q23_durable_command_boundary.sql`
- `backend/drizzle/meta/_journal.json`
- `backend/src/services/idempotency.service.ts`
- `backend/src/middleware/audit.ts`
- `backend/src/services/audit.service.ts`
- `backend/src/middleware/material-write.ts`
- `backend/src/tests/q23-durable-command-boundary.test.ts`
- `qa/2026-07-28_q23-durable-command-boundary_migrate.log`
- `qa/2026-07-28_q23-durable-command-boundary_focused-test.log`
- `qa/2026-07-28_q23-durable-command-boundary_backend-typecheck.log`
- `qa/2026-07-28_q23-durable-command-boundary_review.md`

### Tasks Completed
- [x] Added a shared declared-material-write matcher and key guard for the current idempotent HTTP boundary.
- [x] Hardened `runIdempotent()` to reject missing keys and persist the original HTTP status alongside the response snapshot.
- [x] Added migration `0150_q23_durable_command_boundary` for the new command-result status column and recorded it in the Drizzle journal after `0149`.
- [x] Replaced best-effort response-finish audit emission with a durable pre-response insert plus post-insert enrichment.
- [x] Added a focused foundation test proving missing-key 400, same-key replay, different-payload 409, concurrent one-effect, durable success/replay/403/409/rejected attempts surviving simulated enrichment failure, and fail-closed behavior when audit persistence itself is unavailable.
- [x] Declared the integrated Q23 field/tire/singleton/GPS/finance routes in the centralized material-write registry and added an executable matcher census.
- [x] Added GPS stale-pending lease recovery so a crashed `PENDING` command can be safely retried with the same key after lease expiry.
- [x] Saved focused QA artifacts under `qa/`.
- [x] Performed a self-review and recorded the result.

### Tests Status
- Type check: pass — `qa/2026-07-28_q23-durable-command-boundary_backend-typecheck.log`
- Unit tests: pass — `qa/2026-07-28_q23-durable-command-boundary_focused-test.log`
- Integration tests: not run in this lane
- Migration application: pass — `qa/2026-07-28_q23-durable-command-boundary_migrate.log`
- Focused durability rerun: pass — `qa/2026-07-28_q23_durable_local_backend-focused-rerun-2.log`

### Issues Encountered
- The first focused run exposed a harness teardown gap in the new test file. The test was updated to close Redis and the Postgres client so the standalone focused run exits cleanly.
- A mixed focused run that bundled unrelated route files exposed a second teardown leak in `q23-gps-job-commands.test.ts`; the suite now closes the temporary HTTP server after each case, and the durability-only rerun exits cleanly.
- Internal trip command helpers still permit keyless direct invocation before they reach `runIdempotent()`. That behavior sits outside the owned Lane 0 HTTP boundary and was left unchanged.

### Next Steps
- Lane 1+ can now rely on the shared middleware/audit boundary for declared material HTTP routes.
- If the controller wants universal non-HTTP command enforcement, that needs a separate owned follow-up on the direct service helpers that short-circuit before `runIdempotent()`.
