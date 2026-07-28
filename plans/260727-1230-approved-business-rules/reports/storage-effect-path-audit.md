# Storage effect path audit

**Date:** 2026-07-28  
**Scope:** current SilverSea backend worktree; local/object storage writes, deletes, rollback cleanup, durable `ORPHAN_GUARD` and `FINAL_DELETE` wiring  
**Method:** read-only source audit using the repository context resolver, storage primitive search, caller tracing, and adversarial code review  
**Tests:** not run; this task explicitly excluded database tests

## Verdict

**BLOCKED — the route migration is substantially wired, but the durable upload guard does not yet satisfy retry convergence.**

All active application storage uses the local filesystem through
`LocalStorageService`; no S3/MinIO/R2 or other object-storage writer was found.
The current upload routes for trip photos, OCR photos, company logos, company
expense photos, and forwarder expense photos arm an `ORPHAN_GUARD` before the
filesystem write and cancel it in the successful domain transaction. Current
trip, driver, company-expense, and forwarder-expense photo deletion paths enqueue
`FINAL_DELETE` in the same transaction that removes the owning row.

No active route still performs synchronous `storageService.delete()` after a
committed owner-row deletion. The driver and forwarder paths changed during this
audit; the verdict above reflects the later current worktree in which both use
`FINAL_DELETE`.

Two guard-state defects can still strand objects or make a legitimate retry
permanently fail. The storage adapter also lacks containment checks on mutating
operations.

## Findings

### [P1] A completed orphan cleanup permanently blocks retry of an uncommitted command

**Evidence**

- `backend/src/services/durable-effect.service.ts:191-197` rejects
  `SUCCEEDED`, `CANCELLED`, and `DEAD` guards as closed.
- `backend/src/routes/upload.ts:229-255`,
  `backend/src/routes/expense.ts:102-127`,
  `backend/src/routes/ocr.ts:98-123`, and
  `backend/src/routes/forwarder.ts:123-148` convert every
  `storage cleanup guard already closed` result to `null`.
- Each route then enters `runIdempotent()` with no committed idempotency row.
  Its create callback rejects the null guard with `409`; examples:
  `upload.ts:557-564`, `expense.ts:436-448`,
  `ocr.ts:313-330` / `479-496`, and `forwarder.ts:610-624`.

**Failure sequence**

1. The guard is armed and the upload fails, or the process dies after upload
   but before the domain transaction commits.
2. The guard becomes `RETRY`; the worker deletes the missing/partial/orphan
   object and marks the job `SUCCEEDED`.
3. No idempotency record exists because the domain command never committed.
4. The client retries with the same required idempotency key.
5. Guard acquisition returns `null` for the closed job; the create callback
   returns `409` forever.

This violates the design requirement that an exact retry converges on the
deterministic key. A closed guard is not sufficient evidence that the domain
command committed. Re-arm must distinguish a committed command replay from a
completed orphan cleanup (for example by checking the command/idempotency owner
under a race-safe protocol).

### [P1] Re-arming can overwrite the only durable pointer to a different orphan

**Evidence**

- `backend/src/services/durable-effect.service.ts:199-208` re-arms an existing
  `PENDING`/`RETRY`/expired `RUNNING` job by replacing its complete payload,
  including `storageKey`.
- Route storage keys are deterministic from the idempotency key except for an
  extension selected from processed MIME:
  `backend/src/routes/expense.ts:387-409` and
  `backend/src/routes/forwarder.ts:564-583`. Trip-photo preparation similarly
  chooses its extension before forming the key in
  `backend/src/routes/upload.ts:109-179`.

**Failure sequence**

1. A PNG attempt writes `...<command-hash>.png`; the domain transaction fails,
   leaving its guard in `RETRY`.
2. Before the worker deletes it, the caller retries the still-uncommitted
   command key with JPEG input.
3. Re-arm changes the guard payload to `...<command-hash>.jpg`.
4. The old PNG is no longer named by any durable job and can remain forever.

The re-arm path must not replace a different outstanding storage key. It should
either reject payload drift while the old cleanup is unresolved, use a
content/MIME-independent key, or preserve one cleanup job per concrete object.
A focused regression test should cover a failed first upload followed by a
same-key retry whose processed extension differs.

