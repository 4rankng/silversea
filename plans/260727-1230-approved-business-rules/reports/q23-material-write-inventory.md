# Q23 universal material-write inventory

**Date:** 2026-07-27  
**Mode:** read-only route/service/schema audit  
**Scope:** every mounted authenticated `POST`, `PUT`, `PATCH`, and `DELETE`
boundary, including generated configuration CRUD routes  
**Authority:** Q23 requires a transaction key, stale-version rejection,
first-valid-approval-wins, and an audit record for conflicts on every material
write.

## Inventory method and boundary

`backend/src/index.ts:140-219` installs the mutation audit middleware and mounts
the authenticated routers. A TypeScript AST inventory of `backend/src/routes/`
found:

- 130 explicit mutation endpoints after excluding the three generic factory
  registrations;
- 25 `createCrudRouter(...)` resources in `backend/src/routes/config.ts:126-240`;
- each generated resource exposes `POST /`, `PUT /:id`, and `DELETE /:id`
  (`backend/src/routes/utils/crud-factory.ts:120-190`);
- therefore **205 mounted mutation endpoints**, of which
  `POST /api/auth/login` is unauthenticated and **204 are authenticated**.

Of the 204 authenticated endpoints, 194 are business, security, configuration,
operational-evidence, or financial material writes. Ten are explicitly outside
the material-write rollout: four notification-state writes, three onboarding
progress/analytics writes, two preview POSTs, and one billing-draft generation
POST. They remain inside the common audit boundary.

The live agent transport is Socket.IO (`backend/src/agentSocket.ts:187-528`),
not a hidden REST write route. Its advertised agent tools are currently
read/report/navigation tools; the registry filters the legacy domain tools and
does not expose financial mutation tools
(`backend/src/services/agent/tool.registry.ts:30-87`). Conversation/message
persistence is not a Q23 business-material write.

## Current cross-cutting controls

| Control | Current implementation | Exact limitation |
| --- | --- | --- |
| Client transaction key | Shared frontend transport adds `Idempotency-Key` to JSON, multipart, binary, and text mutations; see `reports/q23-client-transaction-key-slice.md`. | A newly generated key is not automatically stable across a caller-created retry unless the domain caller retains and resupplies it. A header alone does not deduplicate server effects. |
| Server request replay | `runIdempotent()` hashes canonical payloads, takes `pg_advisory_xact_lock(hashtextextended(endpoint + key))`, rejects different-payload reuse, and uses unique `(endpoint,idempotency_key)` (`backend/src/services/idempotency.service.ts:25-29,97-160`; `backend/src/db/schema.ts:2260-2278`). | Only shipment quick-create, driver progress, and driver incidental cost use it. The helper calls `create()` and then inserts the key; the business callback does not receive the helper transaction. A committed business write followed by failed key persistence can still replay the business effect. It stores only an entity id, so it cannot replay arbitrary multi-row/action responses. |
| Natural uniqueness | Selected domain identities have unique indexes: shipment/trip codes, active debit-note period, salary confirmation/close period, settlement code/link rows, live shipment dispatch, configuration natural keys (`backend/src/db/schema.ts:89-264,519-678,729-778,1017-1028,1288-1401,1918-2056,2139-2153`). | Many material identities are not unique: ledger `receipt_id`, payment-allocation receipt, penalties, debt-offset attempts, commissions, payouts, trip expenses, uploads, and shipment documents. Natural uniqueness is inconsistent and cannot substitute for request replay. |
| Stale write | Shipment update/container reconcile/delete require a source version and lock the shipment (`shipment.service.ts:313-409,473-506,720-837`). Trip figure edits accept version (`trip-mutations.service.ts:619-653`). Q18 governance check/approve requires action version and locks action/source (`adjustment-governance.service.ts:218-356`). | Most `PUT/PATCH/DELETE` routes have no `expectedVersion`: generic CRUD, users, settings, expenses, settlement edits, billing documents, tire lifecycle, container/seal/evidence replacement, salary workdays, and several trip commands. |
| First-valid transition | Shipment transitions row-lock and conditional-update status (`shipment.service.ts:418-463`). Advance request/settlement transitions row-lock and status-check (`advance.service.ts:225-287,663-928`). Expense/debt-offset approval uses a row lock and `PENDING` guard (`approval.service.ts:29-123`). Debit-note customer response row-locks and conditionally updates status (`debit-note-lifecycle.service.ts:51-135`). | Some reversal/status paths read before acquiring the controlling row lock or update without a status predicate. The most dangerous are penalty cancel, debt-offset cancel, and trip cancel; two callers can both observe the old state and append duplicate reversal effects. |
| Maker/checker | Advance request approval blocks self-approval; advance settlement enforces maker/checker/approver separation; trip expense and debt-offset approval block creator self-approval; Q18 governance requires distinct actors (`advance.service.ts:225-264,663-928`; `approval.service.ts:79-102`; `adjustment-governance.service.ts:218-356`). | Price/config edits, direct expenses, billing documents, salary confirm/close, penalties, payouts, and several adjustments do not have a reusable maker/checker envelope. Q15 owns policy expansion; Q23 owns race/replay semantics around the resulting actions. |
| Conflict audit | `auditLogMiddleware` records successful, replayed, rejected, and `409` conflict outcomes, whether a key was present, and a sanitized body (`backend/src/middleware/audit.ts:127-258`). | Audit is emitted on response `finish`; `initAuditService()` writes through an async in-process event listener and catches/logs failures (`backend/src/services/audit.service.ts:211-236`). It is best-effort, not transactionally coupled or awaited, and a process failure can lose the conflict attempt. |

