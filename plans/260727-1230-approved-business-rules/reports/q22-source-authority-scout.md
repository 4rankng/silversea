# Q22 source-authority scout

**Date:** 2026-07-27  
**Mode:** read-only product-code scout; this report is the only file created  
**Scope:** shipment → trip → approved expense → debit note → AR/receipt chain  
**Concurrent boundary:** Q17 owns `backend/src/db/schema.ts`, shipment services/routes,
shared shipment schemas, and shipment/user UI. Those surfaces were read only.

## Accepted rule

Q22 in `docs/prd/business-logic-qa-proposals.md` is accepted:

- shipment owns customer, cargo, and container facts;
- trip owns actual vehicle, driver, time, and status;
- approved expense owns cost;
- issued debit note owns receivable due;
- receipt/allocation owns paid and outstanding;
- before lock/issue, source changes recompute dependents and warn operators;
- after lock/issue, originals remain unchanged and correction is a linked
  version, adjustment, or reversal with full history.

The current code has useful per-domain guards, but no executable cross-domain
authority policy and no complete dependency propagation.

## Current authority and actual write flow

| Domain | Current persisted authority | Actual write path | Pre-lock behavior | Locked/issued behavior | Q22 finding |
|---|---|---|---|---|---|
| Shipment | `shipments.version`, shipment fields, and `shipment_containers` | `shipment.service.ts::updateShipment`, `batchUpsertShipmentContainers`, `dispatchShipmentToTrip` | Optimistic/pessimistic version checks. Dispatch copies `customerId`; cargo/container type still comes from the fulfillment request. `snapshotContainersIntoTrip` copies containers once. | Q17 now creates `shipment_change_requests` for post-dispatch CLERK changes. Non-CLERK updates still bypass that classification. Container provenance remains a notes marker. | Shipment is only partially authoritative. Cargo has no canonical shipment field, shipment-linked trips may later change customer, and no source change propagates to an existing trip. |
| Trip | `trips` owns operational assignments, dates/status, inputs, snapshotted rates, derived totals, and `version` | `trip-mutations.service.ts::updateTripFigures`, `updateDepartureDate`, `reassignTrip`; `trip-status-machine.service.ts::transitionTripStatus` | `updateTripFigures` recomputes through shared `computeTripTotals()`. When status is `COMPLETED`, it appends unlock/repost ledger effects. | `LOCKED` blocks figures/date edits. Q18 uses `requestTripReopen` or `requestTripArAdjustment`; maker/checker/approver and source version are enforced. | Trip calculation authority is strong locally, but changes do not refresh saved DRAFT debit notes. A shipment-linked trip can change `customerId` without consulting shipment authority. |
| Expense | `trip_expenses`; approval status is the authority gate | `forwarder.service.ts::createTripExpense`, `updateTripExpense`, `deleteTripExpense*`; `approval.service.ts::transitionApproval/processExpenseApproval`; settlement approval also updates expenses in `advance.service.ts::approveSettlement` | Create is normally `PENDING`. Update/delete of non-approved rows is allowed until trip lock. | Approved expense update/delete is rejected; locked-trip create/update/delete is rejected. Settlement adjustment history is append-only, but it is not a general trip-expense correction record. | `updateTripFigures` passes every expense except `REJECTED` into `ancillaryFees`, but `computeTripTotals()` intentionally excludes ancillary buy/sell amounts from transport `totalCost/grossProfit`; billing assembly and ledger posting separately filter to `APPROVED`. Thus no current PENDING monetary contamination was proved. The real gap is that approval changes status only: it does not post a late `SERVICE_FEE` for an already completed trip or refresh/mark saved DRAFT debit notes. The settlement approval path bulk-updates expense status and bypasses a common propagation hook. |
| Debit note | `billing_documents` and `billing_document_lines`; status lifecycle and period locks | `billingDocument.service.ts::generateDraft`, `saveDocument`, `updateDocument`; `debit-note-lifecycle.service.ts::transitionDebitNoteStatus` | Generation re-queries billable trips and approved expenses. Save/upsert replaces lines and posts only override/exclusion/ad-hoc delta. A saved DRAFT is not regenerated automatically. | Source-line edits require DRAFT. Issuance locks trip financial authority and requires trip sources to remain `LOCKED`. Q21 blocks writes in closed periods. Delete currently uses `assertNotLocked`, so a `SENT` or `PENDING_CONFIRM` note can still be soft-deleted even though its lines cannot be edited. | Lines have `sourceType/sourceId` and `baseAmount`, but no source version/fingerprint or stale state. Issued note immutability is inconsistent at delete. There is no linked adjustment-document identity. |
| AR | Append-only `ledger`; trip completion posts `TRIP_REVENUE` and approved fee `SERVICE_FEE`; debit-note save posts only `ADJUSTMENT` delta | `LedgerService.postTripLock/postTripUnlock`, `billingDocument.service.ts::postDebitNoteDelta`, Q18 `approveGovernanceAction` | Completed-trip edits reverse/repost ledger effects. DRAFT note edits reconcile only the document delta. | Q18 approved AR adjustment appends a ledger `ADJUSTMENT` and bumps trip version without changing original trip revenue. | **Issued debit note does not own the full receivable due today.** The ledger remains trip/expense authoritative; `billing_documents.totalInclVat` is presentation plus delta metadata. Statements and AR status read ledger rows, mostly keyed to trip or expense. |
| Receipt/allocation | `payment_allocations` is traceability; `PAYMENT_RECEIVED` ledger credits determine paid/outstanding | `financial.service.ts::recordPayment`, `payment-allocation.service.ts::allocatePayment` | Per-customer advisory lock and outstanding recomputation prevent over-allocation in one serialized transaction. | There is no update/delete path; corrections are append-only ledger effects. Q18 refuses reopen when direct or document allocation exists. | Paid/outstanding is correctly derived from append-only receipts/allocations, but production receive-payment targets trips, not issued documents. Receipt replay uniqueness is a Q23 gap and must not be solved inside Q22. |

