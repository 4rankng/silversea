# FB-106 — sau khi tạo lô chuyển sang Chi tiết lô hàng + nút 'Tạo lô mới' cạnh 'Xóa lô'

- Card: `171026115810-fb106-fcl-sau-tao-lo-chuyen-chi-tiet-nut-tao-lo-moi.docx`
  (Kanban TODO, 17/10/2026)
- Nguồn: Phạm Trung Kiên (Zalo SilverSea) — P2 feature request
- Phạm vi: `frontend/src/features/shipments/create/use-shipment-create-workflow.ts`
  (điều hướng sau lưu), `frontend/src/pages/ShipmentDetailPage.tsx` (cụm nút
  header). FCL và LCL dùng chung một đường lưu + một trang chi tiết nên cả hai
  mode đều được áp dụng.

## Yêu cầu

(a) Sau khi bấm 'Tạo lô hàng' (tạo mới FCL/LCL) tự chuyển sang màn
    'Chi tiết lô hàng' của lô vừa tạo để CUS kiểm tra.
(b) Trên trang chi tiết có nút 'Tạo lô mới' đặt NGAY CẠNH nút 'Xóa lô'; bấm mở
    form tạo lô (`/shipments/new`).

## Trạng thái triển khai (đã có trước lượt này)

- (a) FB-080 (card 091026180900): `use-shipment-create-workflow.ts` sau khi lưu
  thành công gọi `navigate('/shipments/{id}')` khi không có `onSaved` —
  `ShipmentCreateWorkspace` không truyền `onSaved` nên mọi intent
  (Lưu nháp / Tạo lô hàng) đều đáp trên chi tiết lô vừa tạo. Codepath lưu theo
  `cargoMode` là chung (payload khác, điều hướng không phân biệt FCL/LCL).
- (b) commit `0f669cb9` (batch FB-086/106/107): nút 'Tạo lô mới' (`Plus`) trong
  PageHeader action cluster TRƯỚC nút 'Xóa lô' (`Trash2`), cùng bộ vai trò với
  route guard `shipmentCreatorOnly` (ADMIN/CUS/MANAGER/DISPATCHER) →
  `/shipments/new`.

**Khoảng trống lượt này đóng:** (a) chưa có test FE nào pin điều hướng sau
tạo (red-at-head trước khi thêm test: `use-shipment-create-workflow.test.tsx`
không assert location); (b) chưa test pin vị trí 'Tạo lô mới' NGAY CẠNH
'Xóa lô' (chỉ pin sự hiện diện + điều hướng).

## Ca hồi quy

### FB106-A1 — FCL: 'Tạo lô hàng' thành công → Chi tiết lô vừa tạo

1. Vào `/shipments/new`, mode FCL, khách hàng catalog + Số Bill + 1 container
   (đủ loại cont/nhà máy/tuyến/cảng nâng/hạ/giờ hẹn) → bấm 'Tạo lô hàng'.
2. Kỳ vọng: điều hướng tới `/shipments/{id}` của lô vừa tạo (màn Chi tiết lô
   hàng), không ở lại form, không về danh sách.
- Pin FE: `use-shipment-create-workflow.test.tsx`
  `'FCL: lands on the detail page of the lot just created'` (assert location thật
  của MemoryRouter sau `save('CREATE')`).

### FB106-A2 — LCL: cùng cam kết điều hướng

1. Như A1 với mode LCL (tuyến + nhà máy + kho lấy hàng + kiện/tấn + ngày giao).
2. Kỳ vọng: `/shipments/{id}` của lô vừa tạo.
- Pin FE: `use-shipment-create-workflow.test.tsx`
  `'LCL: same landing — the navigation is cargo-mode generic'`.

### FB106-A3 — tạo thất bại → KHÔNG điều hướng

1. Bấm 'Tạo lô hàng' khi API tạo lô lỗi.
2. Kỳ vọng: ở lại form, lỗi hiện trên form (không "mất" dữ liệu đang nhập).
- Pin FE: `use-shipment-create-workflow.test.tsx`
  `'a failed create keeps the operator on the form'`.

### FB106-B1 — 'Tạo lô mới' nằm NGAY CẠNH 'Xóa lô' và mở form tạo

1. Mở Chi tiết lô hàng (vai trò CUS) → đọc cụm nút header.
2. Kỳ vọng: thứ tự ['Tạo lô mới', 'Xóa lô'], kề nhau trong cùng action cluster;
   bấm 'Tạo lô mới' → `/shipments/new`.
- Pin FE: `ShipmentDetailPage.test.tsx`
  `'sits immediately before Xóa lô in the header action cluster'` (kèm ca
  navigate sẵn có `'navigates to the create workspace'`).

### FB106-B2 — phân vai trò nút 'Tạo lô mới'

1. Lần lượt đăng nhập ADMIN/CUS/MANAGER/DISPATCHER và ACCOUNTANT/DRIVER/OPS/
   CUSTOMER mở Chi tiết lô.
2. Kỳ vọng: 4 vai trò đầu thấy nút (đúng bộ `shipmentCreatorOnly`); 4 vai trò
   sau không thấy.
- Pin FE: `ShipmentDetailPage.test.tsx` 2 ca `it.each` trong describe
  `'Tạo lô mới affordance (FB-106)'` (có sẵn từ `0f669cb9`, giữ).

## Bằng chứng

- UI rung 3 (tạo thật 1 lô FCL + 1 lô LCL từ form, chụp màn hình chi tiết sau
  điều hướng, assert DOM, truy vấn DB, log driver): `qa/2026-10-17_fb106_*`
  (điền sau khi chạy).
- Gates: `qa/2026-10-17_fb106_frontend-tsc.log`, `..._frontend-tests.log`,
  `..._root-lint.log`.
