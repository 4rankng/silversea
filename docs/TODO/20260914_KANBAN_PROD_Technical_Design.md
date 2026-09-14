# Kanban-PROD technical design

[Implementation plan](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md>) · [Technical design](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md>) · [Completion audit](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md>)

Status: **Proposed implementation design, not a claim that changes have been made.** 14 September 2026.

## Baseline and authority

The audit covers all 191 documents under `/Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD`: 6 IN_PROGRESS, 57 TODO and 128 QA_PASSED. Current source was read at `161a2e7098dfab3466a88b0224cb6b8e427d5b37`. Staging `/api/health` reported backend build `161a2e70` at `2026-09-14T12:05:36.823Z`; this does not prove the frontend or migration version. See the companion completion audit for every source file, its requirements, current source evidence and outstanding checks.

Frank's final requirements override historical acceptance criteria that ask to preserve approval or offline behavior:

- Authorized users record operations directly. There is no internal request/checker/approver workflow. Keep permissions, validation, audit, concurrency, credit policy and closed-period controls.
- Internet is required. No durable offline business command queues, automatic reconnect writes, offline application fallback or background synchronization.
- Preserve compact, readable data views on mobile, tablet and desktop. Screen space should primarily serve records and actions; avoid nested decorative cards, large empty panels and excessive edge padding.
- Driver acceptance of a transport order and customer acknowledgement of actual delivery are operational events. Do not delete those simply because their names resemble approval.

No source ticket is rewritten or moved by this audit. “QA_PASSED” is a claimed status; it is not independent proof. Missing evidence creates a verification task, not an assumed product defect. New interfaces below are proposed contracts; use the existing route/service boundaries where feasible.

## Design choices

| Decision | Alternatives and trade-offs | Recommended choice |
|---|---|---|
| Remove approval | Hiding buttons leaves API gates. Automatically approving keeps artificial states and actors. Direct commands require careful migration but match the product. | Direct authorized domain commands, deliberate legacy-state migration, no synthetic approvers. |
| Retire offline support | Unregistering everything also disrupts push. Deleting only a queue leaves old workers and other drain callers active. | Retire queues before startup, replace existing worker with a minimal push-only worker, remove owned offline caches and periodic tags. |
| Recover version conflicts | Generic GET-latest-and-retry is easy but bypasses stale-write protection. Manual reconciliation costs one step only when there is a real conflict. | Preserve original/local/latest values; merge proven non-overlapping changes or require explicit choices. Reject generic fresh-token replay in KP-135. |
| Create a logical trip | Sequential base/legs/containers is simple but can leave partial trips. One transaction protects relational data; image storage still needs explicit lifecycle handling. | One complete logical create command for relational trip data, followed by visible attachment outcomes. An explicitly identified resumable draft is a fallback, never an invisible partial trip. |
| Two 20FT containers | Ignoring truck conflicts risks real double booking. A second grouping model could disagree with existing trip pairs. | Extend the canonical `tripPairs` / `KEP` authority for a shared reservation, retaining separate cargo and evidence identities. |
| Shared responsive patterns | A global CSS rewrite is fast but can break already-correct views. Per-page copies keep inconsistencies. | Small shared primitives, adopted one record/template at a time with existing acceptance cases. |

<a id="design-1"></a>

## 1. Command and read-model contracts

Use the existing shared package for request/result types and validation. Keep server authorization authoritative. Define domain errors separately from HTTP status: `VALIDATION_ERROR`, `VERSION_TOKEN_REQUIRED`, `STALE_VERSION`, `DUPLICATE_CODE`, `RESOURCE_CONFLICT`, `MISSING_RATE`, `PERIOD_LOCKED`, `FORBIDDEN`. Names are proposed except codes already present in source. Do not parse Vietnamese prose to decide recovery.

Each mutation must carry the version from the snapshot the user actually edited. Preserve the repository's integer `expectedVersion` and timestamp `expectedUpdatedAt` conventions until a deliberate API migration; do not mix them or create fresh tokens silently. A missing token is a caller contract failure, not permission to overwrite.

For protected writes, require an explicit caller-owned token and remove the transport's remembered-path fallback (`client.ts:111–116`). A background GET can replace that remembered token while the form still contains an older draft. Load values and their version together, retain both as the original snapshot, and return `VERSION_TOKEN_REQUIRED` when a caller omits its token. Fetching the latest token does not authorize resending an unreviewed draft.

Proposed direct-save result:

```ts
type AppliedCommand<T> = {
  outcome: 'APPLIED';
  entity: T;                  // authoritative post-write representation
  version: number | string;  // existing domain version convention
  commandId: string;
  replayed: boolean;
};

type ConflictResult = {
  code: 'STALE_VERSION';
  message: string;
  currentVersion: number | string;
  changedFields?: string[];  // only fields this actor may read
};
```

The `APPLIED` outcome above describes the command committing; it does not mean a future-dated policy is already effective, an expense is paid, or money has been transferred. Return the domain effective date and posting/payment state separately, and use them for accurate user-facing text.

