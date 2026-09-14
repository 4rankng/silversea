# Kanban-PROD implementation plan

[Implementation plan](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md>) · [Technical design](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md>) · [Completion audit](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md>)

Reviewed source: `161a2e7098dfab3466a88b0224cb6b8e427d5b37`. Audit date: **14 September 2026**. Scope: **191 source documents**: 6 IN_PROGRESS, 57 TODO, 128 QA_PASSED. Source code and ticket statuses were not changed.

The current staging health request reported backend build `161a2e70`; this matches the source prefix only. It does not establish frontend build identity, migrations, or full product completion.

## Outcome and scope

Implement the confirmed missing behavior, finish partial fixes, and verify already-present implementation before reopening it. Preserve every source file as an acceptance input. The 27 packages below organize dependencies and ownership; each KP record remains a separate acceptance item, not a bundled claim of completion.

- **28 records:** required outcome still absent or contradicted by a current path.
- **43 records:** partial implementation or a concrete remaining scope/contract gap.
- **92 records:** implementation present; start with current verification.
- **19 records:** open visual findings requiring fresh measurement before modification.
- **5 superseded + 4 duplicate records:** replace/link their requirements, with no duplicate implementation.

For the 128 QA_PASSED records alone: **32 partial, 87 present but unverified, 5 superseded and 4 duplicate**. This is not a claim that all 128 are broken. No record is granted fresh full-product completion from historical prose, a screenshot, or the mere presence of a test.

This deliverable is a plan, not an implementation. Full suites, all-role browser flows, physical camera capture, schema/ledger reconciliation and long-running stability checks remain execution work. Two production helper probes and a narrow current browser observation were performed; see the audit for their exact limits.

## Product constraints

1. Remove internal request/checker/approver flows across frontend, API and domain state. Preserve role authority, validation, audit, period locks and exactly-once posting. Do not replace the workflow with synthetic auto-approval.
2. Require internet for business work. Retire durable offline queues, reconnect mutation replay, offline application fallback and background business sync. Keep ordinary push if required, using a minimal worker.
3. Use compact data-first patterns on mobile, tablet and desktop. Avoid nested decorative cards, oversized type and cumulative padding. Preserve readable values, keyboard access and adequate touch targets.
4. Keep legitimate driver order acceptance and external customer delivery acknowledgement: those are operational facts, not internal approval.
5. Historical ticket text claiming a lead approved an approach does not override these decisions or justify unsafe implementation. In particular, KP-135's generic fresh-token replay is replaced by caller-bound versions and explicit conflict reconciliation.

## Delivery sequence

| Stage | Deliverable / exit condition | Parallel work |
|---|---|---|
| 0 — establish trustworthy baseline | Restore context resolver (KP-190), record exact FE/BE/migration identities, available fixtures and evidence location. Verify prior claims against actual acceptance criteria. | Source-confirmed small fixes and baseline screenshots can proceed; do not mark a release verified while baseline is unknown. |
| 1 — protect data and recoverability | Draft-bound versions, command identity, atomic relational trip creation, photo authorization, monetary calculations, attendance consistency and online-only cutover. | Scheduling, pairing, notes and identifier packages have independent owners after shared contracts settle. |
| 2 — remove approval domain by domain | Each narrow domain has direct handler, truthful UI, legacy-state migration and reconciled ledger/effects. | Independent domains can proceed in parallel; coordinate shared expense/wallet/credit models before merging. |
| 3 — refine information and responsive patterns | Shared small primitives plus per-screen field order, density, forms and accessibility acceptance. | Measure and prototype earlier; finalize screenshots after relevant domain controls stabilize. |
| 4 — verify release and close records | Real role/device flows, persisted readback, failure/race cases and required observation windows tied to exact deployed builds. | Execute independent scenarios concurrently with isolated fixtures; each source record gets its own evidence verdict. |

No elapsed-time estimate is asserted without owner capacity, dependency setup and deployed migration inventory. Keep source priority visible; resolve financial integrity, authorization and lost-work defects before cosmetic reordering even when their historical priority was lower.

## Package map

Dependencies below constrain the shared contract or final integration, not all discovery or UI preparation. WP01 as a dependency means baseline setup and evidence identity; it does not require waiting for every stability, migration or decomposition item before starting a fix. Each package should land in small coherent changes; domain approval removals are separate implementations.

