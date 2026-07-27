# Phase 2 remaining gap map — Q15, Q17, Q18, Q21, Q22

**Date:** 2026-07-27  
**Scope:** read-only source audit of the accepted rules named above.  
**Authority:** `docs/prd/business-logic-qa-proposals.md`; implementation intent
in `phase-02-shared-governance-and-concurrency.md`; current code and tests are
evidence of what is implemented, not authority for changing the accepted rule.

## Executive finding

The reusable foundations are uneven:

- optimistic row locking, first-approve-wins and failed-mutation auditing exist
  on selected paths;
- debit notes and trips have useful locked-state guards;
- salary has a company-wide close record;
- shipment documents already support append-only replacement in the service.

Those anchors do **not** yet close the five rules:

- Q15 actor separation is domain-local and cannot be proved for every material
  write;
- Q17 has role-level CLERK access but no unit/customer/shipment assignment
  scope, and the post-dispatch edit boundary is not enforced;
- Q18 has no reusable adjustment/reversal envelope, and some locked or
  approved records can still be overwritten in place;
- Q21 has no canonical cross-domain period-lock authority and the salary close
  is not consulted by salary mutation paths;
- Q22 has source-backed snapshots in several domains but no explicit authority
  catalog or dependency/recompute protocol.

The Phase 1 baseline labels Q15 `PROVED`, but the current source contradicts
that broad claim: it proves selected role and approval paths, not the accepted
maker/checker/approver invariant across money, price, debt, exceptions, closes
and adjustments.

## Q15 — maker / checker / approver / viewer separation

### Current authority and useful anchors

- Accepted rule: maker, checker and approver are distinct for money, price,
  debt, exceptions, period closes and adjustments; the maker cannot approve
  their own record; view-only roles cannot mutate or approve.
- `backend/src/services/approval.service.ts:29` is the shared approval boundary
  for `trip_expenses` and `debt_offsets`. It row-locks the record, makes the
  first valid approval win, and now rejects self-approval for debt offsets
  (`:43-87`).
- `backend/src/services/advance.service.ts:225` rejects a requester approving
  their own advance (`:235-237`).
- `backend/src/services/advance.service.ts:635` rejects a maker checking their
  own settlement; `:658-679` requires a checked settlement and a distinct
  approver.
- `backend/src/tests/d1-concurrent-expense-approval.test.ts:109` and
  `backend/src/tests/m64-debt-offsets.test.ts:370` prove first-approve-wins and
  no duplicate ledger side effect for two selected entity types.
- `backend/src/middleware/audit.ts:136` records authenticated successful,
  rejected and HTTP 409 mutation attempts, including actor and sanitized
  request metadata.

### Concrete gaps

1. `transitionApproval()` has a table-specific self-approval branch for debt
   offsets, but the reusable mapping does not expose a maker for
   `trip_expenses`.
2. `trip_expenses` has no general `createdBy` column
   (`backend/src/db/schema.ts:1151-1174`). `forwarderId` identifies an owner for one
   creation path, but accountant-created rows use `forwarderId = null`, so a
   reusable self-approval check has no maker authority.
3. Advance settlements now prove the required three-actor behavior in one
   domain, but the rule remains embedded in `advance.service.ts` rather than
   reusable by price, debt, close and adjustment workflows.
4. `closeSalaryPeriod()` is a direct financial-role action and stores only
   `closedBy` (`backend/src/services/salary-period-close.service.ts:98-184`);
   there is no maker/checker proposal or distinct approver.
5. Billing documents have `createdBy` but their lifecycle confirmation does
   not model internal checker/approver actors. Trip price overrides record who
   overrode, but do not route the material price change through a distinct
   checker and approver.
6. Casbin provides coarse resource verbs. It cannot enforce row-level actor
   separation by itself; route role checks must not be treated as Q15 proof.
7. The current tests prove self-approval only for advances/settlements. There
   is no table-driven proof covering debt offsets, trip expenses, price
   overrides, debit-note adjustments, period closes and reversals.

### Exact implementation touchpoints

- Shared contract: add a dedicated module such as
  `shared/src/schemas/governance.ts`, exported by
  `shared/src/schemas/index.ts` and `shared/src/index.ts`. Define stable
  subject/action/status enums and require `reason`, `expectedVersion`, maker,
  checker and approver transitions where applicable.