### [P1] Mutating local-storage methods can escape the configured upload root

**Evidence**

- `backend/src/services/storage.service.ts:15-21` uses
  `path.join(uploadDir, key)` and writes without validating or resolving the
  result under `uploadDir`.
- `backend/src/services/storage.service.ts:30-34` deletes using the same
  unchecked path construction.
- The read method has a containment guard at `storage.service.ts:47-55`, proving
  the adapter already recognizes this boundary, but write/delete/exists do not.
- Durable job payload validation in
  `backend/src/services/durable-effect.service.ts:45-57` accepts any nonblank
  `storageKey`; migration `backend/drizzle/0157_durable_effect_jobs.sql:34-74`
  also backfills historical audit keys into executable delete jobs.

Current route-generated keys are constrained prefixes, so this is not a
confirmed request-level traversal exploit. It is still unsafe for durable
replay: a malformed legacy/database key can make the worker unlink outside the
upload directory. The adapter should resolve and enforce containment for every
operation, with invalid keys becoming observable terminal job failures rather
than filesystem mutations.

### [P2] Exported helpers remain non-durable storage-write bypasses

The active HTTP handlers no longer call these unsafe modes, but the public
helpers can be reused without the required guard:

- `backend/src/routes/upload.ts:274-310` — `saveTripPhoto()` writes storage and
  then inserts the row with no pre-upload guard or rollback release.
- `backend/src/routes/upload.ts:420-427` — `saveCompanyLogo()` writes a file
  with no guard.
- `backend/src/routes/ocr.ts:174-235` — `persistOcrPhoto()` writes directly when
  `skipStorageUpload` is false, then inserts the photo row.

No active non-test caller of `saveTripPhoto()` or `saveCompanyLogo()` was found.
The two OCR routes pass a prepared photo with `skipStorageUpload: true` after
arming their own guard. These are therefore latent bypasses, not currently
reachable route bypasses. Restrict/remove the exports or make guarded storage
ownership mandatory in their signatures so future callers cannot silently
reintroduce the crash window.

### [P2] Existing focused tests still encode the superseded cleanup-audit contract

`backend/src/tests/q23-upload-idempotency.test.ts:266-305` expects a
`STORAGE_CLEANUP_PENDING` audit after rollback cleanup failure and stubs
`storageService.delete()`. The new operational authority is the durable job
state, and current upload rollback no longer performs immediate deletion.
`backend/src/services/audit.service.ts:596-650` now has no active production
caller.

The stale test should be replaced with assertions that the pre-upload guard
survives the rollback, becomes retryable, and succeeds after worker replay.
Coverage is also missing for both P1 guard-rearm sequences above.

## Active storage-effect inventory

### Filesystem primitives

| File / symbol | Effect | Durable boundary |
|---|---|---|
| `backend/src/services/storage.service.ts:8-12` `LocalStorageService.constructor` | Creates the configured upload root | Idempotent process initialization; not a domain effect |
| `backend/src/services/storage.service.ts:15-23` `upload` | Creates parent directories and writes/overwrites bytes | Must be preceded by an upload guard in route flows |
| `backend/src/services/storage.service.ts:30-35` `delete` | Unlinks a file; missing file is success | Called in production by the durable worker |
| `backend/src/services/durable-effect.service.ts:320-359` `processDurableEffectJob` | Checks ownership for `ORPHAN_GUARD`, then deletes; directly deletes for `FINAL_DELETE` | Leased, fenced, at-least-once worker |

`multer.memoryStorage()` in upload, OCR, expense, and forwarder routes does not
write temporary files.

### Upload/write producers

