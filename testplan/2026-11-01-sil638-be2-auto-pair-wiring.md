# SIL-638 (id 742) — BE đợt 2: auto-pair + wiring guards vào dispatch path

Ngày: 2026-11-01 · Branch: `fix-sil-638-be2` · Nguồn: QA verdict 01/11
(build `35bef085` — chỉ TC3 pass; TC1/2/5/6/7 FAIL, TC8/9 BLOCKED).
Chẩn đoán orchestrator: guards đợt 1 nằm ở PAIR-CREATION gate nhưng
dispatch assign/issue không bao giờ tự tạo pair → đường dispatch bypass
toàn bộ (regression note đợt 1: "auto-pair gap").

## Regression cases

| ID | Bước tái hiện | Kết quả mong đợi |
|----|---------------|------------------|
| REG-638-B2-1 (TC3 auto-pair DOUBLE) | Lô 2 cont, cả 2 fulfillment khai `DOUBLE`; phát lệnh leg 1 (20', xe X + tài xế D, ngày N), rồi phát lệnh leg 2 cùng rig/ngày | Pair row `pairKind='KEP'` TỰ TẠO tại issue leg 2 (Trip_ID gộp như pair thủ công: `trip_pairs.first/second_trip_id` + `active_trip_pair_id` trên 2 chuyến); VETC dedup + lương phụ phí chạy như pair thủ công |
| REG-638-B2-2 (TC7 auto-pair COMBINED) | Như trên nhưng cả 2 khai `COMBINED` | Pair `pairKind='KET_HOP'` tự tạo; số cont leg 2 trắng → kế thừa số cont leg 1 (trip_containers + shipment_containers); VETC hook chạy |
| REG-638-B2-3 (TC6(1) 40' DOUBLE) | Leg 1 DOUBLE 20' đã phát trên rig X; phát leg 2 DOUBLE 40' cùng rig/ngày (cửa sổ không giao nhau) | Chặn 422 đúng text DOC: "Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft" |
| REG-638-B2-4 (TC6(2) weight soft warning trên đường issue) | 2 leg DOUBLE 20' cùng rig/ngày, tổng tải vượt capacity; phát leg 2 | 409 `KEP_WEIGHT_WARNING` + text DOC; retry mang `kepWeightWarningConfirmed=true` → lưu được VÀ pair tự tạo |
| REG-638-B2-5 (idempotent) | Leg đã nằm trong pair ACTIVE; phát lại/phân xe lại leg đó | Không pair lại (không pair thứ 2, không 500) |
| REG-638-B2-6 (TC5 quick-create) | `POST /api/shipments/quick` với `containers[2].classification='DOUBLE'` | 2 fulfillment mang `dispatch_classification='DOUBLE'` trên dispatch rows (FE column hiển thị KẸP sẵn); omitted → 'SINGLE' như cũ |
| REG-638-B2-7 (TC1 window law) | Xe ĐƠN: leg 1 08:00–12:00 (đã phát), phát leg 2 14:00–18:00 cùng xe | Pass — giờ kết thúc DO ĐIỀU VẬN NHẬP thắng (không bị ghi đè bằng duration tuyến ~12h); 10:00–14:00 trùng → vẫn chặn |
| REG-638-B2-8 (TC1 IN_TRANSIT giữ nguyên) | Leg 1 08:00–12:00 đang IN_TRANSIT trong ngày, nhận lệnh/xuất phát leg 2 cùng xe | Vẫn chặn ở truck-busy gate như luật SIL-474/631 (không đổi) |
| REG-638-B2-9 (TC2 message) | Xe đang giữ leg KẸP (DOUBLE) cùng khung giờ; gán/phát leg 2 ĐƠN (SINGLE) cùng xe | 409 message phân loại "Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe" (TRƯỚC message trùng lịch), cả ở issue lẫn plan-assign |
| REG-638-B2-10 (driver accept không regress) | Cặp DOUBLE cùng xe/ngày CHƯA pair → driver accept leg 2 (SIL-634 exempt); cặp KEP ACTIVE → accept leg 2 (SIL-631 exempt) | 2 exempt vẫn chạy đúng (không đụng trip-status-machine) |

## Đặt chỗ chống-lặp (điều kiện cặp, chặn sai)
- Khác classification (DOUBLE↔COMBINED) → không auto-pair.
- Khác xe / khác tài xế / khác ngày business (Asia/Ho_Chi_Minh) → không auto-pair.
- Carrier EXTERNAL → không auto-pair (pair law: chỉ chuyến nội bộ).
- Một leg đã có pair ACTIVE → không pair lại.
- ĐƠN (SINGLE/LCL) không bao giờ auto-pair.