- Persistence: `backend/src/db/schema.ts` plus the next additive Drizzle
  migration after `0133_payment_due_date_snapshots.sql`.
  Add an append-only `governance_actions`/`governance_action_history` model, or
  equivalent reusable approval envelope. Add `trip_expenses.created_by`; do
  not infer unknown historical makers.
- Policy: extend `backend/src/services/approval.service.ts` so every mapped
  subject exposes maker/checker/approver columns and it rejects
  `actorId === makerId`, `checkerId === approverId`, and stale expected
  versions inside the same row-locking transaction.
- Domain adapters:
  `backend/src/services/advance.service.ts`,
  `backend/src/services/debtOffset.service.ts`,
  `backend/src/services/financial.service.ts`,
  `backend/src/services/billingDocument.service.ts`,
  `backend/src/services/salary-period-close.service.ts`, and the trip price
  override branch in `backend/src/services/trip-mutations.service.ts`.
- Route/RBAC adapters: the corresponding financial, trip and salary/config
  routes plus `backend/src/casbin/policy.csv`. Casbin remains the coarse role
  gate; the service remains the actor-separation authority.

### Focused tests

- New table-driven service test: each material subject rejects maker approval,
  checker-as-approver, missing reason and stale version.
- Extend `d1-concurrent-expense-approval.test.ts` to use two distinct actors
  and assert the loser is audited at the HTTP boundary.
- Retain `m64-debt-offsets.test.ts` self-approval coverage and add the
  equivalent maker check for `trip_expenses`.
- Retain `forwarder-settlement-workflow.test.ts` proof that `PENDING → CHECKED
  → APPROVED` requires distinct actors; use the same policy test vectors for
  the remaining subject types.
- Add salary-close governance tests proving a close request cannot be checked
  or approved by its maker.
- E2E: creator sees submit but not approve; checker cannot final-approve;
  viewer sees no mutation/approval actions at desktop and mobile widths.

### Migration implications

An additive migration is required. Backfill only facts that are authoritative:
`trip_expenses.created_by` may be copied from `forwarder_id` when non-null;
legacy null makers must remain null and be handled as legacy/manual-review
records. Do not manufacture checker/approver identities from audit text.

## Q17 — CLERK editable surface and dual scope

### Current authority and useful anchors

- Accepted rule: CLERK may manage shipment/document/container/declaration
  fields; direct edits are allowed before dispatch; after handoff, only
  non-plan information can be appended. Customer, container, time or location
  changes require a new version and dispatch notification. Access is the
  intersection of responsible unit and assigned customer/shipment. CLERK has
  no price, cost, debt or salary writes.
- `backend/src/casbin/policy.csv:80-82` gives CLERK `shipments` read/write and
  customer-portal read; financial/config/salary writes are absent.
- `backend/src/services/shipment.service.ts:267` has shipment optimistic
  locking, and `:309` serializes status transitions.
- `backend/src/services/shipment.service.ts:955` preserves document replacement
  history with `replacedBy` instead of deleting the prior document.
- `backend/src/tests/shipment-routes.test.ts:451-499` proves versioned basic
  update and current CLERK write access. `:743-759` proves CLERK cannot
  dispatch.
- `frontend/src/pages/clerk/ClerkShipmentDocsPage.test.tsx` proves the current
  BL/container workflow and hides dispatch from CLERK.

### Concrete gaps

1. No business-unit model or unit reference exists on `users` or `shipments`
   (`backend/src/db/schema.ts:89-118`, `:1719-1747`).
2. No CLERK-to-customer or CLERK-to-shipment assignment table exists.
   `GET /api/shipments`, detail and mutation routes do not scope by actor; a
   CLERK can list/read/update every shipment admitted by the role.
3. `updateShipment()` does not check shipment status. A CLERK can directly
   change customer, BL, expected date, pickup or delivery location after
   dispatch.
4. `batchUpsertShipmentContainers()` reconciles by destructive delete/update
   and has no caller-supplied version. It can overwrite another container edit
   and it remains callable after dispatch.
5. `attachShipmentDocument()` appends documents after any status, but the
   versioned `replaceShipmentDocument()` service has no shipment route.
6. The route permits CLERK to execute general lifecycle transition
   (`backend/src/routes/shipments.ts:202-219`), including DRAFT →
   IN_PROGRESS, even though dispatch/handoff is a manager operation.
7. The UI exposes only BL and containers. The accepted editable surface also
   includes seals, declarations, delivery orders, locations and document
   files, with different pre/post-dispatch behavior.

