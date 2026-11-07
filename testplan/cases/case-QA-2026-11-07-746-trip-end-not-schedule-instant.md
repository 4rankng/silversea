# Case QA-2026-11-07-746 — /dispatch LỊCH TRÌNH shows the trip end after Phát lệnh (SIL-746, id 866)

## Claim
The `/dispatch` (Kế hoạch Tổng quát) column "LỊCH TRÌNH" keeps showing the saved
appointment hour after "Phát lệnh" — identical to `/dispatch-detail` and the
drawer "Chi tiết container". The trip's estimated `plannedEndAt` never
surfaces as the schedule instant, on any surface.

1. Lot QA350-TEST-01 (SHP-2611-00506, shipment 1014, container QACU3500003)
   holds giờ hẹn đóng/trả 10/11/2026 14:30 and, after issuing trip 426
   (TRP-202611-0188, plannedStartAt 07:30Z / plannedEndAt 09:30Z), the
   `/dispatch` LỊCH TRÌNH cell shows `10/11/2026 14:30` — not 16:30.
2. `/dispatch-detail` and the drawer keep showing 14:30 (unchanged).
3. The CUS workspace "Lịch trình & điều xe" groups and the cảng nâng/hạ day
   grouping use the same override → appointment instant (no trip-end leak).
4. A dispatch "Giờ trả hàng" override (fulfillment plannedEndAt, card 343)
   still outranks the container appointment — card 343's verified behavior.

## Reproduce (pre-fix defect, staging vantai.tingting.vip build ca0e72b9, 07/11/2026)
1. `tiepvv` (CUS) creates a 1-container lot with giờ hẹn đóng/trả
   10/11/2026 14:30 and saves.
2. `dungnv` (Điều vận): `/dispatch` and `/dispatch-detail` both show 14:30.
3. Assign a truck, press "Phát lệnh" → 201, trip 426 with plannedStartAt
   07:30Z (14:30 VN) and plannedEndAt 09:30Z (16:30 VN).
4. Reload `/dispatch`: the lot's LỊCH TRÌNH cell shows `10/11/2026 16:30`.
5. `/dispatch-detail` for the same lot still shows `10/11/2026 14:30`; the
   drawer shows GIỜ HẸN ĐÓNG/TRẢ 14:30. Reload repeats the mismatch.

## Expected behavior
LỊCH TRÌNH keeps 14:30 — the saved appointment — consistently across
`/dispatch`, `/dispatch-detail` and the drawer.

## Root Cause
Card 343 (commit 813a2b0d) wired the effective appointment instant as
`trips.plannedEndAt ?? shipmentFulfillments.plannedEndAt ??
shipmentContainers.customerAppointmentAt` in three loaders
(`list-summaries.ts`, `container-aggregates.ts`,
`cus-workspace-builders.service.ts`). The trip's `plannedEndAt` is an
estimated completion instant the issue command synthesizes (+2h) — nobody
enters it as a giờ hẹn — and `/dispatch-detail` never reads it for stored
instants, so the overview contradicted the detail board as soon as a live
trip existed.

## Fix
Drop `trips.plannedEndAt` from the precedence chain everywhere (effective
instant = fulfillment override → customer appointment), remove the now-dead
trips join/columns, and pin the law with
`backend/src/tests/unit/sil746-schedule-instant-not-trip-end.test.ts`.
Supersedes the trip leg of card 343's precedence wording; card 343's
override-propagation leg is preserved.
