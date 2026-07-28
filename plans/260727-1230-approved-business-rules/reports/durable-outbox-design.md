# Durable effects and storage cleanup — design report

## Executive summary

- **Issue:** committed governance mutations can return `500` and permanently lose cache invalidation; storage rollback/delete work can disappear after process or audit failure.
- **Root cause:** database state, Redis/process cache, and filesystem storage have no shared transaction. The current `WeakMap` queue and cleanup audit are observability only, not recoverable work.
- **Recommendation:** one typed `durable_effect_jobs` table and dispatcher, with two effect kinds: `CACHE_INVALIDATE` and `STORAGE_DELETE`.
- **Critical distinction:** ordinary effects are inserted in the domain transaction. Upload rollback protection must be armed in a small committed transaction **before** external upload; otherwise the cleanup record rolls back with the failed domain transaction.
- **Delivery semantics:** at-least-once execution, idempotent handlers, leased/fenced workers, bounded retry with an observable `DEAD` state. The API reports the committed domain result and never treats a later effect failure as a domain rollback.

## Problem-first diagnosis

The proposed “generic outbox” is not itself the requirement. The real requirement is:

> No successful domain commit may depend on an ephemeral post-commit callback, and no externally created object may become an undiscoverable orphan after a crash or dual failure.

Core assumption challenged: **one row inserted in the domain transaction does not solve upload rollback cleanup**. If upload occurs and the transaction rolls back, that row rolls back too. A correct design needs a pre-upload cleanup guard or an external store with transactional staging. SilverSea has local filesystem storage, so the pre-upload guard is the least complex correct answer.

Evidence strength: **strong**. Current code:

- deletes the governance callback queue before executing it;
- executes callbacks after `runIdempotent()` has committed and rethrows callback failure;
- stores cleanup-pending only after storage deletion already failed, then suppresses failure of that audit write;
- commits photo-row deletion before external deletion and returns `500` when deletion fails;
- already contains a proven durable lease/retry pattern in `trip_gps_capture_jobs`.

## Requirements and boundary

### Expected output

A concrete implementation that:

1. atomically records governed cache invalidation with the approved mutation;
2. durably records final storage deletion with the database deletion;
3. protects pre-transaction uploads with a committed cleanup guard;
4. recovers after process restart, lease expiry, Redis/storage failure, and idempotent request replay;
5. exposes pending, retrying, succeeded, cancelled, and terminal-failure states.

### Acceptance criteria

- Governance approval and its durable effect row commit or roll back together.
- Effect failure never changes a committed API response to `500`.
- Exact request replay returns the stored response and creates no duplicate effect.
- A failed cache invalidation is retried after restart and eventually succeeds.
- Upload success followed by database failure and cleanup failure remains discoverable and is deleted by the worker.
- Database photo deletion followed by storage failure returns the committed response; worker eventually deletes the file.
- Two workers cannot both own an active lease; a stale worker cannot acknowledge another worker's lease.
- Missing storage object counts as successful deletion.
- Existing cleanup-pending audit rows are backfilled into recoverable jobs.

### Scope

In scope: governance cache invalidation, governed financial app-setting cache correctness, upload/OCR/expense/forwarder rollback cleanup, photo final-delete cleanup, worker startup, migration/backfill, focused tests.

Out of scope: Kafka/SQS, generic arbitrary callbacks, notification/email migration, an admin retry UI, replacing local storage, or exactly-once delivery. The table may support later typed kinds, but only the two required handlers ship now.

## Options considered

| Option | Build effort | Runtime latency | Operational complexity | Failure coverage | Second-order effect |
|---|---:|---:|---:|---|---|
| Improve current callbacks + cleanup audit | 1–2 days | immediate | low initially | Fails restart and audit/DB dual failure | Creates false confidence; every new callback repeats the same bug |
| Separate cache-outbox and storage-cleanup tables/workers | 4–6 days | 0–60 sec | high: two state machines, dashboards, migrations | Correct if both implement leases | Duplicated retry/fencing code drifts over time |
| **One typed durable-effect table + pre-upload guard** | **3–5 days** | **0–60 sec** | **medium, one worker/state machine** | **Covers both blockers and restart windows** | Requires strict typed handlers; becomes a safe extension point later |

**Simplest viable option:** the third option. It is smaller than two workers and materially safer than enhancing best-effort callbacks.