## Exact confirmed gaps

1. **No executable policy catalog.** The source chain exists only in the PRD,
   plan prose, and local comments. There is no stable mapping of source kind,
   authoritative fields/status, dependent kind, and action
   (`RECOMPUTE`, `MARK_STALE`, `VERSION`, `ADJUST`, `REVERSE`).
2. **Shipment provenance is not explicit.**
   `shipment.service.ts::snapshotContainersIntoTrip` writes
   `notes="__shipment_snapshot:<shipmentId>"`; `trip_containers` has no source
   shipment-container id or shipment version. This must be coordinated with Q17.
3. **Shipment and trip authority can conflict.**
   `dispatchShipmentToTrip` accepts cargo/container type from fulfillment, and
   `updateTripFigures` allows MANAGER/ADMIN to change customer even when
   `trips.shipmentId` is set.
4. **Expense-status filtering is inconsistent but current transport totals are
   not contaminated.** `trip-mutations.service.ts::updateTripFigures` selects
   expenses with `approvalStatus != REJECTED` for `ancillaryFees`, while
   `computeTripTotals()` intentionally excludes ancillary amounts from
   transport cost/profit and ledger/billing paths filter to `APPROVED`.
   Normalize the upstream selection to `APPROVED` so the executable policy is
   obvious, but do not claim this fixes a current total-cost defect.
5. **Expense approval has no dependency propagation.**
   `approval.service.ts::transitionApproval` and
   `advance.service.ts::approveSettlement` do not recompute the trip, append a
   late service-fee ledger effect, or update/mark affected debit notes.
6. **Saved DRAFT debit notes drift.**
   `generateDraft` reads current sources, but no source mutation calls it or a
   transactional equivalent. A later explicit Generate is the only refresh.
7. **Source consistency cannot be proved.**
   `billing_document_lines` stores `source_type/source_id/base_amount`, but not
   `source_version`. `trip_expenses` itself has no optimistic `version`.
8. **Document issuance is not the AR authority switch.**
   `transitionDebitNoteStatus(DRAFT→SENT)` validates locked trip sources but
   does not bind existing ledger obligations to the document. Statements,
   status, and payment receive flows remain trip-ledger based.
