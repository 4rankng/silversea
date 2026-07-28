# Durable effect foundation

## Scope completed

- Added `durable_effect_jobs` schema and migration foundation for typed durable side effects.
- Implemented the backend worker/service contract in `backend/src/services/durable-effect.service.ts`.
- Registered the minute scheduler tick in `backend/src/index.ts`.
- Added focused DB-backed coverage in `backend/src/tests/durable-effect-jobs.test.ts`.
- Recorded QA artifacts under `qa/`.

## Files changed

- `backend/drizzle/0157_durable_effect_jobs.sql`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/schema.ts`
- `backend/src/index.ts`
- `backend/src/services/durable-effect.service.ts`
- `backend/src/tests/durable-effect-jobs.test.ts`
- `qa/2026-07-28_durable-effect-jobs_backend-test.log`
- `qa/2026-07-28_durable-effect-jobs_backend-test.rerun.log`
- `qa/2026-07-28_durable-effect-jobs_typecheck-backend.txt`

## Delivered contract

### Durable effects

- `CACHE_INVALIDATE` payload `{ key }`
- `STORAGE_DELETE` payload `{ storageKey, mode, entityType?, entityId? }`
- status machine: `PENDING`, `RUNNING`, `RETRY`, `SUCCEEDED`, `CANCELLED`, `DEAD`
- unique dedupe on `(kind, dedupe_key)`
- leased worker claim with `FOR UPDATE SKIP LOCKED`
- fenced acknowledgements via `(id, status='RUNNING', lease_token)`
- bounded retry with escalating backoff and terminal `DEAD`

### Producer API

- `enqueueDurableEffect(tx, input)`
- `enqueueDurableEffects(tx, inputs)`
- `enqueueStorageDelete(tx, input)`
- `armStorageCleanupGuard(input)`
- `cancelStorageCleanupGuard(tx, lease)`
- `releaseStorageCleanupGuard(lease, error?)`

### Worker API

- `claimDueDurableEffectJobs(limit?, deps?)`
- `processDueDurableEffectJobs(limit?, deps?)`
- `processDurableEffectJob(job, deps?)`

## Migration behavior

`0157_durable_effect_jobs.sql` creates the durable job table and backfills legacy `STORAGE_CLEANUP_PENDING` audit rows into `STORAGE_DELETE / ORPHAN_GUARD` jobs using dedupe key `legacy-cleanup-audit:<auditLogId>`.

## Focused verification

- Backend typecheck: `qa/2026-07-28_durable-effect-jobs_typecheck-backend.txt`
- Focused backend tests:
  - red run preserved: `qa/2026-07-28_durable-effect-jobs_backend-test.log`
  - green rerun: `qa/2026-07-28_durable-effect-jobs_backend-test.rerun.log`

Covered behaviors:

- transactional enqueue commit vs rollback
- cache invalidation retry, replay dedupe, stale-lease fencing
- orphan guard release → worker cleanup
- orphan guard cancellation when durable owner exists
- explicit guard cancel on successful commit
- final delete retry and missing-file success
- unknown kind/version → `DEAD`
- migration backfill statement creates runnable jobs

## Known boundary

This phase intentionally did **not** wire the new APIs into governance transition, idempotency, upload/OCR/expense/forwarder routes, or audit internals. That integration remains for the overlapping worker phase. The foundation contract is now present and tested for that next step.
