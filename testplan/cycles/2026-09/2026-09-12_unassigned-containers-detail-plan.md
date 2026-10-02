# Regression spec — Unassigned containers missing from dispatch detail plan

**Source:** User report 2026-09-12 (CTO escalation)
**Status:** RUNNING — staging verification in progress
**Date:** 2026-09-12

## Goal

Containers in READY_FOR_DISPATCH status that have no carrier assigned (plannedCarrierType IS NULL) do not appear in the dispatcher's "Kế hoạch Chi tiết" (detail plan) screen. This prevents dispatchers from assigning carriers to new shipments.

## Root cause analysis (staging)

**Staging evidence (2026-09-12):**
- Shipment `SHP-2609-00007` (id=7): status=READY_FOR_DISPATCH, container `EGHU3963060` (id=16), carrierType=NULL, appointmentAt=2026-09-08
- This shipment does NOT appear in `GET /api/shipments/dispatch-detail-plan-rows` (any date filter or no filter)
- Shipment `SHP-2609-00014` (id=14): status=READY_FOR_DISPATCH, container `QATU0900017` (id=23), carrierType=NULL → later assigned EXTERNAL
- 13 rows in detail plan, 0 with NULL carrierType — all fulfillments already assigned

**Hypothesis:** The shipment intake flow creates fulfillments, but some READY_FOR_DISPATCH shipments may lack fulfillments entirely (inner join on `shipmentFulfillments` excludes them). Alternatively, the `dispatchDetailTransportDateSql()` returns NULL for shipments without `customerAppointmentAt` or `expectedDeliveryDate`, causing the date filter to exclude them.

## Acceptance criteria

### TC-UNASSIGNED-001 — Every READY_FOR_DISPATCH container appears in detail plan

- **Given** shipment S with status READY_FOR_DISPATCH and container C with `carrierType IS NULL`
- **When** dispatcher opens the detail plan (with or without date filter)
- **Then**:
  - Container C appears as a row in the grid
  - The carrier cell shows an unassigned state (e.g., "Chưa phân nhà xe" or empty)
  - The dispatcher can assign a carrier to this row
- **Assert:**
  - `GET /api/shipments/dispatch-detail-plan-rows` includes a row where `shipmentId = S.id`
  - `row.dispatch.carrierType` is null
  - Row is renderable (has required fields: fulfillmentId, containerNumber, customerRoute)
- **Evidence:**
  - `qa/2026-09-12_unassigned-detail-plan_api.log`
  - `qa/2026-09-12_unassigned-detail-plan_ui.png`

### TC-UNASSIGNED-002 — Date filter does not exclude unassigned containers

- **Given** container C with `customerAppointmentAt = D` and `carrierType IS NULL`
- **When** dispatcher filters detail plan by date D
- **Then**:
  - Container C appears in the filtered results
  - The container is not filtered out due to NULL transport date
- **Assert:**
  - `GET /api/shipments/dispatch-detail-plan-rows?date=D` includes container C
  - If `customerAppointmentAt` is NULL but `expectedDeliveryDate = D`, container still appears
- **Evidence:**
  - `qa/2026-09-12_unassigned-date-filter_api.log`

### TC-UNASSIGNED-003 — Backend unit test: detail plan includes unassigned fulfillments

- **Given** a shipment with status READY_FOR_DISPATCH and a fulfillment with `plannedCarrierType IS NULL`
- **When** `listDispatchDetailPlanRows` is called without assignmentStatus filter
- **Then**:
  - The result includes the unassigned fulfillment
  - `plannedCarrierType` is null in the result
  - The row has all required fields for rendering

### TC-UNASSIGNED-004 — Backend unit test: detail plan date filter with NULL transport date

- **Given** a fulfillment where both `customerAppointmentAt` and `expectedDeliveryDate` are NULL
- **When** `listDispatchDetailPlanRows` is called without a date filter
- **Then**:
  - The fulfillment IS included in the results (no date filter = no exclusion)
- **Given** the same fulfillment and a date filter `date = '2026-09-12'`
- **When** `listDispatchDetailPlanRows` is called with that date filter
- **Then**:
  - The fulfillment is NOT included (NULL date cannot match any specific date)

## QA gates

```
pnpm lint                           # 0 errors
cd backend && npx tsc --noEmit      # 0 errors
cd backend && pnpm test             # all pass
cd frontend && npx tsc -b           # 0 errors
cd frontend && pnpm test            # all pass
make build                          # succeeds
```

## What is NOT covered

- Mobile viewport for detail plan
- FORWARDER / DRIVER views on the same data
- Concurrent carrier assignment race conditions
- Staging rollback path
