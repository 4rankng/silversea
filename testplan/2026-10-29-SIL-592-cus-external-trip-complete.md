# SIL-592 (id 692) — CUS thiếu chức năng xác nhận hoàn thành vận chuyển cho xe ngoài

## Báo cáo
Khách hàng (b_d. Phạm Trung Kiên) 29/10/2026: khi xe ngoài đã hoàn thành vận
chuyển, Điều vận xác nhận hoàn thành được (Kế hoạch Chi tiết ⋯ → Hoàn thành),
nhưng vai trò CUS không tìm thấy chức năng tương tự trên bất kỳ màn hình nào.

## Nguyên nhân (đã đối chiếu mã nguồn)
- Backend đã hỗ trợ đầy đủ: `POST /api/trips/:id/complete-external`
  (`backend/src/routes/trips/status.ts`, allowlist ADMIN/MANAGER/DISPATCHER/CUS
  trong `backend/src/middleware/authz-grants.ts`).
- Chức năng CUS "Hoàn thành" từng tồn tại trong drawer ledger
  (`c15c6c8e feat(cus): staff close for external-carrier trips from the
  container ledger`) nhưng bị mất khi SIL-485 (`1113e5d2`) thay drawer body bằng
  sheet chỉ đọc `CusLotView`. Mặt phẳng `Chi tiết lô hàng` (/shipments-detail)
  chưa bao giờ có hành động này.

## Tái hiện
1. Đăng nhập vai trò CUS, mở `/shipments-detail` (hoặc drawer lô trên `/shipments`).
2. Tìm dòng container/lô có chuyến XE NGOÀI đang chạy (Trạng thái "Đang chạy"
   hoặc "Đã tạo chuyến", cột Phân xe ghi nhà xe ngoài).
3. Tìm nút xác nhận hoàn thành — không có.

## Expected (sau khi sửa)
- Dòng xe ngoài còn sống (tripStatus CREATED | IN_TRANSIT) **đã có biển số**
  có nút "Hoàn thành" tại ô Trạng thái của Chi tiết lô hàng (cả dòng cont và
  dòng lô) và trong drawer lô (CusLotView, ô Trạng thái mỗi dòng container).
- Chưa có biển số (đúng luật backend card 20261004_359 — "Chuyến chưa có biển
  số xe…") → KHÔNG nút (không dead button); sau "Phân xe lại" có biển thì nút
  xuất hiện.
- Bấm → confirm dialog "Hoàn thành chuyến với xe ngoài …" (cùng wording với
  dialog của Điều vận) → xác nhận gọi `POST /trips/:id/complete-external`,
  toast thành công, bảng/ drawer refetch; thất bại → toast lỗi, dialog giữ
  nguyên để thử lại.
- Không hiện nút cho: chuyến OWN (tài xế tự chốt qua app), chuyến đã
  COMPLETED/CANCELED, dòng chưa có chuyến, hoặc role ngoài allowlist
  (ACCOUNTANT/OPS bị ẩn).
- Nút wrap không truncate ở 390px và 1280px.

## Automated pins
- `frontend/src/features/shipments/cus/cusUtils.externalClose.test.ts` — gate
  trạng thái (thuần): chỉ EXTERNAL + tripId + CREATED/IN_TRANSIT được chốt.
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.external-close.test.tsx`
  — nút + dialog + callback trên bảng Chi tiết lô hàng.
- `frontend/src/features/shipments/cus/CusLotView.external-close.test.tsx` —
  nút + dialog + callback trong drawer.
- `shared/src/schemas/cus-shipment-workspace.test.ts` — wire flat row mang
  tripId/tripStatus/carrierType để gate chạy được.