A result should reflect what committed. `actionKind === TRIP_FINANCIAL_CHANGE` does not mean “waiting for approval.” The current trip submit hook makes that incorrect inference. Return the resulting trip and version or perform an authorized readback, update the detail cache, and show “Đã lưu thay đổi.” Report later attachment failure separately from the successful financial update.

Maintain idempotency for explicit retries. Reuse the same key only for the same logical command and payload. A key conflict must not trigger a new create with a new key while the first outcome is unknown. Reconcile the original operation first. After a user explicitly reconciles and changes the payload, issue a new logical command with the version they reviewed. Query refetch/reconnect may repeat reads; it must not replay mutations.

For each write transaction: authenticate → authorize current row scope → validate input → acquire required domain/resource locks in one documented order → recheck version/invariants → write domain changes, ledger/audit/idempotency result → commit → refresh read models. Keep all components that can fail atomically together where they share the database. Use a transactional outbox for required external/post-commit work; an unawaited callback is not a delivery guarantee.

Source anchors: `frontend/src/lib/api/client.ts:109`, `frontend/src/hooks/use-trip-form-submit.ts:335`, `backend/src/routes/auth.ts:377`, `backend/src/services/idempotency.service.ts`, `backend/src/services/trip-figure-updates.service.ts`.

<a id="design-2"></a>

## 2. Edit concurrency and truthful recovery

KP-141 is a current source defect: the original populated payload survives a 409; only `fresh.version` changes before retry. Stop that retry. Track three snapshots per editable entity:

1. **Original:** values and version loaded together when editing began.
2. **Local:** current user draft, including raw text and explicit clear/zero values.
3. **Latest:** authoritative values returned after a conflict.

For each allowed field, compare original→local and original→latest. A local-only change can merge with latest. A field changed differently on both sides requires an explicit selection. If both chose the same value it is non-conflicting. Submit only allowed changed fields where supported, but keep version protection: a PATCH alone does not prevent two writers changing the same field. Nested containers, legs, allocations and instructions need domain-aware reconciliation, not generic object spreading. Revalidate totals and linked identities after merge. Another concurrent write must cause another conflict, not an unbounded retry loop.

Define field semantics before comparing: omitted/unchanged, explicit `null`, blank text and numeric zero are distinct unless that field's contract says otherwise. Match child rows by stable IDs, not array position; handle additions, removals, reordering and edit-versus-delete conflicts explicitly. Recompute derived values from the reconciled inputs rather than merging cached totals. The current edit flow commits figures before saving containers and instructions. Record which steps actually committed, read them back after partial failure, and reconcile only unfinished work. Do not replay already-saved children or imply that an earlier commit was rolled back.

KP-001/KP-006 already carry business-unit versions and distinct error codes. Verify those exact endpoints; truck tests do not prove them. Show latest and draft unit values after conflict, and preserve the user's intent. The fuel setup page currently repopulates form state whenever refreshed config changes: keep initial hydration separate from dirty-state reconciliation. Loading, legitimately missing config and fetch failure are three distinct states; never create a default config because a GET failed.

The salary editor currently fetches a fresh token but initializes amount from the older summary. Load amount and token from the same driver snapshot, then allow editing. A token from a newer row must not authenticate a value copied from an older summary.

Tests: two-session notes/revenue edits; same-field and unrelated 409; third writer during conflict review; old draft plus background refetch; missing explicit token; null/blank/zero; reordered or deleted child rows; figures saved but child save failed; stale async hydration; unit duplicate versus stale errors; failed refresh retains draft; cancel never writes.

<a id="design-3"></a>

## 3. Internet-required operation and session behavior

Implement one availability model shared by the office shell, driver/OPS shells, CUS, customer portal and authentication shell. Suggested states: `checking`, `available`, `offline`, `serviceUnavailable`, `sessionInvalid`. `navigator.onLine` is a hint; a successful bounded same-origin service/identity request is evidence of availability. Avoid tight polling. A health response alone does not guarantee every dependency: command failures must still have truthful local recovery.

On lost connection, stop new business commands and disable editing that promises a save. Keep any already-entered draft inert in current memory with a compact message and explicit Retry. Do not persist it into a business replay queue. Local sign-out and navigation to recovery remain available. Avoid a full-screen modal for an already-loaded page when a compact accessible gate explains the same restriction. A cold offline launch may show the browser's unavailable page; do not introduce an offline app shell solely to render a branded fallback.

Model mutation outcomes separately:

| Outcome | UI and retry |
|---|---|
| Definitely not sent | Keep in-memory draft; explicit retry when service works. |
| Server rejected | Show field/domain error; retain draft and current committed value. |
| Committed and response received | Update authoritative cache and show saved state. |
| Response lost / outcome unknown | Show “Chưa xác định kết quả lưu”; reconcile by operation identity/readback. Never assume failure or issue a different create key. |

