# Kanban requirements reconciliation — core

Baseline: `d4d7366039877658f173e45c7767274fd1cfde80`.
Ticket labels are not evidence. Existing product decisions require online operation and no approval workflows.

## TC-KP-136 — clean checkout context resolution
1. Use only tracked files; omit local HANDOFF and QA artifacts.
2. Run context validation and resolve frontend/backend profiles.
3. Expect successful resolution of tracked sources. Missing optional files are ignored; a missing required reference still fails with its exact path.

## TC-KP-124 — transient identity service failure
1. Sign in, preserve an unsaved draft, and make `/auth/me` return 503 or time out on reload.
2. Expect recoverable session-check feedback and retry; credentials are retained.
3. Recover the endpoint, retry, and expect the same account. A real 401 must clear the session and request login.

## TC-KP-135 — overlapping logout revocations
1. Sign in as A, start logout, and delay revocation.
2. Sign in as B and click logout before A's request finishes.
3. Expect immediate local logout of B, independent server revocation identities, and no stale A callback restoring/clearing a newer session.

## TC-KP-139/140/141 — online-only operation and upgrade
1. Load each role shell, open a modal, interrupt connectivity, and attempt keyboard/pointer saves.
2. Expect one compact connection gate; no business mutation or deferred replay, while local logout remains available.
3. Restore internet with the API still unavailable, then recover the API. Work resumes only after a successful bounded probe; reads may refresh, writes require a fresh explicit action.
4. Populate legacy scoped/unscoped command storage, IndexedDB commands, and owned/unrelated CacheStorage entries. Upgrade repeatedly.
5. Expect retired commands never to execute, owned offline caches/periodic tags removed, unrelated data retained, and a truthful retirement message without account-specific payload.

## TC-KP-142 — route asset recovery
1. Fail a lazy asset on an unchanged build and separately fail service reachability.
2. Expect truthful unavailable feedback and manual retry; no automatic reload, unrelated cache deletion, or deployment-cooldown consumption.
3. Serve a distinct build identifier, repeat the lazy asset failure, and expect one bounded refresh; repeated failure remains recoverable without a loop.

## TC-KP-125/126/127 — evidence access boundaries
1. Create synthetic trip evidence and try anonymous/public-alias, wrong-driver, former-driver and unassigned-OPS access.
2. Expect no evidence returned or deleted; no cleanup job created. Current owner and intended office roles retain access.
3. Race reassignment with photo deletion. The ownership decision and deletion must share the write transaction/lock.

## TC-KP-018 — configuration version tokens
1. Save with an explicit current token, omit a token, and submit a stale token.
2. Expect explicit-token success once, omission recovery at most once on VERSION_TOKEN_REQUIRED, and stale conflicts requiring reconciliation without a blind overwrite.
# TC-KP-BOOTSTRAP — Fresh database can load the production-shaped demo flows
- Apply all migrations to a new local database, then run the documented seed command.
- Expected: pricing tables exist through the journaled forward migration; completed demo trips explicitly record return of the original POD, while the real completion guard still rejects trips without that evidence.
- Re-run seed: no duplicate demo chains and no fabricated internal approval transitions.
# TC-KP018 — Current build identity and bounded dispatch hook
- Open personal account information at 390/768/1440px; the support row must match the current `/api/health` buildHash and allow retry on failure without showing a fabricated version.
- Run dispatch filter, sort, pagination and refresh regressions after extraction; the hook must remain at most 515 lines without loosening its guard.

## TC-QA129 — driver completion and attendance commit together
- Create an assigned, accepted trip departing on Saturday, with submitted e-POD evidence and a positive driver base salary.
- Complete via the authenticated driver HTTP route. Check persisted completion date in Vietnam, every day in the range including Sunday, and exactly one work-day per date.
- Replay the same operation: identical completion snapshot and unchanged attendance/posting counts.
- Inject a DB attendance-write failure for only this test driver; assert trip status, completion time, progress, attendance and financial postings all roll back. Remove the failure and retry the same key successfully.
- Keep an overlapping day's existing trip attribution. Closed payroll remains governed by its immutable published snapshot and explicit correction rules.

## TC-ADVANCE-DIRECT — direct advance lifecycle
- Creating a valid advance produces RECORDED plus exactly one OPS_ADVANCE ledger entry in the same transaction; replay returns the original response.
- Invalid amounts/reasons, another role, changed-body retry and removed review/update/delete endpoints must not change the recorded source or its ledger.
- RECORDED/DRAFT/VOIDED filters, counts and balances agree; unresolved legacy DRAFT rows cannot fund settlement and cannot appear as paid.

## TC-FINANCIAL-AUDIT — direct writes retain durable evidence
- Apply a financial change through the shared direct transaction primitive; read an immutable audit entry containing the original and resulting snapshots, reason, actual actor, source version and ledger/application references.
- Force the audit insert to fail: the source write and posting must roll back together. Retry through the durable operation key: one source effect and one audit entry.
- Unauthorized roles and incomplete evidence create neither effect nor applied audit. No pending/approval record or extra user decision is introduced.

## TC-DIRECT-LANGUAGE — workflow labels match direct recording
- Search every role's command palette: no approval-center destination.
- Advances workspace, credit thresholds/exposure and adjustment history describe direct recorded facts.
- Keep exact role permissions, amounts and validation while replacing stale review wording; existing rendering/payment/settings tests continue to assert the same behavior.