### Exact implementation touchpoints

- Persistence in `backend/src/db/schema.ts` and one additive migration:
  `business_units`; explicit user-unit membership; customer assignment and
  shipment assignment; responsible unit on shipment; indexes on every scope
  join. Deny access when any required scope component is missing.
- Reusable scope service, e.g.
  `backend/src/services/clerk-shipment-scope.service.ts`, consumed by
  `listShipmentsPaginated`, `getShipmentDetail` and every shipment mutation.
  The effective predicate is:
  `same responsible unit AND (assigned customer OR assigned shipment)`.
- Reusable edit-boundary policy, e.g.
  `backend/src/services/shipment-edit-policy.service.ts`, called by
  `updateShipment`, `batchUpsertShipmentContainers`,
  `attachShipmentDocument`, declaration writes and replacement.
  It classifies fields as:
  pre-dispatch direct; post-dispatch append-only non-plan; post-dispatch
  version-required plan change.
- Shared schemas: split the broad `updateShipmentSchema`
  (`shared/src/schemas/index.ts:1016`) into direct patch and version-change
  intent; add `version` to container/document replacement mutations.
- Routes: `backend/src/routes/shipments.ts` must pass the authenticated actor
  into every query/mutation, remove CLERK from general lifecycle transition,
  and expose document replacement/version history.
- Frontend: `frontend/src/api/shipmentClient.ts`,
  `frontend/src/pages/clerk/ClerkShipmentDocsPage.tsx`, its tests, and an
  administrator assignment surface. The page must show whether a change is
  direct or creates a new version.

### Focused tests

- Backend matrix: same unit + assigned customer, same unit + assigned
  shipment, wrong unit, unassigned, and cross-customer denial for list,
  detail and every mutation.
- DRAFT direct edits succeed; IN_PROGRESS non-plan append succeeds; customer,
  container, expected time, pickup and delivery changes create a version and
  notification rather than overwriting the original.
- Concurrent container reconciles with the same expected version: one wins,
  one 409, original history remains available.
- CLERK cannot call status transition or dispatch; MANAGER can hand off.
- Frontend tests at CLERK and ADMIN/MANAGER roles for disabled/hidden actions,
  version-change confirmation and 409 reload behavior.
- E2E at desktop/tablet/mobile for assignment isolation and post-dispatch
  action visibility.

### Migration implications

Additive schema is required. Existing shipments and CLERKs cannot be safely
auto-assigned from names or prior reads. Backfill a controlled default unit
only if the business has one authoritative unit; otherwise keep assignments
empty and deny CLERK access until an administrator assigns them. Existing
document rows remain valid; `replacedBy` is already backward-compatible.

## Q18 — approved/locked data uses adjustment, reversal or version

### Current authority and useful anchors

- Accepted rule: approved or locked data is never directly edited. Authorized
  users create an adjustment or reversal; every change stores reason, before,
  after, actor and approver. Reopen is exceptional and only before issue or
  posting.
- `backend/src/services/debit-note-lifecycle.service.ts:98-117` defines a
  reusable debit-note locked-state assertion.
- `backend/src/services/billingDocument.service.ts:768` and `:914` reject
  update/delete after confirmation and use conditional writes to close races.
- `backend/src/services/trip-mutations.service.ts:644-646` rejects locked trip
  edits. Forwarder expense/container/photo paths have comparable locked-trip
  checks.
- `backend/src/services/debtOffset.service.ts:180-260` cancels an approved
  offset with reversing ledger entries and preserves original approver fields.
- `backend/src/services/financial.service.ts:165` creates append-only trip AR
  adjustments with a required note and signed agreement reference.

### Concrete gaps

1. `saveDocument()` finds an existing same-period debit note and overwrites the
   document and lines without calling `assertNotLocked`
   (`backend/src/services/billingDocument.service.ts:681-734`). A POST save can
   therefore bypass the guarded PUT path for a confirmed document.
2. The debit-note comment says changes require a new adjustment document, but
   no adjustment-document link/type/schema exists. The system can only reject
   the edit.
3. `updateShipment()`, container reconciliation and document attachment have
   no approved/handoff boundary. Q17 plan-changing values can be overwritten
   after dispatch.
4. Generic expenses reverse/repost ledger effects and then update the original
   row in place (`backend/src/services/expense.service.ts:118-216`); there is
   no immutable before/after adjustment record.