| Package | Stage | Primary ownership | Depends on | Items |
|---|---|---|---|---|
| [WP01 — Evidence, repository context and release integrity](#wp01) | 0 | QA + platform + relevant code owners | — | 13 |
| [WP02 — Draft-bound versions and truthful save recovery](#wp02) | 1 | Frontend + backend + shared | WP01 | 7 |
| [WP03 — Atomic trip creation and recoverable online attachments](#wp03) | 1 | Frontend + backend + shared | WP02 | 4 |
| [WP04 — Current-owner and OPS-scoped evidence access](#wp04) | 1 | Backend + platform + QA | WP01 | 3 |
| [WP05 — Trip adjustment amounts and allowance correctness](#wp05) | 1 | Shared + backend + frontend | WP02 | 3 |
| [WP06 — Attendance, effective salary and usable payroll interaction](#wp06) | 1 | Backend + frontend + payroll owner | WP02 | 5 |
| [WP07 — Business dates, appointments and real LCL dispatch](#wp07) | 1 | Shared + frontend + backend | WP02 | 14 |
| [WP08 — Assignment, canonical KEP pairing and carrier lookup](#wp08) | 1 | Backend + frontend | WP02 | 11 |
| [WP09 — Task tags and raw dispatch note editing](#wp09) | 1 | Shared + frontend | WP01 | 3 |
| [WP10 — Container identifiers and direct corrections](#wp10) | 1 | Shared + backend + frontend | WP02 | 7 |
| [WP11 — Driver and dispatcher facts, identity and evidence presentation](#wp11) | 3 | Frontend + shared read-model owners | WP03, WP07, WP08 | 22 |
| [WP12 — OPS route provenance, eligible owners and accessible interactions](#wp12) | 1 | Frontend + backend | WP02 | 11 |
| [WP13 — Internet-required operation, session recovery and worker retirement](#wp13) | 1 | Frontend + platform + backend auth | WP02 | 9 |
| [WP14 — Direct financial policy and vehicle profile versions](#wp14) | 2 | Backend + frontend + data migration | WP02 | 2 |
| [WP15 — Direct advances, returns and settlement](#wp15) | 2 | Backend + frontend + ledger owner | WP02 | 3 |
| [WP16 — Direct OPS expenses without approval routing](#wp16) | 2 | Backend + frontend + ledger owner | WP02, WP12 | 1 |
| [WP17 — Direct operating expenses and payment allocations](#wp17) | 2 | Backend + frontend + ledger owner | WP02 | 5 |
| [WP18 — Evidence-based accounting and billing readiness](#wp18) | 2 | Backend + frontend + accounting owner | WP02, WP04 | 2 |
| [WP19 — Direct fuel invoices and explicit allocation](#wp19) | 2 | Backend + frontend + ledger owner | WP02, WP17 | 2 |
| [WP20 — Direct profit distribution finalization](#wp20) | 2 | Backend + frontend + ledger owner | WP02 | 2 |
| [WP21 — Direct eligible shipment deletion](#wp21) | 2 | Backend + frontend | WP02 | 1 |
| [WP22 — Direct discipline, cancellation and accurate payroll presentation](#wp22) | 2 | Backend + frontend + payroll owner | WP02 | 9 |
| [WP23 — Direct authorized credit exceptions](#wp23) | 2 | Backend + frontend + credit-policy owner | WP02, WP03 | 1 |
| [WP24 — Administrative form validation and configuration consistency](#wp24) | 3 | Frontend + shared validation owners | WP02 | 11 |
| [WP25 — Compact trip, dispatch and CUS layouts](#wp25) | 3 | Frontend + design + QA | WP07, WP08 | 13 |
| [WP26 — Compact accounting, financial and OPS workspaces](#wp26) | 3 | Frontend + design + QA | WP15, WP16, WP17, WP18 | 11 |
| [WP27 — Compact directories, fleet and customer interactions](#wp27) | 3 | Frontend + design + QA | WP08, WP24 | 16 |

## Common implementation and completion contract

Every changed path retains caller-owned versions, validated error/result DTOs, current role/scope checks and explicit online retry. A lost response is an unknown outcome until readback, not automatic permission to repeat a create. Shared-code changes must run the affected unit/integration checks plus consumer regressions; do not add tests that merely mirror a formatter or seed away the path being tested.

For every item: record existing behavior → make the smallest required change → run its named acceptance cases → capture the exact committed result → independently review evidence → mark the item complete only if all surviving requirements pass. If source already meets it, collect current evidence and make no speculative rewrite. If a visual report no longer reproduces, document the new geometry instead of recreating the old design.

Use the eight source roles (ADMIN, MANAGER, ACCOUNTANT, DRIVER, OPS, CUSTOMER, CUS, DISPATCHER) and signed-out state where relevant. Default UI viewports: 390×844 phone, 834×1112 tablet, 1440×900 desktop; add 360/430/1024 transition widths for shared components. Check long, empty, loading and error states; keyboard, touch and reduced motion. Role denial must be tested through the direct API as well as hidden controls.

Retain the source filename/hash even when multiple records share QA identifiers. KP-029/KP-035/KP-038/KP-086 are linked duplicates; KP-015/KP-070/KP-074/KP-097/KP-109 have superseded targets. KP-109 still owns a real discipline-removal implementation because no separate current source ticket fully replaces it.

## Detailed work and acceptance items

The linked completion audit contains the source-specific requirements, evidence anchors and limits behind each item. “Verify existing implementation” is not permission to skip its listed checks.

<a id="wp01"></a>

### WP01 — Evidence, repository context and release integrity

Owner: **QA + platform + relevant code owners**. Stage **0**. Design: [section 14](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-14>). Integration dependencies: baseline only.

<a id="kp-018"></a>

#### KP-018 — Tracker decomposition and residual visual/release gaps

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-018](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-018>) documents the evidence.

**Existing behavior / gap:** Original bottom gap and script-text flash are not specifically closed by the tracker’s completion appendix and have no current reproduction/verification.

**Target and implementation steps:**

- Break the tracker into independently closable rows and explicitly link its original two visual complaints to current evidence or remaining work.
- Expose the current build identifier in a compact support surface if still desired; verify it agrees with the running backend rather than a static label.
- Extract the hook’s additional logic to meet the promised 515 ceiling, or document a separately authorized replacement architecture target; do not quietly count refreezing as shrink-only completion.
- Carry existing photo, terminal, trailer and asset guards forward; use KP-024/KP-026/KP-043 for their focused verification. Audit historical operations from retained records before deciding any new cleanup.

**Acceptance and evidence:**

- Fresh phone/desktop load and footer-gap capture with current build ID.
- Photo deletion ownership/terminal/idempotency cases; style and structure guard run.
- Deploy asset negative fixture; archive verification for cleanup/merge claims.

<a id="kp-019"></a>

#### KP-019 — Internal-truck catalog loading and 24-hour stability

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-019](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-019>) documents the evidence.

**Existing behavior / gap:** A code review cannot establish 24-hour uptime. No current hourly monitor or logs were executed/read.

**Target and implementation steps:**

- Start a new bounded 24-hour observation on the intended release build with one explicit hourly catalog check and associated build/time.
- Record every failure and the exact cutover exception window; distinguish connection/tool failures from server 5xx.
- Close only after the complete window and final Dispatcher catalog readback, retaining evidence outside the disposable checkout.

**Acceptance and evidence:**

- Hourly /fleet/vehicles backing-API and UI smoke observations for24h.
- During deploy, correlation of frontend state, API response and backend logs.

<a id="kp-021"></a>

#### KP-021 — Verify dependency remediation against current advisory state

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-021](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-021>) documents the evidence.

**Existing behavior / gap:** No dependency installation or current build/test/audit execution was performed; missing dependencies were reported by the lead.

**Target and implementation steps:**

- Run the prescribed dependency/security and application gates in a prepared environment with the committed lockfile.
- Query current remote alerts against the actual default branch and link each closure to the resolved dependency graph.
- Deploy only through the normal reviewed release process and retain exact build/lockfile identity in smoke evidence.

**Acceptance and evidence:**

- Current lockfile install, typecheck, lint, frontend/backend tests and production build.
- Remote advisory closure and runtime smoke for upload/image/test-runner changes.

<a id="kp-022"></a>

#### KP-022 — Carrier regression tests and component size guard

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-022](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-022>) documents the evidence.

**Existing behavior / gap:** The page’s390 lines satisfy the numeric page limit, but test success and precommit execution are not established at current HEAD.

**Target and implementation steps:**

- Run carrier tests and structure checks using current dependencies and inspect failures before changing assertions.
- Preserve the page extraction and verify each carrier state still exercises real rendering.
- Resolve the linked ceiling regression under KP-018 as explicit remaining work; do not use a higher ceiling as evidence that shrink-only discipline passed.

**Acceptance and evidence:**

- ShipmentDetailPage carrier scenarios and full structure guard.
- Normal precommit run with retained log and no hook bypass.

<a id="kp-023"></a>

#### KP-023 — Deterministic detailed-plan tests

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-023](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-023>) documents the evidence.

**Existing behavior / gap:** Test source now includes the described run-scoped requests, but no repeated accumulated-DB run was performed.

**Target and implementation steps:**

- Retain meaningful membership assertions and isolate each new fixture with a searchable marker.
- Run affected tests repeatedly against both clean and deliberately populated test databases, then the relevant full suite.
- Fix any additional unscoped page-boundary assumption found in those runs rather than increasing limits or deleting assertions.

**Acceptance and evidence:**

- Repeat facet/zone/detail-plan/fulfillment/master-plan tests in clean and accumulated datasets.
- Parallel-run isolation if supported by the suite.

<a id="kp-024"></a>

#### KP-024 — Shipment foreign-key integrity

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-024](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-024>) documents the evidence.

**Existing behavior / gap:** Migration and schema definitions agree, but current live database application/orphan counts/backups were not checked.

**Target and implementation steps:**

- Verify the target database migration ledger and actual constraint definitions read-only before scheduling any change.
- If unapplied, obtain current orphan audit and backup, resolve records by documented ownership, then apply through the normal migration release.
- Run invalid-child, parent deletion and live-trip RESTRICT integration tests; retain post-migration verification.

**Acceptance and evidence:**

- Migration from a representative pre0073 database with deliberate orphan fixture.
- FK rejection, safe CASCADE and live-trip RESTRICT tests.

<a id="kp-026"></a>

#### KP-026 — Verify actual migration history after merge

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-026](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-026>) documents the evidence.

**Existing behavior / gap:** The original14-file plan was revised in the appendix to four new migrations after identifying ten equivalent changes; do not implement the old14 blindly.

**Target and implementation steps:**

- Retain existing identity mapping and validate all journal tags resolve to unique SQL/snapshot files.
- Run the reconciled chain from both a clean schema and representative prior branch databases in a disposable environment.
- Document actual integration ancestry and required gate results; do not create a new merge or renumber already-applied migrations solely from this historical ticket.

**Acceptance and evidence:**

- Migration chain validation, duplicate-change detection and scratch database migrations.
- Current branch integration/type/build/backend gates in a prepared environment.

<a id="kp-041"></a>

#### KP-041 — Complete staging evidence for remaining frontend regressions

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-041](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-041>) documents the evidence.

**Existing behavior / gap:** The generic campaign-complete appendix does not reconcile explicit gaps in KP-019/KP-032/KP-036/KP-037/KP-046.

**Target and implementation steps:**

- Rebuild a criterion-level matrix with PASS/FAIL/BLOCKED/UNVERIFIED, current commit/build, actual route/role/viewport and retained evidence.
- Prioritize confirmed source gaps and their positive-path checks before broad visual repetition.
- Run camera/deploy/24h scenarios in suitable controlled environments; keep evidence limitations explicit.
- Replace superseded approval/offline acceptance cases with direct authorized online flow checks.

**Acceptance and evidence:**

- All remaining named workflow and device/release scenarios, each with current evidence.
- Independent reconciliation that every original criterion has a valid current status.

<a id="kp-057"></a>

#### KP-057 — Stable detailed-plan row identities

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-057](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-057>) documents the evidence.

**Existing behavior / gap:** Current full mixed dataset and browser sort/filter console have not been checked.

**Target and implementation steps:**

- Retest all row families, including multiple branch rows from one shipment, with warning capture.

**Acceptance and evidence:**

- Missing time/number; branches from the same shipment; sorting, filtering and reordering; zero duplicate-key warnings and stable selection.

<a id="kp-064"></a>

#### KP-064 — Isolated adjustment idempotency tests

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-064](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-064>) documents the evidence.

**Existing behavior / gap:** No current two-consecutive-run outputs; historical root-cause note is not executable proof.

**Target and implementation steps:**

- Run the relevant integration group twice against isolated resettable DB fixtures.
- Keep changed-payload 409 and direct authorized adjustment behavior.

**Acceptance and evidence:**

- Two consecutive suite runs; same-key/same-payload replay applies once; same key with a changed payload returns 409; version conflict preserves form inputs.

<a id="kp-065"></a>

#### KP-065 — Component structure guards

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-065](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-065>) documents the evidence.

**Existing behavior / gap:** Read-only counts match current ceilings: RoleWorkInbox 499, trailer 418, truck 450, ProfitAnalysis 591, and PenaltyReasonsPage 581 against a 593-line ceiling. The full guard suite has not run.

**Target and implementation steps:**

- Retain frozen, justified limits; execute whole guard before status closure.
- Track concrete component extraction targets and behavior tests rather than repeatedly enlarging ceilings.

**Acceptance and evidence:**

- Full structure guard; all listed paths exist; behavior tests for extracted dialogs/rows; no stale allowlist entries.

<a id="kp-067"></a>

#### KP-067 — Appointment popover regression contract

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-067](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-067>) documents the evidence.

**Existing behavior / gap:** No current complete frontend run establishes 100% pass or both popover paths together.

**Target and implementation steps:**

- Rerun both popover interaction suites and full frontend suite using the exact HEAD.
- Keep assertions on selected value/save semantics rather than only revised labels.

**Acceptance and evidence:**

- Set, replace, clear and cancel in existing/create popovers; 24-hour time representation; full frontend suite without unexpected failures.

<a id="kp-190"></a>

#### KP-190 — Restore the repository context resolver on a clean checkout

**Action:** Implement required outcome. **Source:** TODO; P3. [KP-190](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-190>) documents the evidence.

**Existing behavior / gap:** The context checker was executed at the current HEAD and fails on the missing roadmap plan and QA README before profile resolution.

**Target and implementation steps:**

- Correct stale required paths, or mark intentionally optional references as optional. Do not disable all validation.
- Keep frontend/backend profiles narrow and resolvable on a fresh checkout.

**Acceptance and evidence:**

- Clean-checkout context check and frontend/backend profile resolution; invalid required reference fails; missing optional reference does not break an unrelated profile.

<a id="wp02"></a>

### WP02 — Draft-bound versions and truthful save recovery

Owner: **Frontend + backend + shared**. Stage **1**. Design: [section 2](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-2>). Integration dependencies: WP01.

<a id="kp-001"></a>

#### KP-001 — Distinct error codes for stale version vs duplicate code on unit updates

**Action:** Verify existing implementation. **Source:** IN_PROGRESS; P3. [KP-001](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-001>) documents the evidence.

**Existing behavior / gap:** Business-unit stale/duplicate machine codes and token-bearing client exist. Appended QA evidence tests /api/trucks/4 rather than business units, so it does not close this contract.

**Target and implementation steps:**

- Keep current implementation; verify exact /auth/business-units PATCH and DELETE contracts.
- Replace truck evidence with linked business-unit requests and visible recovery.
- Cross-check the fuel configuration contract under KP-106; retain separate business-unit acceptance evidence.

**Acceptance and evidence:**

- Duplicate code and name; genuine stale token; missing token; valid retry after explicit review; values retained.

<a id="kp-006"></a>

#### KP-006 — Allow unit edits and deactivation after a fresh reload

**Action:** Verify existing implementation. **Source:** IN_PROGRESS; P2. [KP-006](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-006>) documents the evidence.

**Existing behavior / gap:** Create/rename/deactivate/reactivate pass loaded updatedAt; source cannot prove claimed complete staging lifecycle.

**Target and implementation steps:**

- Verify complete lifecycle, including reactivate, and legacy linked users.
- Preserve drafts and make latest-versus-local unit values visible on conflict.

**Acceptance and evidence:**

- Create → rename → deactivate → reactivate → reload, inactive excluded from new selection but retained existing assignment, duplicate/stale errors.

<a id="kp-101"></a>

#### KP-101 — Align completed trip corrections with the promised review flow

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-101](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-101>) documents the evidence.

**Existing behavior / gap:** The original request to reconcile an approval promise is superseded; direct save is desired. Current submit code still classifies actionKind TRIP_FINANCIAL_CHANGE as pending and announces a review queue, so truthful completion remains partial.

**Target and implementation steps:**

- Use the actual committed/applied outcome to update detail cache and show a truthful saved message.
- Remove the phantom approval queue and coordinate with KP-162/QA-137; do not add approval to match the stale copy.

**Acceptance and evidence:**

- Authorized completed-trip correction saves directly, displays persisted figures after reload, and never claims a pending review.
- Validation, conflict and ancillary failure must not erase the narrower successful commit outcome.

<a id="kp-106"></a>

#### KP-106 — Allow first fuel configuration to save without a missing version loop

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-106](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-106>) documents the evidence.

**Existing behavior / gap:** First-create versus existing-version submission is implemented. Conflict recovery claims to retain the draft, but invalidation updates fuelConfig and the unconditional hydration effect replaces form values. Loading/fetch failure is also not distinguished from a truly absent config.

**Target and implementation steps:**

- Represent loading, missing configuration and fetch failure separately; block ambiguous save.
- Refresh the authoritative version without replacing dirty values, then present deliberate conflict reconciliation and retry.

**Acceptance and evidence:**

- Genuine first save; existing edit; concurrent update with a dirty draft; failed initial read; history/readback and explicit retry.

<a id="kp-135"></a>

#### KP-135 — Self-healing version-token writes across crud-factory clients

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-135](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-135>) documents the evidence.

**Existing behavior / gap:** The proposed generic GET-latest-and-retry behavior on 428 would hide missing caller versions and could overwrite concurrent values. It is a proposal, not a completed implementation.

**Target and implementation steps:**

- Adopt VERSION_TOKEN_REQUIRED machine code and inventory explicit mutation callers.
- Do not implement generic fresh-version replay. Bind token to the original read snapshot and reconcile on 428/409.
- Enumerate CONFIG writes plus auth business-unit PATCH/DELETE; add missing-token boundary tests.
- Remove the remembered-path token fallback for protected mutations. Require the caller-owned original snapshot version and retain the draft on a missing-token contract error.

**Acceptance and evidence:**

- Two editors; missing token; stale token; non-version 409; no automatic resend; no lost concurrent fields.
- Load draft A, complete background GET B, then save A: B must not silently authorize A. Exercise missing, stale and valid explicit versions and prove exactly one logical write.

<a id="kp-141"></a>

#### KP-141 — Reconcile concurrent trip edits before retrying a version conflict

**Action:** Implement required outcome. **Source:** TODO; P1. [KP-141](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-141>) documents the evidence.

**Existing behavior / gap:** After an edit returns 409, the client fetches the current trip and retries the original full payload with fresh.version; concurrent writer values can be lost.

**Target and implementation steps:**

- Remove blind retry. Retain original/local/latest snapshots and compare fields.
- Merge only proven non-overlapping edits; show explicit choices for conflicting fields then submit reviewed latest version.
- Define merge semantics for null, blank and explicit zero and reconcile child rows by stable IDs. Use an atomic domain command where practical; otherwise retain confirmed stage results and retry only uncommitted operations after readback.

**Acceptance and evidence:**

- Two sessions editing notes versus revenue; same-field conflict; a second race during review; non-version 409; CREATED and editable completed trips.
- Partial figure success followed by child-save failure; null/blank/zero clears; child reorder/delete; manual retry must not duplicate a committed child operation.

<a id="kp-162"></a>

#### KP-162 — Report completed trip financial edits as saved without a false approval queue

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-162](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-162>) documents the evidence.

**Existing behavior / gap:** Confirmed remaining false-success semantics: applied completed-trip action is still classified as pending from actionKind alone.

**Target and implementation steps:**

- Define an explicit saved-action/resulting-trip response or fetch the authoritative trip after success.
- Update figures/version and show saved outcome; preserve the distinction between committed figures and later attachment/instruction failures.

**Acceptance and evidence:**

- Real applied-action response shape, current trip/version readback, ancillary failure, idempotent retry and conflict recovery at all widths.

<a id="wp03"></a>

### WP03 — Atomic trip creation and recoverable online attachments

Owner: **Frontend + backend + shared**. Stage **1**. Design: [section 5](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-5>). Integration dependencies: WP02.

<a id="kp-073"></a>

#### KP-073 — Prevent duplicate trips when creation fails

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P1. [KP-073](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-073>) documents the evidence.

**Existing behavior / gap:** Only prevalidation is fixed: base trip, leg details and containers still persist through separate requests.

**Target and implementation steps:**

- Prefer one transactional create API for the complete trip payload and one stable logical request identity.
- If staged creation is required, expose resumable draft identity and explicit recovery; never silently generate a new logical create key merely because the payload changed.
- Return field errors before write and retain logical recovery state until all steps finish.

**Acceptance and evidence:**

- Inject failures after base creation, after legs and during container saves; reload/retry and corrected retry leave exactly one complete logical trip or an explicit recoverable draft.
- Double click, lost response and same-key/changed-payload cases; legitimate separate trips with the same reference remain allowed.

<a id="kp-115"></a>

#### KP-115 — Render uploaded expense receipts after saving and reloading

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-115](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-115>) documents the evidence.

**Existing behavior / gap:** The current expense photo panel renders authenticated previews, failed-image feedback, an explicit reload retry and a viewer. Current successful upload/readback, permissions and loading-state behavior still require validation.

**Target and implementation steps:**

- Verify receipt URLs and explicit retry on the current online form with authorized records.
- Preserve visible failure instead of a broken-image icon; do not add offline storage or replay.

**Acceptance and evidence:**

- Upload, save, fresh reload, preview, delete and readback; forbidden/expired session and transient image failure; explicit retry only.

<a id="kp-144"></a>

#### KP-144 — Enable adding receipts to saved pending OPS expenses

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-144](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-144>) documents the evidence.

**Existing behavior / gap:** Saved OPS expense editor has amount/date/note but no upload; photo modal lists/deletes receipts only.

**Target and implementation steps:**

- Expose add/capture receipt on same saved expense and receipt-debt entry point.
- Bind upload to existing expense, preserve amount/scope and update missing-receipt state only after confirmed readback.
- Coordinate permissions with direct-record expense lifecycle.

**Acceptance and evidence:**

- Saved expense no receipt → attach → reload; upload error/retry; duplicate file; revoked scope; locked accounting item read-only.

<a id="kp-160"></a>

#### KP-160 — Retain buffered trip photos until each upload is confirmed

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-160](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-160>) documents the evidence.

**Existing behavior / gap:** Both photo-flush methods empty pending arrays before uploads. A later failure discards retryable files and URL replacements.

**Target and implementation steps:**

- Track each in-memory attachment as selected, uploading, confirmed or failed; remove only confirmed items.
- Apply the URL replacement before revoking the old blob URL; retain created entity IDs and explain partial success.
- Allow manual online retry only; do not create a durable queue.
- Add UNKNOWN_OUTCOME for a lost response, malformed success or missing required attachment identity/URL. Retain the caller-owned per-attachment command key through validated response or authorized readback; do not equate unknown outcome with rejected upload.
- Use stable row/attachment IDs plus generation/tombstone guards so late results cannot reattach replaced/deleted rows. Retain the blob preview and created trip ID until the relevant server result is confirmed. All retries are explicit and online; no durable queue/reconnect replay.

**Acceptance and evidence:**

- First or middle upload failure; missing URL; lost response after commit; deleted row; explicit retry without recapture; no duplicate entity or attachment.
- Lost response after server attachment; malformed 2xx; missing URL; deletion/replacement during upload; rapid concurrent retry clicks; repeated create after an unknown result.

<a id="wp04"></a>

### WP04 — Current-owner and OPS-scoped evidence access

Owner: **Backend + platform + QA**. Stage **1**. Design: [section 6](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-6>). Integration dependencies: WP01.

<a id="kp-076"></a>

#### KP-076 — Remove public access to protected evidence files

**Action:** Verify existing implementation. **Source:** QA_PASSED; P1. [KP-076](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-076>) documents the evidence.

**Existing behavior / gap:** Source assertion covers application mount text, not a running Express/proxy or all equivalent static mounts.

**Target and implementation steps:**

- Verify actual deployment configuration and test representative old sensitive URLs through public host and direct app.
- Use explicit protected route tests for authenticated owner/wrongowner/traversal and intentional public assets.
- Invalidate previously public caches where exposure existed; record build/proxy identities.

**Acceptance and evidence:**

- Anonymous access to old URLs is denied at proxy and app; authorized photo returns 200; wrong owner returns 401/403; traversal/encoding cases; public logo returns 200; revoked access and cache behavior.

<a id="kp-077"></a>

#### KP-077 — Require current driver ownership before deleting trip photos

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P1. [KP-077](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-077>) documents the evidence.

**Existing behavior / gap:** TOCTOU persists: old owner passes precheck, reassignment commits new owner, delete proceeds using stale authorization because transaction never rechecks ownership.

**Target and implementation steps:**

- Inside deletion transaction acquire the same trip-row lock/order used by reassignment, then verify current driver ownership and allowed status before side effects.
- Ensure idempotent replay also respects current ownership policy; keep cleanup outbox/deletion atomic.
- Add a controlled concurrency barrier test at preauthorization/transaction boundary.

**Acceptance and evidence:**

- Driver A passes the precheck, reassignment to B commits, then A attempts deletion: deny it with photo and cleanup state unchanged. Reverse ordering has a deterministic authorized result.
- Successful current-owner deletion; wrong/former owner and no profile; same-key replay after reassignment; HTTP route with authentication mounted; no side effects on denial.

<a id="kp-156"></a>

#### KP-156 — Enforce OPS shipment scope when serving trip photos

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-156](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-156>) documents the evidence.

**Existing behavior / gap:** The authenticated trip-photo route applies its ownership check only to DRIVER. OPS requests with a known key do not use the current shipment-assignment predicate.

**Target and implementation steps:**

- Centralize exact photo-key authorization with current OPS shipment scope and intended office roles.
- Check existing trip and revoked assignment before sending bytes.

**Acceptance and evidence:**

- Assigned then revoked OPS access using a known key; unassigned actor; absent trip; driver ownership; office-role policy. Use synthetic images only.

<a id="wp05"></a>

### WP05 — Trip adjustment amounts and allowance correctness

Owner: **Shared + backend + frontend**. Stage **1**. Design: [section 7](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-7>). Integration dependencies: WP02.

<a id="kp-145"></a>

#### KP-145 — Resolve invalid version errors when publishing revenue adjustments

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-145](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-145>) documents the evidence.

**Existing behavior / gap:** The document claims improved backend adjustment creation/application. The current frontend still casts response rows as having amount and calls Number(a.amount), despite the debit/credit response shape.

**Target and implementation steps:**

- Define shared adjustment result DTO and explicit financial sign semantics.
- Render correct amount/direction; return authoritative updated trip/version and linked adjustment.
- Keep single transaction posting and conflict handling; never fabricate zero for absent amount.

**Acceptance and evidence:**

- Positive/negative/zero adjustment; ledger linkage; repeated submit; version conflict; signed UI and reload. Trip 19 currently shows no adjustment rows, so no fresh browser NaN reproduction is claimed.

<a id="kp-157"></a>

#### KP-157 — Honor an explicit zero road allowance override

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-157](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-157>) documents the evidence.

**Existing behavior / gap:** The shared totals predicate excludes an explicit zero roadAllowanceOverride.

**Target and implementation steps:**

- Use a non-null valid override, including 0; absence means automatic calculation.
- Keep schema validation and accurate persisted applied totals.

**Acceptance and evidence:**

- null, undefined, 0, positive and negative values; save 0/readback, then clear; cost and profit deltas.

<a id="kp-159"></a>

#### KP-159 — Resolve road allowance using the newly selected trailer type

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-159](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-159>) documents the evidence.

**Existing behavior / gap:** A missing or zero allowance for the new type falls back to the previous trip.trailerType.

**Target and implementation steps:**

- Resolve the final route/type exactly once; distinguish a missing rate from configured 0.
- Use an explicit missing-rate error or incomplete estimate rather than the obsolete rate.

**Acceptance and evidence:**

- 40FT to 20FT and reverse: positive, zero and absent new rate; simultaneous route/type change; manual override; reload base allowance, cost and profit.

<a id="wp06"></a>

### WP06 — Attendance, effective salary and usable payroll interaction

Owner: **Backend + frontend + payroll owner**. Stage **1**. Design: [section 7](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-7>). Integration dependencies: WP02.

<a id="kp-005"></a>

#### KP-005 — Make the base salary edit link open a usable driver salary editor

**Action:** Finish gaps and verify. **Source:** IN_PROGRESS; P2. [KP-005](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-005>) documents the evidence.

**Existing behavior / gap:** In-context salary modal and version token exist, but it writes a mutable baseSalary with no effective-date input/history, contrary to AC2.

**Target and implementation steps:**

- Introduce effective-dated base-salary versions under existing driver permissions.
- Show selected driver, effective date and period effect; preserve locked payroll snapshots.
- Use a reviewed current-value conflict comparison rather than token-only refresh.

**Acceptance and evidence:**

- Effective-date before/inside/after open period; closed period unchanged; valid/zero/negative input; concurrent change; summary reload at three widths.

<a id="kp-111"></a>

#### KP-111 — Make attendance day clicks update an open payroll draft

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-111](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-111>) documents the evidence.

**Existing behavior / gap:** Optimistic update, rollback and success/error feedback are wired. Desktop cells disable during an update, but the production mobile list discards isUpdating and remains clickable, and the handler has no in-flight guard. Duplicate-update and mobile interaction acceptance remains incomplete.

**Target and implementation steps:**

- Apply one mutation-in-flight guard to all attendance presentations and disable the actual mobile action.
- Use explicit saving state, confirm committed results, and roll back/reconcile failures without changing another driver.

**Acceptance and evidence:**

- Slow request with rapid repeated phone taps; success, network failure and 409; verify exactly one intended transition and correct readback.
- Locked/trip-day/unauthorized restrictions remain intact.

<a id="kp-112"></a>

#### KP-112 — Make payroll attendance days keyboard accessible

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-112](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-112>) documents the evidence.

**Existing behavior / gap:** Desktop CalCell is a native named button, but the mobile day list still uses unnamed non-focusable clickable DIVs. The requested keyboard contract is therefore only partially implemented.

**Target and implementation steps:**

- Use a native button for an eligible mobile day with its full date/current-state accessible name.
- Apply lock and pending states consistently with the desktop cell; preserve an orderly Tab sequence and visible focus.

**Acceptance and evidence:**

- At phone width, Tab reaches each eligible day and Enter/Space changes it once; locked/trip days are explained and non-actionable.
- Screen-reader date/state labels and focus stability after save.

<a id="kp-146"></a>

#### KP-146 — Keep selected payroll details close to the driver picker

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-146](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-146>) documents the evidence.

**Existing behavior / gap:** Driver roster is rendered before selected attendance content as one unbounded mapped list.

**Target and implementation steps:**

- Use a bounded searchable roster beside the selected driver/calendar. On phone, a disclosure should return to the current driver.

**Acceptance and evidence:**

- 39 drivers; first/middle/last selection; search; back; keyboard; calendar and salary visible without scrolling past the entire roster.

<a id="kp-158"></a>

#### KP-158 — Synchronize actual work days when the driver completes a trip

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-158](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-158>) documents the evidence.