9. **Post-issue correction is only partially modeled.**
   Q18 `governance_actions` supports trip reopen and trip AR delta, but not an
   adjustment document linked to an original debit note/source line. The
   original note total and line set therefore cannot present the correction
   chain.
10. **No end-to-end Q22 proof.** Existing Q18 tests prove source-line replacement
    versus issuance serialization, but not source recompute before issue,
    expense approval propagation, document-owned AR after issue, or correction
    after payment.

## Smallest dependency-safe implementation slices

### Slice 1 — executable authority vocabulary (no Q17 overlap)

Add:

- `shared/src/governance/source-authority.ts`
- `shared/src/governance/source-authority.test.ts`

Define stable source/dependent kinds, field families, lock milestones, and
allowed dependency actions. The catalog is policy metadata, not a second data
store and not a formula engine. Keep `computeTripTotals`, ledger posting, and
billing line builders as the calculation authorities.

Minimum policy rows:

- shipment customer/cargo/container → trip plan/snapshot:
  `RECOMPUTE` before dispatch, `VERSION` after dispatch;
- trip actual/revenue → DRAFT debit-note line/AR:
  `RECOMPUTE`, then `ADJUST` after issue/lock;
- expense status/amount → approved-expense cost reporting and DRAFT debit-note
  line: ignore `PENDING/REJECTED`, `RECOMPUTE` on `APPROVED`, then `ADJUST`;
  do not silently merge ancillary buy-side cost into transport P&L;
- issued debit note → AR obligation: immutable, `ADJUST/REVERSE`;
- receipt/allocation → paid/outstanding: immutable, `ADJUST/REVERSE`.

Export from `shared/src/index.ts` only after checking Q17 has finished its shared
surface.

### Slice 2 — approved-expense authority and DRAFT propagation (isolated backend)

Add `backend/src/services/source-change.service.ts` with transaction-scoped
entry points such as:

- `propagateTripFinancialSourceChange(tx, beforeTrip, afterTrip)`
- `propagateExpenseApproval(tx, beforeExpense, approvedExpense)`
- `refreshDraftDebitNoteDependencies(tx, sourceRefs)`

Refactor the existing billing line builder to accept `Tx`, lock affected DRAFT
documents, refresh matching source lines, recompute `totalInclVat` and
`ledgerAdjustmentAmount`, and post only the exact delta in the same transaction.
If a safe synchronous refresh is impossible, mark the DRAFT stale and notify
the responsible financial roles; never leave it silently current.

Wire both approval paths:

- `approval.service.ts::transitionApproval`
- `advance.service.ts::approveSettlement`

Normalize `updateTripFigures` to use only `APPROVED` expenses even though the
current transport total function ignores those ancillary amounts. Approval of
a late fee on a `COMPLETED` trip must append the missing `SERVICE_FEE` exactly
once; on a `LOCKED`/issued dependency it must create an adjustment intent
instead of changing the original.

### Slice 3 — trip source → DRAFT debit-note recompute (no shipment/Q17 files)

Wire `trip-mutations.service.ts::updateTripFigures` to the same source-change
service inside its existing transaction and shared trip financial advisory
lock. Preserve the existing reverse/repost ledger behavior for `COMPLETED`
trips, but atomically refresh DRAFT lines and their override delta. The
source-change/issuance race must serialize through
`lockTripFinancialAuthority`; either recompute commits before issue, or issue
wins and the source write is rejected/converted to an adjustment. No mixed
snapshot is allowed.

Do not change shipment-linked plan fields in this slice; consume the Q17
version/change-request output after Q17 lands.

### Slice 4 — additive provenance and issued-document AR binding (after Q17)

This slice requires schema/migration coordination and must start only after Q17
releases `backend/src/db/schema.ts` and reserves the next migration number.

Minimum additive model:

- `trip_expenses.version` (optimistic source version);
- `billing_document_lines.source_version`;
- DRAFT dependency state on `billing_documents`
  (`CURRENT | STALE | ADJUSTMENT_REQUIRED`, plus source-change timestamp/reason);
- explicit link from an issued debit note to the ledger obligation entries it
  owns (prefer a narrow relation table rather than overloading `txn_id`);
