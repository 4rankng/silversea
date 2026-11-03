# SIL-674 — Gate KEP_WEIGHT_WARNING chặn phát lệnh chân thứ 2 của cặp Kẹp dù tổng tải dưới sức kéo

- **Case ID:** REG-674-KEP-WEIGHT-GATE
- **Date:** 2026-11-03
- **Source:** QA staging 5b0bdad3 (ticket SIL-674) — block toàn bộ flow ghép thủ công + verify manual pair (SIL-668) + economics TC3-T3.
- **Severity:** HIGH.

## Triệu chứng

Phát lệnh chân thứ 2 của cặp Kẹp (2×20', cùng xe + tài xế + ngày) LUÔN trả
`409 {"error":"Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của
phương tiện, Điều vận vui lòng kiểm tra lại","code":"KEP_WEIGHT_WARNING"}` —
mọi xe, mọi tổng tải (5t+5t trên xe sức kéo 33t vẫn chặn). Bằng chứng QA:

- Cặp 15/01 xe 15H-104.03 (truck 37): chân A 5t phát OK (trip 222); chân B 5t → 409.
- Cặp 16/01 xe 15E-016.26 (truck 1, towCapacityTons 33.0): chân C 5t OK (trip 223); chân D 5t → 409 (10t < 33t vẫn chặn).
- Build trước 41c75c08: 6t/25t/30t/40t đều 409 tương tự.
- GET /api/trips/222, /223 trả `vehicleCapacityKg: null` dù truck có towCapacityTons 33.0.

## Nguyên nhân thật (kiểm chứng bằng repro local, qa/2026-11-03-sil674/driver-before.log)

Đường phát lệnh tính capacity xe CHỈ từ bucket loại moóc
(`TRAILER_CAPACITY_KG[trailer.type ?? truck.trailerType]` — 20FT=18t/40FT=30t).
Master-data import để trống Loại Moóc (trailer.type null, và trucks.trailerType
null) → capacity resolve null → `kepPairWeightVerdict` trả `'unprovable'` →
luật warn-once TC6(2) v2 (SIL-638) refuse-once → 409 KEP_WEIGHT_WARNING trên
MỌI lần phát, kể cả tổng tải nhỏ hơn sức kéo. Snapshot
`trips.vehicleCapacityKg` cũng lưu null (trips 222/223).

Giả thuyết phụ (SIL-668 — carve Kẹp-pair phụ thuộc auto-pair context) bị
**loại** bằng control repro: cùng hình ảnh manual-pair (KHÔNG có pair row,ghép
thủ công sau khi phát) nhưng moóc 40FT (capacity 30000 known) → chân 2 phát
**201** sạch. Carve declared-share không phụ thuộc pair row; chỉ capacity null
là khác biệt.

## Repro local (trước fix)

1. Xe nội bộ `towCapacityTons = 33`, moóc type null (hình ảnh import master data).
2. Lô FCL 2 container 20', mỗi cont 5.000 kg, cùng ngày, cùng khung giờ.
3. Plan-save cả 2 chân `classification: DOUBLE` + cùng truck.
4. Phát lệnh chân A → 201 (trip snapshot `vehicle_capacity_kg` = NULL).
5. Phát lệnh chân B → **409 KEP_WEIGHT_WARNING** (bug: 10t < 33t sức kéo vẫn chặn).

Driver: `qa/scripts/2026-11-03-sil674-kep-weight-gate-repro.mjs before` (log `qa/2026-11-03-sil674/driver-before.log`).

## Expected sau fix

1. Tổng tải cặp (5t+5t=10t) < sức kéo 33t → chân B phát **201**, KHÔNG warning;
   snapshot `trips.vehicleCapacityKg = 33000`.
2. Tổng tải VƯỢT capacity (25t+25t=50t > 33t) → 409 KEP_WEIGHT_WARNING ĐÚNG
   MỘT LẦN, retry mang `kepWeightWarningConfirmed: true` → lưu được (TC6(2) giữ nguyên).
3. FE cảnh báo mềm có nút xác nhận: dialog `useConfirm` (Hủy / Xác nhận) mang
   text DOC verbatim trên cả 2 đường phát lệnh của `useIssueOrder` (quick-issue
   hàng rô + section phát lệnh trong dialog chỉnh phân công) — QA "dialog
   KHÔNG có nút vượt qua" được sửa ở shared hook.
4. Capacity chưa cấu hình THẬT SỰ (mooc type null VÀ tow null) → giữ luật hiện
   hành: warn-once confirmable (nhánh DOC "xe chưa cấu hình tải moóc", SIL-638
   TC6(2) v2 — owner law).
5. Không regress: TC6(1) 40' chặn cứng (plan-save + issue giữ message DOC
   "Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft"); SIL-668 manual-pair
   only (phát lệnh sạch KHÔNG tự tạo trip_pairs); SIL-638 round-3 +
   RIG_OVERLAP_COMPLETED warn-once; TC2 symmetric (KẸP↔ĐƠN chặn cả 2 chiều).

Driver sau fix: `... repro.mjs after` (log `qa/2026-11-03-sil674/driver-after.log`)
— U/C/O/N/F/P đều PASS. UI drive (rung 3): `qa/scripts/2026-11-03-sil674-ui-drive.mjs`
— bấm nút "Phát lệnh" thật trên /dispatch-detail, dialog cảnh báo tải xuất
hiện với nút "Xác nhận", xác nhận xong row chuyển "Đã phát lệnh", trip lưu
`vehicle_capacity_kg = 33000` (`qa/2026-11-03-sil674/ui-driver.log`, ui-*.png).

## Pins

- `backend/src/tests/unit/sil674-tow-capacity-gate.test.ts` — tons→kg, null-safety,
  resolution chain (bucket trước, tow fallback), pass/refuse/confirmed luật,
  precedence bucket-wins.
- `frontend/src/features/dispatch/detailed-plan/QuickIssueOrderButton.test.tsx` —
  KEP_WEIGHT_WARNING confirm + flagged retry; decline không retry.
- Giữ nguyên: `sil638-tc6-*`, `sil668-manual-pair-only`, `sil638-tc2-*`.