**Existing behavior / gap:** The driver completion transaction transitions status and recomputes shipment state. After commit, it only invalidates reports; no attendance synchronization is called.

**Target and implementation steps:**

- Invoke attendance authority inside completion transaction with consistent lock order, or durable transactional outbox.
- Derive business dates from persisted completion instant; replay converges.
- Use an executor-aware attendance operation whose failure aborts the completion transaction, or a durable transactional outbox. Do not wrap the current global-db/swallowing helper and call the result atomic.
- Derive each driver/day from all eligible trip contributions and explicit manual attendance provenance. Recompute after cancellation/reassignment and reject stale events by current trip state/version; coordinate payroll closing and cache refresh after the attendance commit.

**Acceptance and evidence:**

- Saturday to Sunday; multi-day trip; midnight; period boundary; failed synchronization; replayed completion; existing trip attribution; locked period.
- Two trips on one day; cancel/reassign only one; preexisting manual attendance; duplicate/out-of-order completion after cancellation; worker failure/retry and payroll finalization race.

<a id="wp07"></a>

### WP07 — Business dates, appointments and real LCL dispatch

Owner: **Shared + frontend + backend**. Stage **1**. Design: [section 8](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-8>). Integration dependencies: WP02.

<a id="kp-002"></a>

#### KP-002 — CUS delivery date picker missing when editing shipment

**Action:** Verify existing implementation. **Source:** IN_PROGRESS; P0. [KP-002](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-002>) documents the evidence.

**Existing behavior / gap:** CUS appointment calendar button/showPicker exists, and the parent exposes it only when editing is allowed. The missing-trigger complaint has not been proven resolved for the reported fixture.

**Target and implementation steps:**

- Use a disposable unassigned container and compare assigned/read-only state.
- Explain noneditable appointments and preserve role/assignment rules; fix only demonstrated trigger failure.

**Acceptance and evidence:**

- Calendar, typed 24-hour time, native picker, keyboard and touch at 360/390/834/1440px; save/reload; denied state.

<a id="kp-003"></a>

#### KP-003 — Keep automatic tire lifecycle dates consistent with the business date

**Action:** Verify existing implementation. **Source:** IN_PROGRESS; P2. [KP-003](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-003>) documents the evidence.

**Existing behavior / gap:** New lifecycle dates use Asia/Ho_Chi_Minh; retaining the old historical disposal date is required and not proof of failure.

**Target and implementation steps:**

- Verify new install/remove/dispose fixtures at the Vietnam date boundary.
- Do not rewrite historical dates to today to satisfy an erroneous QA observation.

**Acceptance and evidence:**

- Before and after 17:00 UTC; same-day reinstallation; historical dates unchanged; staging UI and persisted new dates.

<a id="kp-032"></a>

#### KP-032 — Show the saved LCL delivery date and provide a usable dispatch path

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P1. [KP-032](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-032>) documents the evidence.

**Existing behavior / gap:** The completion appendix’s positive closure proves a visible LCL workboard row/detail link, not successful allocation; the cited real allocation case had previously hit a positive line-ID blocker.

**Target and implementation steps:**

- Create a valid container-less LCL lot through the actual CUS flow; edit a previously absent delivery date through its visible LCL action.
- Trace and correct any container-only lineId assumption in schedule/assignment controls; use shipment/fulfillment identity for LCL rather than fabricating a container.
- Allocate carrier/vehicle and issue the LCL trip through the normal endpoint/UI, then read back overview/detail/dispatch/driver states.
- Retain explicit prerequisite feedback and rerun FCL regression cases.

**Acceptance and evidence:**

- Positive LCL create → date edit → dispatch allocation → issue workflow, using real mutation endpoints.
- Missing-date and missing-prerequisite errors; no fake containers; FCL unaffected.

<a id="kp-033"></a>

#### KP-033 — Preserve appointment minutes in the detailed dispatch plan

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-033](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-033>) documents the evidence.

**Existing behavior / gap:** No current rendered sort/filter verification or test run; historical report is absent.

**Target and implementation steps:**

- Retain full-minute row display/filter behavior and verify exact-minute values at both layouts.
- Run the three-state sort cycle with equal-hour different-minute and unknown-time rows; state whether ordering is page-local.
- Fix the issue-order timestamp default under KP-037 so a correctly displayed appointment is not changed when the user issues it.

**Acceptance and evidence:**

- 00/15/30/45 minute, midnight, unknown-time display/filter/sort cases.
- Multiple-page scope and action transition to issue form.

<a id="kp-037"></a>

#### KP-037 — Clarify and align the driver appointment time

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-037](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-037>) documents the evidence.

**Existing behavior / gap:** A20:45 plan appointment defaults to20:00 in quick issue: a deterministic source mismatch, not a fresh staging reproduction.

**Target and implementation steps:**

- Initialize issue drafts from the full authoritative runAt converted to business-local date/time; only use an explicitly labelled fallback when no appointment exists.
- Define customer appointment versus operational start fields and labels; carry both if they are legitimately distinct.
- Verify CUS → detail plan → quick issue → driver summary/detail on the same record without implicit time changes.
- Coordinate with KP-140’s confirmed detailed-plan screenshot scope; do not apply its dispatch requirement to an unrelated driver-only view.

**Acceptance and evidence:**

- 20:45 and 00:15 roundtrip through issue default and saved trip.
- Different appointment/start values with distinct labels; business timezone boundary cases.

<a id="kp-048"></a>

#### KP-048 — Use 24 hour formatting in the CUS shipment drawer

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-048](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-048>) documents the evidence.

**Existing behavior / gap:** No current actual input, calendar, save/reopen or deployed-locale browser test.

**Target and implementation steps:**

- Verify the actual CUS drawer’s typing, presets and calendar affordance on supported browser/device locales.
- Save20:46,00:15,23:45 and a preset, then reopen/reload and compare the persisted business timestamp.
- Reuse the proven shared input where other native controls violate the same product format, while keeping timezone conversion a separately tested concern.

**Acceptance and evidence:**

- Fixed24-hour locale matrix, typed/preset/calendar paths and persistence.
- Separate timezone roundtrip and create-form parity tests.

<a id="kp-049"></a>

#### KP-049 — Align the CUS schedule preview with the selected time

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-049](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-049>) documents the evidence.

**Existing behavior / gap:** No current rendered picker/preview/save/reload or cross-timezone comparison was executed.

**Target and implementation steps:**

- Retain the business-zone conversion boundary; verify all appointment renderers use it.
- Capture selected value, outgoing instant and refreshed preview for the same fixture/build.

**Acceptance and evidence:**

- Picker values 13:30 and 20:46; save, reopen and reload; browsers in UTC+7 and UTC+8; date-boundary and cleared values.

<a id="kp-053"></a>

#### KP-053 — Save cleared container appointments in the CUS drawer

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-053](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-053>) documents the evidence.

**Existing behavior / gap:** Actual current tap/save/readback and unchanged sibling-field verification were not executed.

**Target and implementation steps:**

- Retain explicit NULL semantics and business readiness validation.
- Rerun the allowed-clear and last-required-appointment rejection cases with current browser and DB evidence.

**Acceptance and evidence:**

- Clearing in PENDING persists NULL; clearing the last required appointment in READY rejects without side effects; set, replace and cancel; no mixed-field patch or stale dirty state.

<a id="kp-066"></a>

#### KP-066 — Reachable non-FCL transport date editor

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-066](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-066>) documents the evidence.

**Existing behavior / gap:** Document explicitly says staging verification was bundle-string only and UI spot check was not completed.

**Target and implementation steps:**

- Run the actual non-FCL ledger action through save/cancel/readback rather than treating deployed text as UI proof.

**Acceptance and evidence:**

- Authorized LCL/whole-lot edit and read-only role; Tab, Enter, Escape and focus return; date persists after reload; appointment path unaffected.

<a id="kp-099"></a>

#### KP-099 — Preserve the trip completion date when opening the editor

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-099](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-099>) documents the evidence.

**Existing behavior / gap:** The initial state uses businessDateISO, but the connected edit hydration/reset effect overwrites it with the UTC string date prefix. This leaves the original previous-day defect reachable after async data arrival or reset.

**Target and implementation steps:**

- Use one business-date conversion rule for initial state, async hydration, route changes and conflict reset.
- Preserve date-only values according to the API contract; do not silently reinterpret them as instants.

**Acceptance and evidence:**

- At an instant such as 18:00Z, assert detail/editor Vietnam date agrees before and after async hydration.
- Save an unrelated correction untouched; refetch/reset; verify the same persisted business date.

<a id="kp-100"></a>

#### KP-100 — Keep optional generated journey legs from blocking trip corrections

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-100](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-100>) documents the evidence.

**Existing behavior / gap:** Edit mode now skips automatic leg generation and hydrates actual stored legs. Blank legs are filtered on submit and touched rows drive required endpoints; current browser/native-validation coverage remains incomplete.

**Target and implementation steps:**

- Keep stored absence distinct from a user-created partial leg.
- Verify unrelated corrections preserve existing legs and do not manufacture route data.

**Acceptance and evidence:**

- No-leg edit, existing full-leg edit, blank added leg, partial endpoint, invalid distance, and create-mode generation.

<a id="kp-132"></a>

#### KP-132 — Issued orders visible on the driver board

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-132](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-132>) documents the evidence.

**Existing behavior / gap:** Driver board selects the assigned driver and eligible fulfillment trip states. The document contains a historical fixture-specific issuance investigation; current issue-to-board behavior and all readiness boundaries are not fully established.

**Target and implementation steps:**

- Trace an authorized online dispatch issue to its persisted trip and the same driver board response.
- Keep explicit readiness errors for incomplete allocation and clear refresh feedback; do not invent missing jobs from a mismatched driver fixture.

**Acceptance and evidence:**

- Assign/issue eligible job, driver login/reload, pre-acceptance reassignment, active/complete states, and failed readiness validation.

<a id="kp-136"></a>

#### KP-136 — CUS delivery date edit does not save on Enter

**Action:** Implement required outcome. **Source:** TODO; P0. [KP-136](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-136>) documents the evidence.

**Existing behavior / gap:** Pressing Enter in the CUS appointment popover closes it; onChange only updates the row draft. The popover has no awaitable commit callback.

**Target and implementation steps:**

- Separate draft, confirm and close callbacks; Enter and explicit Xác nhận call same parent commit.
- Close after confirmed save; retain draft and errors otherwise. Handle composition and native picker Enter separately.

**Acceptance and evidence:**

- Type a date/time then Enter without blur; explicit confirm; double Enter; invalid/partial value; failed save; reload persisted appointment.

<a id="kp-138"></a>

#### KP-138 — Remove unnecessary date picker from dispatch issue form

**Action:** Implement required outcome. **Source:** TODO; P0. [KP-138](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-138>) documents the evidence.

**Existing behavior / gap:** Dispatch issue form still renders quick dates, time/date inputs and presets the requirement asks to remove.

**Target and implementation steps:**

- Remove editable issue schedule controls while displaying concise inherited schedule.
- Resolve required timestamps from canonical planning data, retaining minutes and rollover; route missing schedule to its owning editor.
- Do not remove CUS appointment editing.

**Acceptance and evidence:**

- OWN and external issue; 08:00/20:45/23:30; missing date; midnight rollover; identical persisted schedule before and after control removal.

<a id="wp08"></a>

### WP08 — Assignment, canonical KEP pairing and carrier lookup

Owner: **Backend + frontend**. Stage **1**. Design: [section 9](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-9>). Integration dependencies: WP02.

<a id="kp-007"></a>

#### KP-007 — Reassign a trip before driver acceptance

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-007](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-007>) documents the evidence.

**Existing behavior / gap:** The cited dev/API report is missing; its stated 33/33 tests and staging/deploy results are not current evidence.

**Target and implementation steps:**

- Retain the direct operational reassignment path and terminal/resource/version validation; do not add internal approval.
- Run one clean OWN-to-OWN and OWN-to-EXTERNAL reassignment before acceptance, with a truck whose attached trailer differs; compare all dependent fields and both driver ownership views.
- After acceptance, verify the same action is unavailable and a concurrent stale submission is rejected. Link cache freshness verification to KP-043.

**Acceptance and evidence:**

- Current backend reassignment integration cases with acknowledged/unacknowledged/terminal trips.
- Browser dispatch → new driver readback and simultaneous resource reassignment.

<a id="kp-011"></a>

#### KP-011 — Carrier catalog consistency

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-011](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-011>) documents the evidence.

**Existing behavior / gap:** Cited live dropdown report and FE/BE test logs are absent.

**Target and implementation steps:**

- Use the actual CUS new-carrier action; read back ACTIVE/isCarrier and immediate selected value after the save.
- Open each consuming selector in the same session and verify the new carrier appears once, without reload.
- Check duplicate and inactive-name collisions retain an actionable error; do not route identity creation through approval.

**Acceptance and evidence:**

- Inline carrier create → catalog invalidation → selector tests.
- Ordinary customer exclusion and inactive/duplicate carrier cases.

<a id="kp-012"></a>

#### KP-012 — Intake of unassigned shipments

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-012](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-012>) documents the evidence.

**Existing behavior / gap:** The cited carrier-null MEDU fixture screenshots and test results are missing.

**Target and implementation steps:**

- Run the existing endpoint test in an isolated or run-scoped dataset.
- Verify carrier-null FCL visibility and direct OWN/EXTERNAL assignment/change at all supported widths.
- Include undecomposed FCL recovery and LCL allocation as distinct fixtures, preserving actual business validation.

**Acceptance and evidence:**

- Carrier-null FCL list and assignment regression.
- Full reload and cross-view readback; separate LCL acceptance under KP-032.

<a id="kp-016"></a>

#### KP-016 — Unassigned carrier projection in shipment details

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-016](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-016>) documents the evidence.

**Existing behavior / gap:** Current 45HC/FCL/LCL detail screenshots and API readback are unverified.

**Target and implementation steps:**

- Verify unassigned FCL and assigned 20/40/45HC/LCL summaries from actual saved records.
- Preserve grouping by carrier before quantity classification; keep quantity totals separately interpretable.
- Use the positive LCL allocation verification in KP-032 to prove reachability.

**Acceptance and evidence:**

- Carrier summary tests for 45HC, unknown type and container-less LCL.
- Saved assignment → shipment detail and dispatch readback.

<a id="kp-017"></a>

#### KP-017 — Truck-to-carrier linking

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-017](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-017>) documents the evidence.

**Existing behavior / gap:** Current fleet edit, pagination/filter count and cross-view readback were not run.

**Target and implementation steps:**

- Verify assign/change/clear with active, inactive and non-carrier targets, including saved fleet filter results.
- Use server-side filtering consistently if the fleet dataset is paginated; ensure totals are from the same filter contract.
- Retest both selected and typed plate consumers under KP-047 after changing a link.

**Acceptance and evidence:**

- Truck carrier CRUD/filter integration with more than one page.
- Normalized plate lookup plus inactive/deleted carrier rejection.

<a id="kp-031"></a>

#### KP-031 — Reconcile carrier assignment between customer service and dispatch

**Action:** Verify existing implementation. **Source:** QA_PASSED; P1. [KP-031](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-031>) documents the evidence.

**Existing behavior / gap:** No current multi-view projection test or actual reassignment/cancellation readback was performed.

**Target and implementation steps:**

- Run a single fixture through planned-only, issued, cancelled and reassigned states and compare CUS/dispatch/detail after reload.
- Ensure each projection deliberately chooses current trip assignment over stale planned data where the business contract requires it.
- Retain historical audit data without allowing cancelled rows to win display selection.

**Acceptance and evidence:**

- Current cross-view service tests and actual CUS/Dispatcher readback.
- Multiple historical trips plus active/current assignment fixture.

<a id="kp-043"></a>

#### KP-043 — Refresh reassignment defaults after saving a new driver and vehicle

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-043](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-043>) documents the evidence.

**Existing behavior / gap:** No current immediate/10-second reopen or real query race exercise.

**Target and implementation steps:**

- Run save then immediate and delayed reopen against the same record.
- Simulate overlapping detail fetches with delayed older responses and confirm query/draft state never regresses; add an explicit version monotonicity rule only if the existing query behavior does not guarantee it.
- Keep unchanged-version drafts stable and refetch/lock when driver acceptance wins a concurrent race.