- explicit adjustment-document/original-document link;
- shipment-container provenance
  (`source_shipment_id`, `source_shipment_container_id`,
  `source_shipment_version`) only if Q17 does not already deliver it.

Backfill only unambiguous direct references. Existing notes markers cannot prove
a shipment version. Do not rewrite issued/paid documents or historical ledger
rows; preserve them and begin explicit provenance for new versions. A migration
is therefore **required** for full Q22 closure.

At `DRAFT→SENT`, atomically freeze line source versions and bind the existing
trip/service-fee ledger obligations to the issued document. New payment
allocations for issued obligations should target `BILLING_DOCUMENT`; unissued
trip accrual may remain trip-targeted. This makes the issued document the
receivable identity without double-posting the customer balance.

### Slice 5 — post-issue linked correction

Extend the bounded Q18 envelope rather than inventing route-local flags:

- original issued document and source lines remain unchanged;
- correction carries original document/source/version/period links;
- approved correction appends ledger effect and creates/updates a current-open
  adjustment document;
- payment allocations are never overwritten;
- statement/document reads show original, adjustment, paid, and outstanding as
  one traceable chain.

Keep Q15 actor separation and Q21 original-period links. Q23 idempotency keys and
conflict-attempt audit remain a separate dependency, not hidden Q22 scope.

## Focused tests

Add `backend/src/tests/q22-source-authority.test.ts` and keep pure catalog tests
in shared.

1. Policy catalog exhaustively maps every accepted Q22 source/dependent pair and
   rejects an undefined action.
2. PENDING and REJECTED expenses do not affect debit-note lines, customer AR,
   or approved-expense cost reporting; transport cost/profit remains
   intentionally independent of ancillary expenses; first APPROVED transition
   affects the applicable cost/receivable dependency exactly once.
3. Both direct expense approval and settlement approval use the same propagation
   path.
4. A trip revenue change with a saved DRAFT note refreshes line
   `baseAmount/sourceVersion`, document total, and override/exclusion ledger
   delta in one transaction.
5. Billing source-version mismatch is detectable and surfaced as stale.
6. Concurrent source update and DRAFT→SENT produces one coherent result:
   refreshed-then-issued, or issued-then-adjustment/rejection.
7. After issue/period lock, the same source delta leaves originals unchanged
   and creates a linked adjustment with original period/version.
8. Payment allocation remains authoritative and unchanged after correction;
   outstanding equals issued amount plus approved adjustments minus receipts.
9. Issued debit-note deletion is rejected; pre-issue DRAFT deletion reverses
   only its own delta.
10. Shipment provenance/version tests land only after Q17 integration and prove
    new snapshots; legacy notes-marker rows remain historical/unproven.

Useful existing regression anchors:

- `backend/src/tests/q18-adjustment-governance.test.ts`
- `backend/src/tests/q21-period-authority.test.ts`
- `backend/src/tests/trip-ledger-completion.test.ts`
- `backend/src/tests/d1-concurrent-expense-approval.test.ts`
- `backend/src/tests/billing-document-lock.test.ts`
- `backend/src/tests/billingDocument.service.test.ts`
- `backend/src/tests/m56-payment-allocation.test.ts`

## Recommended ownership boundary

Q22 can begin with Slice 1 and the trip/expense/billing propagation service.
Do not edit these Q17-owned surfaces concurrently:

- `backend/src/db/schema.ts` and the active Q17 migration;
- `backend/src/services/shipment.service.ts`;
- `backend/src/services/shipment-edit-boundary.service.ts`;
- `backend/src/routes/shipments.ts`;
- shared shipment schemas/types and shipment/user frontend pages.

After Q17 merges, integrate the catalog with Q17's shipment change-request
classification and add provenance in a newly numbered additive migration.

## Conclusion

Q22 is still partial. The closest green path is:

1. executable policy;
2. approved-expense semantics plus transaction-scoped DRAFT propagation;
3. trip-to-DRAFT recompute under the existing financial authority lock;
4. post-Q17 provenance migration and issued-document obligation binding;
5. linked post-issue adjustment and integrated tests.

The migration is mandatory for source-version proof, stale state,
issued-document AR identity, and linked corrections. No existing historical
issued/paid record should be rewritten during backfill.

Status: DONE