Remove active queues in `useOfflineCommandQueue`, driver detail/POD, forwarder detail, RoleWorkInbox and legacy `offline-queue`/DriverProgressCard. Move reusable direct command senders and error types out of queue modules. Remove queue counters, pending-sync statuses, reconnect drains, paused-mutation hydration and automatic mutation retries. Inspect query defaults and any persistence adapters; transport `retry:false` alone is not enough if a paused mutation can resume.

Run an idempotent owned-storage retirement before mounting any component capable of reading a legacy queue. Cover current scoped keys, original unscoped keys, IndexedDB stores and multi-tab old clients. Do not submit discarded queued entries. Preserve confirmed server records. A concise one-time message may explain that unsent legacy work must be entered online again. Do not delete arbitrary origin storage or unrelated databases.

`fetchAuthUser` currently clears credentials for every `ApiError`. Only actual invalid/expired/revoked identity should clear a valid session. 502/503/429/network failures gate protected work and retain credentials for explicit recovery. Local logout must always read and clear the current session; scope in-flight revocation to its own token, so account A's hung request cannot block account B. Remove the durable failed-revocation token queue and online listener; make a bounded online revocation attempt for the current token, clear locally regardless, and accurately state any remote-session uncertainty. A late response must not modify the next login.

Acceptance includes all 8 roles plus signed-out state, old profiles, two tabs, account switching, before-send versus after-commit failure, zero automatic writes on reconnect and no legacy queued credentials. Ordinary live server updates/read refreshes are not offline sync.

<a id="design-4"></a>

## 4. Service worker and deployed-asset migration

Use the existing `/sw.js` URL/scope to update already controlled clients. Replace its offline fetch handlers and periodic journey polling with a minimal push/click worker if notifications remain supported. Update both startup registration and `usePushNotifications` registration; otherwise opt-in can restore retired behavior. Remove the token mirror in `token.ts` with the worker consumer of `/__auth-token` and `/__journey-new-count`.

Migration removes only identified TransTing shell/runtime caches and the `refresh-journey-board` periodic tag. Handle unavailable APIs, blocked IndexedDB deletion and another tab still holding old storage; keep migration idempotent and prevent old consumers from restarting. Coordinate old-client cutoff through a compatibility/build policy before allowing legacy clients to submit queued commands. Do not rely on merely deploying new JavaScript to stop already open old tabs. Avoid unconditional controller-change reload loops. Keep push subscriptions, normal authentication and unrelated caches intact.

For route-asset errors, distinguish offline/service unavailable from verified stale frontend build. Introduce a small same-origin frontend build identity tied to the bundle manifest, separate from backend health. Compare it only when reachable. Do not label every `vite:preloadError` as a new release or delete all CacheStorage. A verified stale client may offer a bounded refresh with loop protection; a transient network failure gets explicit Retry and does not spend the deployment-recovery allowance. Rollback must not reintroduce a queue-draining worker/client. Prefer a compatible forward fix after the online-only storage migration.

Acceptance: fresh profile, installed app, old cached profile, two open tabs, push opt-in after upgrade, unavailable periodic API, unchanged-build asset failure, real stale deployment, repeated failure and safe recovery. No new offline fallback.

<a id="design-5"></a>

## 5. Atomic trip creation and attachment lifecycle

KP-073: current create writes base trip, legs, then containers through separate requests. Early validation does not make that atomic. Add a shared complete-create DTO containing the trip, legs, container instances/seals and instructions needed for a usable record. Run its relational changes and the command result in one transaction. Preserve role, pricing, credit, optional-field and resource rules. Keep files outside the database transaction and link only confirmed stored objects.

If a fully atomic command cannot land in the first slice, retain one explicit draft trip ID and completed step state. Retry unfinished steps against that ID. Do not mint a new trip merely because the payload changed or an attachment failed. The UI must clearly identify a recoverable incomplete record, not navigate away with a full success message.

KP-160: maintain an in-memory map per selected file: `{localId,rowKey,generation,file,previewUrl,state,serverPhotoId,serverUrl,error,requestKey}`. Use `SELECTED`, `UPLOADING`, `CONFIRMED`, `FAILED` and `UNKNOWN_OUTCOME`. A lost response, malformed successful response or missing returned ID/URL can follow a committed upload; it is not proof of failure. Keep the file and preview while reconciling that command's result. Remove an item from pending work only after confirmation, and apply its server URL to the view before revoking the blob URL. Failed or unattempted files remain available in the open form for explicit online retry.

Assign one stable request key to each attachment intent, independent of its temporary blob URL or file metadata. Retain it until response validation and, when needed, authoritative readback establish the outcome. The current transport releases generated keys before parsing a response (`client.ts:130–139`); a malformed success must not lead to a new key and duplicate upload. Preserve the saved trip/container IDs through all attachment outcomes. An uncertain create or idempotency conflict must be reconciled before permitting a new logical create, never automatically retried with a fresh trip key.

Permit only one in-flight request per attachment. Stable row IDs plus generation counters and deletion markers (tombstones) prevent a late result from attaching to a deleted or replaced row. Abort where possible, but treat abort as outcome-unknown if the server may have received the request. Reconcile any confirmed orphan before authorized cleanup; do not silently attach it elsewhere. Revoke only URLs no longer displayed. Keep this state in current memory, with explicit online recovery and no durable queue or reconnect replay.