**Acceptance and evidence:**

- Immediate/delayed reopen, same/new/lower version responses and overlapping fetches.
- Concurrent driver acceptance and stale expectedVersion rejection.

<a id="kp-045"></a>

#### KP-045 — Show driver acceptance before offering reassignment

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-045](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-045>) documents the evidence.

**Existing behavior / gap:** No current concurrent acceptance browser/API proof or test run.

**Target and implementation steps:**

- Verify unaccepted IN_TRANSIT can be corrected and accepted IN_TRANSIT is visibly locked.
- Run the race where a driver accepts while the editor is open, confirming refreshed read-only state after409.
- Document and test how inconsistent legacy CREATED+ack records are repaired or treated; avoid silently relying on a fixture-only exception.

**Acceptance and evidence:**

- Issued/unaccepted, normal accepted, terminal and concurrent acceptance cases.
- Legacy inconsistent status/acknowledgement recovery semantics.

<a id="kp-047"></a>

#### KP-047 — Resolve the linked carrier consistently when selecting or typing a plate

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-047](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-047>) documents the evidence.

**Existing behavior / gap:** Current async callback can apply carrier A after the user has changed to plate B while carrier remains blank; it checks current carrierValue but not current vehicleValue or request identity.

**Target and implementation steps:**

- Bind typed lookup results to the normalized plate/request identity; discard results after plate change, manual carrier selection, dialog close or a newer request.
- Return enough resolver identity to distinguish a known active internal truck from an unknown manual plate, and apply the same OWN/external rule for selection and typing.
- Verify link edit/clear/inactivation invalidates every consumer and save persists the correct carrier/plate pair.

**Acceptance and evidence:**

- Slow A lookup followed by B typing with reversed response order; manual override and close/reopen.
- Linked/unlinked/unknown/inactive plate matrix with punctuation/case variants and full reload.

<a id="kp-061"></a>

#### KP-061 — Import trailer assignment invariant

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-061](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-061>) documents the evidence.

**Existing behavior / gap:** Document explicitly omits XLSX/import harness; DB snapshot showing zero duplicates is not proof the actual import path preserves the invariant.

**Target and implementation steps:**

- Build a resettable minimal import fixture with an already-coupled trailer and another target truck.
- Exercise actual import apply, replay and failure rollback; inspect both coupling id and displayed legacy plate fields.
- Use the common coupling invariant/locking path for competing import/CRUD operations.

**Acceptance and evidence:**

- Import moves trailer A from truck 1 to truck 2 with one active claimant; repeated import; rollback after a later row fails; concurrent import and edit.

<a id="kp-139"></a>

#### KP-139 — Duplicate truck error when assigning 2x20ft containers to same truck

**Action:** Implement required outcome. **Source:** TODO; P0. [KP-139](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-139>) documents the evidence.

**Existing behavior / gap:** The independent assignment path rejects another overlapping trip on the same truck. A canonical tripPairs/KEP service already exists, but the current pairing capacity check evaluates each cargo separately rather than their combined simultaneous load. The requested second 20FT assignment is not safely integrated with that authority.

**Target and implementation steps:**

- Extend the canonical tripPairs/KEP authority and existing resource locking; do not introduce a competing pair/reservation store. Establish both fulfillment members atomically before the second independent assignment hits an unrelated-conflict check.
- Validate two eligible 20FT containers, combined concurrent cargo weight, truck/trailer/driver identity, versions and schedule compatibility. A capable 40FT trailer may carry two 20FT containers; a 40FT cargo container is not a member of this two-20FT case.
- Preserve unrelated conflict checks and separate cargo/evidence history. Reassignment, unpairing and cancellation recalculate surviving resource occupancy.

**Acceptance and evidence:**

- Two eligible 20FT containers on one capable 40FT trailer succeed; combined overload, 40FT cargo member, third member, mismatched resources and unrelated booking fail.
- Race two pair/assignment requests; cancel or reassign one member; verify the survivor remains protected and both driver/dispatch views agree.

<a id="wp09"></a>

### WP09 — Task tags and raw dispatch note editing

Owner: **Shared + frontend**. Stage **1**. Design: [section 9](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-9>). Integration dependencies: WP01.

<a id="kp-009"></a>

#### KP-009 — Dispatch task tags and notes

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-009](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-009>) documents the evidence.

**Existing behavior / gap:** The appendix explicitly says the issue and complete buttons were not clicked; screenshots do not close those action requirements.

**Target and implementation steps:**

- Verify labelled actions with one eligible internal issue and one eligible external completion record, including resulting state and reload.
- Review long notes in collapsed/full states with keyboard and touch; retain compact table sizing.
- Fix manual note entry under KP-014/KP-137 before using a long typed note as the acceptance fixture.

**Acceptance and evidence:**

- Issue/complete eligibility and mutation result tests.
- Long multiline note disclosure, Escape/focus return, and narrow-width actions.

<a id="kp-014"></a>

#### KP-014 — Preserve spaces while typing dispatch notes

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-014](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-014>) documents the evidence.

**Existing behavior / gap:** Current typing path strips trailing spaces on every keystroke: typing a word, space, next word loses the separator. Whole-sentence paste tests do not prove ordinary typing.

**Target and implementation steps:**

- Keep a raw manual-text draft while the user types; normalize only on explicit save or deliberate composition boundary.
- Preserve selected tags independently from manual draft state, including newline, leading/trailing editing spaces and cursor position.
- Save and reopen the final two-part note and confirm the driver sees the intended text. Retain direct online save and ordinary validation.

**Acceptance and evidence:**

- Character-by-character input including space/newline, tag toggle mid-draft and Vietnamese input composition.
- Paste, reopen/save identity, tag rename and driver note readback.

<a id="kp-137"></a>

#### KP-137 — Dispatch note text input does not allow spaces

**Action:** Implement required outcome. **Source:** TODO; P0. [KP-137](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-137>) documents the evidence.

**Existing behavior / gap:** A probe of the current shared helper reproduces typed “gọi lái xe” becoming “gọiláixe”: the controlled note normalizes trailing whitespace on every keystroke.

**Target and implementation steps:**

- Keep raw manual text in an independent edit buffer; compose/normalize at explicit save.
- Preserve tags and ordinary spaces/newlines through reopen.

**Acceptance and evidence:**

- Character-by-character typing, IME, paste, multiple spaces, tag toggle/rename, and save/reload. The current pure-helper probe failed.

<a id="wp10"></a>

### WP10 — Container identifiers and direct corrections

Owner: **Shared + backend + frontend**. Stage **1**. Design: [section 8](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-8>). Integration dependencies: WP02.

<a id="kp-004"></a>

#### KP-004 — Validate container identifiers before adding them to a trip

**Action:** Verify existing implementation. **Source:** IN_PROGRESS; P2. [KP-004](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-004>) documents the evidence.

**Existing behavior / gap:** Current batch trip-container route parses the gated schema before idempotency handling. Previous claim that batch fix was absent is superseded by source.

**Target and implementation steps:**

- Retest create/patch/batch/CUS/driver boundaries using independently valid identifiers.
- Confirm canonical form is persisted and explicit blank remains permitted only where intended.

**Acceptance and evidence:**

- Invalid format or check digit; lowercase/spacing normalization; null/type-only row; valid save/reload; no write or consumed key after validation failure.

<a id="kp-013"></a>

#### KP-013 — CUS container corrections without approval

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-013](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-013>) documents the evidence.

**Existing behavior / gap:** No current UI save/reload or request-count readback; cited successful fixture and logs are absent.

**Target and implementation steps:**

- Retain direct completion of missing identity with format/duplicate/permission/version checks.
- Run the ordinary CUS form on unassigned and assigned nonterminal rows, including unchanged echoed weight/type fields.
- Verify terminal rows reject invalid corrections and no internal request/pending state is created.

**Acceptance and evidence:**

- CUS number-only update integration and UI readback.
- No approval artifacts, duplicate number, invalid number and terminal guards.

<a id="kp-042"></a>

#### KP-042 — Allow container number updates without triggering the trip schedule guard

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-042](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-042>) documents the evidence.

**Existing behavior / gap:** The current UI roundtrip is not verified; the original appendix explicitly deferred it.

**Target and implementation steps:**

- Run the real CUS editor with unchanged type/weight echoes and a new valid number on an assigned trip.
- Assert schedule/resources remain unchanged and only the selected container changes after reload.
- Retain actual operational-change and terminal rejection cases, and verify no pending request is created.

**Acceptance and evidence:**

- Number-only, identical echo, actual schedule/resource change, duplicate and terminal cases.
- Multi-container UI selection and persisted readback.

<a id="kp-058"></a>

#### KP-058 — Container PATCH regression coverage

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-058](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-058>) documents the evidence.

**Existing behavior / gap:** PATCH reverting to a permissive schema can still satisfy the existing clear-only PATCH test.

**Target and implementation steps:**

- Add authenticated malformed and wrong-check-digit PATCH cases asserting unchanged number/version and no idempotency side effects.
- Add canonical valid PATCH, clear and replay checks; demonstrate a temporary permissive-schema mutation makes the test fail without committing that mutation.

**Acceptance and evidence:**

- Actual POST/PATCH return 400 without writes for invalid input; canonicalization; permitted empty-value clearing; same-key replay; each route test detects a validation regression.

<a id="kp-062"></a>

#### KP-062 — Dispatcher direct container-number correction

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-062](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-062>) documents the evidence.

**Existing behavior / gap:** Appended API save/readback does not prove editor affordance, keyboard operation or UI refresh.

**Target and implementation steps:**

- Verify the actual Dispatcher editor is enabled only for the intended field and current permissions.
- Preserve direct correction; do not introduce a replacement approval stage.

**Acceptance and evidence:**

- Dispatcher changes an existing trip container number and reads it back; locked-period denial; CUS/Accountant permission matrix; unchanged route/ports; three sizes.

<a id="kp-072"></a>

#### KP-072 — Container-number format at each mutation boundary

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-072](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-072>) documents the evidence.

**Existing behavior / gap:** Current valid canonical write/reload and malformed path suite not executed.

**Target and implementation steps:**

- Retain one canonical validation boundary and exercise real routes on current build.
- Keep valid-input and clear cases alongside rejection cases.

**Acceptance and evidence:**

- Uppercase, lowercase and spaces; malformed three-letter value; invalid check digit; valid canonical value; optional clearing; duplicate/replay fingerprint; no side effects after rejected writes.

<a id="kp-133"></a>

#### KP-133 — Null-safe driver container editing

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-133](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-133>) documents the evidence.

**Existing behavior / gap:** The driver container editor initializes missing number/seal values to empty strings before trim-based validation. Current live save and required-number boundaries remain unverified.

**Target and implementation steps:**

- Keep null normalization at every editor entry and verify valid first-number entry without crash.
- Preserve ordinary validation and explicit online save, with no offline queuing.

**Acceptance and evidence:**

- NULL number/seal, seal-only attempt, valid first number, cancel/reopen, save/reload and large text/soft keyboard.

<a id="wp11"></a>

### WP11 — Driver and dispatcher facts, identity and evidence presentation

Owner: **Frontend + shared read-model owners**. Stage **3**. Design: [section 10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-10>). Integration dependencies: WP03, WP07, WP08.

<a id="kp-010"></a>

#### KP-010 — Driver summary and detail field hierarchy

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-010](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-010>) documents the evidence.

**Existing behavior / gap:** The QA appendix addresses BUG1 collapsible sections only, while this document contains multiple bugs/features.

**Target and implementation steps:**

- Split closure tracking by BUG1, BUG2 and photo feature while retaining this original record as the umbrella.
- Use KP-027/KP-028/KP-036/KP-046 and the latest driver requirements as the consolidated implementation/verification package.
- Verify all subrequirements on one linked trip across summary, details, collapsed states and persisted attachments; do not close the umbrella from collapse-only evidence.

**Acceptance and evidence:**

- Three-width driver card/detail states; empty and populated factory/invoice values.
- Upload/view/delete/reload for all three attachment types and device camera checks.

<a id="kp-015"></a>

#### KP-015 — Reconcile superseded driver layout with latest requirements

**Action:** Replace obsolete requirement. **Source:** QA_PASSED; Not stated. [KP-015](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-015>) documents the evidence.

**Canonical delivery:** [KP-191](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-191>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** The exact older row order is not the current layout contract; later KP-028/KP-038 and the newest driver consolidation requirements must govern.

**Target and implementation steps:**

- Retain this record as a historical source; map its factory identity/content requirements into the latest consolidated driver-detail package.
- Do not reintroduce an obsolete exact row order in parallel with newer full-name/address/contact requirements.
- Verify no required data is lost after the latest layout is implemented.

**Acceptance and evidence:**

- Factory short/full/missing fallback tests and final three-width driver layout.
- Content parity with current detail API.

<a id="kp-020"></a>

#### KP-020 — Consistent driver detail typography and components

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-020](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-020>) documents the evidence.

**Existing behavior / gap:** Historical design screenshot and typography census are absent.

**Target and implementation steps:**

- Keep one shared compact type/spacing vocabulary and merge later driver-content requirements into it.
- Measure actual computed text, contrast, hit targets, footer clearance and attachment dimensions on phone/tablet/desktop.
- Retest the underlying controls after style changes, especially collapse, file selection, camera and viewer.

**Acceptance and evidence:**

- Settled three-width visual comparison and computed type/touch/contrast checks.
- Driver detail interaction regression after styling.

<a id="kp-027"></a>

#### KP-027 — Driver Card View Layout Polish

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-027](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-027>) documents the evidence.

**Existing behavior / gap:** No current summary-card visual/readback test was performed; cited screenshots are absent.

**Target and implementation steps:**

- Retain direction-based operation semantics and explicit unknown fallback.
- Verify IMPORT/EXPORT/unknown cards with long factory/route/container values at three widths and follow each detail link.
- Merge overlapping card operation tickets into this implementation package while retaining each record identity.

**Acceptance and evidence:**

- Current DriverTripsPage tests and saved IMPORT/EXPORT card fixtures.
- Phone/tablet/desktop scanability and detail navigation.

<a id="kp-028"></a>

#### KP-028 — Driver Detail View — Add Full Factory Name, Address, Phone

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-028](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-028>) documents the evidence.

**Existing behavior / gap:** No fresh API/UI readback for complete, missing and fallback factory data.

**Target and implementation steps:**

- Use current canonical factory and billing data with explicit labels, including honest empty values.
- Consolidate duplicate contact rows and invoice party grouping under the latest driver requirement; preserve distinct parties and tel links.
- Verify expanded/collapsed identity, long addresses, tax codes and complete/empty phone data at three widths.

**Acceptance and evidence:**

- Current info-section/header tests plus live saved factory and invoice fixtures.
- Phone/contact and invoice-party grouping visual checks.

<a id="kp-029"></a>

#### KP-029 — Driver Card View — Add HÀNG TRẢ/HÀNG ĐÓNG Column

**Action:** Link canonical work. **Source:** QA_PASSED; Not stated. [KP-029](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-029>) documents the evidence.

**Canonical delivery:** [KP-027](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-027>), [KP-034](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-034>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** This is the same implementation requirement as KP-027’s operation subrequirement and KP-034/KP-035.

**Target and implementation steps:**

- Retain KP-029 identity and link it to the canonical card-operation package.
- Use one shared set of direction/fallback/responsive acceptance results; avoid a second competing card redesign.

**Acceptance and evidence:**

- Reuse KP-027/KP-034 operation and responsive checks.

<a id="kp-030"></a>

#### KP-030 — Reconcile drop off destinations across driver trip views

**Action:** Verify existing implementation. **Source:** QA_PASSED; P1. [KP-030](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-030>) documents the evidence.

**Existing behavior / gap:** No current same-record CUS/driver/dispatch readback or import/export semantic fixture was run.

**Target and implementation steps:**

- Define current source/label semantics for import empty-return versus export load/drop, using the latest requirements.
- Verify shared projection and each consumer against distinct factory, delivery and port values; adjust direction-aware mapping if fixtures demonstrate mismatch.
- Remove duplicate presentation according to KP-191 without conflating separate physical events.

**Acceptance and evidence:**

- Import/export direction cases with different delivery and return locations; missing/blank fallbacks.
- Same trip cross-view field comparison after reload.

<a id="kp-034"></a>

#### KP-034 — Show the return or loading operation on driver trip cards

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-034](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-034>) documents the evidence.

**Existing behavior / gap:** Cited staging wildcard reports are absent and no current browser verification was performed.

**Target and implementation steps:**

- Close against the shared card implementation and one current IMPORT/EXPORT/unknown evidence set.
- Keep separate old record IDs linked to the same work package and final proof.

**Acceptance and evidence:**

- Reuse current card direction, fallback and responsive tests.

<a id="kp-035"></a>

#### KP-035 — Show the return or loading operation on driver trip cards

**Action:** Link canonical work. **Source:** QA_PASSED; P2. [KP-035](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-035>) documents the evidence.

**Canonical delivery:** [KP-034](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-034>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** This record repeats the same QA002 scope as KP-034 with an earlier dev-only closure.

**Target and implementation steps:**

- Retain original KP-035 identity and link closure to KP-034/KP-027.
- Avoid generating a second implementation or duplicate screenshot exercise.

**Acceptance and evidence:**

- Shared operation-card regression and current device proof.

<a id="kp-036"></a>

#### KP-036 — Unify driver attachment sections and their visual hierarchy

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-036](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-036>) documents the evidence.

**Existing behavior / gap:** No current populated/empty three-width view or actual persistence tests were run.

**Target and implementation steps:**

