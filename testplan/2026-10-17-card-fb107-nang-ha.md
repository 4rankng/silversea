# FB-107 (card 171026115820) — Chi tiết lô: nhãn 'Nơi giao'/'Nơi nhận' → 'Nâng'/'Hạ'

Chỉ thị người dùng 2026-10-17 kèm card Kanban
`…/SilverSea/Kanban/TODO/171026115820-fb107-chi-tiet-lo-noi-giao-nhan-trong-thay-nang-ha.docx`
(P2, Phạm Trung Kiên, Zalo SilverSea). Card này bổ sung **phần nhãn** của
FB-107 mà lượt batch
`2026-10-17-batch-fb086-fb106-fb107-fb108-fb006-qa1-007.md` chưa làm (lượt đó
mới gắn **giá trị** thật vào 2 dòng còn nhãn cũ).

## Repro / hiện trạng

1. Mở Chi tiết lô hàng → card "Sơ đồ thông tin": 2 dòng **'Nơi nhận'** /
   **'Nơi giao'** (ảnh card chụp lô FCL 0403665034 ngày 15/10: cả hai '—').
2. Business meaning của 2 nhãn không rõ với vận hành → đề xuất thay bằng
   **Nâng** (điểm lấy/nâng hàng) và **Hạ** (điểm hạ/trả hàng).
3. Cùng lỗi trên **portal khách hàng** `/portal/shipments/:id` (eyebrow cũng là
   "Chi tiết lô hàng"): 2 dòng vẫn bind 2 cột dormant `pickup_location`/
   `delivery_location` — lô tạo từ form để trống cả hai → luôn '—'.

## Quyết định (rename vs replace)

- **Trang nội bộ** `ShipmentDetailPage`: **đổi nhãn** — giá trị đã là điểm
  Nâng/Hạ thật qua luật dùng chung `resolveLiftDropPoints` (lượt batch):
  'Nơi nhận' → **'Nâng'**, 'Nơi giao' → **'Hạ'**. Giữ nguyên thứ tự
  Nâng rồi Hạ. Nhãn khớp đúng từ card đề xuất và khớp màn Kế hoạch Tổng quát
  (`MasterPlanGrid` đã dùng 'Nâng'/'Hạ' cho cùng luật).
- **Portal** `PortalShipmentDetailPage`: **đổi cả binding lẫn nhãn** — cùng
  lớp lỗi (2 cột dormant), cùng tên màn hình. Bind qua `resolveLiftDropPoints`
  như trang nội bộ; BE chiếu tiếp các fact đã có sẵn trong `getShipmentDetail`
  (không schema/migration, không model mới).

## Bảng ánh xạ (một luật `resolveLiftDropPoints`, client resolve)

| Nhãn cũ | Nhãn mới | Nguồn giá trị |
|---|---|---|
| Nơi nhận | **Nâng** | FCL: `container.pickup_port_id` → tên cảng nâng (không đảo theo chiều); LCL Nhập: `pickup_warehouse_site_id` (tên kho CFS), LCL Xuất: nhà máy (`operational_site_id`/`factory_name`) |
| Nơi giao | **Hạ** | FCL: `container.dropoff_port_id` → tên cảng hạ; LCL Nhập: nhà máy, LCL Xuất: kho CFS |
| (dự phòng) | | `shipments.pickup_location` = text tự do điểm nâng, `shipments.delivery_location` = text tự do điểm hạ (FB-105 xác nhận nghĩa 2 cột) — chỉ dùng khi bên đó chưa từng chọn điểm danh mục |

Không có cột `return_warehouse_site_id` trong schema
(`backend/src/db/schema/shipments.ts`: `operational_site_id`,
`pickup_warehouse_site_id`, `factory_name`, `pickup_location`,
`delivery_location`); "điểm trả hàng" của LCL chính là nhà máy/kho theo chiều
XNK ở trên.

## Regression pin

- `frontend/src/pages/ShipmentDetailPage.test.tsx` — FB-107 block: nhãn đúng
  'Nâng'/'Hạ', nhãn cũ không còn trên trang; 4 ca giá trị (FCL ghép nhiều cảng
  + không đảo chiều, LCL Nhập đổi vai, LCL Xuất đổi vai, dự phòng free text).
- `frontend/src/pages/portal/PortalShipmentDetailPage.lift-drop.test.tsx` (mới):
  nhãn 'Nâng'/'Hạ' + binding qua cùng luật (LCL Nhập đổi vai; FCL ghép tên cảng;
  dự phòng free text khi payload chỉ có text tự do).
- `backend/src/tests/shipment-detail-lift-drop-projection.test.ts` — thêm ca
  portal: `toCustomerShipmentDetail` chiếu đủ fact cho luật (tên kho, nhà máy
  hiệu lực, tên cảng nâng/hạ từng container, 2 cột free text) — dây portal hết
  '—' là bug người dùng thấy được nên BE phải bị pin, không chỉ FE mock.

## Scope

- Sửa: nhãn + binding 2 dòng ở chi tiết lô nội bộ và portal,
  `toCustomerShipmentDetail` (chiếu fact, không model mới), test như trên.
- Không sửa: luật `resolveLiftDropPoints` (một nguồn chân lý cho 4 màn),
  màn điều phối (đã đúng nhãn 'Nâng'/'Hạ'/'Trả hàng'), form tạo lô, schema/DB,
  các field khác của chi tiết lô.
