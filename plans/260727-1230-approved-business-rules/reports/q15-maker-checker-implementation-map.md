# Q15 maker/checker implementation map

**Date:** 2026-07-27  
**Mode:** read-only implementation scout  
**Verdict:** Q15 remains **PARTIAL**  
**Authority:** accepted Q15 in `docs/prd/business-logic-qa-proposals.md`  
**Plan:** `phase-02-shared-governance-and-concurrency.md`  
**Related inventory:** `reports/q23-material-write-inventory.md`

## Scope and boundary

Q15 requires three distinct actors for money, price, debt, exceptions,
period-close and adjustment decisions:

1. the **maker** creates the proposal or editable draft;
2. a different **checker** verifies the facts, source version and evidence;
3. a third **approver** makes the final decision;
4. a **viewer** may read an authorized subject but cannot create, change, check,
   approve, reject, cancel or reopen it.

The creator cannot approve. The checker must differ from both the creator and
the approver. Coarse ADMIN/MANAGER/ACCOUNTANT route access is not proof of
actor separation.

This scout covers 20 material-write classes:

- 54 named money, debt, approval, adjustment, close and financially material
  trip/document endpoints;
- 45 financial-authority configuration mutations:
  - 39 generated create/update/delete endpoints across 13 relevant resources;
  - two singleton road/fuel configuration writes;
  - four salary-period definition writes.

The count excludes read-only reports/previews, evidence uploads, ordinary
shipment progress and customer debit-note responses that do not grant internal
financial approval authority.

No source, test, migration, HANDOFF or deployment change is part of this
report.

## Executive finding

The current code has three useful anchors but no universal Q15 control:

1. `governance_actions` implements a real
   `PENDING_CHECK → PENDING_APPROVAL → APPROVED` workflow for trip AR
   adjustments and exceptional trip reopen, with distinct actor IDs, reason,
   source/action versions, snapshots and transactional application.
2. advance settlements persist a forwarder maker, accountant checker and
   distinct approver; settlement corrections also prevent the correction maker
   from checking or approving.
3. advance requests, trip expenses and debt offsets block creator
   self-approval, but have no independent checker stage.

Everything else is either role-gated direct application or a domain-specific
status change. Direct payments, payouts, commissions, penalties, company
expenses, price/config changes, billing-document AR changes, salary
confirmation/close, profit distribution and several exception decisions can be
created and finalized by one authenticated actor.

The smallest safe design is to extend the existing Q18 governance envelope and
actor policy. Do not create a second workflow engine, and do not force mature
domain-native workflows such as advance settlements to duplicate their state
inside `governance_actions`.

## Current authorization reality

### Coarse role gates

`backend/src/casbin/policy.csv` currently grants:

- MANAGER: trip/config/financial/salary read and write, plus delete on trip,
  config and financial resources;
- ACCOUNTANT: trip/config/financial/salary read and write, plus config and
  financial delete;
- ADMIN: broad access through the administrator policy;
- DRIVER: salary read only;
- CUSTOMER: scoped portal routes, not the internal financial resource.

This protects viewers such as DRIVER/CUSTOMER from the internal write routes,
but it does not distinguish maker, checker and approver among office users.

The frontend makes several price pages ADMIN-only
(`frontend/src/App.tsx:210-217,224`), while the backend config resource permits
MANAGER and ACCOUNTANT writes. UI hiding is therefore not an authorization
boundary and must not be treated as Q15 enforcement.

### Existing stage-specific role gates

- advance request approval/rejection: ADMIN or MANAGER;
- advance settlement check/approve/reject: ADMIN or ACCOUNTANT;
- debt-offset approval/cancel: ADMIN or MANAGER;
- trip-expense approval/rejection: ADMIN, MANAGER or ACCOUNTANT;
- Q18 action check/approve: ADMIN, MANAGER or ACCOUNTANT, with TRIP_REOPEN
  narrowed to ADMIN/MANAGER in the service;
- salary close: any financial role; salary reopen: ADMIN/MANAGER;
- profit distribution: ADMIN/MANAGER;
- penalty cancellation: ADMIN/MANAGER.

