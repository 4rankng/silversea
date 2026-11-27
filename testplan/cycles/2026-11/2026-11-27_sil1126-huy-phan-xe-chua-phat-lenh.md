# Regression spec — `SIL-1126` Hủy phân xe lô đã điều xe nhưng chưa phát lệnh

**Ticket:** SIL-1126 (hủy phân xe không hoàn tất vòng đời — thiếu mục "Hủy phân xe", bỏ chọn nhà xe bị chặn lưu)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-27 (lane r40e) — verify on staging
**Cycle:** 2026-11 wave

## Goal

Quy tắc SIL-708 (QA pass 08/11): HỦY PHÂN XE rồi phân xe mới phải chạy xuyên suốt, cả nhà xe
nội bộ lẫn ngoài. Lô đã điều xe nhưng CHƯA phát lệnh (không có chuyến sống) phải hủy được phân
xe — trả về "Chưa phân xe" sạch rồi phân xe mới thành công. Lô ghép nhóm LCL (W3A-LCL-01/02)
cũng phải hủy được theo từng fulfillment (luật per-row như đợt hủy chuyến SIL-753; BKS chung của
nhóm vẫn đi qua "Đổi BKS nhóm").

## Repro (QA 27/11, build 23a8fa17)

1. dungnv, /dispatch-detail?q=W3A-LCL; lô W3A-LCL-01 (fulfillment 1136, READY_FOR_DISPATCH, đã
   điều nhà xe ngoài QA-TRUCK-2711 / 99Q-99999, chưa phát lệnh).
2. Menu ⋯ dòng lô: chỉ có "Sửa điều phối", "Đổi nhà xe/BKS", "Gộp hàng" — KHÔNG có "Hủy phân xe".
3. Mở hộp thoại "Chỉnh sửa điều phối" → danh sách nhà xe → "Bỏ chọn" → "Lưu thay đổi": dòng chữ
   đỏ "Chọn nhà xe trước khi lưu.", không lời gọi API, dòng lô vẫn giữ QA-TRUCK-2711.
4. (build cũ) PATCH .../1136/plan với carrierType null → 400 "Invalid option: expected one of OWN|EXTERNAL".

## Expected

- Menu ⋯ dòng đã gán xe (nội bộ + ngoài, gồm dòng ghép nhóm) có mục "Hủy phân xe".
- "Bỏ chọn" nhà xe + Lưu trong hộp thoại Chỉnh sửa điều phối = hủy phân xe (PATCH plan
  `carrierType: null` + `clearVehicle: true`), không chặn.
- Sau hủy: dòng đọc "Chưa phân xe" (carrierName null); phân xe mới chạy được.

## Out of scope

- Không đổi luật BKS chung của nhóm ("Đổi BKS nhóm" vẫn owns group BKS; bỏ BKS riêng lẻ khi GIỮN
  nhà xe vẫn bị từ chối).
- Không đổi nhánh hủy chuyến đang chạy (trip cancel, SIL-753 r4).

## Acceptance criteria

### TC-1126-001 — Menu mang "Hủy phân xe" cho dòng đã gán chưa phát lệnh

- **Given** dòng đã gán (EXTERNAL QA-TRUCK-2711 / OWN SilverSea) chưa phát lệnh, gồm dòng LCL ghép nhóm.
- **When** mở menu ⋯.
- **Then** có mục "Hủy phân xe"; click gọi `onCancelDispatch(row)`.

### TC-1126-002 — Editor "Bỏ chọn" nhà xe lưu được hủy phân xe (kể cả dòng ghép nhóm)

- **Given** hộp thoại Chỉnh sửa điều phối của dòng đã gán (kể cả grouped LCL).
- **When** "Bỏ chọn" nhà xe → "Lưu thay đổi".
- **Then** `onAtomicSave` nhận body `carrierType: null` + `clearVehicle: true`; không lỗi
  "Chọn nhà xe trước khi lưu."; dây nhóm `updateLclTruck` im lặng. Bỏ BKS GIỮN nhà xe vẫn bị
  từ chối (existing pin).

### TC-1126-003 — Vòng đời hủy → Chưa phân xe → phân xe mới

- **Given** dòng đã gán OWN + EXTERNAL chưa phát lệnh (page-level).
- **When** menu "Hủy phân xe" → xác nhận.
- **Then** `savePlan` đúng body hủy gán (không `cancelTrip` vì không có chuyến), refresh; thông
  điệp "Nhà xe và biển số dự kiến sẽ bị gỡ…".