KP-144: the same lifecycle supports adding a receipt to an already-saved OPS expense. Add a compact capture/file action in the saved editor and receipt-debt view. Scope it to the existing expense ID, preserve amount and shipment/container identity, and clear missing-receipt status only after readback. Removing internal approval does not remove accounting-lock or current ownership checks.

Tests must inject first/middle/last upload failure, lost response after commit, malformed success, missing photo URL, container-save failure, row deletion or replacement during upload, simultaneous retry clicks, corrected create retry, and navigation with partial success. Verify retained entity IDs and no duplicate attachment on readback. Real camera capture requires physical-device evidence; a visible camera button or bundle string is not equivalent.

<a id="design-6"></a>

## 6. Evidence authorization at the actual operation boundary

KP-076/KP-156: keep private files behind authenticated exact-key serving. Apply current OPS shipment scope as well as driver ownership; verify known-key access after scope revocation. Public/static aliases, deployment proxy rules and previously cached URLs require independent checks. A source mount test alone does not verify the deployed proxy.

KP-077: the driver delete route checks ownership before its transaction, then deletes under an idempotency lock scoped to endpoint/key. Reassignment uses another transaction and can occur between those steps. Move ownership/terminal/version checks into the destructive transaction and lock the same trip/assignment authority used by reassignment in a consistent order. Recheck before creating the final-delete outbox record. A lock on the photo alone does not serialize ownership changes. The replay response must also respect current access and must not perform another deletion.

Tests: synthetic photo, current owner, former owner, no driver profile, OPS assignment and revocation, absent/deleted trip, reassignment deliberately paused between read and delete, terminal transition race, same-key replay and proxy-alias denial. Do not use unrelated users' real private evidence to test this boundary.

<a id="design-7"></a>

## 7. Monetary correctness, allocation and payroll

Use explicit decimal/integer money contracts already appropriate to each domain. Do not fix `NaN` by coercing missing data to zero. KP-145 requires a shared adjustment read DTO defining debit/credit direction and the amount displayed; keep signs consistent with actual ledger effects and return the applied trip version. Preserve existing audited calculation/rounding policies rather than introducing new financial semantics through a UI formatter.

KP-157: absent override means automatic; zero is an explicit valid amount. Change the shared allowance predicate from `>0` to valid non-null semantics. The current isolated helper returns 500,000 allowance for both null and 0 against an automatic 500,000 fixture. Verify stored override, applied allowance, cost and profit together.

KP-159: resolve the final route/trailer pair once. Represent rate found at 0 separately from not found. Do not fall back to the previous trailer type. Prefer a clear missing-rate state requiring configuration or an explicit permitted override; do not silently borrow a different equipment rate. Recalculate and persist one consistent source/rate/result snapshot.

KP-075: the API accepts `expenseIds`, the ordinary payment UI does not send them, and the settlement helper marks selected expenses fully paid without receiving the payment amount. Replace this with explicit allocations, for example a unique payment/expense allocation record with amount and reversal linkage. Under locks, require same supplier, allowed non-cancelled expense, positive allocation, allocation≤remaining expense balance and total allocations≤unallocated payment amount. A payment of 1 against expense 100 leaves 99 outstanding. Partial status is derived from balance; selecting an ID alone cannot mark full payment. An unallocated remainder may remain a supplier credit only if the existing ledger model supports it, clearly labelled. Recording a payment is not proof that a bank transfer occurred.

Expose a compact expense selection and allocated amount table in supplier payment recording. Reversal is a direct authorized compensating ledger/allocation operation, never deletion of historical entries. Ensure the helper has a real production caller; tests of an unreachable helper do not close the flow. Retire the obsolete APPROVED prerequisite with the direct-expense lifecycle. Test multi-expense, cumulative partial payments, over-allocation, mixed suppliers, concurrent payments, replay, rollback and reversal.

KP-158: driver completion must update actual work dates through the persisted completion date in `Asia/Ho_Chi_Minh`. Prefer passing the existing transaction into a transaction-aware attendance authority after agreeing a global lock order with salary closing; otherwise insert an idempotent attendance-sync outbox entry in the completion transaction. Do not call the current `syncAttendanceAfterStatusChange` wrapper as if it were transactional: it uses the global database, accepts no executor and swallows failures (`trip-attendance-sync.service.ts:30–65`). Required synchronization must either commit with completion or remain durably retryable.

Make attendance reflect all contributing trips for a driver/day. Current `syncTripWorkDays` overwrites the date's trip attribution, while cancellation removes days belonging to the cancelled trip (`attendance.service.ts:224–268`). Replace last-writer behavior with contribution-aware recomputation under the driver/day lock, so removing one trip preserves another valid contribution. Define how legitimate manual day states and authorized corrections interact with derived trip days. For an outbox, use an idempotent event identity, then reconcile against current trip status, version, driver and dates; a delayed completion event must not undo a later cancellation or reassignment.