Rejected shortcut: serializing closures, module/function names, or arbitrary commands into JSON. Deploys rename code, payloads outlive releases, and arbitrary dispatch expands the security boundary. Persist only versioned, finite effect descriptors.

## Recommended schema

Add migration `backend/drizzle/0157_durable_effect_jobs.sql` and the matching Drizzle declaration in `backend/src/db/schema.ts`.

```text
durable_effect_jobs
  id                bigserial/serial primary key
  kind              varchar(40) not null
  payload_version   smallint not null default 1
  dedupe_key        varchar(255) not null
  payload           jsonb not null
  status            varchar(16) not null default 'PENDING'
  attempt_count     integer not null default 0
  max_attempts      integer not null default 20
  next_attempt_at   timestamptz not null default now()
  lease_token       varchar(100) null
  lease_expires_at  timestamptz null
  last_error        text null
  completed_at      timestamptz null
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()
```

Constraints/indexes:

- unique `(kind, dedupe_key)`;
- status check: `PENDING | RUNNING | RETRY | SUCCEEDED | CANCELLED | DEAD`;
- `attempt_count >= 0`, `max_attempts > 0`;
- due-work index `(status, next_attempt_at, id)`;
- lease-recovery index `(status, lease_expires_at)` where supported.

Typed payloads:

```ts
type DurableEffectInput =
  | {
      kind: 'CACHE_INVALIDATE';
      payloadVersion: 1;
      dedupeKey: string;
      payload: { key: string };
      maxAttempts?: number;
    }
  | {
      kind: 'STORAGE_DELETE';
      payloadVersion: 1;
      dedupeKey: string;
      payload: {
        storageKey: string;
        mode: 'ORPHAN_GUARD' | 'FINAL_DELETE';
        entityType?: string;
        entityId?: number;
      };
      maxAttempts?: number;
    };
```

Use Zod discriminated validation in the dispatcher. Unknown kind/version becomes `DEAD` with a bounded error; it must not retry forever or execute arbitrary code.

Recommended retry policy:

- lease: 2 minutes for worker execution;
- upload producer guard: 10-minute lease;
- backoff after worker failure: 30 sec, 2 min, 10 min, 30 min, 2 hr, 6 hr, then 24 hr cap;
- cache jobs: `maxAttempts=20`;
- storage jobs: `maxAttempts=50`;
- terminal exhaustion: `DEAD`, retained for operator inspection/requeue; never silently delete the row.

## Transaction boundaries

### 1. Governance/cache invalidation

Replace `GovernanceApplyResult.postCommit: (() => Promise<void>)[]` with pure `durableEffects: DurableEffectInput[]`.

Inside `approveGovernanceActionWithAdapter()`:

1. lock and validate governance action;
2. apply domain mutation;
3. update governance result;
4. insert durable-effect descriptors using the same `tx`;
5. persist idempotency result/audit using the same `tx`;
6. commit;
7. return the committed response immediately.

Remove the `WeakMap`, `runQueuedGovernancePostCommitEffects()`, `clearQueuedGovernancePostCommitEffects()`, and their calls from `runIdempotent()`. Replay does not reconstruct callbacks; the original unique job continues independently.

Price/catalog adapters emit:

```text
kind=CACHE_INVALIDATE
dedupe_key=catalogs-bootstrap:governance-action:<actionId>
payload={key:"catalogs:bootstrap"}
```

For governed financial app settings, do **not** persist “set this process-local variable” as an effect. A worker on pod A cannot clear memory on pod B. Simplest correct policy: remove the module-level `cached` fast path and make `getAppSettings()` read the six authoritative rows. Direct bot/GPS listener behavior can remain synchronous after its direct commit; governed financial policy no longer needs a local-memory effect. If measurement later shows the six-row read is expensive, introduce a shared Redis cache as a separate measured change.

### 2. Final storage deletion

Within the transaction that deletes the photo/document row:

1. lock and validate the row/version/owner;
2. insert a `STORAGE_DELETE` / `FINAL_DELETE` job;
3. delete the database row;
4. persist idempotency response and mandatory audit;
5. commit and return success.

No route calls `storageService.delete()` synchronously. Storage failure cannot turn the committed response into `500`. Missing file is success, so repeat execution is safe.

Suggested dedupe keys:

- `trip-photo-final:<photoId>:<storageKeyHash>`;
- `expense-photo-final:<photoId>:<storageKeyHash>`;
- `forwarder-expense-photo-final:<photoId>:<storageKeyHash>`.

Hash in the dedupe key avoids unwieldy raw paths; keep the actual validated path only in typed payload.

### 3. Upload rollback protection

This is a two-transaction saga, deliberately:

1. Compute deterministic `storageKey` from endpoint/actor/idempotency key.
2. In a small committed transaction, `armStorageCleanupGuard()`:
   - insert or re-arm `STORAGE_DELETE / ORPHAN_GUARD`;
   - status `RUNNING`;
   - producer `leaseToken`;
   - `leaseExpiresAt = now + 10 minutes`;
   - do not upload if another unexpired producer/worker lease owns the guard.
3. Upload bytes.
4. Run the domain/idempotency transaction.
5. In that same successful domain transaction, conditionally mark the guard `CANCELLED` using its producer lease token and insert the photo/idempotency/audit rows.
6. On ordinary domain failure, release the guard to `RETRY` immediately. If the process dies, the worker reclaims it after lease expiry.

This ordering covers:

- crash before upload: worker deletes a missing object and succeeds;
- crash after upload before DB transaction: expired guard deletes orphan;
- DB rollback plus immediate delete failure: guard remains retryable;
- successful DB commit: guard cancellation commits with ownership;
- exact retry: deterministic key plus guarded re-arm converges without duplicate rows.

For `ORPHAN_GUARD`, the handler should check the known ownership tables before deletion (`trip_photos`, `expense_photos`, `trip_expense_photos`, and any owned upload table in the migrated routes). If the key became durably referenced, mark the guard `CANCELLED` rather than delete. `FINAL_DELETE` does not use this check because deletion was explicitly committed.

Company-logo upload cancellation occurs when its idempotent upload command commits; the upload command itself is the durable owner even before a later company-info selection.

## Worker and lease algorithm

Add `processDueDurableEffectJobs(limit=50)` and register `durable-effect-dispatch` every minute in `backend/src/index.ts`.

Claim transaction:

1. select due `PENDING/RETRY`, plus `RUNNING` rows with null/expired leases;
2. order by `next_attempt_at, id`;
3. `FOR UPDATE SKIP LOCKED`, bounded by `limit`;
4. set `RUNNING`, increment attempt, assign random UUID lease token and 2-minute expiry;
5. commit claims.

Execute outside the claim transaction. On each result:

- success: conditional update to `SUCCEEDED` where `(id,status='RUNNING',lease_token=token)`;
- referenced orphan guard: conditional `CANCELLED`;
- transient failure: conditional `RETRY`, clear lease, set backoff and bounded `last_error`;
- exhausted/invalid payload: conditional `DEAD`;
- stale worker: conditional update affects zero rows and must not overwrite the new owner.

The existing scheduler advisory lock prevents duplicate full ticks across pods; row leases and `SKIP LOCKED` remain mandatory because manual runs, future concurrency, or a process pause can overlap. A crash after external success but before acknowledgement re-executes after lease expiry. Both Redis key deletion and filesystem missing-file deletion are idempotent, so this is safe at-least-once behavior.

Lifecycle:

- scheduler disabled in tests exactly as today;
- startup registers the job before `startScheduler()`;
- shutdown needs no new long-lived timer because the existing scheduler owns cadence;
- an in-flight claim may expire and be reclaimed after shutdown;
- scheduler run logs provide tick health; the job table provides per-effect health.

Operational signals:

- alert if oldest nonterminal job >15 minutes;
- alert on any `DEAD`;
- log counts claimed/succeeded/retried/dead, never raw credentials/request bodies;
- retain succeeded/cancelled rows for 30 days, then a later housekeeping migration/job may purge them. Do not add that purge in this fix.

## Migration and legacy cleanup

Migration `0157`:

1. create table, constraints, unique/due/lease indexes;
2. backfill existing `audit_logs` whose payload has
   `event='STORAGE_CLEANUP_PENDING'`, `cleanupPending=true`, and a nonblank `storageKey`;
3. create `STORAGE_DELETE / ORPHAN_GUARD` jobs with dedupe key
   `legacy-cleanup-audit:<auditLogId>`, `next_attempt_at=now()`, and the audit entity references;