5. `trip_expenses` can be edited in place after `APPROVED` while the parent
   trip is not LOCKED. The approval status is not a universal immutability
   boundary.
6. Existing adjustment contracts are trip-specific and do not carry original
   entity version, original period, before/after snapshots, maker/checker or
   approver.
7. Request-body audit logs are not a substitute for canonical before/after
   business history; the middleware does not load the previous row.

### Exact implementation touchpoints

- First close the bypass in `saveDocument()` by row-locking the existing
  document and applying the same `assertNotLocked` plus conditional status
  predicate used by `updateDocument()`.
- Add a shared typed adjustment/reversal/version intent in
  `shared/src/schemas/governance.ts` (or a narrowly named adjustment module):
  subject type/id, original version, original period lock, action kind,
  reason, before/after, maker/checker/approver and status.
- Add append-only adjustment header/history persistence in
  `backend/src/db/schema.ts`. Keep financial ledger rows as the monetary
  posting authority; the new record explains and links the business change.
- Implement `backend/src/services/adjustment.service.ts` as the transactional
  envelope. Domain adapters calculate and apply effects; the generic service
  enforces actor separation, locked-state policy, expected version and
  immutable history.
- Adapt billing documents, shipment versions, approved trip expenses, generic
  expenses, debt-offset cancellation and salary-period reopen. Do not replace
  existing ledger reversal logic; link it to the adjustment record.
- Add a distinct debit-note adjustment document relation (original document
  id, sequence/version, adjustment reason) and render it as such.

### Focused tests

- Regression: POSTing the same customer/period after CONFIRMED returns 409 and
  leaves header, lines and ledger unchanged.
- Adjustment happy path records exact before/after, reason, maker and distinct
  approver; original row remains unchanged.
- Reversal posts the financial mirror exactly once and links original,
  adjustment and ledger entries.
- Direct update/delete of each locked/approved subject returns 409.
- Two concurrent adjustments against one original version: one wins, one 409,
  both attempts audited, one business effect.
- Reopen rejected after issued/paid/posted markers and accepted only before
  them with authorized approval.

### Migration implications

Additive tables/columns are required. Do not backfill synthetic adjustment
history for legacy updates. Existing audit and ledger rows remain immutable.
For locked legacy records, require a new adjustment going forward and expose
historical provenance as unavailable rather than inventing before/after data.

## Q21 — period lock granularity and late data

### Current authority and useful anchors

- Accepted rule: salary and fuel lock monthly; debit notes lock by each
  customer's contractual billing cycle (monthly default, weekly only by
  contract). Late data enters the current open period as an adjustment linked
  to the original period; old periods are not overwritten. Reopen is permitted
  only before issue/payment and with approval.
- `backend/src/services/salary-period-close.service.ts:98` implements one
  company-wide `YYYY-MM` close row with advisory-lock serialization and
  idempotent re-close.
- `backend/src/services/salary-period-close.service.ts:196` restricts reopen to
  ADMIN/MANAGER and posts a reversing summary entry.
- `backend/src/db/schema.ts:1909-1923` enforces one salary close per period.
- `backend/src/tests/m73-salary-period-close.test.ts` proves role guards,
  summary posting, idempotent close, concurrency and reopen reversal.
- Debit-note lifecycle locks a confirmed document; customer rows currently
  have a `debitNoteMode` defaulting to `MONTHLY`.

### Concrete gaps

1. No salary mutation path calls `getSalaryPeriodClose()`. The close is a
   summary marker, not an enforced write lock. Attendance, trip salary and
   related source values can still change after close.
2. The legacy per-driver `salary_confirmations` model and routes remain active
   (`backend/src/db/schema.ts:870-882`,
   `backend/src/routes/salary.ts:58-108`), creating a second, finer-grained
   lock authority.
3. Salary close sums ledger rows by ledger timestamp, not a canonical
   adjustment/event period link. Late entries cannot be distinguished from
   original-period entries.
4. There is no fuel-period lock model or guard. Fuel reconciliation explains
   monthly variance but does not close a month.
5. Debit notes accept arbitrary `rangeFrom/rangeTo`. There is no contractual
   cycle resolver or period-close row, and save/generate does not validate a
   customer cycle.