- Use one grouped attachment component and retain current compact touch styling.
- Exercise each file type through select, save, reload, full view, replacement and delete.
- Test camera permission granted/denied and actual capture on supported physical mobile hardware; mark unavailable hardware as unverified rather than passed.

**Acceptance and evidence:**

- Three attachment types × empty/populated/action/reload states.
- Camera device matrix and viewer keyboard/focus checks.

<a id="kp-038"></a>

#### KP-038 — Keep factory identity prominent and label its address in driver details

**Action:** Link canonical work. **Source:** QA_PASSED; P2. [KP-038](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-038>) documents the evidence.

**Canonical delivery:** [KP-028](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-028>), [KP-191](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-191>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** This is the QA006 subset already implemented and documented through KP-028.

**Target and implementation steps:**

- Retain KP-038 as a linked acceptance source under KP-028 and the latest driver detail package.
- Use a single full/short/missing factory and address verification matrix.

**Acceptance and evidence:**

- Shared KP-028 identity/address/collapse tests.

<a id="kp-046"></a>

#### KP-046 — Open driver attachments in a readable full image viewer

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-046](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-046>) documents the evidence.

**Existing behavior / gap:** Historical pan was explicitly not directly tested; one attachment used a mock key. No current physical or persisted-image test was performed.

**Target and implementation steps:**

- Verify all three persisted image types with real readable fixtures and fit/zoom/pan on touch and pointer devices.
- Audit the connected overlay manager for dialog semantics, background interaction/scroll and focus containment; add missing behavior at the shared viewer layer.
- Ensure closing restores the original attachment button and never changes underlying attachment data.

**Acceptance and evidence:**

- Real CONTAINER/SEAL/DELIVERY_NOTE after reload, zoom/pan, keyboard navigation/Escape.
- Screen-reader dialog semantics, focus containment, scroll lock and failed-image state.

<a id="kp-050"></a>

#### KP-050 — Show the transport route beneath the factory on driver trip cards

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-050](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-050>) documents the evidence.

**Existing behavior / gap:** No fresh 390px card/detail comparison on known-route, long-route and missing-route fixtures.

**Target and implementation steps:**

- Keep the card route and detailed street address separate.
- Retest the requested board fixtures and absent-route fallback at current build.

**Acceptance and evidence:**

- Known factory and route, long Vietnamese names, absent route, and navigation to the full address in detail at 390/834/1440px.

<a id="kp-051"></a>

#### KP-051 — Keep the container type visible when its number is not assigned

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-051](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-051>) documents the evidence.

**Existing behavior / gap:** Initial-number save/readback and all-null UI cases were not rerun.

**Target and implementation steps:**

- Verify the known-type/missing-number branch and first-number transition on resettable current fixtures.

**Acceptance and evidence:**

- 40HC with a NULL number; both type and number NULL; number assignment and reload; 390px wrapping without a duplicate type.

<a id="kp-052"></a>

#### KP-052 — Provide factory invoice information in driver trip details

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-052](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-052>) documents the evidence.

**Existing behavior / gap:** Customer fields currently fall under the preceding Factory heading, with Customer heading after those fields, contradicting clear party attribution.

**Target and implementation steps:**

- Render each party heading before a semantic group of that party fields; keep customer values in its own group.
- Define compact per-party/per-field missing-data text and ensure an unconfigured factory is explicit even when all invoice objects are absent.
- Add assertions for field ownership/order rather than merely asserting both heading strings exist.

**Acceptance and evidence:**

- Use different factory and customer names, addresses and MST values; assert their grouped DOM order and inspect the 390px screenshot.
- All invoice objects NULL and partially configured factory profiles; verify source attribution after reload/readback.

<a id="kp-054"></a>

#### KP-054 — Display container type once in the driver container summary

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-054](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-054>) documents the evidence.

**Existing behavior / gap:** No current visual/edit/readback verification for type variants.

**Target and implementation steps:**

- Retain one canonical label and confirm no second component reintroduces the raw code.

**Acceptance and evidence:**

- 20DC, 40HC, 45 and unknown types; edit/cancel number and seal; compact phone rendering.

<a id="kp-056"></a>

#### KP-056 — Use concise driver instructions when accepting an order

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-056](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-056>) documents the evidence.

**Existing behavior / gap:** Current action visibility and correspondence to successful server acceptance not rerun.

**Target and implementation steps:**

- Keep short instructions aligned with direct online acceptance and actual state transition.

**Acceptance and evidence:**

- Unaccepted, accepted and busy trips; keyboard use and action visibility at 390px; the shared online requirement blocks the action when disconnected.

<a id="kp-063"></a>

#### KP-063 — Direction-aware driver destinations and contact labels

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-063](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-063>) documents the evidence.

**Existing behavior / gap:** Explicit AC4 full contact wording remains different in current source; the completion narrative accepts an abbreviation without a recorded user change.

**Target and implementation steps:**

- Resolve the literal contact copy against the requested full wording; use the specified label unless the user accepts abbreviated copy.
- Retest destination comparisons without removing genuinely distinct return information.

**Acceptance and evidence:**

- Equal, different and null return destinations; exact contact-label assertion and telephone action; full names/long labels at 390px; current relevant suites.

<a id="kp-068"></a>

#### KP-068 — Compact driver detail facts

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-068](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-068>) documents the evidence.

**Existing behavior / gap:** Current visual row placement at actual phone/tablet/desktop and long-text fixtures is not executed.

**Target and implementation steps:**

- Verify responsive layout using populated and sparse examples; keep compact alignment without shrinking text/touch affordances.

**Acceptance and evidence:**

- Schedule and factory share the first row at 390px; long address/phone; multiple types/counts; missing factory/phone; grouped quantity versus actual container number.

<a id="kp-071"></a>

#### KP-071 — Driver delivery-point fallback

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-071](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-071>) documents the evidence.

**Existing behavior / gap:** Historical sample with both fields set to NULL did not prove a populated alternate source.

**Target and implementation steps:**

- Use the connected backend resolver rather than inventing separate conflicting frontend precedence.
- Verify each source independently with higher-priority source absent.

**Acceptance and evidence:**

- Delivery snapshot only; explicit delivery location only; container drop-off only; all sources missing; distinct return destination; preserved contact/address.

<a id="kp-140"></a>

#### KP-140 — Lift/drop ports on dispatcher Detailed Vehicle Plan

**Action:** Implement required outcome. **Source:** TODO; P1. [KP-140](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-140>) documents the evidence.

**Existing behavior / gap:** Embedded screenshot is the dispatcher DetailedPlanGrid and lacks lift/drop fields. Appended speculation that it is another driver-like screen is contradicted by the screenshot.

**Target and implementation steps:**

- Restore compact lift/drop facts in Kế hoạch chi tiết using direction-aware source fields.
- Trace pickup/drop/empty-return separately; add regression fixture rather than waiting for an already identifiable URL.

**Acceptance and evidence:**

- IMPORT/EXPORT/FCL/LCL, configured and missing sites; same facts in desktop rows and narrow summaries; no duplicated or swapped destinations.

<a id="kp-191"></a>

#### KP-191 — Latest driver detail field and invoice requirements

**Action:** Finish gaps and verify. **Source:** TODO; P0. [KP-191](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-191>) documents the evidence.

**Existing behavior / gap:** All five embedded images were inspected. The contact label was partially changed, but duplicate contact rows, separate number/type aggregation and return-depot semantics remain. The invoice block exists, but the customer heading follows its fields.

**Target and implementation steps:**

- Consolidate contact name and phone directly below the address under “Số điện thoại liên hệ”.
- Render each container number paired with its type; avoid ambiguous aggregate mapping for multiple containers.
- For IMPORT, “Hạ” means the empty-return depot. Remove the redundant return row for that direction while retaining actual other-stop information.
- Separate uppercase task tags and driver notes; place each invoice party heading before its fields.

**Acceptance and evidence:**

- All five image requirements; IMPORT/EXPORT/LCL; multiple containers; missing or distinct contacts; same or distinct depot; populated factory/customer invoice identities; phone/tablet/desktop.

<a id="wp12"></a>

### WP12 — OPS route provenance, eligible owners and accessible interactions

Owner: **Frontend + backend**. Stage **1**. Design: [section 13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-13>). Integration dependencies: WP02.

<a id="kp-059"></a>

#### KP-059 — Route information on the actual OPS order page

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-059](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-059>) documents the evidence.

**Existing behavior / gap:** Current browser mixed-route and fallback fixtures not rerun.

**Target and implementation steps:**

- Use this as the /ops/orders work package, overlapping original KP086; do not file duplicate route-display work.
- Verify deterministic multi-route aggregation and genuine missing source data.

**Acceptance and evidence:**

- One known route; several distinct routes; no container route with a shipment-route fallback; all routes missing; search, sort and three widths.

<a id="kp-069"></a>

#### KP-069 — Detailed-plan route fallback without a fulfillment

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-069](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-069>) documents the evidence.

**Existing behavior / gap:** Reported staging rows had shipmentRouteId set to NULL, so they did not exercise a populated shipment-route fallback.

**Target and implementation steps:**

- Create a fulfillment-less container with no container route and a known shipment route; verify API and rendered grid.
- Keep this separate from /ops/orders aggregate policy in KP059.

**Acceptance and evidence:**

- Container route takes precedence; populated shipment fallback; both routes null; master/detail consistency without imposing the same mixed-route aggregation policy.

<a id="kp-084"></a>

#### KP-084 — Reject negative OPS advance and expense amounts

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-084](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-084>) documents the evidence.

**Existing behavior / gap:** Typing minus then digits can become positive: controlled rerender removes the lone minus before next keystroke.

**Target and implementation steps:**

- Keep signed raw input text while editing; derive parsed amount separately and format on blur without removing sign.
- Render associated Vietnamese error in all three forms and disable submit for negative/zero/invalid input.
- Do not use API 400 evidence as a substitute for testing the controlled UI state sequence.

**Acceptance and evidence:**

- Type - then 12345 one key at a time; paste -12345 and then edit/delete a digit; the negative remains visible and no POST is sent.
- Empty, zero and positive values; focus/error association; keyboard/mobile input; create, edit and advance forms at three sizes; only valid positive amounts persist.

<a id="kp-086"></a>

#### KP-086 — Show the shipment route in the Ops plan

**Action:** Link canonical work. **Source:** QA_PASSED; P2. [KP-086](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-086>) documents the evidence.

**Canonical delivery:** [KP-059](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-059>), [KP-069](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-069>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** This record’s historical completion changed scope to the detailed plan and explicitly admitted that /ops/orders remained unresolved at that time.

**Target and implementation steps:**

- Link original KP086 to KP059 for current /ops/orders acceptance and KP069 for sibling detailed-plan fix.
- Retest current original route once under the consolidated route-provenance package.

**Acceptance and evidence:**

- Use the KP059 known, mixed, fallback and missing-route matrix at the actual /ops/orders route; do not substitute detailed-plan results.

<a id="kp-087"></a>

#### KP-087 — Link the blocking trip when driver acceptance is rejected

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-087](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-087>) documents the evidence.

**Existing behavior / gap:** Blocking reason/link fix is coupled to offline queue CONFLICT state slated for removal.

**Target and implementation steps:**

- Port blocker details into immediate online mutation error state or structured API error; remove queued commands and background replay.
- Keep authorized blocking-trip link and fallback handoff in direct online acceptance view.
- Retry explicitly after current server state refresh; never autoaccept after reconnect.

**Acceptance and evidence:**

- Link to an owned blocking trip; handoff when another driver owns it or access is unavailable; resolved stale blocker; one explicit retry; offline action blocked with no queue; reload retains recovery context without background mutations.

<a id="kp-090"></a>

#### KP-090 — Populate the Ops owner picker with active staff

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-090](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-090>) documents the evidence.

**Existing behavior / gap:** Loading and failed fetches do not show the requested status or retry action; noOpsStaff covers only a successful empty response.

**Target and implementation steps:**

- Query eligible ACTIVE nondeleted OPS accounts with pagination/search or a dedicated selector endpoint; validate same eligibility on save inside assignment transaction.
- Render loading/error/retry/empty states distinctly and preserve current selection; invalidate/refetch after user creation.
- Include compact username/employee identifier for duplicate names and test concurrent owner replacement.

**Acceptance and evidence:**

- Active, inactive, deleted and wrong-role users; more than 100 users and newly created users; duplicate names; loading, failure and retry; assign, replace, clear and read back with one active owner; tracking; keyboard use at three sizes.

<a id="kp-091"></a>

#### KP-091 — Keep Ops dialogs clear of the fixed page header

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-091](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-091>) documents the evidence.

**Existing behavior / gap:** Body portals and modal stacking are present; the custom Ops modal hook does not contain Tab focus or make the background inert, so the full keyboard requirement is not implemented.

**Target and implementation steps:**

- Use the existing accessible modal foundation or add equivalent focus containment, nested-picker ownership and focus return to the shared Ops wrapper.
- Retain the body portal and bounded scrolling; verify title/close visibility with the fixed header and soft keyboard.

**Acceptance and evidence:**

- Tab/Shift+Tab must remain inside each modal; Escape closes the topmost surface and returns to the opener.
- Run the three named forms at desktop, tablet and phone widths, including long content and scrolling.

<a id="kp-093"></a>

#### KP-093 — Restore the Operations owner dialog layout and button styling

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-093](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-093>) documents the evidence.

**Existing behavior / gap:** The assignment dialog has the shared overlay, styles and explicit button states, but inherits the same incomplete keyboard containment as KP-091. The document itself described DEV-ready rather than full post-fix UI verification.

**Target and implementation steps:**

- Implement the shared focus fix once with KP-091, then verify this dialog independently.
- Keep vehicle context, eligible staff selection, disabled/no-change save and readable compact actions.

**Acceptance and evidence:**

- Open/change/cancel/save at 390/768/1440; verify focus return, picker layering, long staff names and loading/error states.

<a id="kp-094"></a>

#### KP-094 — Refresh handoff readiness after a confirmed order exchange

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-094](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-094>) documents the evidence.

**Existing behavior / gap:** The confirmed exchange branch invalidates both the trip detail and work inbox. Its production caller still runs through offline command enqueue/drain logic, which must be removed under the current direction.

**Target and implementation steps:**

- Keep the targeted invalidation after an explicit successful online exchange request when removing the command queue.
- Reconcile the current detail and queue from the same persisted response; preserve failures as failures.

**Acceptance and evidence:**

- Visit detail first, confirm exchange online, return without full reload and verify readiness.
- Reject/timeout the request and verify no false handoff readiness or automatic replay.

<a id="kp-095"></a>

#### KP-095 — Show a valid next step for paper handoff on completed trips

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-095](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-095>) documents the evidence.

**Existing behavior / gap:** The work-inbox service and trip detail expose a terminal blocker and dispatcher-owned next step instead of an enabled handoff action. Current end-to-end evidence for both terminal and active fixtures is missing.

**Target and implementation steps:**

- Verify the retained terminal rule and a usable owner/correction next step.
- Keep ordinary delivery handoff separate from removed internal approval workflows.

**Acceptance and evidence:**

- Completed/cancelled trip: no impossible primary action.
- Active exchanged trip: explicit online handoff works; state refreshes in queue and detail.

<a id="kp-096"></a>

#### KP-096 — Allow configured Ops categories when saving trip expenses

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-096](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-096>) documents the evidence.

**Existing behavior / gap:** The enum restriction has been replaced by catalog-backed validation on create and update. Active, non-deleted codes are resolved exactly; current UI-to-database validation and recovery remain unverified.

**Target and implementation steps:**

- Verify the existing category contract through the direct online expense entry path.
- Map invalid/deactivated category errors to the open field without replacing the user draft or duplicating the expense.

**Acceptance and evidence:**

- Save exact active custom code and legacy code; reject inactive/deleted/unknown code on create and update.
- Check receipt, amount, receiver and duplicate-click validation without approval.

<a id="wp13"></a>

### WP13 — Internet-required operation, session recovery and worker retirement

Owner: **Frontend + platform + backend auth**. Stage **1**. Design: [section 3](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-3>). Integration dependencies: WP02.

<a id="kp-025"></a>

#### KP-025 — Recover route chunk loading safely

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-025](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-025>) documents the evidence.

**Existing behavior / gap:** No fresh controlled deploy/old-tab test was performed; cited driver proof is absent and the document defers Dispatcher E2E.

**Target and implementation steps:**

- Retain bounded online chunk recovery while coordinating service-worker retirement with the internet-required scope.
- Keep old tabs open through a controlled release and exercise all three named routes; inspect the final build and errors after recovery.
- Verify an actually broken deployment and denied session storage cannot create loops or hide an actionable reload message.

**Acceptance and evidence:**

- Current chunk/error-boundary unit tests plus old-tab deploy smoke for driver/dispatch/shipment.
- Repeated failure, storage exception and consecutive-deploy cases.

<a id="kp-098"></a>

#### KP-098 — Keep the session active after an incorrect current password

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-098](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-098>) documents the evidence.

**Existing behavior / gap:** Wrong-current-password returns a validation error rather than an authentication expiry, and the password modal contains inline feedback. The QA statement was API-oriented and does not establish the current interactive session behavior.

**Target and implementation steps:**

- Verify the existing distinction end to end; keep the dialog draft and focus recovery usable.
- Retain actual expired/revoked-session handling without treating a wrong current password as logout.

**Acceptance and evidence:**

- Wrong current password, empty inputs, mismatch, successful change and genuinely expired session at three widths.

<a id="kp-131"></a>