**Common notation below:** `K` request replay, `U` natural/database uniqueness,
`L` row/advisory/conditional lock, `V` expected version, `M` maker/checker,
`A*` current best-effort common audit. Every authenticated route has `A*`; the
table calls out stronger controls only.

## P0 — money, ledger, approval, and close writes

These paths must be implemented and concurrency-tested before lower-risk
catalog/evidence writes.

| Reachable endpoints | Write boundary | Current protection | Exact Q23 gap |
| --- | --- | --- | --- |
| `POST /api/payments/receive` | `financial.service.ts::recordPayment` → `LedgerService.postEntry` (`financial.service.ts:27-96`) | `L` per customer; text `receiptId`; `A*` | **Critical.** No `K`, no receipt header/unique receipt, no persisted replay result. Repeated or concurrent same receipt posts again. Production bypasses `payment-allocation.service.ts`; see Q03 overlap below. |
| `POST /api/payments/vendor`; `POST /api/payments/carrier`; `POST /api/drivers/:driverId/payouts` | `recordVendorPayment`, `recordCarrierPayment`, `recordDriverPayout` (`financial.service.ts:117-150,331-447`) | Ledger entity locks on carrier/payout; text receipt; `A*` | No `K` or receipt uniqueness. Vendor reads balance before `postEntry()` acquires the vendor lock, so concurrent overpay validation is stale. Carrier/payout serialize balances but a replay still posts twice. |
| `POST /api/commissions`; `POST /api/penalties` | `commission.service.ts::recordCommission`; `financial.service.ts::createPenalty` | Transactional ledger append; `A*` | No stable business identity, `K`, version, or maker/checker. A retry creates a second payable/penalty and ledger effect. |
| `POST /api/penalties/:id/cancel` | `financial.service.ts::cancelPenalty` (`financial.service.ts:268-295`) | Status check; driver ledger lock; append-only reversal; `A*` | **Critical race.** Status is read before the transaction/driver lock and the update has no `status='ACTIVE'` predicate. Concurrent cancels can both reverse. Add row lock/conditional state winner plus request replay. |
| `POST /api/finance/debt-offsets`; `POST /api/finance/debt-offsets/:id/approve`; `POST /api/finance/debt-offsets/:id/cancel` | `createDebtOffset`, `approveDebtOffset`, `cancelDebtOffset` | Create locks customer+vendor; approve uses shared approval row lock, `M`, then ledger locks; append-only cancel (`debtOffset.service.ts:52-257`) | Create has no `K`/business identity. Approve is first-wins but lacks replay result/expected version. **Cancel is race-prone:** it reads status without locking the offset row and updates without an APPROVED predicate, so concurrent cancel can double-reverse. |
| `POST /api/adjustments`; `POST /api/trips/:id/adjustment`; `POST /api/trips/:id/unlock`; `POST /api/governance-actions/:id/check`; `POST /api/governance-actions/:id/approve` | Q18 `requestTripArAdjustment`, `requestTripReopen`, `checkGovernanceAction`, `approveGovernanceAction` | `L+V+M`; source trip lock/version; conditional action update; append-only ledger/status effect (`adjustment-governance.service.ts:118-363`) | Strongest existing reference path, but no `K`; duplicate creates can produce multiple pending actions against the same source version unless natural uniqueness/active-action policy rejects them. Replay of check/approve is a conflict, not original-result replay. Conflict audit is `A*`. |
| `POST /api/advance-requests/:id/approve|reject` | `approveAdvanceRequest`, `rejectAdvanceRequest` | Row `FOR UPDATE`, status predicate, `M`, ledger append on approve | First transition wins, but no `K`/`V`; exact retry returns `409`, not original result. |
| `POST /api/advance-settlements/:id/check|approve|reject`; `PUT /api/advance-settlements/:id`; `PATCH /api/advance-settlements/:id/expenses/:expenseId` | `checkAdvanceSettlement`, `approveAdvanceSettlement`, `rejectAdvanceSettlement`, `updateAdvanceSettlement`, `adjustSettlementExpense` | Approval row lock/status predicate; three-actor `M`; expense/scope advisory locks; settlement/ledger uniqueness for selected links/effects (`advance.service.ts:548-1124`; schema `1300-1369`) | Approval is first-wins but lacks `K`/`V` replay. Edits have locks/status guards but no client version; last valid editor wins. Request-key replay must wrap the whole multi-row result, not only one entity id. |
| `POST /api/trips/:id/expenses/:eid/approve|reject` | `approval.service.ts::processExpenseApproval/transitionApproval` | Expense row `FOR UPDATE`, PENDING-only, creator separation, fuel/invoice/no-invoice guards | First approval/rejection wins; no `K`, `V`, or replay response. Q22 propagation must occur inside this same winner transaction before Q23 records success. |
| `POST /api/reports/distribute-profit` | `reporting.service.ts::distributeProfit` → `profit-distribution.service.ts::distributeProfit` | Quarter/year advisory lock, existing-row check, all inserts in one transaction (`profit-distribution.service.ts:63-113`) | Domain first-execution-wins is sound. No `K`; exact retry is `409`, response is not replayed; distribution rows have no single persisted command/result header. |
| `POST /api/salary-periods/:period/close|reopen` | `salary-period-close.service.ts::closeSalaryPeriod/reopenSalaryPeriod` | Per-period advisory lock, unique period, idempotent same-state response, append-only close/reversal (`salary-period-close.service.ts:100-250`; schema `2139-2153`) | Domain idempotency is good, but same request key/different payload is not detected; reopening after a close intentionally reuses the row, so a durable action/result identity is still needed. Close lacks Q15 maker/checker. |
| `POST /api/salary/:driverId/:year/:month/confirm|unconfirm`; `PUT /api/salary/:driverId/:year/:month/workdays` | `salary.service.ts::confirmSalary/unconfirmSalary`; `attendance.service.ts::batchUpsertWorkDays` | Unique driver-period confirmation; workday unique driver/date; status guards | No request replay or expected version. Workday update checks confirmation before a later upsert without one shared row/period lock, so close/confirm/edit races require a common salary-period authority lock. |
| `POST /api/finance/billing-documents`; `PUT /api/finance/billing-documents/:id`; `DELETE /api/finance/billing-documents/:id` | `billingDocument.service.ts::saveDocument/updateDocument/deleteDocument` | Unique active customer debit-note period; customer/trip authority locks; period lock; DRAFT-only debit-note delete and conditional status/delete race guard | No `K` or document `V`. Same create can conflict on unique period but cannot replay the original document. Concurrent DRAFT edits are last-writer-wins; Q22 source versions/stale state must land before universal Q23 enforcement. |
| `POST /api/portal/debit-notes/:id/confirm|dispute` | `debit-note-lifecycle.service.ts::transitionDebitNoteStatus` | Document `FOR UPDATE`, legal transition, conditional status update, customer scope | First response wins correctly; no `K` or persisted replay result. The losing customer action is audited only best-effort. |