These stage role lists are useful inputs to a policy catalog, but only Q18 and
advance settlements also prove three distinct people.

## Material-write control matrix

Legend:

- **M** maker is authoritative and persisted;
- **C** checker is authoritative and persisted;
- **A** approver is authoritative and persisted;
- **V** viewer/read boundary exists;
- **Direct** means the same call applies the money/price/status effect.

| # | Surface and reachable writes | Current M/C/A/V control | Exact Q15 gap |
|---|---|---|---|
| 1 | Trip AR adjustment and reopen: `POST /api/adjustments`, `POST /api/trips/:id/adjustment`, `POST /api/trips/:id/unlock`, `POST /api/governance-actions/:id/check`, `POST /api/governance-actions/:id/approve` | **M/C/A/V complete for the two action kinds.** `governance_actions` stores maker/checker/approver, snapshots, versions and application effect. Service rejects maker-as-checker and maker/checker-as-approver. | `REJECTED` is allowed by the table but there is no reject service/route; no queue/detail route; policy and action kinds are hard-coded to two TRIP cases. |
| 2 | Customer receipt: `POST /api/payments/receive` | Q03 persists `payment_receipts.created_by` and atomically applies receipt/allocation/ledger effects. **M only; Direct.** Financial resource gate supplies V. | No checker/approver or pending status. Receipt creation and application are one actor/call. |
| 3 | Vendor payment, carrier payment, driver payout: `POST /api/payments/vendor`, `/payments/carrier`, `/drivers/:driverId/payouts` | Financial role gate; balance/entity locks; append-only ledger. **No M/C/A columns; Direct.** | Inputs do not carry actor ID into the service, and no command/proposal row exists before the ledger effect. `confirmOverpay` lets the same maker authorize an exception. |
| 4 | Manual commission: `POST /api/commissions` | ADMIN/MANAGER/ACCOUNTANT; one ledger append. **No M/C/A; Direct.** | No persisted command identity, creator, checker, approver, reasoned decision or status. |
| 5 | Penalty create/cancel: `POST /api/penalties`, `POST /api/penalties/:id/cancel` | Create is any financial writer; cancel is ADMIN/MANAGER; cancel is now first-winner safe. **No persisted M/C/A; Direct.** | `penalties` has amount/status but no `createdBy`, checker, approver, cancellation actor/reason or version. Creation and reversal each apply immediately. |
| 6 | Debt offsets: create/approve/cancel under `/api/finance/debt-offsets` | `createdBy` and `approvedBy`; row/entity locks; creator self-approval rejected. **M/A only.** | No checker, expected version, rejection actor/reason or reject route. Cancel is a new financial adjustment but has no maker/checker/approver workflow and does not persist cancel actor/reason. |
| 7 | Forwarder advance request: `POST /api/forwarder/me/advance-requests`, approve/reject routes | `requesterId` and `approvedBy`; requester self-approval rejected; first transition wins. **M/A only.** | No checker. Rejection reuses approval columns and does not distinguish rejector semantics. No version or reasoned reject state. |
| 8 | Advance settlement create/update/correction/check/approve/reject | Forwarder is M, `checkedBy` is C, `approvedBy` is A; all three must differ. Correction `adjustedBy` cannot check/approve; check is invalidated by later edits. **Strong domain-native M/C/A/V.** | No expected settlement version; rejection reuses approval fields; ordinary update can be made by the eventual checker before a fresh check, and stage policy remains embedded in `advance.service.ts` rather than reusable. |
| 9 | Office trip expense create/update/delete/approve/reject | Create persists `trip_expenses.createdBy`; approval rejects unknown maker and maker self-approval; approved rows reject direct rewrite. **M/A only.** | No checker stage or persisted checker/approver fields. Approval identity is reconstructed from audit logs in reporting, not authoritative on the expense. No version. |
| 10 | Forwarder expense create/update/delete, later settlement submission | Forwarder identity is persisted and settlement approval supplies downstream C/A. Draft edits are scope/lock guarded. **M draft plus settlement-level C/A.** | An unlinked expense is not yet governed; corrections outside the settlement envelope need an explicit rule. Do not duplicate governance for draft edits that cannot post independently. |
| 11 | Company expense create/update/delete: `/api/expenses` | `expenses.createdBy` on create; any finance writer can update/delete; unpaid writes reverse/repost vendor ledger in the same call. **M only; Direct.** | No status, checker, approver, version, adjustment history or delete actor/reason. `_userId` is unused on update/delete. |
| 12 | Trip create/copy, financial figures, complete/lock/cancel: `POST /api/trips`, `/:id/copy`, `/bulk-figures`, `PUT /:id/pre-departure|actuals`, `POST /:id/complete|lock|cancel` | Trip stores creator/version and override actor/reason; updates row-lock and conditionally increment version. Lifecycle transitions have first-winner controls. **M only for monetary changes; Direct.** | Revenue, salary, commission, toll, fuel, road allowance, external freight and override changes have no checker/approver. Completing/locking/canceling can post or reverse ledger effects without three actors. |
| 13 | Billing/debit-note save/update/delete plus customer confirm/dispute | Document stores creator and lifecycle status; DRAFT/period/source locks prevent unsafe overwrite; customer response is customer-scoped first-winner. **M only internally; Direct AR delta.** | DRAFT save/update currently calls `postDebitNoteDelta`, so a maker changes AR before internal check/approval. No document version/checker/approver/rejection fields. There is no internal issue/approve route even though the lifecycle supports SENT/PENDING_CONFIRM. |
| 14 | Salary workdays, confirm/unconfirm: `PUT /api/salary/:driver/:year/:month/workdays`, `POST .../confirm|unconfirm` | Finance roles write; confirmation stores only `confirmedBy`. Unconfirm deletes the confirmation row. **A-like confirmer only; Direct.** | Workday maker is not tied to a submitted snapshot; no checker; confirmer may be the workday editor; unconfirm erases actor/history instead of creating an approved adjustment. No version. |
| 15 | Salary period close/reopen: `POST /api/salary-periods/:period/close|reopen` | Per-period lock, append-only ledger reversal and `closedBy`; `period_locks` stores closed/reopened actors. **Single actor; Direct.** | No proposal maker/checker/approver, source snapshot/version, reject path or distinct reopen approval. `salary_period_closes` lacks reopened actor/time and overwrites the latest ledger reference. |
| 16 | Profit distribution: `POST /api/reports/distribute-profit` | ADMIN/MANAGER; quarter advisory lock; one atomic distribution. **No M/C/A; Direct.** | Preview is not a persisted proposal. Distribution rows have no command header, maker, checker, approver, decision status or reason. |
| 17 | Price/rate CRUD: pricing tables, road allowances, fuel norms, weight tiers and lift pricing (15 generated mutations) | Config write/delete roles; some rows have `createdBy`; natural indexes. **Direct price authority.** | No proposal/check/approve stage, version or actor history. `pricing_tables` and `road_allowances` do not even store creator. Generic CRUD cannot apply field-aware Q15 policy safely. |
| 18 | Financial-policy/config writes: customers when payment-term fields change, forwarder expense types, expense categories, penalty reasons, management fees, cap table, truck cap, road config, fuel config, salary-period definitions | Config role gate; frontend hides several pages from non-ADMIN. **Direct policy authority.** | No persisted before/after decision, source version, checker or approver. These writes change future price, expense eligibility, debt dates, salary windows or profit allocation. Frontend ADMIN-only does not narrow the API. |
| 19 | Ancillary revenue/refunds: generated create/update/delete under `/api/ancillary-revenue` | Creator is stored; negative amount requires a note. **M only; Direct money.** | A note is not approval. Refund/create/update/delete have no checker, approver, version or immutable reversal history. |
| 20 | Exceptions: overpay confirmation, auto-price/revenue override, fuel supplement/actual price, road-allowance override, no-invoice approval and fuel-reconciliation explanation | Reasons/actor exist on selected rows; no-invoice amount tier gates ACCOUNTANT versus MANAGER/ADMIN; missing evidence blocks. | Exception maker can still be final approver on several paths. `confirmOverpay` is caller boolean only. Fuel explanation upserts overwrite prior text and has no mounted mutation route. No reusable exception status/decision record; unknown no-invoice category currently fails open. |