6. `customers.debitNoteMode` is `MONTHLY | PER_BATCH`
   (`shared/src/schemas/index.ts:488`); it is not the accepted
   `MONTHLY | WEEKLY-by-contract` lock authority. Preserve presentation/batch
   behavior separately rather than overloading it.
7. Adjustments have no `originalPeriodLockId`, so late data cannot prove its
   origin.
8. Reopen checks role only; it does not prove salary slips are unissued,
   unpaid and unposted.

### Exact implementation touchpoints

- Shared period contract: add domain, scope, start/end, status, contract
  override, issued/paid/posted gates and original-period reference. Export it
  from shared.
- Canonical persistence: add one `business_period_locks` table (or an
  equivalently single authority) with domain `SALARY | FUEL | DEBIT_NOTE`,
  scope `COMPANY | CUSTOMER`, date range, cycle key, status, actor approvals
  and lifecycle gates. Migrate current salary-close facts into this authority;
  do not leave two writable lock sources.
- Customer contract fields: add a distinct billing-cycle setting
  `MONTHLY | WEEKLY`, with weekly unavailable unless a contract reference and
  anchor are present. Do not silently reinterpret legacy `PER_BATCH`.
- Implement `backend/src/services/period-lock.service.ts` and require all
  salary, fuel and debit-note material writes to call it in their transaction.
- Adapt `salary-period-close.service.ts`, `routes/salary.ts`, salary/trip
  mutation paths, fuel expense/reconciliation approval paths and
  `billingDocument.service.ts`.
- Link Q18 adjustments to `originalPeriodLockId`; late original-period data is
  posted to the current open period and never mutates the locked period.

### Focused tests

- Closing salary blocks attendance/trip-salary/direct confirmation changes
  across all drivers; late data creates a current-period adjustment linked to
  the closed month.
- Closing fuel blocks direct changes to that month's approved fuel facts; late
  invoice/allocation uses the open month with origin link.
- Monthly customer ranges resolve correctly; weekly is rejected without
  contract authority and accepted with it; arbitrary ranges cannot be locked.
- Debit-note issue/payment prevents reopen; pre-issue approved reopen succeeds.
- Concurrent close/reopen/write tests serialize on the same canonical period
  row.
- Migration test proves each existing salary close maps once and there is only
  one writable authority.

### Migration implications

A new canonical period-lock migration and customer-cycle migration are
required. Migrate existing `salary_period_closes` rows deterministically.
Existing `salary_confirmations` should become readiness/history data or be
retired from lock enforcement; do not keep it as a competing authority.
Legacy `PER_BATCH` customers need explicit review, not automatic conversion to
weekly.

## Q22 — source authority and recompute versus adjustment

### Current authority and useful anchors

- Accepted source chain:
  shipment owns customer/cargo/container facts; trip owns actual vehicle,
  driver, time and status; approved expense owns cost; issued debit note owns
  AR due; receipt/allocation owns paid and outstanding values.
- Shipment dispatch already links trip to shipment and snapshots shipment
  containers (`backend/src/services/shipment.service.ts:711-852`).
- Trip figure updates recalculate shared totals with
  `computeTripTotals()` and use optimistic versioning
  (`backend/src/services/trip-mutations.service.ts:929-1045`).
- Customer debit-note generation reads billable trips and approved ancillary
  expenses and persists line `sourceType/sourceId`
  (`backend/src/services/billingDocument.service.ts:264-325`).
- Confirmed debit notes and locked trips have immutable guards; ledger entries
  carry append-only financial effects and selected contractual snapshots.

### Concrete gaps

1. The source-authority table exists only in prose and scattered comments.
   There is no executable policy mapping field families to authoritative
   entity/status and permitted downstream behavior.
2. Shipment-to-trip container provenance uses a marker embedded in
   `trip_containers.notes` rather than explicit source id/version
   (`backend/src/services/shipment.service.ts:403-457`).
3. A shipment source change after dispatch does not version the shipment-trip
   relationship or notify dispatch; direct update currently overwrites source.
4. Saved DRAFT debit notes are not automatically recomputed or marked stale
   when their source trip/approved expense changes. Generation re-queries only
   when an operator explicitly generates again.
5. Billing lines store source id and base amount but not the source version
   used. The system cannot prove whether a saved line matches current source.
6. Approval changes on expenses do not have a common dependency propagation
   event; several services update downstream ledger or snapshots locally.
7. Post-lock behavior is inconsistent: some paths reject, some reverse and
   overwrite, and no common adjustment/version record links the source,
   dependent record and original period.
