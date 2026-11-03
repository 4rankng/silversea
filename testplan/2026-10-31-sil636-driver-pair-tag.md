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

## SIL-636-REG-2 — QA round-3b: trang DETAIL mất tag khi không có pairKind (03/11)

- **Triệu chứng (QA round-3b, build 6737cbf1):** LIST (/my-trips) PASS tag cạnh số cont, nhưng 10/10 trang DETAIL không có tag.
- **Root cause:** tag LIST dùng `tagLabelFor` — khi wire không có `pairKind` (không có pair row ACTIVE), fallback theo phân loại điều vận `DOUBLE`→KẸP / `COMBINED`→KẾT HỢP (và `linked`→KẸP). Trang DETAIL chỉ đọc `trip.pairKind` → mất tag đúng ở nhóm chuyến này (22 chuyến DOUBLE-unpaired có thật trong DB dev tại thời điểm QA).
- **Repro:** chuyến 756 (TSTU8170758, `classification='DOUBLE'`, không pair row ACTIVE) — list hiện KẸP, detail trống trước fix.
- **Fix:** detail giải tag qua cùng `tagLabelFor` (shared `features/driver/driver-trip-model.ts`): `pairKind` wire ưu tiên, fallback phân loại/linked của board card giống hệt list. ĐƠN (không pair, không phân loại ghép) → không tag.
- **Expected:** mọi trang detail của chuyến bị list gắn tag KẸP/KẾT HỢP phải hiện cùng tag đó cạnh số container; Trip_ID không bao giờ render.

### Regression coverage (FE vitest, REG-2)

`DriverTripDetailPage.test.tsx`:
6. Board card `classification='DOUBLE'`, wire `pairKind=null` → badge `[KẸP]` cạnh số cont.
7. Board card `classification='COMBINED'`, wire `pairKind=null` → badge `[KẾT HỢP]`.
8. Board card `classification='SINGLE'`, `linked=true` → badge `[KẸP]` (fallback isCombined "kẹp").
9. Board card `classification='SINGLE'`, `linked=false` (ĐƠN) → không badge.

### UI DRIVEN evidence (04/11, local dev, role DRIVER)

- Chuyến 756 (DOUBLE-unpaired — ca lỗi QA): `[KẸP]` cạnh TSTU8170758 @390px (overflow 0px) + @1440px — `qa/2026-11-03-sil636/2026-11-03-sil636_ui-detail-756-kep-{390,1440}.png`.
- Chuyến 773 (pairKind KEP — pair 24): `[KẸP]` cạnh TLTU4028779 @390px — `qa/2026-11-03-sil636/2026-11-03-sil636_ui-detail-773-kep-390.png`.
- Chuyến 650 (ĐƠN): không tag — `qa/2026-11-03-sil636/2026-11-03-sil636_ui-detail-650-single-notag-390.png`.
- List không regress (13 chip, 9 KẸP cạnh số cont) + paired-orders ?date=2026-12-14 giữ nguyên pair view — `qa/2026-11-03-sil636/2026-11-03-sil636_ui-{list-chips,paired-orders}-390.png`.
- Cặp ghép thủ công MỚI qua UI điều vận (dieuvan → Kế hoạch Chi tiết Xe → Ghép chuyến → Kẹp; pair 25, chuyến 35+36 của nhvuong): cả 2 chân detail hiện `[KẸP]` (36 cạnh NYKU3600230; 35 cạnh "Chưa có số cont") @390+@1440 — `qa/2026-11-03-sil636/2026-11-03-sil636_ui-detail-{35,36}-freshpair-kep-*.png`.
- Driver logs: `qa/2026-11-03-sil636/driver.log` (14/14 PASS), `driver-fresh-pair.log` (8/9 PASS — mục FAIL duy nhất là 404 ảnh cũ của chuyến 36 trên uploads dir backend cục bộ, ngoài phạm vi tag).
- Không cover: role CUS/OPS nhìn tag này (tag chỉ thuộc driver app); pairing UI với lô KẾT HỢP thật (đã verify đường KẸP; nhãn KẾT HỢP có pin unit + cùng code path).
