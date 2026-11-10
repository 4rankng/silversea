# Case SIL-694 — Đóng chuyến kẹt cổng POD gốc, không có đường đánh dấu đã thu hồi

## Bug (QA retest 08/11, staging build c4cea6b6)
Đóng chuyến governed trên Điều vận / Sổ chuyến đi KHÔNG BAO GIỜ xong: đủ ảnh
container + đủ 2 file e-POD + đủ mốc giao hàng (evidence-status ready:true),
POST /api/trips/:id/complete vẫn 409:

> Chưa thu hồi POD gốc (chứng từ mộc đỏ). Vui lòng đánh dấu đã thu hồi trước
> khi hoàn thành.

Và KHÔNG có UI/API path nào để đánh dấu "đã thu hồi POD gốc" (QA probe ~25
endpoint + mọi màn: driver pod page, trip detail + drawer + close modal,
shipment detail admin/CUS, clerk docs, phoi-phieu, forwarder work-inbox).
Trip 492 (lô 1100, QA1108W3R3-694C) kẹt IN_TRANSIT.

## Root cause
- BE đã có `POST /api/trips/:id/pod-recovered` (requireRoles ACCOUNTANT, CUS)
  và cổng hoàn thành đọc `trips.pod_recovered_at` (trip-status-machine) —
  nhưng FE không có MỘT chỗ nào gọi endpoint này, và `GET /api/trips/:id`
  không trả `pod_recovered_at` nên FE thậm chí không biết trạng thái cổng.

## Fix
- `GET /api/trips/:id` trả thêm `podRecoveredAt` + `podRecoveredBy`.
- Modal "Hoàn thành chuyến" hiển thị hàng trạng thái POD gốc (role="status"):
  đã thu hồi (kèm thời điểm) hoặc chưa thu hồi + nút
  [Đánh dấu đã thu hồi POD gốc] cho đúng vai backend cho phép (Kế toán/CUS).
  Vai khác (Admin/QL) thấy lý do rõ ràng thay vì lỗi chung.
- FE `tripClient.markPodRecovered(id, expectedVersion)` — optimistic-locked.

## Expected behavior
1. hoapt (ACCOUNTANT) mở /trips/:id đang IN_TRANSIT → Hoàn thành → modal hiện
   "Chưa thu hồi POD gốc" → bấm đánh dấu → hàng chuyển "POD gốc: đã thu hồi ·
   <thời điểm>" → gửi hoàn thành không còn 409 cổng POD.
2. admin (ADMIN) thấy đúng lý do "Chưa thu hồi POD gốc…" và KHÔNG có nút
   đánh dấu (backend 403 với ADMIN — không render nút chết).
3. Chuyến đã mark thì nút biến mất, chỉ còn dòng trạng thái.

## Verification
- FE: useTripDetailPage.pod-recovery.test.tsx (4 pins) + TripDetailPage.pod-gate.test.ts (source pins).
- BE: trip-detail-pod-recovery.test.ts (GET trả đủ cột; route giữ allowlist).
- UI drive thật: qa/2026-11-09-r8a-694-728-734/ (screenshots + driver log).
