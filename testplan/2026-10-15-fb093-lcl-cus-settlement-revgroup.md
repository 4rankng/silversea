# FB-093 — LCL CUS Chi phí-Quyết toán: ghép/tách cước thu khách

Nguồn: kanban/TODO/FB-093-lcl-cus-settlement-revgroup.md (DEV SPEC §II.3), phụ
thuộc FB-090. Ngày: 2026-10-15.

## Phạm vi

- Backend: `mergeLclRevGroup` (service + POST /api/shipments/lcl/rev-group),
  `updateLclGroupTruck` quick-edit (POST /api/shipments/lcl/truck), và các
  trường nhóm trên debit-summary rows (cargoMode, rev/cost group +
  order + memberCount, actual/billing BKS, mã loại xe thu/trả, principal ref).
- Frontend: ShipmentDebitPage — chọn lô mở (pre-lock), nút
  [Ghép cước thu khách] + popup (loại xe tính cước thu + BKS ảo), dải thông
  tin lô mở rộng (THÔNG SỐ CONTAINER "Lô lẻ | Thu: Xe 3.5T | Trả: Xe 10T",
  PHÂN XE 2 dòng sửa nhanh, ghi chú "Ghép cước cùng Bill X", Hủy ghép).

## Case hồi quy

### FB093-01 — chọn lô OPEN để ghép (pre-lock)
1. Trang Chi phí - Quyết toán (CUS): click lô LCL đang mở.
2. Lô được chọn (pick tick); nút [Ghép cước thu khách] bật khi ≥2 lô Lẻ chưa
   ghép cước được chọn.

### FB093-02 — validation cùng 1 khách hàng
1. Chọn 3 lô Lẻ thuộc 2 khách hàng → mở popup.
2. Popup chặn với thông báo "cùng một khách hàng", không gọi API.
3. Bỏ lô khách khác → ghép được; thứ tự chọn quyết định Lô 1.

### FB093-03 — tiền cước thu theo nhóm rev_group
1. Ghép 2 lô cùng khách (có trip live + bảng giá lane).
2. Trip Lô 1: revenue = giá AUTO theo lane (customer × route × loại xe).
3. Trip Lô 2..N: revenue = 0 + reason "Ghép cước cùng Bill {Lô1}";
   revenueOriginal giữ giá gốc.
4. TỔNG CHI HỘ giữ nguyên (service không đụng chi hộ).

### FB093-04 — THÔNG SỐ CONTAINER + PHÂN XE trên chi tiết lô
1. Mở chi tiết lô Lẻ đã ghép.
2. THÔNG SỐ CONTAINER hiện "Lô lẻ | Thu: Xe {revClass} | Trả: Xe {costClass}".
3. PHÂN XE 2 dòng: BKS thực + BKS báo khách (Ảo), combobox + free text;
   Lưu BKS cập nhật cả nhóm cost; cảnh báo cam khi billing ≠ actual.

### FB093-05 — sửa nhanh BKS cập nhật cả nhóm cost
1. Sửa BKS thực của một lô trong nhóm → mọi lô cùng cost_group nhận BKS mới.
2. Lô chưa từng gán nhóm: chỉ lô đó đổi.

## Gate

- backend: tsc + test lcl-grouping (8 case) + shipment-debit-summary (18).
- frontend: tsc -b + vitest ShipmentDebitPage* + full suite khi đổi contract.