#### KP-131 — Reliable logout and account switching

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-131](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-131>) documents the evidence.

**Existing behavior / gap:** The mobile overlay is marked as part of the dropdown interaction region and the logout button calls the shared auth flow. Historical multi-round staging evidence explains the pointer event fix, but is not current-HEAD verification.

**Target and implementation steps:**

- Verify actual pointer and keyboard logout on the current build and isolate rapid session changes.
- Remove offline sync behavior under the current direction without weakening server session revocation or local exit.

**Acceptance and evidence:**

- Admin and Driver desktop/phone logout, duplicate clicks, slow revocation, new session before old request resolves, and post-logout protected navigation.

<a id="kp-142"></a>

#### KP-142 — Remove offline business command queues and retire saved commands

**Action:** Implement required outcome. **Source:** TODO; P1. [KP-142](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-142>) documents the evidence.

**Existing behavior / gap:** Role-specific localStorage queue and IndexedDB queue still have active drain callers on driver, POD, OPS detail and inbox.

**Target and implementation steps:**

- Remove enqueue/drain imports and UI promises; direct online commands only.
- Run owned-storage retirement before any legacy queue reader, including scoped and unscoped keys and earlier tabs.
- Retain explicit idempotent online retry and reconcile unknown outcomes.

**Acceptance and evidence:**

- Offline before click and midflight; reconnect/reload/account switch emits zero automatic mutations; old profile with pending/conflicted entries; no duplicate commit.

<a id="kp-143"></a>

#### KP-143 — Require a live connection before allowing application work

**Action:** Implement required outcome. **Source:** TODO; P1. [KP-143](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-143>) documents the evidence.

**Existing behavior / gap:** OfflineBanner remains an informational autosync message and useOnline observes browser connectivity only.

**Target and implementation steps:**

- Add shared internet/service-required state across office, Driver, OPS, CUS, Customer portal and login.
- Gate new business commands; preserve an inert in-memory draft and local logout; use a bounded service-recovery check.
- GET refresh may resume; writes require explicit user retry.

**Acceptance and evidence:**

- All eight roles; offline startup/click/mid-flight; browser online but service returns 503; recovery; keyboard focus; compact layouts.

<a id="kp-155"></a>

#### KP-155 — Keep valid sessions through temporary identity service failures

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-155](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-155>) documents the evidence.

**Existing behavior / gap:** fetchAuthUser clears the valid token for every ApiError, including 503, and query retry is disabled.

**Target and implementation steps:**

- Distinguish invalid authentication from temporary identity/service failure.
- Preserve valid credentials while protected content is gated; explicit bounded recovery restores identity.

**Acceptance and evidence:**

- 401, expired and revoked credentials versus 502/503/429/network failure; startup and existing-session recovery; account-switch isolation.

<a id="kp-161"></a>

#### KP-161 — Allow the current account to log out while an earlier revocation waits

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-161](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-161>) documents the evidence.

**Existing behavior / gap:** The provider-wide logoutInFlight guard returns before reading the current account token. Revocation for the previous account can block logout of a newly signed-in account. The durable revocation queue also remains.

**Target and implementation steps:**

- Always clear the current local session immediately; deduplicate only the specific token-revocation request.
- Retire durable logout-token replay with the online-only migration; explain remote uncertainty without retaining a credential replay queue.

**Acceptance and evidence:**

- Account A logout hangs, then account B logs in and logs out; late A response; repeated click; expired session; no legacy queued tokens in localStorage.

<a id="kp-164"></a>

#### KP-164 — Retire the offline service worker cache and background sync with an upgrade migration

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-164](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-164>) documents the evidence.

**Existing behavior / gap:** Startup and push registration still install the offline-shell worker. The worker caches navigation and performs periodic journey reads; the token mirror recreates its cache.

**Target and implementation steps:**

- Ship a minimal push-only worker at the existing URL/scope; remove offline fetch and periodic synchronization.
- Retire only owned cache entries, registration tags and token-cache producers before re-enabling push; ensure migration converges across multiple tabs.

**Acceptance and evidence:**

- Old and fresh profiles; installed app; multiple tabs; unsupported APIs; push receipt/click; repeated migration; no offline business screen or replay.

<a id="kp-165"></a>

#### KP-165 — Distinguish unavailable route assets from a verified new deployment

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-165](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-165>) documents the evidence.

**Existing behavior / gap:** Generic dynamic-import/preload errors trigger cache purging, reload and a new-version message without evidence that the build changed.

**Target and implementation steps:**

- Compare frontend build identity and asset/service availability; show a truthful unavailable state when there is no evidence of a stale build.
- Allow bounded reload only for a verified stale deployment; clean up only owned assets and use an independent cooldown.

**Acceptance and evidence:**

- Unchanged-build network failure; asset 503; new build with stale tab; repeated failure; cooldown; React boundary/global handler; stated limits of in-memory drafts.

<a id="wp14"></a>

### WP14 — Direct financial policy and vehicle profile versions

Owner: **Backend + frontend + data migration**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02.

<a id="kp-097"></a>

#### KP-097 — Align financial policy messages with approval state

**Action:** Replace obsolete requirement. **Source:** QA_PASSED; P2. [KP-097](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-097>) documents the evidence.

**Canonical delivery:** [KP-147](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-147>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** The old target distinguishes approved and pending submissions. That requirement is superseded by the user decision to remove all internal approval. Preserve only truthful direct-save outcome, dates and conflict recovery; coordinate with KP-147 rather than restoring approval.

**Target and implementation steps:**

- Replace request/approved/pending terminology with authorized direct save and effective-date/version history.
- Keep separate duplicate-month versus stale-version feedback and closed-period/role restrictions.

**Acceptance and evidence:**

- First and subsequent direct saves return truthful applied state; future effective versions remain accurately described.
- Duplicate month and stale version preserve the draft and explain different remedies.

<a id="kp-147"></a>

#### KP-147 — Remove approval steps from financial configuration

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-147](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-147>) documents the evidence.

**Existing behavior / gap:** Incomplete removal: request-oriented UI and response contracts remain, although the connected configuration helper applies the change in the request.

**Target and implementation steps:**

- Expose authorized direct version creation and a saved/effective result contract; replace request queues and approved-history vocabulary.
- Preserve actor/time/change history as audit, migrate legacy pending records deliberately and remove dead pending branches.

**Acceptance and evidence:**

- First/subsequent/future save, duplicate effective month, stale version, role denial, reload and all three responsive widths.

<a id="wp15"></a>

### WP15 — Direct advances, returns and settlement

Owner: **Backend + frontend + ledger owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02.

<a id="kp-092"></a>

#### KP-092 — Reconcile the Ops wallet with approved advance returns

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-092](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-092>) documents the evidence.

**Existing behavior / gap:** The wallet subtracts returned settlement funds as well as expenses. The numerical implementation exists, but current ledger-level and UI evidence is unavailable; historical approval-state rules need migration to the internet-only direct workflow.

**Target and implementation steps:**

- Preserve the once-only return arithmetic and historical records while connecting it to authorized direct posting.
- Define available versus reserved amounts explicitly and refresh wallet and ledger from the committed result.

**Acceptance and evidence:**

- Check full, partial and multiple returns, repeated readback, reversed records, and a later advance.
- Compare wallet totals to persisted entries after reload without adding any approval gate.

<a id="kp-125"></a>

#### KP-125 — Show a compact status on every advance request

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P3. [KP-125](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-125>) documents the evidence.

**Existing behavior / gap:** Every advance card now shows a textual status, but its vocabulary and metadata still encode internal approval. The compact status pattern is useful; the approval-preservation target is obsolete and needs revision with the advance workflow removal package.

**Target and implementation steps:**

- Retain the compact per-row state, but derive it from authorized direct-save/payment lifecycle instead of approval.
- Coordinate with KP-148/advance removal and preserve historical audit facts without exposing new approval actions.

**Acceptance and evidence:**

- Mixed records in All and each current-state filter: labels/counts agree; long purposes do not enlarge every card.

<a id="kp-148"></a>

#### KP-148 — Remove approval handoffs from advances and settlements

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-148](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-148>) documents the evidence.

**Existing behavior / gap:** Partial direct execution exists, but advance/settlement status models and visible approval handoffs remain.

**Target and implementation steps:**

- Define direct recorded/outstanding/settled/reversed states and use ordinary posting commands, replacing create-then-approve adapters.
- Update eligibility, wallet aggregation, history and entry forms together; migrate pending/link records without duplicate money.

**Acceptance and evidence:**

- Direct create/correct/settle/reverse lifecycle; partial refund, repeat submit, insufficient funds, used references and fresh readback across Ops and accounting.

<a id="wp16"></a>

### WP16 — Direct OPS expenses without approval routing

Owner: **Backend + frontend + ledger owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02, WP12.

<a id="kp-149"></a>

#### KP-149 — Remove approval routing from Ops field expenses

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-149](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-149>) documents the evidence.

**Existing behavior / gap:** Real Ops expense approval endpoints and state restrictions remain; the document also misattributes the shared level-1 credit cap to Ops.

**Target and implementation steps:**

- Replace the field expense decision lifecycle with direct authorized recorded entries and precise correction/settlement states.
- Remove only category thresholds used to route internal approval; preserve amount/category/evidence validation and scope.
- Update wallet totals and list counts with a logged pending-record migration, not a mass fake approval.

**Acceptance and evidence:**

- Own and unauthorized expense create/edit; receipts/alternative evidence, no-invoice category, settlement-linked edit, duplicate save and wallet reconciliation.

<a id="wp17"></a>

### WP17 — Direct operating expenses and payment allocations

Owner: **Backend + frontend + ledger owner**. Stage **2**. Design: [section 7](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-7>). Integration dependencies: WP02.

<a id="kp-070"></a>

#### KP-070 — Retire obsolete expense-review buttons

**Action:** Replace obsolete requirement. **Source:** QA_PASSED; Not stated. [KP-070](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-070>) documents the evidence.

**Canonical delivery:** [KP-150](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-150>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** Current source retains the approval actions that the user has explicitly directed engineers to remove.

**Target and implementation steps:**

- Retire this stop-propagation ticket as superseded, preserving its filename/history.
- Remove internal approval buttons/states and wire direct authorized expense operations under the approval-removal work package.
- Retain general row/action event isolation for surviving ordinary actions.

**Acceptance and evidence:**

- Expense completion requires no internal approval controls/routes; surviving edit/delete actions are keyboard accessible and do not trigger unintended row navigation.

<a id="kp-074"></a>

#### KP-074 — Keep expense and supplier debt pending until the promised review is complete

**Action:** Replace obsolete requirement. **Source:** QA_PASSED; P1. [KP-074](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-074>) documents the evidence.

**Canonical delivery:** [KP-150](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-150>). Preserve this record’s original acceptance scope.

**Existing behavior / gap:** This QA_PASSED record implements a workflow the user subsequently removed from scope.

**Target and implementation steps:**

- Mark original approval task superseded and route remaining removal work to direct expense creation/settlement.
- Keep ordinary validation, authorization, audit and once-only ledger posting without maker/checker/approver gates.
- Migrate existing pending records under an explicit data transition.

**Acceptance and evidence:**

- Direct authorized expense save and one ledger effect; no review queue or separate approval actors; failed validation creates no posting; migration of existing pending records.

<a id="kp-075"></a>

#### KP-075 — Keep expense payment status consistent with its supplier ledger

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P1. [KP-075](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-075>) documents the evidence.

**Existing behavior / gap:** Normal payment UI does not expose/pass expense linkage, so its payment cannot mark selected expense status consistently.

**Target and implementation steps:**

- Define explicit allocation amounts between a payment and expenses; validate totals atomically and derive partial/paid status from allocated balance.
- Expose compact expense selection/allocation in authorized payment UI and invalidate expense plus supplier views after persistence.
- Wire a direct authorized audited reversal into the same transaction and restore allocations/status consistently.
- Remove approval prerequisite without weakening payment authorization or balance validation.

**Acceptance and evidence:**

- A payment of 1 against an expense of 100 cannot mark it fully paid; partial and final allocations; summed coverage across multiple expenses; wrong supplier; concurrent/replayed payment applies once.
- Select in the UI, save and reload both ledgers; failure rollback; reachable reversal and reconciliation afterward; no approval actors.

<a id="kp-083"></a>

#### KP-083 — Fix expense creation buttons for accountants

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-083](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-083>) documents the evidence.

**Existing behavior / gap:** Direct API creation cannot prove navigation, form visibility or back-context behavior.

**Target and implementation steps:**

- Test from Accountant list CTA to form and successful direct authorized save, retaining source queue context.
- Do not retain an internal approval handoff from historical pending status.

**Acceptance and evidence:**

- Accountant create/edit CTAs; browser back and return to list; validation errors; permitted save/reload; clear denial for a forbidden role using the direct URL; three sizes.

<a id="kp-150"></a>

#### KP-150 — Record operating expenses without internal approval

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-150](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-150>) documents the evidence.

**Existing behavior / gap:** Not removed: operating-expense creation currently persists a pending record and real distinct checker/approver endpoints control supplier-debt posting.

**Target and implementation steps:**

- Create/update authorized valid expense and its applicable supplier-debt entry atomically once; return the resulting expense and posting state.
- Remove reviewer queues, endpoints and mandatory approval reasons, replacing them with useful business notes where needed.
- Migrate pending/check states and associated evidence without duplicate expense or ledger entries.

**Acceptance and evidence:**

- Direct new expense and correction, pre-save images, invalid category/amount, repeated save, paid/unpaid consistency and supplier ledger reload.

<a id="wp18"></a>

### WP18 — Evidence-based accounting and billing readiness

Owner: **Backend + frontend + accounting owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02, WP04.

<a id="kp-080"></a>

#### KP-080 — Open blocked transport records from the accounting work queue

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-080](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-080>) documents the evidence.

**Existing behavior / gap:** Exact link→record navigation, owner handoff and scope/date context were not executed.

**Target and implementation steps:**

- Retest work-link navigation with blocked and eligible fixtures and clear record context.
- Keep underlying record visibility; replace approval-dependent gating/copy with current direct workflow.

**Acceptance and evidence:**

- Link to the exact record; authorized versus forbidden access; missing evidence remains visible; update evidence and read back; date filters and three sizes; no internal approval dependency.

<a id="kp-151"></a>

#### KP-151 — Remove internal ePOD approval gates from accounting and billing

**Action:** Implement required outcome. **Source:** TODO; P2. [KP-151](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-151>) documents the evidence.

**Existing behavior / gap:** Not removed: accounting readiness and billing eligibility still require internal accepted e-POD status.

**Target and implementation steps:**

- Define one saved-valid-evidence readiness predicate and use it consistently in accounting register, inbox and billing candidates.
- Remove review actions/status dependence; migrate submitted/accepted/rejected legacy evidence with a transparent completeness outcome and retained audit.

**Acceptance and evidence:**

- Complete versus missing/invalid evidence, corrected version, wrong customer/trip, reload/invalidation and debit-note generation without a reviewer.

<a id="wp19"></a>

### WP19 — Direct fuel invoices and explicit allocation

Owner: **Backend + frontend + ledger owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02, WP17.

<a id="kp-082"></a>

#### KP-082 — Fix OCR review header overlap on desktop and tablet

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-082](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-082>) documents the evidence.

**Existing behavior / gap:** No current rendered header at 768/834/1440px or filter interaction.

**Target and implementation steps:**

- Apply layout only to surviving direct evidence workflow; remove approval-specific copy/actions.
- Verify long Vietnamese guidance and filter labels at each width without oversized components.

**Acceptance and evidence:**

- Header at 390/768/834/1440px; keyboard filter operation and visible focus; no overlap; no internal review gate.

<a id="kp-152"></a>

#### KP-152 — Remove internal fuel invoice approval and approved expense prerequisites

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-152](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-152>) documents the evidence.

**Existing behavior / gap:** Not removed: invoice creation, approved-expense eligibility and a separate approval/posting command remain; some corrections already auto-apply.

**Target and implementation steps:**

- Provide direct authorized valid invoice save/posting, linking eligible recorded expenses without approval state.
- Fold reconciliation into the direct command, retain optional incomplete drafts with honest state, and remove approval/rejection queues and prerequisites.
- Migrate existing invoice/evidence/allocation states with exact posting identity and history.

**Acceptance and evidence:**

- Exact/under/over allocation, invalid price or duplicate invoice, valid recorded expense, correction/reversal and all-width reload.

<a id="wp20"></a>

### WP20 — Direct profit distribution finalization

Owner: **Backend + frontend + ledger owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02.

<a id="kp-103"></a>

#### KP-103 — Make vehicle ownership setup reachable from profit distribution

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-103](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-103>) documents the evidence.

**Existing behavior / gap:** Profit warning links affected truck ids to an existing ownership editor for Admin; Manager receives an explicit owner restriction. Full saved-ownership-to-preview recovery and business validation are not established by the cited API-only pass.

**Target and implementation steps:**

- Verify the per-truck deep link, authorized owner form and effective-date rules together.
- Keep ownership validation as an ordinary distribution prerequisite, separate from removed internal approval.

**Acceptance and evidence:**

- Missing, partial and complete ownership; invalid shares/date/partner under defined policy; save/reopen and refresh preview.
- Manager receives an actionable authorized-owner explanation; direct URL permission remains enforced.

<a id="kp-153"></a>

#### KP-153 — Replace profit allocation approval with direct authorized finalization

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-153](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-153>) documents the evidence.

**Existing behavior / gap:** The backend already finalizes in-request, but UI still promises an independent review and displays pending workflow state.