| Producer | External write | Guard and commit semantics | Current status |
|---|---|---|---|
| `backend/src/routes/upload.ts:456-512` company-logo upload | `storageService.upload` at line 475 | Arm before write; cancel in `runIdempotent` transaction at 496; rollback release at 502-504 | Wired; subject to guard findings |
| `backend/src/routes/upload.ts:514-586` trip-photo upload | Upload at 540 | Arm at 530-537; photo row + cancellation commit together at 557-570; rollback release at 575-577 | Wired; subject to guard findings |
| `backend/src/routes/ocr.ts:249-368` OCR capture with `trip_id` | Upload at 292 | Guard at 279-287; photo row + cancellation in transaction at 313-330; rollback release at 362-364 | Wired; OCR preview without `trip_id` has no storage write |
| `backend/src/routes/ocr.ts:434-524` OCR persist-only | Upload at 465 | Guard at 456-462; photo row + cancellation at 479-496; rollback release at 501-503 | Wired; subject to guard findings |
| `backend/src/routes/expense.ts:373-466` expense receipt photo | Upload at 419 | Guard at 410-416; owner row + cancellation at 436-454; rollback release at 456-458 | Wired; subject to guard findings |
| `backend/src/routes/forwarder.ts:545-642` forwarder expense photo | Upload at 593 | Guard at 584-590; owner row + cancellation at 610-633; rollback release at 638-640 | Wired; subject to guard findings |

### Delete/final-cleanup producers

| Producer | Owner-row mutation | Durable effect | Current status |
|---|---|---|---|
| `backend/src/routes/upload.ts:323-350` `deleteTripPhotosByType` | Locks and deletes matching `trip_photos` | One `FINAL_DELETE` per row in the same transaction | Wired |
| `backend/src/routes/upload.ts:353-400` `deleteTripPhotoByStorageKey` | Locks and deletes one `trip_photos` row | `FINAL_DELETE` in the same transaction | Wired |
| `backend/src/routes/upload.ts:588-678` targeted trip-photo delete route | Locks and deletes one row inside `runIdempotent` | `FINAL_DELETE` at 670 before row delete | Wired; replay creates no second job |
| `backend/src/routes/driver.ts:85-135` `deleteDriverTripPhotosCommand` | Locks and deletes all selected rows inside `runIdempotent` | One `FINAL_DELETE` per row at 115-125 | Wired |
| `backend/src/routes/expense.ts:468-508` expense-photo delete | Locks and deletes `expense_photos` row inside `runIdempotent` | `FINAL_DELETE` at 492-500 | Wired |
| `backend/src/routes/forwarder.ts:167-202` `deleteForwarderExpensePhotoCommand` | Locks and deletes `trip_expense_photos` row inside `runIdempotent` | `FINAL_DELETE` at 188-196 | Wired |

### Durable worker ownership checks

`backend/src/services/durable-effect.service.ts:458-480` checks all discovered
durable storage owner locations before executing an `ORPHAN_GUARD`:

- `trip_photos`;
- `expense_photos`;
- `trip_expense_photos`;
- `shipment_documents`;
- `app_settings['company.logo_storage_key']`.

`FINAL_DELETE` intentionally skips the reference check. Missing files are
successful because `LocalStorageService.delete()` only unlinks when the path
exists.

## Non-writers and lifecycle notes

- Shipment document attach/replace routes
  (`backend/src/routes/shipments.ts:379-451`) persist storage-key metadata only;
  no active local document-byte writer was found. The comment claiming bytes
  arrive through `/api/upload` is not matched by a generic document-upload
  handler in the audited backend.
- PDF/export services produce in-memory buffers or response streams. Their
  filesystem usage is read-only (for example font lookup in
  `backend/src/services/pdf-export.service.ts`).
- Company-logo upload intentionally treats the committed upload command as the
  durable owner before a later governed company-info selection. Replacing or
  clearing `company.logo_storage_key` does not currently enqueue deletion of an
  older logo. The design explicitly made the upload command an owner, so this
  audit records that as retention behavior rather than a violated
  `FINAL_DELETE` requirement.

## Review conclusion

The current worktree closes the originally identified synchronous-delete
bypasses for driver and forwarder photo deletion and wires all active route
uploads through pre-write guards. It should not be declared green until:

1. a cleaned-but-uncommitted guard can be safely retried with the same command
   key;
2. re-arm cannot discard a prior concrete storage key;
3. mutating storage paths are confined to `uploadDir`;
4. focused tests prove those cases and replace the cleanup-audit expectation.

