# Case QA-2026-10-22-lcl-kho-chung — Kho lấy hàng (CFS/Cảng) phải list từ danh mục chung, không lọc theo khách

Card 261022093245. Nguồn: Zalo khách 22/10 09:31 + screenshot form tạo lô
hàng lẻ.

## Trạng thái trước fix

Form tạo lô LCL, ô bắt buộc "Kho lấy hàng (CFS/Cảng)\*" chỉ list các dòng
`operational_sites` (siteType=WAREHOUSE) gán cho KHÁCH HÀNG của lô
(`GET /api/shipments/operational-sites?customerId=<id>` → FE lọc
`siteType='WAREHOUSE'`). KH chưa có kho nào thấy hint "Chưa có kho cho khách
hàng này" và buộc bấm "+ Thêm kho" dù kho CFS/cảng là hạ tầng dùng chung đã
có sẵn trong danh mục (local dev DB: 13 kho active thuộc 5 khách).

## Nguyên tắc khách (Zalo 22/10)

Kho CFS/đóng ghép trả hàng là hạ tầng DÙNG CHUNG — dropdown phải hiện từ danh
mục kho/cảng chung (active), KHÔNG cần gán khách. Chọn xong lưu như bây giờ
(`pickupWarehouseSiteId` + pickup/delivery location theo label). Nút
"+ Thêm kho" giữ nguyên (luồng tạo kho mới vẫn hữu ích) nhưng không còn là
cách duy nhất.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| KHOCHUNG-R1 | KH mới/chưa có kho (vd LOG COM id=2), mở dropdown Kho (CFS/Cảng) | dropdown list TẤT CẢ kho active trong danh mục chung (≥1; local: 13), KHÔNG filter theo khách — không còn "Chưa có kho cho khách hàng này" khi danh mục còn kho |
| KHOCHUNG-R2 | Chọn kho chung (thuộc khách khác) + tạo lô LCL | lô tạo OK; `shipments.pickup_warehouse_site_id` = id kho đã chọn; pickup/delivery location giải đúng short name/name của kho (label không rỗng vì kho không thuộc khách của lô) |
| KHOCHUNG-R3 | Gõ text trùng tên kho chung (lô chạy ngoài) | custom-text match chọn site id từ danh mục chung (match rộng hơn trước) |
| KHOCHUNG-R4 | Nút "+ Thêm kho" + dialog tạo kho | vẫn hoạt động; kho mới xuất hiện ngay trong dropdown |
| KHOCHUNG-R5 | API contract | `GET /operational-sites?customerId=<id>` giữ nguyên hành vi cũ (sites của khách); `?scope=shared` list kho active mọi khách; thiếu cả hai → 400 như cũ |
| KHOCHUNG-R6 | Nhà máy picker + FCL | không đổi — factory vẫn filter theo khách của lô |

## Fix scope

- BE: `GET /api/shipments/operational-sites` nhận thêm `scope=shared` (kho
  active mọi khách, same intake roles, ACCOUNTANT giảm projection như list);
  `customerId` chỉ bắt buộc khi không có scope.
- FE: dropdown Kho (CFS/Cảng) trên `ShipmentCreateLclRouteSection` đổi nguồn
  sang danh mục chung (load 1 lần + refetch khi tạo kho mới); label resolution
  cho payload dùng union customer-sites + shared catalog; hint reword
  "Chưa có kho trong danh mục" (chỉ khi danh mục chung rỗng).

## Verify (22/10/2026 — LOCAL, branch fix-lcl-kho-chung)

- **Audit (root cause)**: dropdown "Kho lấy hàng (CFS/Cảng)" trên
  `ShipmentCreateLclRouteSection` đọc `warehouseSites = sites.filter(WAREHOUSE)`
  với `sites` từ `GET /operational-sites?customerId=<id>` — chỉ kho gán cho
  khách của lô. BE còn 2 guard customer-scope chặn kho thuộc khách khác:
  `shipment-fulfillment.service.ts` `loadSiteSnapshot` (eq customerId với CẢ
  hai điểm, chạy ngay trong quick-create qua `ensureShipmentFulfillmentsInTx`)
  và `shipment-intake.service.ts` validate điểm LCL khi submit dispatch.
- **Fix**: BE `GET /operational-sites` nhận `?scope=shared` (kho active mọi
  khách; `customerId`-mode giữ nguyên; unknown scope 400);
  `listSharedWarehouseSitesForIntake` + pure resolver
  `resolveOperationalSitesListQuery`. Guard kho bỏ điều kiện customerId (giữ
  WAREHOUSE/active/live; factory giữ nguyên customer-scope). FE: dropdown đọc
  danh mục chung (load on mount + refetch khi tạo kho), payload label resolution
  qua union (sites + shared catalog), hint reword "Chưa có kho trong danh mục"
  (chỉ khi danh mục chung rỗng), nút "+ Thêm kho" giữ nguyên.
- **R1 (UI DRIVEN)**: KH 25282 (JB customer, 0 kho riêng) — dropdown list 13
  kho active của 5 khách (ASKEY XƯỞNG 1/2, BB Đà Nẵng, E2E…, ICD Hà Nội, Kho
  ST, NEWEB-KHO 1-3, QA Nhà xe, SCONECT, SJ TECH, SUNRISE); hint cũ biến mất;
  "+ Thêm kho" còn. BEFORE (trunk 839d0577): dropdown 0 option +
  "Chưa có kho cho khách hàng này" hiển thị.
- **R2 (UI DRIVEN)**: tạo lô LCL thật — KH 25282, Nhập khẩu, kho chung
  "ICD Hà Nội" (site 442, thuộc khách 4), nhà máy "Nhà máy Resolve", route
  bootstrap, BL KHOCHUNG-*. Kết quả DB: shipment 312533 / SHP-2610-19366,
  `pickup_warehouse_site_id=442`, `pickup_location='ICD Hà Nội'`,
  `delivery_location='Nhà máy Resolve'` — label giải đúng từ union.
- **R3**: `warehouseCustomText` giờ match trên danh mục chung (match rộng hơn)
  — covered by `createAdhocFieldLogic` chạy trên `warehouseSites` prop (nguồn
  mới); FE test pin sự kiện dropdown + label resolution ở
  `ShipmentCreateWorkspace.lcl-points.test.tsx` +
  `shipment-create-model.test.ts` (union case).
- **R4**: optimistic merge sau "+ Thêm kho" — ClerkShipmentCreatePage
  TC-CUS-FACTORY-SEARCH-09 (LCL WAREHOUSE case) xanh, refetch shared catalog
  theo `sitesVersion`.
- **R5 (DB/API VERIFIED)**: `?customerId=25282` trả đúng sites của khách
  (factory 3625, không có kho); `?scope=shared` trả 13 kho active mọi khách;
  `?scope=bogus` → 400 "scope không hợp lệ."; thiếu cả hai → 400
  "customerId không hợp lệ." như cũ. Unit tests
  `backend/src/tests/unit/operational-sites-shared-scope.test.ts` (4 case).
- **R6**: factory picker vẫn đọc customer-scoped `sites` — không đổi code
  path factory; FE suite xanh.

Artifacts: `qa/2026-10-22-lcl-kho-chung/` (before/after API log, UI driver
logs + screenshots, DB row).