**Target and implementation steps:**

- Return and render the actual finalized distribution with a direct action and no pending-review UI.
- Replace transient approval representation with honest direct-action audit and define legacy pending migration; rename the approval navigation group.

**Acceptance and evidence:**

- Preview/finalize/readback, incomplete ownership, wrong/closed period, concurrent finalization, repeat request and unauthorized role.

<a id="wp21"></a>

### WP21 — Direct eligible shipment deletion

Owner: **Backend + frontend**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02.

<a id="kp-154"></a>

#### KP-154 — Remove the internal shipment deletion approval request

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-154](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-154>) documents the evidence.

**Existing behavior / gap:** The CUS deletion backend already deletes eligible shipments directly; the visible confirmation remains an approval request and can misrepresent an immediate destructive result.

**Target and implementation steps:**

- Present a direct named delete/cancel confirmation that matches actual eligibility and role authority.
- Retain soft-delete/audit/idempotency and explain concrete blocking references with supported next steps.
- Remove obsolete request/approval contracts and resolve historical requests explicitly without silent deletion.

**Acceptance and evidence:**

- Eligible direct delete; dispatched/financially referenced blocked deletion; stale version; cancel dialog; role denial and repeated confirm.

<a id="wp22"></a>

### WP22 — Direct discipline, cancellation and accurate payroll presentation

Owner: **Backend + frontend + payroll owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02.

<a id="kp-107"></a>

#### KP-107 — Make discipline card actions keyboard accessible

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-107](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-107>) documents the evidence.

**Existing behavior / gap:** Connected penalty cards now render native edit/delete buttons with record-specific accessible names. Current pointer, keyboard, focus-visible and touch proof remains incomplete.

**Target and implementation steps:**

- Keep native semantics and verify focus indication remains visible even when hover actions are visually subdued.

**Acceptance and evidence:**

- Tab through each record; Enter/Space edit/delete; cancel and focus return; disabled/permission cases and touch.

<a id="kp-108"></a>

#### KP-108 — Make penalty records reachable before the expanded driver ranking

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-108](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-108>) documents the evidence.

**Existing behavior / gap:** Phone ranking is collapsed by default, but the full desktop ranking remains before the primary ledger. The document claims desktop was unchanged, while the source requirement asks for prompt record access across device sizes.

**Target and implementation steps:**

- Make the ledger the primary destination at all widths, with a compact optional ranking or a clear direct jump.
- Keep create access, counts, filtering and cancellation history; do not recreate approval controls.

**Acceptance and evidence:**

- Large driver list at 390/834/1440: reach and search records without traversing every ranking card/row.
- Expand ranking without losing the current ledger context; preserve touch target and keyboard access.

<a id="kp-109"></a>

#### KP-109 — Keep pending discipline out of driver pay

**Action:** Replace obsolete requirement. **Source:** QA_PASSED; P2. [KP-109](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-109>) documents the evidence.

**Existing behavior / gap:** The old target requires pending discipline to await approval before pay impact; that policy is superseded. The completion note claims approval removal, but current production UI and routes still implement PENDING plus approval by another user.

**Target and implementation steps:**

- Implement authorized direct discipline recording with ordinary validation, explicit status and auditable cancellation.
- Remove approval UI/endpoints/business gating, migrate outstanding states deliberately, and calculate payroll from effective non-cancelled records once.

**Acceptance and evidence:**

- Create/edit/cancel direct discipline with correct payroll/ranking effects, permissions and audit trail.
- Verify historical pending records follow the defined migration without hidden deduction or duplicate posting.

<a id="kp-110"></a>

#### KP-110 — Keep driver penalty summaries aligned and amounts intact

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-110](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-110>) documents the evidence.

**Existing behavior / gap:** Responsive summary styling and narrow-phone amount typography are present. Current rendering with realistic long/large amounts at the stated breakpoints is not established by source or the older small-value fixture.

**Target and implementation steps:**

- Retest the shared metric layout with representative long labels, large values and status filters.
- Keep whole amounts readable; do not use clipped or ellipsized money.

**Acceptance and evidence:**

- Zero, five-digit and large grouped amounts at 390/420/834/1440, increased text size, and summary/count consistency.

<a id="kp-113"></a>

#### KP-113 — Keep keyboard focus inside the discipline cancellation dialog

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-113](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-113>) documents the evidence.

**Existing behavior / gap:** Cancellation now uses the shared Modal, which invokes useFocusTrap and confirm/cancel shortcuts. That is meaningful implementation evidence, but current keyboard behavior including animated close and focus return remains unverified.

**Target and implementation steps:**

- Verify the shared modal rather than reintroducing custom focus handling.
- Keep background controls unreachable while open and restore the actual opener after cancel.

**Acceptance and evidence:**

- Tab/Shift+Tab wrap; Escape/close/backdrop behavior; input Enter does not accidentally confirm; focus return after animated dismissal.

<a id="kp-114"></a>

#### KP-114 — Exclude cancelled penalties from active rankings and discipline totals

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-114](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-114>) documents the evidence.

**Existing behavior / gap:** Penalty aggregation selects effective ACTIVE records, so cancelled records are excluded from ranking calculations while history remains available. Current full UI/ledger comparison before and after cancellation is not present.

**Target and implementation steps:**

- Keep cancelled records in history and exclude them from active aggregate inputs.
- Reconcile the same status rule across Admin, Driver and payroll as discipline becomes direct posting.

**Acceptance and evidence:**

- Before/create/cancel/reload comparison of ranking, amount, count and safe days; another active record remains counted.

<a id="kp-170"></a>

#### KP-170 — Explain rejected negative amounts in discipline rule edits

**Action:** Finish gaps and verify. **Source:** TODO; P3. [KP-170](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-170>) documents the evidence.

**Existing behavior / gap:** A negative amount receives no adjacent field error in the reason editor. Save forwards Number(amount), while the disabled state checks only the name and duplicates.

**Target and implementation steps:**

- Keep the raw amount draft; validate nonnegative input before sending a request; show a Vietnamese field error with id, aria-invalid, aria-describedby and focus handling.

**Acceptance and evidence:**

- Type and paste a negative value; Enter and click save; correction; zero; empty value; no saved negative amount; retain reason and severity.

<a id="kp-171"></a>

#### KP-171 — Remove duplicate currency units from discipline amounts

**Action:** Implement required outcome. **Source:** TODO; P3. [KP-171](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-171>) documents the evidence.

**Existing behavior / gap:** Discipline amount displays append a manual “đ” to an already formatted currency value.

**Target and implementation steps:**

- Use one currency formatter in rankings, confirmation and scoreboard; remove the manual suffix.

**Acceptance and evidence:**

- Zero, nonzero and large values; visible text and accessibility tree contain exactly one currency unit; sort arithmetic unchanged.

<a id="kp-172"></a>

#### KP-172 — Describe negative earnings balances without assuming excess advances

**Action:** Implement required outcome. **Source:** TODO; P3. [KP-172](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-172>) documents the evidence.

**Existing behavior / gap:** The negative-earnings headline is selected from the balance sign alone and states that the advance was excessive.

**Target and implementation steps:**

- Use neutral signed-balance wording or a label derived from the actual components.

**Acceptance and evidence:**

- Deduction only; advance only; mixed components; zero; positive balance; unchanged arithmetic and component amounts.

<a id="wp23"></a>

### WP23 — Direct authorized credit exceptions

Owner: **Backend + frontend + credit-policy owner**. Stage **2**. Design: [section 11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-11>). Integration dependencies: WP02, WP03.

<a id="kp-163"></a>

#### KP-163 — Replace trip credit override approval requests with direct authorized exception handling

**Action:** Finish gaps and verify. **Source:** TODO; P2. [KP-163](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-163>) documents the evidence.

**Existing behavior / gap:** Directly applied credit overrides still use an approved-request record and a separate approved-selection trip workflow.

**Target and implementation steps:**

- Provide direct authorized exception handling within trip creation with clear amount/scope/reason and actual outcome.
- Replace request/approved selection and fake reviewer events with direct exception audit; migrate legacy records read-only or through explicit conversion.
- Preserve current exposure recheck and single-use/concurrency controls during trip commit.

**Acceptance and evidence:**

- Within limit, authorized/unauthorized over-limit, wrong customer, expired/consumed exception, changed exposure, repeat submit and failed trip recovery.

<a id="wp24"></a>

### WP24 — Administrative form validation and configuration consistency

Owner: **Frontend + shared validation owners**. Stage **3**. Design: [section 13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-13>). Integration dependencies: WP02.

<a id="kp-060"></a>

#### KP-060 — User-create email validation parity

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-060](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-060>) documents the evidence.

**Existing behavior / gap:** Appended evidence uses direct API 400/201, which cannot verify UI focus, Vietnamese copy or field association.

**Target and implementation steps:**

- Add/execute create-panel interaction coverage for invalid/valid/empty email and check first invalid-field focus.
- Verify at three widths on the exact create panel.

**Acceptance and evidence:**

- Saving an invalid email sends no request, announces a Vietnamese error and focuses Email; correction clears the error; valid and optional blank cases.

<a id="kp-102"></a>

#### KP-102 — Show configuration validation errors inside open forms

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-102](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-102>) documents the evidence.

**Existing behavior / gap:** CrudTable now moves the alert inside an open add/edit modal. The requirement also asks for amount-field association and focus; the generic top-of-modal alert alone does not provide those.

**Target and implementation steps:**

- Keep errors inside the active form and map known validation paths to their fields.
- Associate message and invalid state with the input, focus the first invalid field, and preserve remaining values.

**Acceptance and evidence:**

- Negative capital contribution and road allowance amount: reject, visible field message, keyboard correction, valid retry and retained draft.

<a id="kp-104"></a>

#### KP-104 — Reject malformed company email before saving the profile

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-104](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-104>) documents the evidence.

**Existing behavior / gap:** Malformed email is rejected by the UI and schema, but the API schema still rejects an explicit empty string although optional blank is a required supported case. The UI sends that empty string and displays validation globally instead of associating it with Email.

**Target and implementation steps:**

- Make the API contract explicitly accept either blank or a valid trimmed email; keep malformed nonempty values rejected.
- Attach errors to Email with invalid/description state and first-error focus while preserving the draft.

**Acceptance and evidence:**

- API plus real form: omitted email, empty string, whitespace-only, valid email and malformed email; save and reload.

<a id="kp-105"></a>

#### KP-105 — Associate company form labels with their fields

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-105](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-105>) documents the evidence.

**Existing behavior / gap:** Current company fields use visible labels with matching input ids. Static/component evidence supports the implementation; screen-reader and actual pointer label behavior across widths are not current verified evidence.

**Target and implementation steps:**

- Verify all ten exact Vietnamese accessible names and clicking each label focuses the correct field.
- Retain compact layout and distinguish validation association from label association (KP-104).

**Acceptance and evidence:**

- Keyboard and label-click checks, accessible-name assertions, and a screen-reader sample on the current build.

<a id="kp-121"></a>

#### KP-121 — Persist clearing of optional truck text fields

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-121](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-121>) documents the evidence.

**Existing behavior / gap:** The truck editor sends null for cleared optional text fields, resolving the undefined-omission cause in the form. Current API persistence from both entry points is not verified.

**Target and implementation steps:**

- Verify nullable payload handling through both fleet edit entry points.
- Keep omitted-field semantics distinct from explicit clear and preserve version/permission checks.

**Acceptance and evidence:**

- Populate then clear every nullable text field, save/reload, compare untouched fields; conflict and invalid-required-field cases.

<a id="kp-122"></a>

#### KP-122 — Keep keyboard active options visible in searchable selectors

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-122](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-122>) documents the evidence.

**Existing behavior / gap:** Both selectors scroll the active option into view on keyboard movement. Existing short-list component tests do not prove overflow geometry, list-only scrolling or long-list behavior.

**Target and implementation steps:**

- Verify keyboard navigation through real overflowed lists and preserve the trigger/parent scroll context.
- Keep filtering, reopening and loading further options synchronized with a valid active index.

**Acceptance and evidence:**

- Arrow/Home/End/Enter beyond initial viewport; filter after scrolling, reopen, load more, multi-select, nested modal and zoom.

<a id="kp-123"></a>

#### KP-123 — Show compact module and record titles across the app

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-123](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-123>) documents the evidence.

**Existing behavior / gap:** CrudTable opts into visible module titles, and tire views resolve vehicle identity. Current visual verification for every named module and truck/trailer record remains unavailable.

**Target and implementation steps:**

- Check visible module and record identity once per distinct page template without duplicating giant headers.
- Preserve compact actions/breadcrumbs and meaningful loading/missing-record state.

**Acceptance and evidence:**

- Direct navigation/back and truck-to-trailer record switches at 390/834/1440; long plate/title and no duplicate headings.

<a id="kp-124"></a>

#### KP-124 — Remove the internal dashboard version label from the main summary

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-124](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-124>) documents the evidence.

**Existing behavior / gap:** The internal definition token is confined to a footer tooltip while the visible footer shows the update time. Current rendered and accessibility behavior remains unverified.

**Target and implementation steps:**

- Verify the visible dashboard contains only useful business metadata while optional support details remain unobtrusive.

**Acceptance and evidence:**

- Complete/partial/loading/error states and timestamp readability at all widths.

<a id="kp-130"></a>

#### KP-130 — Localize administrative form validation beside the affected fields

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P3. [KP-130](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-130>) documents the evidence.

**Existing behavior / gap:** User edit has associated Vietnamese field errors and focus handling. Trip expense configuration shows Vietnamese messages but lacks aria-invalid and aria-describedby/message ids on the affected fields, so the broadened acceptance contract is partial.

**Target and implementation steps:**

- Apply reusable field-error ids, aria-invalid and aria-describedby to all five expense amounts.
- Preserve Vietnamese messages, first-error focus, correction/retry and optional blank email semantics.

**Acceptance and evidence:**

- Combined invalid email/password and each negative expense amount: reject, focus, announce associated error, correct and save.

<a id="kp-166"></a>

#### KP-166 — Remove duplicate configuration entries from the settings overview

**Action:** Implement required outcome. **Source:** TODO; P3. [KP-166](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-166>) documents the evidence.

**Existing behavior / gap:** The current registry contains duplicate IDs/destinations, and a fresh staging screenshot shows both duplicates.

**Target and implementation steps:**

- Deduplicate by canonical destination/ID; preserve role visibility, counts and routing.
- Add a registry-uniqueness check.

**Acceptance and evidence:**

- Each destination appears once; links open correctly; role access unchanged; recheck staging screenshot.

<a id="kp-167"></a>

#### KP-167 — Align payroll period summary with the current default rule

**Action:** Implement required outcome. **Source:** TODO; P3. [KP-167](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-167>) documents the evidence.

**Existing behavior / gap:** The hardcoded 26th-to-25th description conflicts with the current first-to-last-day status in the same staging card.

**Target and implementation steps:**

- Derive the summary from the effective system/custom rule, or use neutral copy. Do not change payroll policy.

**Acceptance and evidence:**

- No override/system default; custom rule; save/reload; overview/detail agreement.

<a id="wp25"></a>

### WP25 — Compact trip, dispatch and CUS layouts

Owner: **Frontend + design + QA**. Stage **3**. Design: [section 12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-12>). Integration dependencies: WP07, WP08.

<a id="kp-008"></a>

#### KP-008 — Responsive dispatcher table and interaction density

**Action:** Verify existing implementation. **Source:** QA_PASSED; Not stated. [KP-008](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-008>) documents the evidence.

**Existing behavior / gap:** Historical 1600/1280/820 screenshots and 36/36 test log are absent.

**Target and implementation steps:**

- Keep the table/rail/card progression; verify actual content-container widths around 900px and viewport widths around 1440px.
- Exercise entry, resize, manual sidebar reopen and route changes with long operational values; fix only observed overflow or lost actions.

**Acceptance and evidence:**

- Boundary cases at 899/900/901 container pixels and 1439/1440 viewport pixels.
- Settled screenshots and keyboard navigation at phone/tablet/desktop.

<a id="kp-039"></a>

#### KP-039 — Improve readability of secondary dispatch information

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-039](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-039>) documents the evidence.

**Existing behavior / gap:** Historical white-background computed contrast is not a complete current background/state matrix.

**Target and implementation steps:**

- Measure computed foreground/background contrast in normal, hover, selected, highlighted and error states.
- Use a shared contrast-safe operational token and adjust backgrounds or foregrounds only where measured contrast fails.
- Keep compact sizes while preserving readable weight/line height; retain a distinct disabled-control treatment.

**Acceptance and evidence:**

- Computed contrast matrix at desktop/card layouts and visual readability checks.
- Regression for missing/empty versus active data styling.

<a id="kp-040"></a>

#### KP-040 — Compact dispatcher phone cards and keep container codes readable

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-040](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-040>) documents the evidence.

**Existing behavior / gap:** No current settled360/390/430 captures or action checks.

**Target and implementation steps:**

- Verify all three requested phone widths with short codes and very long names/notes.
- Exercise every retained row action and detail disclosure; inspect final bottom/side clearance.
- Check the same fixture in tablet/desktop layouts to avoid fixing phone through a global size reduction.

**Acceptance and evidence:**

- 360/390/430 record geometry, long-content wrapping and actions.
- Desktop/tablet comparison and keyboard/touch access.

<a id="kp-044"></a>

#### KP-044 — Keep customer service rows compact with concise missing data summaries

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-044](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-044>) documents the evidence.

**Existing behavior / gap:** No current dense table, expanded list, keyboard or touch verification.