## P1 — trip, shipment, expense, and dispatch writes

### Shipment and dispatch

All reachable endpoints:

- `POST /api/shipments`
- `POST /api/shipments/quick`
- `PUT /api/shipments/:id`
- `POST /api/shipments/:id/transition`
- `POST /api/shipments/:id/dispatch`
- `POST /api/shipments/:id/documents`
- `PUT /api/shipments/:id/containers`
- `DELETE /api/shipments/:id`

Current controls:

- only `/quick` uses `K`; normal create does not
  (`backend/src/routes/shipments.ts:119-178`);
- update, container reconcile, and delete use shipment row lock plus `V`
  (`shipment.service.ts:313-409,473-506,720-837`);
- lifecycle transition row-locks and conditional-updates status;
- dispatch has a unique live `trips.shipment_id` constraint and returns an
  existing linked trip on replay (`schema.ts:622-625`;
  `shipment.service.ts:898-1032`);
- post-dispatch CLERK changes create a unique
  `(shipment_id,source_version)` request instead of overwriting
  (`schema.ts:2043-2056`).

Gaps:

- normal create, document attach, transition, and dispatch do not consume the
  client key;
- `runIdempotent()` is not atomic with shipment creation/key persistence;
- document attach has no natural `(shipment,type,storageKey/version)` identity;
- transition/dispatch replay is domain-specific, not same-key/different-payload
  aware;