A required async update exposes processing state and coordinates with payroll finalization, blocking final close until the relevant attendance work is reconciled. Refresh attendance/payroll caches after the attendance commit, not merely after completion. Closed payroll snapshots remain immutable; discrepancies use the existing authorized correction mechanism, not silent recalculation or an approval queue. Test same-day and overnight completion, midnight and period boundaries, two contributing trips on one day, cancellation or reassignment of either, manual day states, delayed events, synchronization failure, replay and concurrent salary closing.

KP-005: add effective-dated salary rates with actor/reason and non-overlapping validity intervals. Resolve the rate by the work/business date under the established payroll calculation policy, not “the next time someone opens the page.” Keep salary-period snapshots and later direct adjustments separate. Verify changes across open/closed periods, mid-period effect, cancelled edit, negative input, concurrency, historical reports and payroll cache refresh.

KP-111/KP-112: desktop and mobile attendance must share one pending guard. Native day buttons expose date/current state and disabled/locked status; mobile clickable DIVs must not remain an alternate unguarded mutation path. Optimistic feedback must roll back or reconcile by driver/date and current query identity.

<a id="design-8"></a>

## 8. Scheduling and CUS interactions

Distinguish **date-only business values**, **Vietnam local appointment drafts** and **persisted instants**. Do not call `.slice(0,10)` on an instant to derive Vietnam date. The completed-trip initializer was fixed, but `useTripFormDispatch` later overwrites it using the UTC prefix. Use one conversion at initial hydration, async data arrival, reset and reconciliation. A date-only value must remain a date, not be reinterpreted in the browser zone. New tire events use business today; historical events retain their saved date.

The appointment popover must own a raw typed 24h draft and expose separate change, commit and dismiss events. Enter and a visible Xác nhận action validate and invoke the same awaitable parent save; close only after success. A date-picker selection is a draft change unless the UI explicitly describes direct save. Handle Vietnamese IME composition and Enter inside the native picker before form submission. Errors stay in the active editor and draft values remain available. Read-only/assigned states must show why a schedule cannot be edited rather than silently losing the trigger. Keep ordinary assignment and terminal constraints; do not add approval.

The dispatch issue form still contains schedule pickers the newer ticket removes. Keep its short inherited schedule summary; edit appointments in the schedule owner. `useIssueOrder` currently reconstructs full displayed runAt from date+integerhour+`:00`, losing minutes. Preserve the full canonical instant and timezone through issuance. Do not silently equate a customer factory appointment with actual vehicle departure if the model treats them as different events: name each field clearly and derive operational start only according to an explicit rule. A missing required schedule returns an actionable link to its editor. Midnight end-time defaults must advance the date, not modulo the clock on the same day.

For LCL, use lot-level transport date and null-container fulfillment identity throughout create→allocation→issue→driver/OPS readback. A test that inserts an already allocated row proves neither allocation nor the UI. Exercise the real endpoint; fix container-only assumptions if exposed, without manufacturing a dummy container.

Tests: blank/date-only/24h typed value, picker and Enter, 20:45 minutes, 23:30 rollover, UTC+7/UTC+8/UTC browser settings, IMPORT/EXPORT/LCL, clear/reopen/reload, failure, assigned state, duplicate submit and real container-less allocation.

<a id="design-9"></a>

## 9. Dispatch reservation, carrier lookup and notes

For KP-139, extend the existing canonical `tripPairs` / `KEP` model to represent the shared reservation for two 20FT fulfillment members. Do not introduce a second independent group authority. `KEP` is concurrent carriage; retain the different sequential rules for `KET_HOP`. Resource availability must recognize only a validated active pair, not a free-text pair label. Establish both assignments and their pair identity atomically before the second member encounters the ordinary overlap rejection.

Validate both members' versions, active membership, compatible route/time, the same actual truck/trailer/driver, two available 20FT positions and combined cargo weight against the applicable capacity. The current pairing helper checks each member's weight separately (`trip-pairing.service.ts:150–160`); that is insufficient for simultaneous carriage. A 40FT trailer may be appropriate for two 20FT containers. Reject a 40FT container as a member of this two-20FT pair, not the trailer merely because it is 40FT.

Acquire parent, member and truck/trailer/driver locks in one documented stable order before checking overlaps and committing assignments. Scope the overlap exception to those two valid members only. Preserve separate shipment/container history and evidence. Reassign or remove a member through the same pair authority and recompute capacity and the survivor's reservation; retain protection against unrelated truck/driver/trailer conflicts. Test combined overload even when each member fits alone, a third container, stale versions, concurrent issue requests, same-key replay, cancellation, reassignment and preservation of `KET_HOP` behavior.

Typed carrier resolution must be associated with normalized plate and request identity. Cancel or ignore obsolete results if the draft, mode or manual carrier changes. Picking a known internal unlinked truck and typing its same plate must resolve consistently. Distinguish unknown manual plate from known OWN inventory. Preserve manually chosen carrier unless the current user accepts a relevant change. Test reversed responses for A then B, clear, same plate with changed link, manual override and reload.

