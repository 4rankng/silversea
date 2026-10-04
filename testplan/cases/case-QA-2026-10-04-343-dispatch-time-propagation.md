# Case QA-2026-10-04-343 — Dispatch time not propagating to overview (card 20261004_343)

## Claim
When a dispatcher edits "Giờ trả hàng" in "Chỉnh sửa điều phối" on `/dispatch-detail` (e.g. changing MSCU3332915 from 10:00 05/10/2026 to 13:00 04/10/2026), the saved time immediately and persistently propagates to `/dispatch` (Master Plan) column "THỜI GIAN & LỊCH TRÌNH".
1. `/dispatch` (Master Plan) loads `appointmentGroups` with the effective dispatch schedule timestamp, honoring live trip `plannedEndAt` -> fulfillment `plannedEndAt` -> container `customerAppointmentAt`.
2. Both `/dispatch-detail` and `/dispatch` show the identical updated time ("13:00 04/10/2026") upon save and on full page reload.
3. Date filtering on `/dispatch` uses the effective dispatch date rather than the stale container appointment date.

## Reproduce (pre-fix defect)
1. Log in to https://vantai.tingting.vip with `dungnv` / `Abc123`.
2. Go to `/dispatch-detail` (Kế hoạch Chi tiết Xe). Row YUANFANG — Bill EGLV790671333291 — Cont MSCU3332915 40'DC shows "10:00 05/10/2026".
3. Open "Chỉnh sửa điều phối", change "Giờ trả hàng" to 13:00 04/10/2026, click "Lưu thay đổi".
4. The row in `/dispatch-detail` updates to "13:00 04/10/2026".
5. Navigate to `/dispatch` (Kế hoạch Tổng quát), find bill EGLV790671333291: column "THỜI GIAN & LỊCH TRÌNH" still shows old time "10:00 05/10/2026" even after full page reload.

## Expected behavior
Column "THỜI GIAN & LỊCH TRÌNH" in `/dispatch` displays the saved dispatch time ("13:00 04/10/2026"), in sync with `/dispatch-detail`.

## Root Cause
`loadShipmentListAppointmentGroups` in `backend/src/services/shipment-queries/list-summaries.ts` queried `s.shipmentContainers.customerAppointmentAt` without joining `s.shipmentFulfillments.plannedEndAt` or `s.trips.plannedEndAt`. While `/dispatch-detail` reads `plannedEndAt` per Card 269, `/dispatch` reads `item.appointmentGroups` which was still bound to `customerAppointmentAt`.

## Verification
- Unit test in `backend/src/tests/dispatch-time-propagation-343.test.ts`:
  Verifies `loadShipmentListAppointmentGroups` and `/api/shipments` reflect `fulfillment.plannedEndAt` in `appointmentGroups` over `customerAppointmentAt`.