4. preserve old audit rows unchanged as historical evidence;
5. update Drizzle journal/meta using the repository's normal migration tooling.

The worker status supersedes `cleanupPending` as operational authority. `persistStorageCleanupFailureAudit()` may be removed after every producer uses the durable guard. Optional audit events for job `DEAD` are secondary observability; audit failure must never remove or complete the durable job.

## Exact implementation touchpoints

### Create

- `backend/drizzle/0157_durable_effect_jobs.sql`
- `backend/src/services/durable-effect.service.ts`
- `backend/src/tests/durable-effect-jobs.test.ts`

### Modify

- `backend/src/db/schema.ts`
- `backend/drizzle/meta/_journal.json` and generated snapshot
- `backend/src/services/governance-transition.service.ts`
- `backend/src/services/idempotency.service.ts`
- `backend/src/services/price-config-governance.service.ts`
- `backend/src/services/app-settings.service.ts`
- `backend/src/services/audit.service.ts`
- `backend/src/routes/upload.ts`
- `backend/src/routes/ocr.ts`
- `backend/src/routes/expense.ts`
- `backend/src/routes/forwarder.ts`
- `backend/src/index.ts`
- focused Q15/Q23 tests that currently assert synchronous storage deletion or cleanup-pending audit behavior

Also scout all callers of `storageService.delete()` before closing implementation. Any path that deletes a durable owner row before external deletion must join this mechanism; leaving helper-based trip-photo deletion as best-effort would preserve the same defect under another route.

## Required tests

1. Domain rollback also rolls back ordinary effect insert.
2. Governance approval commits action, idempotency result, audit, and one cache job atomically.
3. Redis failure leaves job `RETRY`; API/replay remains successful; later run succeeds.
4. Exact replay creates no second effect.
5. Worker crash after effect before acknowledgement: expired lease replays safely.
6. Two concurrent claimers do not own one row; stale lease token cannot acknowledge.
7. Unknown kind/version becomes observable `DEAD`.
8. Guard exists before upload; process crash after upload is recovered after lease expiry.
9. DB rollback plus immediate storage failure remains recoverable after simulated restart.
10. Successful photo commit cancels its guard; worker never deletes owned object.
11. Explicit photo delete commits one final-delete job; first storage failure retries; API replay remains exact.
12. Missing storage object completes successfully.
13. Existing cleanup-pending audit migration produces runnable jobs.
14. Process exits naturally with Redis/DB cleanup.

Focused existing suites to update:

- `q23-upload-idempotency.test.ts`
- `q23-expense-idempotency.test.ts`
- `q23-field-operations-idempotency.test.ts`
- `q23-durable-command-boundary.test.ts`
- app-settings/price-governance focused tests
- full backend and E2E gates after focused green.

Every red and green run must be saved under `qa/` per `AGENTS.md`.

## Pitfalls and non-negotiable invariants

- Do not insert rollback-cleanup work only inside the transaction that can roll back.
- Do not persist executable closures, import paths, arbitrary Redis commands, or request bodies.
- Do not use process memory as cross-pod cache authority.
- Do not acknowledge without matching the lease token.
- Do not hold a database transaction open during Redis or filesystem I/O.
- Do not return `500` after a domain/idempotency result committed.
- Do not assume “exactly once”; require idempotent handlers under at-least-once delivery.
- Do not let a cleanup audit substitute for a retry consumer.
- Do not delete legacy cleanup audit evidence during backfill.
- Do not call the release green until failure-injection, restart, lease-expiry, replay, full tests, migration, and staging worker evidence all pass.

## Decision

Use the **single typed durable-effect table**, not two bespoke queues. Keep its public input finite and versioned. Insert governance cache and final-delete jobs in the owning transaction. Use the pre-upload leased cleanup guard for upload sagas. Remove governed financial settings' process-local cache dependency.

This is the least complex design that closes both blockers without introducing a message broker or pretending PostgreSQL can atomically commit filesystem/Redis work.

Status: DONE

Summary: Minimal correct outbox design completed: one typed leased job table, transactional effect insertion, pre-upload cleanup guards, restart-safe dispatcher, legacy audit backfill, and exact test/file plan.

Concerns/Blockers: Implementation must include OCR and helper-based trip-photo deletes, not only the three initially named route files; otherwise the same orphaning defect remains reachable.