- Q17-owned shipment files must not be edited concurrently (see overlap).

### Trip lifecycle and financial source

All reachable endpoints:

- `POST /api/trips`
- `POST /api/trips/:id/copy`
- `POST /api/trips/bulk-figures`
- `DELETE /api/trips/:id`
- `PUT /api/trips/:id/pre-departure`
- `PUT /api/trips/:id/actuals`
- `POST /api/trips/:id/dispatch`
- `POST /api/trips/:id/complete`
- `POST /api/trips/:id/lock`
- `POST /api/trips/:id/cancel`
- `PATCH /api/trips/:id/reassign`
- `PATCH /api/trips/:id/departure-date`
- `PUT /api/trips/:id/containers`
- `PUT /api/trips/:id/instructions`
- the Q18 unlock/adjustment routes listed under P0.

Current controls:

- figure/bulk edits accept trip version and reject stale versions
  (`backend/src/routes/trips.ts:141-223`;
  `trip-mutations.service.ts:619-653`);
- dispatch/complete use conditional status updates; dispatch also serializes by
  truck; lock conditionally updates COMPLETED→LOCKED
  (`trip-status-machine.service.ts:11-257`);
- trip instructions use unique `trip_id` upsert
  (`trip-instructions.service.ts:44-70`; schema `1211-1225`);
- locked trips route material financial changes through Q18 governance.

Gaps:

- create/copy/delete/reassign/departure/container/instruction/lifecycle commands
  do not consume `K`;
- several commands do not require `V`;
- **trip cancel is race-prone**: after a stale status read it unconditionally
  zeroes financials and may append `postTripUnlock`; two concurrent cancels can
  both reverse a completed trip (`trip-status-machine.service.ts:142-221`);
- completion is conditional-first-wins, but an exact retry returns a same-state
  no-op rather than a persisted original response;
- Q22 source-change/debit-note propagation must share the trip financial
  authority lock before Q23 records the command result.

### Trip/forwarder/direct expenses

All reachable endpoints:

- office trip expense:
  `POST /api/trips/:id/expenses`,
  `PUT /api/trips/:id/expenses/:eid`,
  `DELETE /api/trips/:id/expenses/:eid`;
- forwarder expense:
  `POST /api/forwarder/me/expenses`,
  `PATCH /api/forwarder/me/expenses/:id`,
  `DELETE /api/forwarder/me/expenses/:id`,
  `PUT /api/forwarder/me/trips/:tripId/expense-completion`;
- company/vendor expense:
  `POST /api/expenses`,
  `PUT /api/expenses/:id`,
  `DELETE /api/expenses/:id`.

