# FB-105 (P1, 17/10/2026) — Hàng lẻ: ô "Kho lấy hàng" trống + label sai với hàng Xuất

Chỉ thị người dùng 2026-10-17 kèm spec
`/Users/dev/Downloads/2026.10.17_Dieu_chinh_form_tao_lo_hang_le.docx`
("ĐIỀU CHỈNH TRƯỜNG 'NHÀ MÁY' VÀ 'KHO' KHI TẠO LÔ HÀNG LẺ").

## Hiện trạng / repro

1. Form Tạo lô hàng → Hàng lẻ → ô địa điểm fix cứng label **"Kho lấy hàng \*"**
   cho CẢ Nhập khẩu và Xuất khẩu → sai nghiệp vụ với hàng Xuất (hàng lẻ Xuất
   lấy tại **Nhà máy**, giao tại **Kho CFS/Cảng**).
2. Ô "Kho lấy hàng" từng trống hoàn toàn (commit `df08bd7c` ghim nguồn về `[]`)
   → chọn kho xong `pickupWarehouseSiteId` có giá trị nhưng không option nào
   giữ nó, ô hiển thị trống.

## Yêu cầu (spec §2)

- **Label động theo Hình thức xuất nhập khẩu** (chỉ hàng lẻ):
  - Nhập khẩu: Nhà máy = **"Nhà máy (Điểm trả hàng) \*"**, Kho =
    **"Kho lấy hàng (CFS/Cảng) \*"** (placeholder
    *"Chọn hoặc nhập kho CFS lấy hàng..."*).
  - Xuất khẩu: Nhà máy = **"Nhà máy (Điểm lấy hàng) \*"**, Kho =
    **"Kho trả hàng (CFS/Cảng) \*"** (placeholder
    *"Chọn hoặc nhập kho CFS hạ/giao hàng..."*).
  - Chưa chọn hình thức: giữ nguyên nhãn cũ ("Nhà máy" / "Kho lấy hàng").
- **Ràng buộc**: hàng lẻ bắt buộc **cả** Nhà máy và Kho (\*), trừ khi tích
  "Lệnh chạy ngoài" (waive toàn bộ tiên quyết danh mục).
- **Combobox cho cả 2 ô**: chọn từ danh mục **hoặc gõ text tự do**, kèm nút
  "+ Thêm kho" / "+ Thêm nhà máy".
- **Bố cục**: đưa ô Kho (CFS/Cảng) vào card **"Điểm vận hành & tuyến"** (ngay
  dưới Tuyến đường và Nhà máy); card **"Thông tin hàng"** chỉ còn Loại hàng,
  Quy cách đóng gói, Số lượng, Trọng lượng, Thể tích.
- **Đồng bộ điều vận** (spec §3): cột Nâng/Trả của lô lẻ ở *Kế hoạch Tổng quát*
  và *Kế hoạch Chi tiết Xe* phải hiện điểm lấy/trả thay vì "—":
  - Nhập khẩu: Nâng = Kho lấy hàng (CFS) · Trả = Nhà máy.
  - Xuất khẩu: Nâng = Nhà máy · Trả = Kho trả hàng (CFS).

## Gốc rễ (đã xác minh 17/10)

- Nguồn picker: `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx`
  memo `warehouseSites` bị ghim `[]` (`df08bd7c`) — đã trả lại nguồn thật
  `sites.filter(siteType === 'WAREHOUSE')` (GET
  `/api/shipments/operational-sites?customerId=`).
- Ô Nhà máy của hàng lẻ không có `required` → không bao giờ có dấu `*`
  (`ShipmentCreateLclRouteSection.tsx`); `getShipmentCreateReadiness` cũng
  không đòi `operationalSiteId` với LCL.
- Text tự do: ô Kho chỉ commit id (`allowsCustomValue` không bật); ô Nhà máy chỉ
  cho text tự do khi `isAdHoc`.
- Điều vận: `MasterPlanGrid.aggregateContainerPortGroupLines` hard-code LCL
  Nâng = kho, Hạ = nhà máy (đúng Nhập, **sai Xuất**); Kế hoạch Chi tiết Xe lấy
  Nâng/Trả từ `ports.pickupPortName/dropoffPortName` của container → LCL (không
  có container) luôn "—".

## Sau khi sửa

1. Label/placeholder đổi theo hình thức XNK; dấu `*` khớp validation
   (Nhà máy + Kho bắt buộc với lô có khách hàng danh mục).
2. Cả 2 ô chọn danh mục hoặc gõ text tự do; nút "+ Thêm kho"/"+ Thêm nhà máy"
   vẫn tạo danh mục và chọn ngay dòng vừa tạo.
3. Ô Kho nằm trong card "Điểm vận hành & tuyến".
4. Nâng/Trả 2 màn điều vận hiện đúng điểm theo chiều (Nhập/Xuất) cho lô lẻ.

**Ghi nơi lưu text tự do**: `shipments.pickup_location` (điểm nâng) và
`shipments.delivery_location` (điểm hạ) — 2 cột đã có sẵn, đúng nghĩa
"điểm lấy/trả" (seed đổ sẵn chúng cho mọi lô) → **không cần migration**.

## Regression pin

- `frontend/src/features/shipments/create/shipment-create-model.test.ts`:
  Nhà máy bắt buộc với LCL (catalog), waive khi ad-hoc; payload
  `pickupLocation`/`deliveryLocation` đúng chiều.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.asterisk-contract.test.tsx`:
  dấu `*` của Nhà máy + Kho.
- `frontend/src/features/shipments/liftDropPoints.test.ts`: quy tắc Nâng/Hạ.
- Điều vận: pin LCL Nâng/Trả ở cả 2 grid.

## Scope

- Sửa: form tạo lô (label/validation/combobox/bố cục), payload + luật BE của ô
  Kho (id **hoặc** text tự do), 2 màn điều vận, chi tiết lô (Nơi nhận/Nơi giao).
- Không sửa: cột DB (không migration), luật FCL, màn sửa lô.