For notes, keep selected task IDs/labels and raw manual text separately during editing. Do not round-trip through `trim()` on each keystroke. Normalize only at explicit save; preserve meaningful line breaks and spaces. Maintain a compatibility parser for historical single-line notes, but no migration may destroy arbitrary free text that resembles a tag. Tag rename must preserve the open user's text and selection. Driver presentation uses separate uppercase task line and normal driver-note line. Avoid converting all user-entered notes to uppercase.

<a id="design-10"></a>

## 10. Driver and dispatch information contract

KP-191's five images add requirements not present in its 94 characters of XML text. They are included as evidence in this package. Implement them with the related older driver tickets as one shared presentation contract, while keeping each acceptance case separately traceable:

- Contact name and callable phone together beneath the factory address, labelled “Số điện thoại liên hệ”; eliminate the separate repeated warehouse/contact rows. Choose the operative contact source explicitly and retain meaningful alternative contacts in detail when genuinely different.
- Render each container number next to its own type, e.g. `MNBU12345543 · 40DC`; two arrays of numbers and type counts do not preserve pairing for multiple containers. Quantity summary may supplement, not replace, per-container identity.
- For IMPORT, the required Cảng hạ is the empty-container return depot. Resolve source fields by direction; do not merely suppress a row because two strings happen to match. Preserve a distinct actual delivery location under its correct meaning. Unknown destination is explicit, never a fabricated factory/depot fallback.
- Task tags and driver notes are separate rows; task labels uppercase. Keep driver order acceptance instructions aligned with the actual single primary operation.
- Each invoice party heading precedes that party's legal name/address/MST. Current customer facts occur before their heading and can appear to belong to the factory. Never use the customer's profile as an unlabeled fallback for missing factory billing data. Show a concise missing-profile state when required information is not configured.
- Retain full names, address, date/time, contacts, ports and full details behind compact summaries. Factory-first card ordering is governed by the latest card requirement; the older detail wireframe is route-led and does not itself mandate a factory-first detail header.

KP-140's image is explicitly the dispatcher **Kế hoạch Chi tiết Xe** grid. Restore lift/drop information there with the same direction-aware source mapping. The appended speculation about a different screen must not block this work. Do not fix only a driver view and close the dispatcher ticket.

Check card, task detail, dispatch row and OPS projection against the same fixture: IMPORT/EXPORT, FCL/LCL, missing number/date/site, multiple containers, different invoice parties and different contact sources. Verify field order and group membership, not merely text presence.

<a id="design-11"></a>

## 11. Direct workflows without approval

A direct command is not a weakened validation path. Map every former request to its domain operation, permissions and financial effects. Remove request/approve/reject menus, tabs, counters, routing configuration, status-derived readiness and fake APPROVED results from active paths. Preserve original audit facts read-only under explicit legacy labels.

| Domain / records | Direct operation and invariants | Migration / regression |
|---|---|---|
| Financial policy and vehicle profile — KP-097/KP-147 | Save a validated effective version directly; retain role, uniqueness, period and version controls. | Keep prior versions and historical application dates. Replace pending policy requests with explicit unresolved legacy records until valid authorized re-entry. |
| Advances and settlement — KP-092/KP-125/KP-148 | Record advance, repayment/settlement and compensating reversal under ordinary authority. Derive outstanding from ledger entries. | Pending request is not proof money was disbursed. Classify by actual postings; do not mass convert requests into cash movements. |
| OPS expenses — KP-149 | Record/edit eligible expense and required receipt facts; post wallet effects exactly once. Remove category Finance/Director routing thresholds. | Reconcile wallet opening, receipts, expenses, repayments and closing balance. The app-settings creditTierOne cap belongs to credit exceptions, not OPS; do not erase it in the wrong package. |
| Operating expenses — KP-070/KP-074/KP-150 | Direct authorized expense save; attachment lifecycle and supplier liability post atomically/once under current accounting rules. | Recorded does not mean paid. Reverse posted entries through audited compensation; protect locked periods. |
| ePOD/accounting/billing — KP-080/KP-151 | Required saved evidence and complete data determine readiness; no internal ACCEPTED/reviewer gate. | External customer acknowledgement remains distinct. Recompute readiness from evidence, reconcile billing identities to avoid duplicate invoices. |
| Fuel invoice — KP-082/KP-152 | Direct invoice capture and explicit allocation of litres/amounts across eligible records; OCR confirmation is data correction, not approval. | Preserve exact allocation totals, supplier/invoice uniqueness and evidence requirements. Do not auto-split amounts/litres without a domain rule. |
| Profit distribution — KP-153 | Authorized direct finalization of a reviewed calculation for an eligible period/cap table; once-only posting. | Preserve period locks and original shareholder shares. Distribution recorded does not claim money transferred. Do not fabricate reviewer history. |
| Shipment deletion — KP-154 | Confirm and perform eligible direct deletion/cancellation under reference/terminal/accounting guards. | Pending deletion request must not auto-delete on migration. Retain references/audit; explain real blocker instead of opening approval. |
| Discipline — KP-109 | Direct effective discipline record and auditable cancellation; payroll reads effective non-cancelled records once. | Current PenaltyTable still offers PENDING and another-person approval despite the closure claim. Reconcile historical postings and prevent double deductions. |
| Credit exception — KP-163 | Direct authorized exception in trip creation, retaining credit/exposure ceiling, reason, customer/scope, expiry and usage limits. | Replace approved-request selection; distinguish true financial authority limits from obsolete approval tiers. Changed exposure must be rechecked inside trip creation. |
| Completed trip figures — KP-101/KP-162 | Apply authorized changes directly and report resulting trip/version. | Remove phantom approval success text and update real cache; do not reopen a queue to match stale UI copy. |