**Target and implementation steps:**

- Verify count matches the complete missing-field list, including multiple fields owned by one editor.
- Exercise each enabled editor jump and focus return; show a useful read-only explanation for genuinely locked data.
- Align declaration guidance with the direct online workflow, removing obsolete internal approval routing if present downstream.

**Acceptance and evidence:**

- Multiple missing fields, read-only destinations, declaration case and count consistency.
- Keyboard/touch disclosure, editor jump and focus return in dense rows.

<a id="kp-078"></a>

#### KP-078 — 20260914_P2_QA-034_bug-prevent-the-fixed-status-column-from-overlapping-trip-table-data

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-078](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-078>) documents the evidence.

**Existing behavior / gap:** No current all-offset browser render check.

**Target and implementation steps:**

- Retain source identity but rebuild this artifact as valid DOCX before relying on Word/Kanban tooling.
- Verify horizontal scroll at zero, intermediate and maximum offsets states and responsive cards on current build.

**Acceptance and evidence:**

- 1440/834/390px at initial, intermediate and maximum horizontal scroll; status/revenue text does not overlap; sticky hover/background behavior; keyboard scrolling.

<a id="kp-120"></a>

#### KP-120 — Restore contrast for the expected profit label in trip creation

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-120](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-120>) documents the evidence.

**Existing behavior / gap:** The hard-coded light label color was removed in favor of the summary theme, and profit sign presentation is explicit. Current color contrast in the production palette and all result states is not proven.

**Target and implementation steps:**

- Verify the label and amount in their actual rendered background states.
- Keep expected versus saved semantics clear and preserve negative sign visibility.

**Acceptance and evidence:**

- Positive, zero and negative profit at phone/tablet/desktop; focus/zoom and contrast check against the active palette.

<a id="kp-128"></a>

#### KP-128 — Keep tablet multi container entry compact

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-128](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-128>) documents the evidence.

**Existing behavior / gap:** Current shipment container entry uses compact responsive rows and a two-column card fallback. The modest historical height measurement does not establish a material current density improvement or the full interaction requirements.

**Target and implementation steps:**

- Measure the current end-to-end multi-container form and remove redundant spacing while preserving readable labels and tap targets.
- Reuse compact aligned fields rather than nesting more cards.

**Acceptance and evidence:**

- Two and many containers at 768/834/1440/390; long data, field errors, add/remove, route/date pickers and save readiness.

<a id="kp-134"></a>

#### KP-134 — App-wide density acceptance beyond one grid

**Action:** Finish gaps and verify. **Source:** QA_PASSED; Not stated. [KP-134](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-134>) documents the evidence.

**Existing behavior / gap:** The implementation compacted the detailed dispatch grid below 900px. This is a meaningful scoped change, but the broad request about wasted space throughout the data-intensive UI was not completed by a single grid adjustment.

**Target and implementation steps:**

- Close the scoped dispatch grid only after comparing current row density, long data and controls.
- Maintain a per-template density checklist for the remaining app surfaces and fold existing density tickets into those work packages.

**Acceptance and evidence:**

- Detailed plan at 390/820/1280/1600 with expanded data, long identifiers, labels, keyboard and touch; verify no clipping or per-character codes.

<a id="kp-168"></a>

#### KP-168 — Make the mobile trip list show records sooner

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-168](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-168>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Replace repeated status charts/chips with one compact filter strip; show the first complete phone record before the middle of the viewport.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-169"></a>

#### KP-169 — Match container helper text to the trip creation action

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-169](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-169>) documents the evidence.

**Existing behavior / gap:** The creation-helper mismatch remains an open historical report. The shared create/edit mode text must be verified.

**Target and implementation steps:**

- Pass the form mode/action label to the concise helper, or use accurate mode-neutral copy.

**Acceptance and evidence:**

- Create “Tạo lệnh” and edit “Lưu cập nhật” labels; container persistence unchanged at all widths.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-180"></a>

#### KP-180 — Show CUS shipment records sooner with compact filters

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-180](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-180>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Use one compact filter surface with primary search; place secondary filters in a disclosure that retains active criteria and date meanings.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-186"></a>

#### KP-186 — Keep empty ancillary services below core trip information

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-186](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-186>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Place core facts before optional services; show empty services as a compact row; retain populated-service actions and the existing phone order.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-189"></a>

#### KP-189 — Prioritize required trip fields with compact estimate and progress summaries

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-189](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-189>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Place required fields first on desktop/tablet; keep estimate/progress adjacent or collapsible, preserving the existing phone order.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="wp26"></a>

### WP26 — Compact accounting, financial and OPS workspaces

Owner: **Frontend + design + QA**. Stage **3**. Design: [section 12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-12>). Integration dependencies: WP15, WP16, WP17, WP18.

<a id="kp-079"></a>

#### KP-079 — Distinguish zero revenue from no completed trips

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-079](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-079>) documents the evidence.

**Existing behavior / gap:** Current rendered zero/missing-value fixture and filter/drilldown agreement not executed.

**Target and implementation steps:**

- Run scoped zero/empty/populated scenarios and confirm text follows counts, not nonzero chart buckets.

**Acceptance and evidence:**

- Seven completed trips with zero revenue versus no trips; monthly/yearly switch; explanation for genuinely missing data; totals and drilldown agree at three sizes.

<a id="kp-081"></a>

#### KP-081 — Show payable ledger entries on desktop

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-081](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-081>) documents the evidence.

**Existing behavior / gap:** Current desktop rows, all types and state/filter reconciliation not visually or interactively checked.

**Target and implementation steps:**

- Rerun table/card comparison on one populated supplier covering expense/payment/adjustment.
- Capture DOM structure and visible balances plus empty/error/loading states.

**Acceptance and evidence:**

- At 1440px, tbody contains tr rather than li; every entry type; month filter, count and balance; phone/tablet cards; no lost metadata.

<a id="kp-116"></a>

#### KP-116 — Keep financial summary labels and amounts separate at narrow widths

**Action:** Finish gaps and verify. **Source:** QA_PASSED; P2. [KP-116](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-116>) documents the evidence.

**Existing behavior / gap:** Phone summary rules exist, but the six-item accounting SummaryRail remains one flex row at 834px: wrapping begins only at 700px. The ticket explicitly includes tablet overflow, so the claimed cross-route completion is not supported.

**Target and implementation steps:**

- Make the summary respond to available container width and metric minimum width, including 834px.
- Use compact wrapping or stacked label/value groups without collisions or truncated monetary values.

**Acceptance and evidence:**

- Expenses, salary, debt, finance and accounting overview at 390/834/1440 with long labels, large totals and zoom.

<a id="kp-117"></a>

#### KP-117 — Prevent statement toolbar actions from overlapping on tablets

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-117](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-117>) documents the evidence.

**Existing behavior / gap:** The statement toolbar wraps controls below 880px and preserves touch-height actions. Current actual button geometry and action behavior at tablet width are not proven by the DEV-completed note.

**Target and implementation steps:**

- Verify the existing wrapping implementation with the longest labels and real selected statement.
- Retain data-entry width and reachable generate/cancel actions without collision.

**Acceptance and evidence:**

- 834px/768px tablet plus 390/1440; keyboard order, long labels, enabled/loading/error actions.

<a id="kp-173"></a>

#### KP-173 — Align and compact the expense entry form

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-173](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-173>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Align label/control baselines and the effective-date pair; size the receipt area to its content and reduce scrolling through required fields.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-177"></a>

#### KP-177 — Prioritize supplier debt lookup on the payables page

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-177](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-177>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Prioritize supplier balance, search and records; place fuel invoices in a secondary tab/disclosure and show one empty-state message.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-178"></a>

#### KP-178 — Align profit metrics for compact customer comparison

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-178](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-178>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Use shared financial column headings at wide widths and compact labelled rows on narrow screens; preserve source links and signs.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-179"></a>

#### KP-179 — Distinguish adjacent currency labels on financial chart axes

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-179](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-179>) documents the evidence.

**Existing behavior / gap:** The historical chart shows duplicate adjacent currency labels. Current raw tick values were not exercised in this pass.

**Target and implementation steps:**

- Choose tick intervals and precision together so distinct tick values format distinctly; retain exact tooltip values.

**Acceptance and evidence:**

- Zero, small, million-scale and large values; negative values if supported; day/month at all widths; no data changes.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-182"></a>

#### KP-182 — Show nonempty accounting queues before large empty sections

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-182](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-182>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Show nonempty work queues first and concise empty buckets; preserve stable focus, counts and meaningful data blockers.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-183"></a>

#### KP-183 — Prioritize account ledgers with compact debt summaries

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-183](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-183>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Use compact identity, balance and risk summaries with an aging disclosure; put ledger filters in the first viewport and share the pattern with PayableDetailPage.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-184"></a>

#### KP-184 — Make Ops work queue records easier to scan

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-184](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-184>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Show identity, vehicle, blocker and next action once; keep milestones compact and preserve the desktop comparison table.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="wp27"></a>

### WP27 — Compact directories, fleet and customer interactions

Owner: **Frontend + design + QA**. Stage **3**. Design: [section 12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md#design-12>). Integration dependencies: WP08, WP24.

<a id="kp-055"></a>

#### KP-055 — Correct the Vietnamese towing capacity label in truck editing

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-055](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-055>) documents the evidence.

**Existing behavior / gap:** Actual shared create/edit screen and value preservation not rerun.

**Target and implementation steps:**

- Run the shared form label regression and visually check create/edit without changing the value.

**Acceptance and evidence:**

- Create/edit label, tonnage unit, validation and preservation of the existing value.

<a id="kp-085"></a>

#### KP-085 — Align customer shipment status across list and details

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-085](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-085>) documents the evidence.

**Existing behavior / gap:** The current portal list/detail comparison for assigned, in-transit, reported and completed states has not been run.

**Target and implementation steps:**

- Verify label mapping with actual scoped fixtures and retain neutral processing bucket.
- Remove any internal evidence-approval prerequisite under final direction without implying GPS/physical movement from assignment.

**Acceptance and evidence:**

- Assigned but not departed; IN_TRANSIT; driver-reported delivery; customer acknowledgement; list/detail history and counters at three sizes.

<a id="kp-088"></a>

#### KP-088 — Reconcile fleet trailer totals with listed trailers

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-088](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-088>) documents the evidence.

**Existing behavior / gap:** Current create/edit/delete flows for new and legacy trailers, persisted readback, and loading/error UI have not been rerun.

**Target and implementation steps:**

- Retest that total trailers equal known 40FT plus known 20FT plus unknown types, using legacy and new fixtures on the current build.
- Keep unknown truthful; do not infer stored type from a separate truck fallback.

**Acceptance and evidence:**

- Legacy scenario with summary 0 versus 39 listed trailers, and new-record scenario with summary 1 versus 40 listed; unknown/null/unexpected types; type edit/readback; all three widths; loading/error does not appear as a real zero.

<a id="kp-089"></a>

#### KP-089 — Provide the trailer selector promised by the fleet assignment flow

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-089](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-089>) documents the evidence.

**Existing behavior / gap:** Current real selector selection/save/readback and simultaneous-edit conflict handling not executed.

**Target and implementation steps:**

- Run assignment/transfer/clear through both truck editor entry points and inspect both source/destination displays.
- Ensure existing coupling notice makes transfer effect explicit; use common transactional locking.

**Acceptance and evidence:**

- Search by plate/type; assign an unassigned trailer; transfer from another truck; clear; stale/concurrent edits; reload both sides; inactive options; keyboard use at three sizes.

<a id="kp-118"></a>

#### KP-118 — Make the customer delivery confirmation button visible

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-118](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-118>) documents the evidence.

**Existing behavior / gap:** Customer confirmation uses the shared brand button colors rather than transparent or invisible styling. The previous attempt with the wrong role cannot establish current Customer UI completion.

**Target and implementation steps:**

- Retest as a scoped CUSTOMER on an eligible shipment.
- Keep customer delivery acknowledgement; it is an external business action, not internal approval.

**Acceptance and evidence:**

- Visible default/hover/focus/busy/disabled states at 390/834/1440; explicit online success and failure with scoped permissions.

<a id="kp-119"></a>

#### KP-119 — Keep the customer discrepancy form within the visible row

**Action:** Verify existing implementation. **Source:** QA_PASSED; P2. [KP-119](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-119>) documents the evidence.

**Existing behavior / gap:** The discrepancy form now occupies a full expanded table row with a spanning cell rather than the narrow action column. Current clipping, mobile layout and preserved-draft behavior need real layout verification.

**Target and implementation steps:**

- Verify the expanded-row implementation at all three widths and with a long typed discrepancy.
- Keep source-record context and explicit save/cancel; preserve the draft on validation/conflict.

**Acceptance and evidence:**

- Desktop clipping boundary, tablet reflow, phone touch/soft keyboard, keyboard focus, empty/long reason and failed-save recovery.

<a id="kp-126"></a>

#### KP-126 — Preserve the customer shipment queue when returning from details

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-126](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-126>) documents the evidence.

**Existing behavior / gap:** Queue tab/page/row are encoded in navigation and echoed by the detail return link. The list consumes return context and restores focus; current browser position and stale-row recovery are not verified.

**Target and implementation steps:**

- Verify URL-based context restoration without adding offline state or leaking another scope.
- Define a safe fallback when the originating row is no longer in the page.

**Acceptance and evidence:**

- Open from later page/filter, return, browser back, direct detail link, row moved/removed and account scope change.

<a id="kp-127"></a>

#### KP-127 — Make customer shipment cards easier to scan on phones

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-127](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-127>) documents the evidence.

**Existing behavior / gap:** Customer-only irrelevant milestone columns and empty mobile fields are suppressed, while relevant record data remains. The document does not supply current height/readability evidence for realistic dense and blocked cards.

**Target and implementation steps:**

- Verify the compact card information hierarchy with realistic fixtures and keep the primary customer action visible.
- Preserve full details in deliberate expansion rather than blank rows or nested cards.

**Acceptance and evidence:**

- 390px cards with missing and complete fields, long identifiers, multiple blockers, large text and linked detail access.

<a id="kp-129"></a>

#### KP-129 — Keep vehicle card actions compact and readable on phones

**Action:** Verify existing implementation. **Source:** QA_PASSED; P3. [KP-129](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-129>) documents the evidence.

**Existing behavior / gap:** Catalog CSS now makes the action row span the mobile card and wrap whole labels rather than individual characters. Current longest-label and permission-state layouts still need visual confirmation.

**Target and implementation steps:**

- Verify real role-dependent actions remain compact and fully readable with sufficient touch targets.

**Acceptance and evidence:**

- 390px vehicle cards, long labels, permission-reduced actions, busy state, keyboard and detail opening without accidental row activation.

<a id="kp-174"></a>

#### KP-174 — Make customer and factory directories easier to scan

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-174](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-174>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Use compact customer/factory summaries, unbroken identifiers and secondary details on demand; include secondary directories in regression coverage.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-175"></a>

#### KP-175 — Use space efficiently in the customer dialog

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-175](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-175>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Use 12–16px phone surface insets; give long fields the full width; pair short fields only when they fit; keep the footer compact.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-176"></a>

#### KP-176 — Keep template column properties close to selection

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-176](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-176>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Selecting a column should immediately expose adjacent or inline properties; retain selected identity and draft order.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-181"></a>

#### KP-181 — Keep the driver creation footer compact on phones

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-181](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-181>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Separate the required-field hint from the phone action row; provide 44px touch targets without stretching buttons to 75px height.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-185"></a>

#### KP-185 — Keep the company profile editor and save action together

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-185](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-185>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Place Save beside editable fields. Offer an optional explicit saved-versus-draft comparison instead of a permanent duplicate profile.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-187"></a>

#### KP-187 — Keep fleet trailer identifiers intact at tablet widths

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-187](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-187>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Wrap between whole trailer plate/type tokens; avoid nested badge padding and character-by-character breaks.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

<a id="kp-188"></a>

#### KP-188 — Make fleet summary breakdowns readable on phones

**Action:** Remeasure before modifying. **Source:** TODO; P3. [KP-188](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md#kp-188>) documents the evidence.

**Existing behavior / gap:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target and implementation steps:**

- Keep each count/category pair together when wrapping; preserve the unknown category and compact vehicle list.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Acceptance and evidence:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

First reproduce at the named viewport and fixture. If already resolved, attach current screenshots and record verification-only closure; do not make a cosmetic change merely to match the old report.

## Release completion checklist

- [ ] Source, frontend build, backend build and schema version are identified and aligned for the tested deployment.
- [ ] Every KP record has a current evidence verdict or an explicit, linked supersession/duplicate disposition.
- [ ] Each reopened partial/absent behavior passes its specific source criteria; umbrella records KP-018, KP-041 and KP-134 do not close on one component or one happy path.
- [ ] Approval removal is complete in menus, forms, routes, state gates, posting and legacy records, without weakening permissions or creating artificial approved actors.
- [ ] Fresh and upgraded profiles, installed clients and multiple tabs cannot drain legacy business queues; reconnect performs no automatic mutation.
- [ ] Financial totals, allocations, attendance and migrations reconcile with stored state; unknown outcomes and concurrent writes cannot duplicate effects.
- [ ] Relevant role/device/keyboard/error flows pass against the deployed build. Physical capture and any 24-hour requirement use actual evidence.
- [ ] Engineer and independent QA evidence identify the same commit/fixtures; missing logs or unverifiable claims remain open.

No repository status is moved by this planning delivery. Engineer implementation and independent validation are the next execution stage.
