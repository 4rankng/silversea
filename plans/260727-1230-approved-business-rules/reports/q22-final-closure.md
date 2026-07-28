# Q22 source authority implementation report

## Phase Implementation Report

### Executed Phase
- Phase: Q22 Lane 4 source authority provenance and AR consumer closure
- Plan: `plans/260727-1230-approved-business-rules/`
- Status: completed

### Files Modified
- `backend/drizzle/0151_q22_source_provenance.sql`
- `backend/drizzle/0152_q22_shipment_cargo_authority.sql`
- `backend/drizzle/meta/_journal.json`
- `backend/drizzle/meta/0151_snapshot.json`
- `backend/drizzle/meta/0152_snapshot.json`
- `backend/src/db/schema.ts`
- `backend/src/services/billingDocument.service.ts`
- `backend/src/services/customer-receivable-authority.service.ts`
- `backend/src/services/debit-note-lifecycle.service.ts`
- `backend/src/services/forwarder-trip-query.service.ts`
- `backend/src/services/payment-allocation.service.ts`
- `backend/src/services/shipment.service.ts`
- `backend/src/services/source-change.service.ts`
- `backend/src/services/fuel-ap-recon.service.ts`
- `backend/src/services/trip-mutations.service.ts`
- `backend/src/services/ar-status.service.ts`
- `backend/src/services/aging.service.ts`
- `backend/src/services/statement.service.ts`
- `backend/src/services/payment-term.service.ts`
- `backend/src/services/receivable-reminder.service.ts`
- `backend/src/routes/shipments.ts`
- `backend/src/services/shipment-edit-boundary.service.ts`
- `backend/src/tests/trip-shipment.test.ts`
- `backend/src/tests/shipment-routes.test.ts`
- `backend/src/tests/m61-fuel-ap-recon.test.ts`
- `backend/src/tests/m114-payment-term.test.ts`
- `backend/src/tests/q22-source-authority.test.ts`
- `shared/src/governance/source-authority.ts`
- `shared/src/governance/source-authority.test.ts`
- `shared/src/schemas/index.ts`

### Tasks Completed
- [x] Added additive provenance/version schema for shipment snapshots, billing-document authority state, billing-line source fingerprints, trip-expense versioning, and payment-allocation document/trip links.
- [x] Persisted immutable shipment snapshot provenance on `trip_containers`.
- [x] Persisted explicit source version and source-changed timestamps on billing-document lines.
- [x] Froze issued debit-note authority at send time and persisted post-issue warning state instead of overwriting issued values.
- [x] Routed trip-targeted payment allocations onto issued billing-document authority while preserving immutable receipt/allocation history.
- [x] Added `customer-receivable-authority.service.ts` and moved AR reads onto authoritative issued-note / receipt-allocation snapshots for:
  - `getTripArStatus`
  - `getCustomerArSummary`
  - `getReceivablesSummary`
  - `getCustomerAgingList`
  - `getStatementData`
  - `getPaymentTermEvalReport`
  - receivable reminder overdue/outstanding reads
- [x] Closed `EXPENSE_TO_COST_REPORTING` at the actual public reporting boundary by:
  - filtering legacy fuel AP reconciliation to approved expenses only
  - preferring approved settlement-correction amounts over the mutable base expense row
  - normalizing ancillary-fee trip recompute inputs to approved-only
- [x] Extended shipment-linked trip reads and guards by:
  - surfacing shipment/container provenance on forwarder trip detail reads
  - blocking direct customer reassignment on a shipment-linked trip
  - preserving the post-dispatch request/history path instead of overwriting the linked shipment source
- [x] Expanded the focused Q22 suite to prove:
  - issued-note consumers stay on issued-note authority after post-issue trip drift
  - approved debit-note adjustment is the only path that moves those consumers
  - post-issue duplicate allocation loses under the shared authority lock
  - duplicate refund/reversal request loses at the durable governance uniqueness boundary
  - paid/outstanding remains derived from immutable issued note plus immutable receipts/allocations
  - pending/rejected expenses stay out of cost reporting until approval
  - approved settlement correction becomes the authoritative invoiced cost without overwriting the source expense row
  - shipment-linked trip detail reads expose immutable shipment snapshot provenance
  - direct trip-side customer edits are rejected once shipment authority owns the linked trip
  - shipment cargo is persisted on `shipments`, enforced on dispatch/trip-create, versioned onto linked trips via `trips.source_shipment_version`, recomputed while DRAFT, and routed through post-dispatch request/review flow without overwriting linked trips