## Exact persistence gaps

### Existing `governance_actions`

Current columns are a good base:

- subject/action/status;
- reason;
- original source version and optional period lock;
- before/after/delta snapshots;
- maker/checker/approver IDs and timestamps;
- application/ledger reference;
- action version.

Required additive changes:

1. widen `subject_type` and `action_kind` checks beyond TRIP and the two Q18
   actions;
2. add a nullable stable `subject_key` for proposed creates that do not yet
   have a domain row; relax `subject_id` to nullable with a check requiring
   `subject_id` or `subject_key`;
3. add role snapshots:
   `maker_role`, `checker_role`, `approver_role`;
4. add explicit rejection/return/cancel fields:
   `rejected_by`, `rejected_role`, `rejected_at`, `rejection_reason`,
   `returned_by`, `returned_at`, `return_reason`,
   `canceled_by`, `canceled_at`, `cancel_reason`;
5. add statuses `RETURNED_FOR_EVIDENCE`, `CANCELED` and `SUPERSEDED`;
6. add database checks enforcing non-empty reasons and pairwise-distinct
   non-null actor IDs;
7. add a partial unique active-action key over the logical subject/action/source
   version so duplicate pending proposals cannot coexist;
8. add an application result/effect reference compatible with Q23's material
   command result. Do not invent a second replay-result model if Q23 lands it
   first.