8. No focused end-to-end test follows one source change through shipment →
   trip → approved expense → debit note → AR before and after lock.

### Exact implementation touchpoints

- Add a code-level authority catalog in shared (for example
  `shared/src/governance/source-authority.ts`) with stable source kinds and
  dependency actions: `RECOMPUTE`, `MARK_STALE`, `VERSION`, `ADJUST`,
  `REVERSE`. It is policy metadata, not a second data store.
- Add explicit provenance:
  source shipment/version on trip container snapshots; source version on
  billing document lines; original/dependent ids on adjustment records.
- Add a small application service such as
  `backend/src/services/source-change.service.ts`. Domain writes publish a
  typed source change **inside the owning transaction**; adapters recompute
  open dependents, mark drafts stale when synchronous recompute is unsafe, and
  create Q18 adjustment/version intents for locked dependents.
- Wire:
  `shipment.service.ts`, `trip-mutations.service.ts`,
  `approval.service.ts`/`advance.service.ts`,
  `billingDocument.service.ts`, `financial.service.ts`,
  payment allocation and statement services.
- Preserve current pure calculators and ledger posting functions. The new
  layer decides *when* to call them and records provenance; it must not
  duplicate financial formulas.
- Surface stale/recomputed/adjustment-required state in billing and shipment
  UIs and notify the responsible operator.

### Focused tests

- Before lock: shipment/container source change versions the handoff and
  updates or marks the linked trip dependency; trip/approved-expense change
  recomputes the DRAFT debit note and AR delta exactly once.
- After dispatch/confirmation/period lock: the same changes leave original
  rows unchanged and create a version/adjustment linked to original source and
  period.
- Expense PENDING rows do not affect cost authority; APPROVED transition does;
  REJECTED does not.
- Billing line source-version mismatch is detectable and visible.
- Payment allocation remains authoritative for paid/outstanding even when an
  earlier source changes; correction is an adjustment, never an allocation
  overwrite.
- Concurrent source change and confirmation: either recompute commits before
  confirmation or confirmation wins and the source change becomes an
  adjustment; no mixed snapshot.

### Migration implications

Additive provenance columns/tables are required. Backfill direct links only
where unambiguous (`billing_document_lines.source_type/source_id` and
`trips.shipment_id`). The notes-marker shipment snapshot cannot safely prove a
source version; preserve it for history and begin explicit provenance on new
versions. Do not rewrite issued debit-note or ledger history during backfill.

## Dependency-safe implementation order

1. **Shared governance vocabulary and additive schema.** Land actor/action
   contracts, assignment scope, canonical period locks, adjustment envelope
   and source-version fields without switching behavior. Add migration and
   schema tests.
2. **Q15 actor separation.** Make approval/close/adjustment transitions use
   the same locked transaction and distinct-actor policy. This is required
   before approving Q18 adjustments or Q21 reopens.
3. **Q17 deny-by-default scope and edit classification.** Apply scope to reads
   first, then mutations; add expected versions to container/document writes;
   finally enable post-dispatch version intents.
4. **Q21 canonical period lock.** Migrate salary close, remove competing write
   authority, then add fuel and customer-cycle adapters. All material writes
   consult the same service.
5. **Q18 adjustment/reversal application.** Close the debit-note POST bypass
   immediately, then route approved/locked mutations through the governed
   adjustment envelope linked to Q15 actors and Q21 original period.
6. **Q22 dependency propagation.** Add explicit source versions and wire
   pre-lock recompute/mark-stale versus post-lock adjustment. This comes last
   because it depends on the lock and adjustment decisions already being
   canonical.
7. **Integrated verification.** Run focused red-to-green tests after each
   slice, then root lint, backend/frontend typechecks and tests, build, full
   E2E, independent review and responsive role/page QA. Save every run under
   `qa/` as required by `AGENTS.md`.

## Scope boundary

- Reuse existing calculators, ledger posting, audit middleware, status
  machines and document rendering.
- Do not replace domain records with a generic JSON workflow engine.
- Do not infer assignments, contract cycles, makers, checkers or approvers
  from names, roles or old audit prose.
- Do not edit historical issued/paid/locked rows during migration.
- Q23 material-write rollout remains tracked in
  `reports/q23-material-write-inventory.md`; this map only names concurrency
  controls where they are dependencies of Q15/Q17/Q18/Q21/Q22.