### Tests Status
- Backend typecheck: pass
  - `qa/2026-07-28_q22-cargo_backend-typecheck-rerun.log`
- Q22 authority chain service suite: pass
  - `qa/2026-07-28_q22-cargo_q22-source-authority.test-rerun-4.log`
- Shipment-linked trip cargo/provenance suite: pass
  - `qa/2026-07-28_q22-cargo_trip-shipment.test-rerun.log`
- Shipments HTTP/RBAC/change-request/dispatch suite: pass
  - `qa/2026-07-28_q22-cargo_shipment-routes.test-rerun.log`
- Migration freshness and applied-ledger probe: pass
  - `qa/2026-07-28_q22-cargo_db-migrate-rerun-2.log`
  - `qa/2026-07-28_q22-cargo_migration-freshness.log`
- Fix-loop evidence preserved:
  - `qa/2026-07-28_q22-cargo_db-migrate-rerun.log`
  - `qa/2026-07-28_q22-cargo_q22-source-authority.test.log`
  - `qa/2026-07-28_q22-cargo_q22-source-authority.test-rerun.log`
  - `qa/2026-07-28_q22-cargo_q22-source-authority.test-rerun-2.log`
  - `qa/2026-07-28_q22-cargo_q22-source-authority.test-rerun-3.log`
  - `qa/2026-07-28_q22-cargo_trip-shipment.test.log`
  - `qa/2026-07-28_q22-cargo_shipment-routes.test.log`

### Issues Encountered
- `0151` had already been applied locally before the cargo-authority SQL was split out, so cargo columns could not honestly remain in `0151`; the fix was a clean `0152_q22_shipment_cargo_authority.sql` plus snapshot/journal entry.
- Local migration freshness needed one ledger repair after the additive SQL had already been applied during the first failed `0152` migrate attempt; the final rerun is green and the applied-ledger probe is saved under `qa/`.
- `trip-shipment.test.ts` needed its shipment-version expectation updated because `batchUpsertShipmentContainers()` legitimately bumps the shipment version before the linked trip snapshots that source version.
- `shipment-routes.test.ts` needed explicit `Idempotency-Key` headers for all mutating requests because the route layer now enforces durable write idempotency.

### Proved Q22 Scope
- `EXPENSE_TO_COST_REPORTING`: proved at the actual reporting consumer boundary. Pending/rejected expenses are excluded, approved expenses flow through the report, and post-approval settlement correction changes reporting by adjustment/history rather than overwriting the source expense row.
- `TRIP_TO_DRAFT_DEBIT_NOTE`: proved.
- `EXPENSE_TO_DRAFT_DEBIT_NOTE`: proved.
- `TRIP_TO_ACCOUNTS_RECEIVABLE`: proved for issued-note AR consumers; pre-issue recompute and post-issue no-overwrite/approved-adjustment flow now covered by executable tests.
- `ISSUED_DEBIT_NOTE_TO_ACCOUNTS_RECEIVABLE`: proved across AR status, customer summary, aging, statement, receivable reminders, and payment-term outstanding reads.
- `RECEIPT_ALLOCATION_TO_PAID_OUTSTANDING`: proved for issued-note allocation authority, duplicate allocation loser, duplicate refund/reversal loser, and immutable paid/outstanding history.
- `SHIPMENT_TO_TRIP`: proved for all accepted source-authority subpaths: container provenance/version, shipment-owned cargo persistence, dispatch/create mismatch rejection, DRAFT recompute onto linked trips, post-dispatch request-only cargo edits, request review behavior, and concurrent update-vs-dispatch winner coherence.

### Next Steps
- None for accepted Q22 scope. Follow-on work, if any, is outside this closure and should be tracked as a new lane.

Status: DONE
Summary: All seven accepted Q22 source-authority pairs are now green. The seventh pair closed through `shipments.cargo_type_id`, `trips.source_shipment_version`, request-only post-dispatch cargo edits, and green service/route/regression evidence across the shipment-to-trip authority chain.
Concerns/Blockers: None for accepted Q22 scope.
