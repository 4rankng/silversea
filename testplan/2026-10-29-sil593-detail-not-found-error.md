# SIL-593 (id 693) — Trang chi tiết /shipments/:id báo lỗi "Không thể tải" thay vì "Không tìm thấy lô hàng"

- Nguồn: QA Glint (ticket SIL-593) 29/10/2026 — staging vantai.tingting.vip, build 28c3a120.
- Link: plan.tingting.vip SIL-593.

## Tái hiện

1. Đăng nhập staging bằng dungnv (Điều vận), mở /shipments/382.
2. Trang chỉ hiện "Không thể tải thông tin lô hàng. Vui lòng thử lại." — kể cả sau khi tải lại.
3. Đăng nhập admin, mở /shipments/631 — cùng thông báo.

## Nguyên nhân (evidence 29/10)

Hai lỗi chồng nhau:

1. **Dữ liệu**: lô 382/631 KHÔNG tồn tại trên staging DB (prod mirror — `make stgdb`
   21/10: 257 rows, max(id)=285, `shipments_id_seq`=285, 0 rows >285 kể cả soft-deleted).
   `GET /api/shipments/382|631` trả đúng 404 `{"error":"Không tìm thấy lô hàng"}`.
   Id 382/631 là id của LOCAL dev-seed (QA script `ui-tap-targets-verify-20261029.mjs`
   đánh `localhost:7199/shipments/382`). Merge wave 28-29/10 được minh oan:
   - row có thật (285) render đủ form trên DEPLOYED build 9eba31c8 (chứa cả merge bị nghi);
   - frontend 28c3a120 ≡ HEAD (diff chỉ chạm backend container-date-filter);
   - `buildShipmentEditPrefill` replay sạch trên payload staging thật (LCL+FCL);
   - 275 scoped tests xanh.
2. **UX defect (code)**: `use-shipment-workspace-prefill.ts` catch GỘP lỗi 404 (definitive
   not-found) cùng lỗi transient thành một thông báo retry "…Vui lòng thử lại." — một
   trạng thái không-bao-giờ-thành-công lại mang lời kêu gọi thử lại, khiến gap dữ liệu
   bị đọc nhầm thành trang hỏng.

## Kỳ vọng sau fix

- 404 (lô không tồn tại) → thông báo "Không tìm thấy lô hàng." — không wording retry.
- Lỗi transient (5xx/mạng) → giữ nguyên "Không thể tải thông tin lô hàng. Vui lòng thử lại."
- Trang chi tiết render đủ nội dung lô cho DISPATCHER và ADMIN khi fetch thành công.

## Case ID

- SIL-593-C1: /shipments/:id render Chi tiết lô hàng (form + Số Bill) với role DISPATCHER.
- SIL-593-C2: /shipments/:id render Chi tiết lô hàng với role ADMIN.
- SIL-593-C3: getShipmentDetail reject ApiError 404 → alert "Không tìm thấy lô hàng."
  và KHÔNG chứa "Vui lòng thử lại".
- SIL-593-C4: getShipmentDetail reject lỗi thường (transient) → giữ wording retry cũ.