Historical actor roles must remain null unless authoritative evidence exists.
Do not backfill a user's current role as their historical decision role.

### Domain tables missing authoritative actors/state

- `trip_expenses`: creator exists; missing checker, approver, decision timestamps,
  rejection fields and version.
- `debt_offsets`: creator/approver exist; missing checker, reject/cancel actors
  and reasons, version.
- `advance_requests`: requester/approver exist; missing checker and separate
  reject fields.
- `advance_settlements`: full M/C/A exists; missing version and separate reject
  fields.
- `penalties`: missing creator, checker, approver, cancellation actor/reason and
  version.
- `expenses`: creator exists; missing workflow status/version/checker/approver
  and immutable correction/reversal identity.
- `billing_documents`: creator/lifecycle exist; missing version, internal
  checker/approver, reject/cancel decision actors and approved amount/source
  snapshot authority.
- `salary_confirmations`: only confirmer; missing maker/checker/approver,
  source snapshot/version and immutable reopen history.
- `salary_period_closes`: only closer; missing proposal/check/approve/reopen
  actors, source version and immutable close/reopen events.
- `distributions`: no command header or actor authority.
- `pricing_tables`, `road_allowances`, singleton road/fuel config and several
  policy tables: no source version or complete actor history.
- `payment_receipts`: creator exists but no pending/check/approve state.
- ledger-only vendor/carrier/payout/commission commands: no domain header row
  exists before effect application.

Domain rows do not all need duplicate actor columns if `governance_actions`
is their authoritative approval envelope. Mature domain-native state
(especially advance settlements) should retain its existing columns and use
the same policy functions.

## Exact missing service and route contracts

### Shared service contracts

Add a typed governance policy catalog, for example:

```text
actionKind
subjectType
makerRoles
checkerRoles
standardApproverRoles
directorApproverRoles
amountThreshold
requiresReason
requiresEvidence
requiresExpectedVersion
applyAdapter
```

The service, not the UI or route, must enforce:

- actor is allowed for the stage;
- maker, checker and approver are pairwise distinct;
- action status and expected version are current under `FOR UPDATE`;
- missing evidence returns the action for supplementation rather than routing
  it directly to approval;
- final approval applies the domain effect and marks the action approved in
  one transaction;
- application failure rolls back both the effect and final decision;
- viewer access returns no allowed mutation action.

Use capability meanings rather than job-title strings:

- `FINANCE_CHECK`;
- `FINANCE_APPROVE_STANDARD`;
- `FINANCE_APPROVE_DIRECTOR`;
- `PRICE_APPROVE`;
- `PERIOD_CLOSE_APPROVE`.

Initial role mapping can preserve existing behavior:

- ACCOUNTANT/MANAGER/ADMIN may check when allowed and not the maker;
- standard approval may use the existing subject's final-role list;
- director-tier approval maps to MANAGER/ADMIN until a more specific director
  capability exists;
- price authority uses ADMIN as final approver, matching the current frontend
  boundary;
- viewer is any role with scoped read but no capability for the current stage.

Q14's 5,000,000 VND item and 10,000,000 VND daily thresholds belong in this
policy evaluation, not in route-local booleans.

### Routes

Add/reuse:

- `GET /api/governance-actions` — scoped inbox/history with server-computed
  `allowedActions`;
- `GET /api/governance-actions/:id`;
- existing `POST /:id/check`;
- existing `POST /:id/approve`;
- new `POST /:id/reject`;
- new `POST /:id/return-for-evidence`;
- new `POST /:id/cancel` only for an un-applied proposal.

Submission must remain domain-specific so source validation cannot be bypassed.
Do not add a generic endpoint that accepts arbitrary table names or effect
payloads.

Missing domain boundaries include:

- checker submission for trip expense, debt offset and advance request;
- governed cancellation/reversal requests for penalty and debt offset;
- internal debit-note submit/check/approve/issue flow;
- salary confirmation and period-close submit/check/approve/reopen flow;
- governed proposals for payment/payout/commission/profit commands;
- governed create/update/delete proposals for financial price/config resources;
- a mounted fuel-reconciliation explanation/decision route if that feature is
  intended to be operable.

## Reusable design

### 1. One envelope, domain-owned effects

Extend `governance_actions`; do not create a general-purpose workflow engine.
The envelope owns actor separation, status, source version, reasons, snapshots
and concurrency. Domain adapters continue to own:

- balance validation and ledger posting;
- price/config validation;
- trip calculations;
- billing source/period locks;
- salary readiness and close logic;
- reversal construction.

The approval transaction must lock in this order:

1. governance action row;
2. Q23 material-command/request-key authority when applicable;
3. domain authority/advisory locks in the domain's established sorted order;
4. source row(s) `FOR UPDATE`;
5. conditional source update/effects;
6. action approval/result.

This preserves Q18/Q23 lock ordering rather than wrapping a separately
committing domain service.

### 2. Keep domain-native settlement governance

Advance settlements already have authoritative M/C/A columns and correction
history. Extract reusable assertions such as:

```text
assertCanMake(policy, actor)
assertCanCheck(policy, makerIds, actor)
assertCanApprove(policy, makerIds, checkerId, actor, amount)
```

Use them in `advance.service.ts` and the envelope service. Do not create a
shadow `governance_actions` row for every existing settlement unless a later
audit requirement needs a unified inbox.

### 3. Draft versus applied money

Maker-owned drafts may remain directly editable only while they have no
external accounting effect:

- forwarder expense before settlement submission;
- billing document before issue, after moving AR posting out of DRAFT save;
- salary workdays before salary submission;
- price proposal before approval.

Any transition that posts/reverses ledger, changes an approved price, confirms
salary, closes/reopens a period, or changes locked data must consume an
approved action.

### 4. Viewer enforcement

Keep Casbin as the coarse resource/read boundary. Add stage-level service
authorization and return `allowedActions` from the server. Frontend buttons
consume `allowedActions`; they are not the authority.

Tests must prove that DRIVER, FORWARDER, CUSTOMER and any future office
read-only role:

- can see only scoped records;
- receive `403` on check/approve/reject/cancel/write calls;
- never receive an approval button on desktop or mobile;
- cannot bypass the UI through direct HTTP requests.

## Non-overlapping implementation tranches

The tranches are sequential and own distinct domain behavior. Shared files are
serialized by the controller; they are never edited concurrently.

### Tranche 1 — shared governance foundation

**Owns**

- additive governance schema/migration;
- shared action/status/request schemas and exports;
- governance policy catalog and pairwise actor assertions;
- refactor of `adjustment-governance.service.ts` onto the shared transition
  functions without changing Q18 behavior;
- governance inbox/detail/reject/return/cancel routes;
- generic policy/concurrency tests.

**Does not own**

