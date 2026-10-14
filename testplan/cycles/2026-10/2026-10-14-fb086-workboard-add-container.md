# 2026-10-14 — FB-086: thêm container vào lô cũ ngay trên bảng Chi tiết lô hàng

Ngày: 2026-10-14 · Nguồn: helpdesk FB-086 (round 17, `/shipments-detail`)

## Phiếu — FB-086 (TC-WB-ADDCONT-01/02/03)

> 'FB-086 thêm container: ❌ FAIL — không tìm thấy chỗ thêm cont vào lô cũ'

- **Tái hiện (TC-WB-ADDCONT-01):** mở `/shipments-detail` ("Chi tiết lô hàng"), tìm
  container của một lô FCL cũ → không có chỗ nào để thêm container vào lô. Card
  20260922_41 đã gỡ cột Thao tác (＋Thêm/Xóa) khỏi bảng này; đường duy nhất còn lại
  là chuỗi "Chi tiết" (chữ nhỏ) trên `/shipments` → drawer — tester không tìm thấy.
- **Kỳ vọng mới:**
  - TC-WB-ADDCONT-01: mỗi dòng container có hàng động `＋ Thêm` ("Thêm container cùng
    lô …") mở form thêm inline; lưu gọi đúng cus-workspace add endpoint của lô đó
    (`POST /shipments/cus-workspace/{id}/containers`, `expectedShipmentVersion` của
    dòng) và form đóng khi lưu xong.
  - TC-WB-ADDCONT-02: `Xóa` từng container xác nhận bằng dialog nguy hiểm rồi gọi
    `POST /shipments/cus-workspace/{id}/containers/{containerId}/remove`.
  - TC-WB-ADDCONT-03: dòng lot-level ("Lô hàng lẻ" — lô hàng lẻ không có container)
    KHÔNG có hàng động thêm/xóa (luật nghiệp vụ: LCL + container = 409,
    `shipment-fulfillment.service.ts`).

## Quyết định chồng lấp

FB-086 (helpdesk, 2026-10-14) **supersedes card 20260922_41** ("add/remove left the
container level entirely"): người dùng không tìm thấy chỗ composition ở cửa ngõ duy
nhất còn lại, nên ＋Thêm/Xóa trở lại workboard. Cửa ngõ drawer trên `/shipments`
và trang `/shipments/:id` giữ nguyên. Tap-target law của card 20260922_3/_21 trở
lại theo: cột Thao tác giữ 7% (9% trong hai dải hẹp, mượn từ `notes`).

## Khu vực ảnh hưởng (sweep)

| # | Bề mặt | Xử lý |
|---|---|---|
| S1 | `ShipmentContainersPage.tsx` ledger props | nối `onAddContainer`/`onRemoveContainer` từ `useCusDetail` |
| S2 | `ShipmentContainersPage.css` | chín cột trở lại thang 10/13/11/16/11/10/11/11 + actions 7% + hai media band |
| S3 | `ShipmentContainersPage.styles.test.ts` | pin chín cột sum 100% + actions share |
| S4 | `ShipmentContainersPage.test.tsx` | pin tiêu đề cột + 3 test FB-086 |
| S5 | Drawer `/shipments` + `/shipments/:id` | KHÔNG đổi (composition vẫn hoạt động như cũ) |
| S6 | LCL lot-level rows | KHÔNG có hàng động (giữ nguyên luật LCL không có container) |

## Chạy xác minh

- FE: `cd frontend && npx vitest run src/pages/ShipmentContainersPage.test.tsx src/pages/ShipmentContainersPage.styles.test.ts src/features/shipments/detail/ShipmentContainerLedger.test.tsx`
- Gate: `pnpm lint`, `cd frontend && npx tsc -b`, `node frontend/scripts/check-structure.mjs`