For each table row create a narrow implementation change, not a single giant approval-removal commit. Deliver shared result/error contracts first, then domain handler/transaction, UI callers, migration and regression together. Avoid using `autoApplyGovernanceAction` as the permanent architecture: it keeps approval vocabulary and fabricated state transitions alive. Reuse real validators/posting functions behind direct commands instead.

Legacy transition procedure: inventory request/status counts and actual ledger links; classify already applied, unapplied valid, invalid, cancelled and ambiguous records; preserve mapping and reasons; migrate only deterministic states without new business effects. Unapplied or ambiguous requests remain read-only legacy work requiring direct authorized re-entry/reconciliation. This is an implementation safety boundary, not a new customer approval flow. Compare pre/post ledger totals, balances and affected entity counts. No automatic application of old pending requests.

<a id="design-12"></a>

## 12. Compact responsive design patterns

Adopt existing accessible UI primitives rather than introducing another visual framework. Define a small set of shared patterns: compact page/section header, filter disclosure, summary strip, record summary with details, responsive data table, field group/error, modal/drawer action footer, attachment strip and availability message. Preserve useful existing desktop tables and phone field-first ordering.

Suggested measurements are implementation targets to validate, not claims of current geometry:

- Phone surface content inset about 12–16px including cumulative wrappers; safe-area inset added only where necessary. Avoid outer16+card24+inner16 stacking.
- Normal body/control type stays readable, usually 14–16px. Do not solve density by shrinking important data to 10–11px or enlarging all headings. Use compact labels and tabular numerals for money/identifiers.
- Phone controls retain roughly 44px touch hit areas; visual icons may be smaller. Adjacent hit regions must not overlap. Tight content spacing is compatible with accessible targets.
- Use complete identifier units with `white-space:nowrap` or controlled group wrapping. Wrap between plate/type/count groups, not inside `RM`, `40FT`, MST or phone values. Long names remain available through explicit touch/keyboard details, not hover alone.
- SummaryRail should wrap by available container width and metric minimum content, including 834px; the current 700px threshold leaves the stated tablet case uncovered. Avoid a mandatory row of six squeezed metrics.
- Prefer one surface with separators; use a second card only for a genuinely independent task. Empty secondary sections become concise rows/disclosures. Do not create layout jumps that move focused controls when a queue becomes empty/populated.
- Keep wide comparison rows under shared headings when they fit. On narrow screens group primary identity, state, key amounts and next action, with secondary fields in a disclosure. Do not squeeze desktop's entire field inventory into repeated phone cards.

| Template | Required adaptation | Main records |
|---|---|---|
| Trip list/create/detail | One status summary; records first; required fields before estimate/progress; core facts before empty ancillary services; preserve compact phone form ordering. | KP-073/KP-078/KP-120/KP-168/KP-169/KP-186/KP-189 |
| CUS overview/detail and shipment entry | Search/primary actions visible; named secondary filter disclosure with active count/values; preserve delivery vs transport date semantics and all-date state; keep /shipments/new multi-container entry compact on tablets. | KP-044/KP-048/KP-066/KP-128/KP-180 |
| Customer/factory/catalog directories | Unbroken identifiers, useful name/route width, compact summaries, secondary details on demand; no dedicated ordinal/empty-contact row per card. | KP-174/KP-175 plus secondary directories named in source |
| Payroll/discipline | Bounded driver selector next to attendance; ledger ahead of large rankings; compact responsive summaries and keyboard day controls. | KP-108/KP-110/KP-111/KP-112/KP-146 |
| Payables and debt accounts | Supplier queue primary; secondary fuel workspace; compact balance/aging; ledger/filter navigation in initial phone/tablet viewport. | KP-081/KP-177/KP-183 |
| Accounting and OPS queues | Prioritize nonempty actionable records; empty buckets concise; each record states identity, blocker owner and next direct action once. | KP-080/KP-182/KP-184 |
| Financial comparisons/charts | Shared headings and aligned metrics; distinct tick captions at adjacent values; exact tooltip; no duplicated currency suffixes. | KP-079/KP-116/KP-171/KP-172/KP-178/KP-179 |
| Forms/editors | Statement-create toolbar wraps without overlap; aligned effective-date pair; content-sized receipt area; selected template column adjacent to properties; company Save beside fields; compact driver footer. | KP-117/KP-173/KP-175/KP-176/KP-181/KP-185 |
| Fleet | Trailer code/type groups intact at tablet; count/category groups wrap cleanly on phone; keep vehicle list nearby. | KP-055/KP-088/KP-089/KP-129/KP-187/KP-188 |