- any new ledger, price, billing, salary or domain effect adapter;
- Q23 material-command persistence;
- Q22 source-version fields.

**Acceptance**

- current Q18 tests remain green;
- maker cannot check or approve;
- checker cannot approve;
- viewer cannot call any transition;
- reject/return/cancel are durable and reasoned;
- concurrent check/approve/reject has one winner;
- action/effect rollback is atomic;
- migration upgrade and fresh-chain proofs are green.

### Tranche 2 — normalize existing approval subjects

**Owns**

- trip-expense approval;
- debt-offset create/check/approve/reject and governed cancellation request;
- advance-request check/approve/reject;
- shared actor assertions in advance settlements and separate reject fields.

**Does not own**

- direct company expenses;
- payments/payouts/commissions/penalties;
- trip figures, billing, salary or config.

**Acceptance**

- every subject has three distinct actors;
- legacy unknown trip-expense makers fail closed;
- rejection never posts money;
- cancellation/reversal requires a new governed action;
- existing settlement correction-maker protections remain green.

### Tranche 3 — direct ledger and expense commands

**Owns**

- customer receipt submission/approval while preserving Q03 allocation and
  idempotency;
- vendor/carrier payments and driver payouts;
- commissions;
- penalty create/cancel;
- company expense create/material update/delete;
- profit distribution command header and actor workflow.

**Does not own**

- trip calculation changes;
- debit notes;
- salary/period close;
- price/config.

**Acceptance**

- submission writes no ledger effect;
- approval applies exactly once;
- overpay is a governed exception, not `confirmOverpay`;
- cancel/delete uses append-only reversal;
- Q23 same-key replay and approval races produce one effect.

### Tranche 4 — trip financial source and locked lifecycle

**Owns**

- trip revenue, salary, commission, toll, fuel, allowance and external-freight
  changes;
- revenue/fuel/road override proposals;
- financially material complete/lock/cancel transitions;
- unchanged ordinary progress/document behavior.

**Does not own**

- trip expenses from Tranche 2;
- billing-document application;
- price catalog authoring.

**Acceptance**

- non-financial operational fields remain direct where Q15 allows;
- financial deltas create a proposal and preserve the current trip version;
- approved application revalidates the source version and Q18 authority lock;
- locked data still uses adjustment/reopen, never in-place overwrite.

### Tranche 5 — billing, salary, period close and financial authority config

**Owns**

- DRAFT debit-note save without AR posting;
- internal debit-note submit/check/approve/issue and governed adjustment/cancel;
- salary submission/check/confirm and governed unconfirm;
- salary-period close/reopen proposal;
- price/rate and financial-policy config proposals;
- ancillary revenue/refund;
- salary-period definition governance.

This tranche must be executed as sub-slices with controller ownership of
`config.ts`; billing, salary and price adapters may be implemented independently
but not landed with concurrent edits to shared schema/journal/routes.

**Acceptance**

- no DRAFT debit note changes AR;
- issue/adjustment/close/reopen applies only after three distinct actors;
- price/config create/update/delete records before/after, reason and source
  version;
- frontend and direct API agree on allowed actions;
- viewer matrices pass at desktop, tablet and mobile widths.

### Tranche 6 — compatibility cutover and universal proof

**Owns**

- client migration from direct write endpoints to proposal endpoints;
- explicit deprecation/disablement of legacy direct-effect paths;
- unified work queue and stage-aware UI;
- table-driven backend, frontend and E2E coverage for every matrix row;
- documentation and operational rollout.

Q15 must not be marked complete while a legacy public route can still apply the
same material effect directly.

## Migration and compatibility plan

The live Drizzle journal currently ends at `0138_careful_shape`, which is the
Q03 payment-receipt migration. The next number is not owned by this report.
Q23 and Q22 also need shared schema/migration ownership.

Required sequence:

1. controller confirms the final journal and assigns the next migration;
2. Q23 material-command/result model lands first if it takes the next number;
3. Q15 foundation uses the next available additive migration;
4. Q22 source versions/provenance land before any Q15 adapter that depends on
   those versions;
5. later domain columns use subsequent migrations in tranche order.

Compatibility rules:

