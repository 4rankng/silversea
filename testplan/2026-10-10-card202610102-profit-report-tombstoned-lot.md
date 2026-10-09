# Case: card 20261010_2 — profitability/PnL reports include tombstoned lots' postings

- Case ID: 2026-10-10-card202610102
- Reported: 10/10/2026 03:3x (LEAD QA sweep, staging 01e5e457)
- Status: FIXED (this card)

## Reproduction (pre-fix, live staging)

`GET /api/reports/profitability?month=10&year=2026&dimension=CUSTOMER` returns a row citing
`Nguồn: SEAB-2609-778807 · QA268QA292-20261003101900 · BLCUSa24BB` — the third ref is the
bl_number of shipment 296 (COMPLETED, soft-deleted 2026-10-09 19:21 by the QA purge).
The report renders it under "Lợi nhuận vận hành theo chiều phân tích" on /profit.

Expected: a soft-deleted lot is invisible in financial reports. In normal operation the state
cannot arise (a lot with live trips/containers cannot be deleted — 20261004_352 law), so the
only tombstoned-with-financials lots are purge artifacts; excluding them changes no legitimate
number.

## Root cause

- `profitability.service.getProfitabilityReport` (grouped/aggregate/totalGroups queries) reads
  `profitability_snapshots` → ACTIVE `trip_financial_postings` with no shipment-tombstone filter;
  `sourceTripReferences` joins trips→shipments likewise unfiltered.
- `pnl.service` filters `trips.deleted_at` only (lines ~300, ~863); shipment tombstone not
  considered (trips of purged lots stay live).

## Fix + pins

Read-side exclusion everywhere these reports read postings: when the snapshot/trip carries a
`shipmentId`, that shipment must have `deleted_at IS NULL`; null `shipmentId` (ad-hoc trips)
stays included. No data mutation — the purge registry's guarded-survivor philosophy is preserved.

Pinned by `backend/src/tests/profitability-deleted-shipment.test.ts`:
- T1 tombstoned-shipment snapshot excluded from the CUSTOMER report (group + totals) — observed RED pre-fix.
- T2 live-shipment and ad-hoc (null shipmentId) snapshots stay included.
- T3 PnL revenue excludes the tombstoned lot's trip (sibling sweep, same law).

Sibling suites re-run green: profitability-attribution, profitability-pagination, pnl-invariant,
pnl-fleet-allocation-persisted.
