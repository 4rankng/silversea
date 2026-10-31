# SIL-636 — Tag [KẸP]/[KẾT HỢP] cạnh số container trên driver app

- **Case ID:** SIL-636-REG-1
- **Ticket:** plan.tingting.vip SIL-636 (internal id 740) — ruling: KHÔNG hiển thị Trip_ID; tag suy ra từ pair row.
- **Surface:** driver app — MyTripsList card (`DriverTripsPage` journey cards) + `DriverTripDetailPage` (card số cont & seal); API driver trips (`GET /api/driver/me/fulfillments/:fulfillmentId`).
- **Role:** DRIVER.

## Rule (implement)

- Trip có pair row ACTIVE `pairKind='KEP'` → tag **[KẸP]** cạnh số container, trên cả 2 thẻ của cặp.
- Trip có pair row ACTIVE `pairKind='KET_HOP'` → tag **[KẾT HỢP]** (gating tuần tự TC8/TC9 là scope ticket khác — chỉ hiển thị tag).
- Không có pair row ACTIVE → không tag.
- Không bao giờ render Trip_ID; tag là suy diễn quan sát được từ `pairKind`.

## API

`getDriverFulfillmentDetail` thêm 2 field top-level: `pairKind` ('KEP' | 'KET_HOP' | null) + `partnerTripId` (số nội bộ, chỉ dùng làm key — không render). Resolution mirror đúng journey board (lookup theo stamp `trips.activeTripPairId` + yêu cầu `status='ACTIVE'`) để board và chi tiết luôn đồng nhất. KẾT HỢP riding cùng wire là display-only.

## UI

- **Detail:** badge tĩnh `[KẸP]`/`[KẾT HỢP]` nằm cạnh số container trong hero bento của card "Số cont & seal" (`DriverContainerCard`) — house token pill (brand color-mix), không phải nút (không đụng SIL-583 ≥44px).
- **MyTripsList card:** tag chuyển từ header (cạnh Bill) vào đúng dòng số cont (cạnh `cont-no`); fallback header khi card không có khối container để tag không bao giờ biến mất.

## Regression coverage (FE vitest)

`DriverTripDetailPage.test.tsx`:
1. `pairKind='KEP'` → badge `[KẸP]` cạnh số cont.
2. `pairKind='KET_HOP'` → badge `[KẾT HỢP]`.
3. `pairKind=null` → không badge.
4. Không bao giờ render Trip_ID (pin文案).

`DriverTripsPage.test.tsx`:
5. Card `pairKind='KEP'` → tag KẸP nằm trong dòng số cont (`closest('p')` mang class `driver-journey-card__container`) trên cả 2 thẻ.