Current controls:

- forwarder expense create/update/delete locks expense and completion scope,
  blocks approved/locked mutation, and returns approved corrections to the
  settlement history path (`forwarder.service.ts:193-526`);
- direct/company expense writes and ledger reversals are transactional, but
  `updateExpense` reads the source row without a row lock/version before
  reversal/repost (`expense.service.ts:47-243`);
- trip-expense schema has unique completion scopes, not unique request identity
  (`schema.ts:1227-1285`);
- all are `A*`; none uses `K`.

Exact gap: add key replay for creates, `V` for mutable expense sources, and a
row lock/conditional status/version winner before any reversal. Q22 needs
`trip_expenses.version`; Q23 should consume that field rather than introduce a
second concurrency token.

### Forwarder advance creation

Reachable endpoints:

- `POST /api/forwarder/me/advance-requests`
- `POST /api/forwarder/me/advance-settlements`

`createAdvanceRequest` is a plain insert. `createAdvanceSettlement` takes
request/expense/scope locks, generates a uniquely constrained settlement code,
and atomically links sources (`advance.service.ts:160-172,289-368`; schema
`1300-1339`). Neither consumes `K`; a retry can create a second request or a
second settlement over a different eligible source set/code. Persist and replay
the whole settlement result inside the same transaction.

## P2 — operational evidence and replacement writes

### Driver/forwarder containers, progress, and photos

Reachable endpoints:

- `POST /api/driver/me/trips/:tripId/progress`
- `POST /api/driver/me/trips/:tripId/incidental-costs`
- `POST /api/driver/me/trips/:tripId/containers`
- `PATCH /api/driver/me/trips/:tripId/containers/:containerId`
- `PUT /api/driver/me/trips/:tripId/containers/:containerId/seals`
- `DELETE /api/driver/me/trips/:tripId/photos/:type`
- `POST /api/forwarder/me/trips/:tripId/containers`
- `POST /api/forwarder/me/expenses/:id/photos`
- `DELETE /api/forwarder/me/expense-photos/:id`
- `POST /api/expenses/:id/photos`
- `DELETE /api/expenses/:id/photos/:photoId`

Driver progress and incidental-cost creation are the other two current `K`
consumers (`driver.service.ts:469-616`). Progress is append-only; incidental
cost rejects locked trips. Container mutations enforce caller/trip ownership
and locked-trip guards, but do not have `K` or `V`. Photo deletes and seal
replacement are destructive last-write-wins operations. Add stable evidence
identity where available (`storageKey`, capture id, or client event id), key
replay on creation, and expected container/evidence version on replacement or
delete.

### Upload, OCR, geotag, and GPS reconstruction

Reachable endpoints:

- `POST /api/upload/company-logo`
- `POST /api/upload`
- `POST /api/upload/trips/:tripId/photos/:type/delete`
- `POST /api/ocr`
- `POST /api/ocr/pump`
- `POST /api/ocr/persist-only`
- `POST /api/geotag`
- `POST /api/admin/gps/backfill`
- `POST /api/admin/gps/recapture/:tripId`

Geotag uses a natural unique entity upsert
(`geotag.service.ts:120-149`; schema `1850-1862`). Upload/OCR paths may create
storage bytes plus metadata and currently have no shared transaction across
object storage, database write, and request result. GPS recapture/backfill are
repeatable reconstruction jobs but lack a durable command/run identity.

Required Q23 behavior:

- use the client key as the upload/command identity before accepting bytes/work;
- persist object key/checksum/result and replay it;
- same key/different checksum is `409`;
- destructive replacement/delete requires the current evidence version;
- for non-transactional storage, use a durable pending/succeeded/failed command
  row and compensating cleanup, not an entity-id-only idempotency mapping.

## P3 — master data, configuration, identity, and settings

### Generated configuration CRUD: all 75 reachable endpoints

For each resource below, the mounted routes are exactly:
`POST /api/<resource>`, `PUT /api/<resource>/:id`, and
`DELETE /api/<resource>/:id`:

1. `customers`
2. `business-calendar`
3. `trucks`
4. `trailers`
5. `routes`
6. `cargo-types`
7. `container-types`
8. `seal-types`
9. `ports`
10. `forwarder-expense-types`
11. `pricing-tables`
12. `road-allowances`
13. `fuel-norms`
14. `weight-pricing-tiers`
15. `lift-pricing`
16. `ancillary-revenue`
17. `penalty-reasons`
18. `management-fees`
19. `cap-table`
20. `truck-cap`
21. `suppliers`
22. `expense-categories`
23. `tire-positions`
24. `drivers`
25. `fleet/tires`

The factory catches unique-constraint violations as `409`, but update/delete
is `WHERE id=?` only and exposes neither a row lock nor `V`
(`crud-factory.ts:120-190`). Hooks such as customer/supplier mirroring and cache
invalidation execute after the primary row write without a surrounding
transaction. A failure can leave the primary write committed but mirror/cache
side effects incomplete.

Rollout requirement:

- require `K` on create and any destructive action;
- add/reuse a `version` field for mutable financial/authority catalogs;
- condition `UPDATE/DELETE` on `(id,version)` and increment atomically;
- run primary write plus mirror/history/outbox in one transaction;
- retain natural unique indexes as the final database guard.

Price, allowance, fuel, management-fee, ownership, supplier, customer, calendar,
and expense-policy resources should be promoted ahead of cosmetic catalogs
because they change later financial decisions.

### Dedicated config and identity endpoints

Reachable endpoints:

- identity/security:
  `POST /api/auth/logout`,
  `PATCH /api/auth/me`,
  `POST /api/auth/change-password`,
  `POST /api/auth/users`,
  `PATCH /api/auth/users/:id`,
  `DELETE /api/auth/users/:id`,
  `POST /api/auth/business-units`,
  `PATCH /api/auth/business-units/:id`;
- tire lifecycle:
  `POST /api/fleet/tires/:id/install|remove|dispose|transfer`;
- singleton/company settings:
  `PUT /api/road-config`,
  `PUT /api/fuel-config`,
  `PUT /api/company-info`;
- salary-period definitions:
  `PUT /api/salary-periods/default`,
  `POST /api/salary-periods`,
  `PUT /api/salary-periods/:id`,
  `DELETE /api/salary-periods/:id`;
- debit-note template:
  `POST /api/debit-note-templates`,
  `PUT /api/debit-note-templates/:id`,
  `DELETE /api/debit-note-templates/:id`;
- protected settings/content:
  `PUT /api/admin/app-settings`,
  `PUT /api/admin/app-settings/email`,
  `PUT /api/admin/gps-settings`,
  `PUT /api/admin/llm-settings`,
  `PUT /api/admin/onboarding-settings`,
  `POST /api/admin/faq-entries`,
  `PUT /api/admin/faq-entries/:id`,
  `DELETE /api/admin/faq-entries/:id`.

Existing strengths are selected natural uniqueness, encrypted secret storage,
ADMIN/RBAC gates, app-setting key upserts, transactional single-default
debit-note templates, and a user row lock for customer/scope link updates.
There is no universal `K` or `V`. `PUT /api/admin/llm-settings` performs three
row upserts through `Promise.all` without one transaction
(`backend/src/routes/llm-settings.ts:70-133`), so it is especially susceptible
to partial configuration. `PUT /api/company-info` is a single multi-row upsert,
but concurrent complete writes are still last-write-wins
(`config.ts:372-395`).

## Explicit non-material mutation endpoints

These remain audited but do not need durable business-result replay unless
their product meaning changes:

- notification state:
  `POST /api/notifications/read-all`,
  `POST /api/notifications/:id/read`,
  `POST /api/notifications/subscribe`,
  `POST /api/notifications/unsubscribe`;
- onboarding state/analytics:
  `PUT /api/onboarding/progress/:tourId`,
  `PUT /api/onboarding/tasks/:taskId`,
  `POST /api/onboarding/events`;
- read-only previews expressed as POST:
  `POST /api/forwarder/me/advance-settlements/preview`,
  `POST /api/reports/distribute-profit/preview`,
  `POST /api/finance/billing-documents/generate`.

