# TC-666B — SIL-666 round-2: phantom 409 date-dependent (31/12) — hidden trip claim

- **Case ID:** TC-666B (SIL-666, id 773 — QA round-3b FAIL trên build 6737cbf1)
- **Reported:** 04/11/2026; lane `fix/sil666b-date-phantom`
- **Người báo:** QA (board comment 3727 — staging R3J prefix: lot C 709 / SHP-2611-00215)

## Triệu chứng

Gán xe 39 (15H-061.14) cho lô SINGLE mới ngày **31/12/2026 08:00** → 409
`"Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe"` (TC2 mismatch, không nêu
tên lô nào) dù plan-rows grid không có dòng nào của xe 39 ngày 31/12. Cùng xe
ngày **21/12** → 200. Phantom chỉ fires một số ngày (date-dependent).

## Reproduction

1. Seeding drift: một chân KẸP (DOUBLE) được phát lệnh lên 15H-061.14 ngày
   31/12 08:00, sau đó **lô bị soft-delete** (hoặc fulfillment bị cancel / lô
   rơi khỏi status operational) — chuyến (trips) vẫn CREATED. Đường API
   `cancelShipmentFulfillment` hủy chuyến cùng lúc, nên orphan dạng này chỉ
   sinh ra từ drift dữ liệu — chính là tập "claim ẩn" của TC1.
2. Tạo lô SINGLE mới 31/12 08:00, PATCH
   `/shipments/dispatch-detail-plan-rows/{fid}/plan` với `truckId: 39`.

**Trước fix:** 409 TC2-mismatch không nêu tên (tripConflictsRaw vẫn đếm chuyến
của lô đã xóa vì scan phía TRIP chưa từng nhận bộ lọc visibility của SIL-638
TC1 — chỉ các scan plan-row holders mới có).

**Sau fix:** 200. Chuyến ẩn của lô đã xóa / fulfillment đã hủy / lô ngoài
status operational không còn chặn ở CẢ BA gate phía trip:
`assertPlanRowRigAvailable` (PATCH plan), `assertTripRigAvailable` (form
chuyến), `assertResourceAvailability` (phát lệnh). Chuyến KHÔNG gắn fulfillment
(BULK — `fulfillment_id is null`) vẫn chặn và vẫn được nêu tên
("Lệnh BULK-TR-0180 …") — giữ nguyên pin của round-1.

## Expected behavior

Xe không có chuyến visible nào trong ngày phải gán 200; mọi xung đột thật
(chuyến visible, BULK fulfillment-less) vẫn chặn đúng tier với message nêu tên.

## Evidence (local, BE :3013 + ss-prod-db)

- `qa/2026-11-04-sil666b/before.log` — phantom tái hiện: fixture hidden DOUBLE
  trip 831 (CREATED, lot_deleted=true) → S31 409 naming nothing; S21 200;
  BULK-TR-0180 409 named.
- `qa/2026-11-04-sil666b/after.log` — cùng fixture (hidden trip 832) → S31
  **200**; S21 200; BULK-TR-0180 vẫn 409 named.
- Driver: `qa/scripts/2026-11-04-sil666b-date-phantom-repro.mjs`
  (`S666B_PHASE=before|after`).
- Unit: `backend/src/tests/unit/sil666b-trip-side-visibility-law.test.ts`
  (builder SQL pin qua PgDialect + wiring cả 3 gate, không DB theo ruling
  unit-only 2026-10-19).
- Root cause và law owner: `tripHolderVisibilitySql()` trong
  `dispatch-resource-availability.service.ts`, kế thừa law SIL-638 TC1
  (`OPERATIONAL_HOLDER_SHIPMENT_STATUSES`, giờ sống cùng module trip-claim SQL).

## Not covered

- Staging build 6737cbf1 (chỉ owner deploy lại; fix chưa có trên staging khi
  verify) — re-verify do QA thực hiện sau deploy.
- UI click thật trên dialog /dispatch-detail (API PATCH thật = cùng gate; UI
  chỉ render cùng 409) — cùng rung với round-1.