For financial tick labels choose scale and precision together: distinct generated tick values must have distinguishable captions. Do not simply round each tick to a whole million. Currency formatting has one owner; never append another `đ`/`₫` to an already formatted value. Negative earnings should say a neutral balance or name the actual cause, not infer an advance from the sign.

<a id="design-13"></a>

## 13. Input, focus and motion contracts

Keep raw input text separate from parsed values. The OPS money fields still render sign-stripped digits, so typing a minus then digits can turn an intended negative into a positive amount. Preserve the sign in the draft; show an associated Vietnamese validation message and refuse invalid submission. Test individual keystrokes, paste then edit, IME and blur—not only setting a final value in a test. Optional company email accepts blank or a valid trimmed address at both UI and schema; malformed nonempty values remain invalid.

Errors belong inside the active modal/form and next to their fields. Use stable error IDs, `aria-invalid`, `aria-describedby`, concise messages and focus on the first invalid field. A generic top-of-modal alert does not satisfy an explicit amount/email association requirement. Pending saves show one progress state and guard both click and Enter. Fetch failure is not an empty selector; show retry and preserve selection.

OPS modals already portal above the shell but their custom hook lacks full keyboard containment. Reuse the proven shared modal foundation or provide equivalent Tab/Shift+Tab containment, background inertness, topmost Escape behavior and focus return. Respect nested calendar/select portals as part of the active modal. Bound body scrolling with visible title/close and reachable actions under the soft keyboard. Do not trap users in a child picker or send focus to a removed trigger.

OPS assignment must use the same ACTIVE/nondeleted eligibility for selector and mutation. The current list caps at 100 and both ends omit ACTIVE filtering. Add searchable/paged results, stable identity/secondary labels for duplicate names, loading/error/retry, and server recheck after selection. A deleted/inactive account cannot become a new owner through a stale list.

Use short opacity/transform transitions only where they explain expansion/selection. Respect reduced-motion preferences; avoid animating all data rows on every refetch or using layout animation that moves an active editor. Reserve space for pending feedback to avoid jumps. Validate focus/hover contrast and busy/disabled states without increasing visual noise. No animation, contrast or full responsive pass is claimed by this document.

<a id="design-14"></a>

## 14. Release integrity and completion evidence

Repair the context manifest rather than bypass its validation. Split genuinely large files by responsibility; do not raise a shrink-only ratchet to declare it satisfied. Keep test fixtures isolated and deterministic, using real route calls for behaviors under review rather than seeding the final state. Avoid editing historical migration hashes merely to make a checker green; compare the actual migration ledger and deployed schema before a forward corrective migration.

Use one evidence record per acceptance case: source file/hash, changed commit, frontend/backend build identities, migration version, test case, actual role, route, viewport/timezone, fixture IDs, action, observed result, screenshot/DOM and persisted readback where applicable. Test output includes command, time and exit result; test source alone is not an execution. Store evidence in a durable repository-supported or linked artifact destination; broken `/Volumes/...` paths cannot support handoff.

For each surviving UI task test at minimum 390×844,834×1112 and 1440×900, with360/430px phone and1024px transitions for shared components. Include long/empty/loading/error values, keyboard, touch, zoom and reduced motion where relevant. Hardware capture and 24-hour stability need their actual device/time evidence. A smoke test or latest log line cannot substitute for that observation window.

Existing scripts available at this snapshot include `pnpm context:check`, `pnpm context:test`, `pnpm --dir shared test`, `pnpm --dir frontend test`, `pnpm --dir frontend build:check`, `pnpm --dir frontend check:ui`, `pnpm --dir backend test:unit`, `pnpm --dir backend test:integration`, and `pnpm build`. Verify environment prerequisites and use isolated staging/test data before executing mutation suites. The backend integration script already sets test concurrency1. Run focused cases during implementation, then required aggregate gates; do not report any of these as run by this planning audit.

Rollout: shared compatible contracts → integrity fixes → domain-specific direct commands/migrations → queue/worker retirement with old-client cutoff → surviving responsive changes → role/device regression → current release evidence. Independent visual work may proceed alongside backend slices, but it must consume the final direct-operation states. Never close an umbrella ticket because a subset is green; every linked acceptance case must either pass, remain open or be explicitly superseded by Frank's decision.


## Work mapping and evidence

The [implementation plan](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md>) maps every one of the 191 records to a bounded work item and dependency package. The [completion audit](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md>) holds exact source filenames, hashes, requirements, source anchors and verification limits. Proposed interfaces in this document are implementation choices, not descriptions of deployed behavior.