Notification subscriptions and onboarding rows already use natural-key upserts
(`push.service.ts`, `onboarding.service.ts:52-137`). They are intentionally
last-write-wins user state. Audit should not misleadingly label the three
preview endpoints as entity creation.

## Recommended reusable enforcement order

Every material route should call one application boundary; routes must not
assemble idempotency, domain effects, and audit piecemeal.

1. **Authenticate, authorize, and scope.** Resolve actor, role, customer/unit
   scope, and the logical endpoint before any business lookup.
2. **Parse and canonicalize.** Validate the shared schema; normalize semantic
   values before hashing. Reject a missing/oversized malformed key on required
   material routes.
3. **Begin one database transaction.**
4. **Acquire the request-key lock.** Lock
   `(endpoint, Idempotency-Key)` first. Include tenant/customer namespace where
   the endpoint is tenant-scoped.
5. **Resolve replay/conflict.** Load the persisted command row:
   same semantic hash → return stored status/body/resource references;
   different hash → durable `409` conflict audit. Never enter domain code on a
   replay.
6. **Acquire domain locks in a fixed order.** Natural command/document id first,
   then sorted entity locks, then row `FOR UPDATE`. Q03 receipt lock precedes
   customer ledger lock; trip financial authority lock precedes billing-source
   locks.
7. **Reject stale source.** Require `expectedVersion` on mutable/destructive
   writes; compare under the lock and use a conditional
   `UPDATE ... WHERE version=?` as the final winner check.
8. **Apply lifecycle, period, authority, and maker/checker policy.** The same
   locked snapshot decides first-valid-approval-wins. The losing transition
   returns `409`; it never repeats side effects.
9. **Write effects and the replay result atomically.** Business rows, ledger
   rows, source/history records, command status, sanitized response snapshot,
   and a success audit outbox row commit together. Refactor `runIdempotent` to
   pass its `tx` into domain code; do not call an independently committing
   callback.
10. **Record rejected/conflict attempts durably.** A rolled-back business
    transaction cannot contain its own conflict audit. Await a separate,
    failure-visible audit write or durable audit outbox before sending the
    `409/422/403`. Do not rely only on the in-process event emitter.
11. **Post-commit side effects.** Cache invalidation, notifications, email, and
    storage cleanup run from an outbox/retryable post-commit path. They must not
    determine whether the business command is replayable.

The reusable command row must support more than `entityId`: endpoint/key,
actor/scope, semantic hash, command status, HTTP status, sanitized response
snapshot or typed resource references, timestamps, and failure/expiry policy.
Raw keys and secrets must never be copied into audit payloads.

## First-approve-wins contract

For every approve/reject/confirm/close/cancel transition:

1. lock or condition on `(id,current_status,current_version)`;
2. verify actor separation and authority on that locked row;
3. update status/version and append all effects in the same transaction;
4. persist the request result before commit;
5. exact same-key replay returns the original result;
6. different key arriving after the winner receives a `409` describing the
   current state;
7. different payload under the same key receives the Q23 key-conflict `409`;
8. both losing cases produce a durable conflict audit without another ledger,
   notification, or status effect.

`approval.service.ts::transitionApproval`,
`advance.service.ts::approveAdvanceRequest/approveAdvanceSettlement`,
`shipment.service.ts::transitionShipmentStatus`, and
`debit-note-lifecycle.service.ts::transitionDebitNoteStatus` are the current
reference implementations for locked first-winner state changes. Penalty
cancel, debt-offset cancel, and trip cancel must be corrected before they are
wrapped; wrapping a race-prone service with optional keys is insufficient.

## Active ownership overlap and migration sequence

### Q03 overlap

Q03 currently owns or needs:

- `backend/src/db/schema.ts`
- `backend/src/routes/financial/payments.routes.ts`
- `backend/src/services/financial.service.ts`
- `backend/src/services/payment-allocation.service.ts`
- `backend/src/services/idempotency.service.ts`
- shared payment request/response schemas
- `frontend/src/pages/DebtDetailPage.tsx`
- `backend/src/tests/m56-payment-allocation.test.ts`

