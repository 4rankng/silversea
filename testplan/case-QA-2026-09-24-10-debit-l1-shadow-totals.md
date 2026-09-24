# Regression case QA-2026-09-24-10 — Debit L1 shadow totals: fulfillment-less fees stay out of totals and surface as an explicit excluded line

- **Case ID:** QA-2026-09-24-10
- **Card:** 20260924_2 (Director ruling F1, found during card _78 rung)
- **Surface:** `/shipments-debit` L1 list (GET `/api/shipments/debit-summary`) + the summary line on ShipmentDebitTables
- **Status:** BE half landed; FE summary line rides LaneB's 20260924_1 absorption landing
- **Roles:** ACCOUNTANT / ADMIN

## Preconditions

- At least one lot with a trip whose `fulfillment_id` is NULL carrying live (non-voided) trip expenses — the shadow fixture. (QA can create this by clearing a trip's `fulfillment_id` on a QA fixture lot via psql.)
- At least one normal lot (fulfillment-linked trip + fees) for the unchanged-money rung.

## Repro (first try)

1. Login admin/ACCOUNTANT (roster: `testplan/testaccounts.txt`).
2. Open `/shipments-debit`, pick the customer, expand the L1 list.
3. Read the L1 per-lot totals; read the summary line under the list.

## Expected

1. **Totals exclude (AC1):** the shadow lot's `chiHoTotal`/`receivableTotal`/`freightAuto` do NOT include the fulfillment-NULL trip's fees — the same figures match a run where the trip is fulfillment-linked (unit pins in `shipment-debit-summary.test.ts`).
2. **Explicit line (AC2):** the payload carries `excludedCount` (trips) + `excludedSum` (excluded fees' buy-sum); the L1 view renders `N chuyến chưa gán fulfillment — X ₫ chưa vào chốt` in red, matching the current filter. With 0 unattached: the line is HIDDEN (never a zero-rendered line).
3. **Linked money unchanged (AC3):** lots whose trips carry fulfillments show identical totals to before the change.
4. **API rung:** `GET /api/shipments/debit-summary?customerId=…` response contains `excludedCount`/`excludedSum` matching the DB census
   (`select count(distinct t.id), coalesce(sum(te.buy_amount),0) from trips t join trip_expenses te on te.trip_id = t.id where t.fulfillment_id is null and t.deleted_at is null and t.status <> 'CANCELED' and te.approval_status <> 'VOIDED' …`).
5. Unit pins: shadow describe in `shipment-debit-summary.test.ts` — exclusion + excludedCount = trips (not fees) + excludedSum = buy-sum; no-shadow rung pins 0/"0".

## Pass criteria

- All rungs hold in one session; the summary line never renders as a bare "0 chuyến / 0 ₫" line; L1 per-lot totals never include shadow fees.