- do not edit historical migrations;
- preserve existing Q18 action rows and IDs;
- widen checks and add nullable columns before requiring new values;
- leave legacy role snapshots null rather than inventing history;
- retain existing read DTOs;
- add proposal endpoints and update the owning client before disabling the
  direct-effect route;
- if an endpoint must change response shape, version it or add a new
  `/requests` boundary; do not silently change an entity response into an
  action response;
- a temporary dual-path period is not Q15-complete and must be time-bounded;
- use Q23's command/result model for replay rather than duplicating it inside
  Q15.

## Test and proof matrix

Every governed action kind needs:

1. allowed maker submission;
2. unauthorized/viewer submission denied with no business write;
3. maker self-check denied;
4. maker self-approval denied;
5. checker-as-approver denied;
6. distinct M/C/A happy path;
7. missing reason/evidence returned without approval;
8. standard versus director-tier amount authority;
9. stale action version `409`;
10. stale subject version `409`;
11. concurrent check/reject: one winner;
12. concurrent approve/reject: one winner;
13. apply failure rolls back approval and effects;
14. replay uses Q23's original result and creates no duplicate ledger/history;
15. rejection/cancel/reopen preserves immutable history;
16. scoped viewer list/detail without mutation authority;
17. desktop/tablet/mobile actions match server `allowedActions`;
18. full financial/RBAC/schema QA including E2E.

Retain and extend:

- `q18-adjustment-governance.test.ts`;
- `forwarder-settlement-workflow.test.ts`;
- `m64-debt-offsets.test.ts`;
- `d1-concurrent-expense-approval.test.ts`;
- `m73-salary-period-close.test.ts`;
- `q21-period-authority.test.ts`;
- billing-document lock/lifecycle tests;
- Q23 race and replay suites.

## Risks and coordination

- **Migration collision:** Q15, Q22 and Q23 all touch `schema.ts` and the
  journal. Only one controller may own them at a time.
- **Double workflow:** duplicating advance-settlement state in an envelope can
  create conflicting authorities. Reuse policy assertions instead.
- **Premature approval:** a generic route that accepts arbitrary effect payloads
  would bypass domain validation. Submission remains domain-specific.
- **Ledger timing:** billing DRAFT currently posts AR. Its cutover requires a
  clear compatibility and reconciliation plan.
- **Role ambiguity:** existing roles approximate “chief accountant” and
  “director.” Capabilities must express authority; actor ID separation remains
  mandatory even when one role has multiple capabilities.
- **Viewer leakage:** frontend admin-only wrappers do not protect the API.
  Service/route denial must be independently tested.
- **Legacy rows:** unknown makers or missing source versions fail closed for
  approval; do not synthesize actors or versions from current state.
- **Partial rollout:** Q15 remains PARTIAL until direct public effect routes are
  disabled across the full matrix.

## Prioritized executable tranche

Start with **Tranche 1 — shared governance foundation**, after the controller
assigns migration ownership.

Concrete first implementation order:

1. add shared action/status/transition schemas and the capability policy
   catalog;
2. add the governance migration with role/reject/return/cancel fields,
   subject key support, expanded checks and active-action uniqueness;
3. extract pairwise actor, stage, role and version assertions from the current
   Q18 service;
4. keep domain application callbacks transaction-bound;
5. add inbox/detail/reject/return/cancel routes and server-computed
   `allowedActions`;
6. run Q18 compatibility plus new table-driven actor/concurrency tests;
7. obtain independent review before any direct money route is cut over.

This tranche is the dependency for every later Q15 domain slice and can land
without changing current payment, price, billing, salary or ledger behavior.

Status: DONE  
Summary: Q15 is partial across 20 material-write classes. Q18 and advance settlements provide reusable anchors; all direct money, price, close and exception effects are mapped to their current actors and exact missing state. The smallest design extends `governance_actions`, keeps domain-owned application logic and domain-native settlement state, and rolls out in six non-overlapping tranches.  
Concerns/Blockers: Schema/journal ownership must be coordinated with Q22/Q23 after current migration 0138. Q15 cannot be declared complete while legacy direct-effect routes remain reachable.