`reports/q03-allocation-scout.md:43-139,205-343` proves the live
`POST /api/payments/receive` path bypasses the allocator and recommends
`0138_q03_payment_receipts.sql`, receipt-level uniqueness, persisted result
replay, then the generic request-key lock. Q23 must consume that canonical
receipt service; it must not independently add ledger receipt uniqueness or a
second payment command model.

### Q17 overlap

Q17 migration `0137_salty_black_crow.sql` owns the current shipment scope and
versioning model: business units, user unit/shipment links,
`shipments.responsible_unit_id`, and unique shipment change requests. Active
overlap files are:

- `backend/src/db/schema.ts`
- `backend/src/routes/shipments.ts`
- `backend/src/services/shipment.service.ts`
- `backend/src/services/shipment-edit-boundary.service.ts`
- shared shipment/user contracts and the user/shipment frontend files

Q23 should reuse `shipments.version` and
`shipment_change_requests.source_version`; it must not add another shipment
version or alter Q17 assignment semantics.

### Q22 overlap

Q22 currently owns or will touch:

- `shared/src/governance/source-authority.ts` and `shared/src/index.ts`
- `backend/src/services/approval.service.ts`
- `backend/src/services/advance.service.ts`
- `backend/src/services/trip-mutations.service.ts`
- `backend/src/services/billingDocument.service.ts`
- `backend/src/services/debit-note-lifecycle.service.ts`
- the future source-propagation service
- `backend/src/db/schema.ts` and a later provenance/source-version migration

Q22 still needs `trip_expenses.version`,
`billing_document_lines.source_version`, DRAFT stale state, issued-document AR
binding, and linked corrections
(`reports/q22-source-authority-scout.md:150-192`). Q23 must use these versions
at the write boundary and must run source propagation inside the winner
transaction. It must not mark a command successful before Q22 dependencies are
coherent.

### Migration reservation

The live journal ends at `0137_salty_black_crow`
(`backend/drizzle/meta/_journal.json`; `backend/drizzle/0137_salty_black_crow.sql`).
Use this dependency-safe sequence:

1. **0138 — Q03 payment receipts/allocation identity**, exactly as reserved by
   the Q03 scout.
2. **0139 — Q23 reusable material-command result model/idempotency upgrade**,
   including additive fields/table needed for non-entity and multi-row replay.
3. **0140 — Q22 source versions/provenance/issued-document binding**, unless
   Q22 lands first; if it takes `0139`, Q23 must take `0140`. Migration numbers
   are serialized by landing order, never by parallel local generation.
4. Later per-domain uniqueness/version additions take subsequent numbers only
   after the shared Q23 model and Q22 source-version model are stable.

Do not edit historical `0128_idempotency_keys.sql` or `0137`; use additive
migrations. Before generating the next migration, the controller must confirm
the final journal and coordinate ownership of `schema.ts` and
`meta/_journal.json`.

## Required proof matrix

For every material endpoint/class:

1. first request succeeds and persists one result/effect;
2. same key + same canonical payload returns the original result and no new
   business/audit-success side effect;
3. same key + different payload returns `409`;
4. two concurrent first submissions produce one winner and one replay;
5. stale `expectedVersion` returns `409` without mutation;
6. concurrent approve/reject/confirm/cancel produces one valid winner;
7. natural identity collision under different keys returns/replays according to
   the domain command contract;
8. RBAC/scope failure writes no business effect;
9. success, replay, stale conflict, key conflict, and approval loser are visible
   in durable sanitized audit evidence;
10. post-commit notification/cache failure does not duplicate the business
    result on retry.

Q23 remains **PARTIAL**. Client transaction identifiers and broad attempt audit
are present, but universal atomic replay, stale versions, first-valid transition
semantics, and durable conflict evidence are not.

Status: DONE
Summary: The audit expands all 204 authenticated mutation endpoints, identifies 194 material writes and their exact current controls/gaps, prioritizes financial races, defines one reusable enforcement order, and coordinates Q03/Q17/Q22 plus the post-0138 migration sequence.
Concerns/Blockers: Q23 implementation must wait for explicit schema/migration ownership because Q03 and Q22 overlap `schema.ts` and `idempotency.service.ts`; penalty cancel, debt-offset cancel, and trip cancel have confirmed double-reversal race windows that should be fixed before generic wrapping.
