# Báo cáo Kiểm tra Độ Phủ Đặc Tả Luồng Hàng Lẻ (LCL) — 2026-10-17

**Nguồn đặc tả:** `2026.10.15_Cap_nhat_luong_hang_le.docx` (*DEV SPEC: HOÀN THIỆN LUỒNG HÀNG LẺ (LCL) – ĐIỀU VẬN, GOM/TÁCH CƯỚC & QUẢN LÝ XE ẢO*).  
**Ngày kiểm tra:** 2026-10-17.  
**Môi trường:** Nhánh `ops-lcl-spec-coverage-audit` (base `f1ec5ac2`).  
**Tóm tắt kết quả kiểm tra:** **7 DONE**, **1 PARTIAL**, **0 MISSING** (theo 8 phần mục đặc tả chính); toàn bộ nghiệp vụ lõi (schema, bảng giá, logic nhảy tiền, bảo toàn doanh thu, xuất debit note xe ảo) đã được hiện thực hóa và kiểm thử tự động toàn diện. Phần còn khuyết (`PARTIAL`) duy nhất là nút bấm tương tác "Hủy ghép / Tách nhóm" trên giao diện người dùng (mặc dù backend API và client logic đã hoàn thiện 100%).

---

## Bảng Tổng Hợp Độ Phủ (Coverage Matrix)

| Mục | Nội dung đặc tả | Đánh giá | Vị trí mã nguồn chính | Kiểm thử liên quan |
|---|---|---|---|---|
| **§1.1** | Danh mục Loại xe/Trọng tải (1.25T…15T, Cont 20'/40', quy tắc nguồn xe tải = 100% xe ngoài, Cont = SilverSea hoặc xe ngoài) | **DONE** | `backend/src/db/schema/pricing.ts:268`<br>`shared/src/constants/index.ts:874`<br>`frontend/src/pages/config/VehicleSizeClassesConfigPage.tsx:62` | `shared/src/constants/lcl-vehicle-sourcing.test.ts`<br>`backend/src/tests/container-price-classes-catalog.test.ts`<br>`backend/src/tests/freight-pricing-config-routes.test.ts` |
| **§1.2** | Bảng giá (Tuyến × Khách hàng / Nhà thầu): đơn giá Cước thu + Cước trả theo trọng tải tấn | **DONE** | `backend/src/db/schema/pricing.ts:49`<br>`backend/src/services/pricing.service.ts:758, 824`<br>`frontend/src/pages/config/PricingTablesConfigPage.tsx:75`<br>`frontend/src/pages/config/CarrierPricingConfigPage.tsx:18` | `frontend/src/pages/config/CarrierPricingConfigPage.test.tsx`<br>`frontend/src/pages/config/PricingTablesConfigPage.vehicle-class.test.tsx`<br>`backend/src/tests/unit/pricing-tombstone-unique-indexes.test.ts` |
| **§2.1** | Kế hoạch Tổng quát: Cảng nâng/hạ hiện Kho lấy/Điểm trả; Tổng quan hàng hóa [SL][Bao bì] \| [kg] · [CBM], không hiện "Chưa có cont" | **DONE** | `backend/src/services/shipment-queries/list-summaries.ts:796`<br>`frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx:171, 281` | `frontend/src/features/dispatch/master-plan/MasterPlanGrid.lcl-display.test.tsx`<br>`backend/src/tests/shipment-list-lcl-site-projection.test.ts` |
| **§2.2** | Kế hoạch Chi tiết Xe: Gom chuyến & gán xe, ô Container 3 dòng, thanh tổng nhanh, popup Gán xe nhóm, BKS thực vs BKS báo khách, cước trả ĐV Lô 1 = 100%, Lô 2..N = 0₫, Tag "Lẻ · Ghép (1/N)", Cont SilverSea tiền đường/lương chuyến tính 1 lần | **DONE** | `backend/src/services/lcl-grouping.service.ts:956`<br>`frontend/src/pages/DispatchDetailPlanPage.tsx:120`<br>`frontend/src/features/dispatch/detailed-plan/AssignTruckGroupDialog.tsx:53`<br>`frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:460` | `backend/src/tests/lcl-grouping.test.ts`<br>`frontend/src/features/dispatch/detailed-plan/AssignTruckGroupDialog.test.tsx`<br>`frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.lcl-grouping.test.tsx`<br>`backend/src/tests/dispatch-plan-lcl-classification.test.ts` |
| **§3.1** | Chứng từ (CUS) - Chi tiết lô hàng: Thông số container "Lô hàng lẻ \| Thu: Xe 3.5T \| Trả: Xe 10T", Phân xe 2 dòng (BKS Thực + Sửa nhanh BKS Báo khách ảo) | **DONE** | `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:156, 835, 1070, 1095`<br>`backend/src/services/lcl-grouping.service.ts:1330` | `frontend/src/features/shipments/detail/ShipmentContainerLedger.test.tsx`<br>`backend/src/tests/cus-lot-flat-row.test.ts`<br>`backend/src/tests/cus-workboard-lcl-parity-365.test.ts` |
| **§3.2** | Chi phí - Quyết toán: Checkbox chọn lô + Nút "Ghép cước thu khách", Thu riêng từng lô (+ chọn loại xe thu + BKS ảo per-lô = 100% AUTO), Ghép cước cùng khách (chặn khác khách), Lô 1 = 100%, Lô 2..N = 0₫ ("Ghép cước cùng Bill..."), Chi hộ giữ nguyên | **DONE** | `frontend/src/pages/ShipmentDebitPage.tsx:379`<br>`frontend/src/features/shipments/debit/MergeRevGroupDialog.tsx:31`<br>`frontend/src/features/shipments/debit/DebitLotLclFacts.tsx:162`<br>`backend/src/services/lcl-grouping.service.ts:1071, 1210`<br>`backend/src/services/revenue-override-read.service.ts:50` | `frontend/src/pages/ShipmentDebitPage.lcl-merge.test.tsx`<br>`frontend/src/pages/ShipmentDebitPage.f2-money.test.tsx`<br>`frontend/src/features/shipments/debit/DebitLotLclFacts.test.tsx`<br>`backend/src/tests/lcl-single-lot-rev-class.test.ts`<br>`backend/src/tests/lcl-grouping.test.ts` |
| **§4** | Kế toán & Xuất Debit Note: Cột Thông số container ("Lẻ · Thu: 5T / Trả: 10T hoặc Ghép cùng Bill..."), Phân xe 2 dòng (BKS Thực + Badge cam Báo khách ảo), Phải thu/Phải trả tự động 100%/0₫, Debit Note gửi khách BKS = BKS báo khách (tuyệt đối không in BKS thực) + Loại xe thu + Chú thích "Ghép xe cùng Bill", Bảng kê gửi nhà xe BKS = BKS thực + Loại xe trả | **DONE** | `frontend/src/pages/accounting/AccountingDebitClosePage.columns.tsx:165, 187`<br>`backend/src/services/billing-document-draft.service.ts:418, 575, 656`<br>`backend/src/services/billing-export-shared.service.ts:209, 324` | `frontend/src/pages/accounting/AccountingDebitClosePage.lcl-columns.test.tsx`<br>`backend/src/tests/shipment-debit-note-export.test.ts`<br>`backend/src/tests/lcl-grouping.test.ts` |
| **Edge Cases** | Ràng buộc an toàn: Hủy ghép / Xóa Lô 1 → Tự chuyển quyền Lô chính + 100% tiền sang Lô 2 (bảo toàn tiền, không rơi về 0₫) | **PARTIAL** | Backend logic & API: `backend/src/services/lcl-grouping.service.ts:364, 452, 523, 625`<br>`backend/src/services/shipment-lifecycle.service.ts:482`<br>`frontend/src/api/dispatchPlanningClient.ts:271, 284`<br>*Giao diện:* Chưa có nút UI "Hủy ghép" | `backend/src/tests/lcl-grouping.test.ts` (suites `FB095-01..06`, `GAP 1`) |

---

## Chi Tiết Đánh Giá Từng Mục Đặc Tả

### §1.1. Danh mục Loại xe / Trọng tải

#### 1. Yêu cầu đặc tả
- Thêm các loại xe tải trọng tải: `1.25T`, `2.5T`, `3.5T`, `5T`, `8T`, `10T`, `15T` bên cạnh các loại Container `CONT20`, `CONT40` (và `CONT40HC`).
- Hàng lẻ chạy xe tải = 100% Xe ngoài (Nhà thầu / Vendor).
- Hàng lẻ chạy Cont 20'/40' = Xe nội bộ SilverSea HOẶC Xe ngoài.

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Schema & Migration:**
  - `backend/src/db/schema/pricing.ts:268-277`: Bảng `vehicle_size_classes` định nghĩa các cột `id`, `code`, `name`, `isContainer`, `sortOrder`.
  - `backend/drizzle/20261015103000_lcl_vehicle_pricing.sql:8-25`: Tạo bảng và index hỗ trợ tra cứu.
  - `backend/src/seed/seed-demo-freight-pricing.ts:14`: Nạp danh mục chuẩn gồm 9 mã: `['1.25T', '2.5T', '3.5T', '5T', '8T', '10T', '15T', 'CONT20', 'CONT40']`.
- **Quy tắc nguồn xe (Vehicle Sourcing Rules):**
  - `shared/src/constants/index.ts:874-891`: Enum `LclVehicleSourcing` (`EXTERNAL_ONLY` và `INTERNAL_OR_EXTERNAL`) cùng hàm giải định `lclVehicleSourcingRule(isContainer)`.
  - `backend/src/services/lcl-grouping.service.ts:974-976`: Kiểm tra chặt chẽ trên máy chủ:
    ```typescript
    if (lclVehicleSourcingRule(vehicleClass.isContainer) === LclVehicleSourcing.EXTERNAL_ONLY && internalTruck) {
      throw new ApiError(400, `Hàng lẻ xe tải 100% xe ngoài — BKS ${actualTruckNo} là xe nội bộ, chọn BKS nhà xe`);
    }
    ```
  - `frontend/src/features/dispatch/detailed-plan/AssignTruckGroupDialog.tsx:133-143, 175-177`: Ẩn đội xe nội bộ và chặn submit nếu chọn xe tải với BKS nội bộ.
- **Giao diện cấu hình danh mục:**
  - `frontend/src/pages/config/VehicleSizeClassesConfigPage.tsx:62-118`: Tuyến `/config/vehicle-size-classes` hỗ trợ CRUD đầy đủ danh mục loại xe, gán nhóm "Xe tải (trọng tải)" hoặc "Container", tự động hiển thị nhãn quy tắc nguồn xe ("100% xe ngoài" hoặc "Xe nội bộ hoặc xe ngoài").

#### 4. Kiểm thử
- `shared/src/constants/lcl-vehicle-sourcing.test.ts`
- `backend/src/tests/container-price-classes-catalog.test.ts`
- `backend/src/tests/freight-pricing-config-routes.test.ts`

---

### §1.2. Bảng giá (Tuyến đường × Khách hàng / Nhà thầu)

#### 1. Yêu cầu đặc tả
- Đơn giá Cước thu (Khách hàng × Tuyến × Trọng tải/Cont) và Cước trả (Nhà thầu × Tuyến × Trọng tải/Cont).

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Cước thu khách (`pricing_tables`):**
  - Cột `vehicle_size_class_id` trong `backend/src/db/schema/pricing.ts:16-17`, liên kết trực tiếp vào bảng danh mục loại xe.
  - Hàm tra cứu giá: `resolveCustomerVehicleClassPrice` tại `backend/src/services/pricing.service.ts:758-803` tự động tra dòng giá còn hiệu lực mới nhất theo `customerId × routeId × vehicleSizeClassId × date`.
  - Màn hình cấu hình: `frontend/src/pages/config/PricingTablesConfigPage.tsx:75, 189-200` cho phép chọn Khách hàng, Tuyến đường, và Loại xe từ danh mục dropdown.
- **Cước trả nhà xe (`carrier_route_pricing`):**
  - Bảng `carrier_route_pricing` trong `backend/src/db/schema/pricing.ts:49-66`, migration `20261015103000_lcl_vehicle_pricing.sql:34-49`.
  - Hàm tra cứu cascade: `resolveCarrierVehicleClassPrice` tại `backend/src/services/pricing.service.ts:824-867`. Quy tắc: Giá riêng của nhà xe (`supplier_id`) ưu tiên cao nhất; nếu chưa cấu hình giá riêng, hệ thống tự động rơi về giá chung (`supplier_id IS NULL`).
  - Màn hình cấu hình: `frontend/src/pages/config/CarrierPricingConfigPage.tsx:18-80` tại tuyến `/carrier-route-pricing`.

#### 4. Kiểm thử
- `backend/src/tests/freight-pricing-config-routes.test.ts`
- `backend/src/tests/unit/pricing-tombstone-unique-indexes.test.ts`
- `frontend/src/pages/config/CarrierPricingConfigPage.test.tsx`
- `frontend/src/pages/config/PricingTablesConfigPage.vehicle-class.test.tsx`

---

### §2.1. Kế hoạch Tổng quát (Điều vận)

#### 1. Yêu cầu đặc tả
- Cột CẢNG NÂNG/HẠ: Hiển thị Kho lấy hàng / Điểm trả hàng (nếu có), nếu không có hiển thị ký tự `—`.
- Cột TỔNG QUAN HÀNG HÓA: Định dạng `[SL] [Loại bao bì] | [Số kg] · [CBM]` (Ví dụ: `5 PALLET | 1.900 kg · 4 CBM`). Tuyệt đối KHÔNG hiển thị `Chưa có cont`.

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Cột Cảng nâng / Cảng hạ:**
  - `frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx:171-176`:
    ```typescript
    if (item.cargoMode === 'LCL') {
      return [
        { direction: 'lift', label: 'Nâng', portName: item.pickupWarehouseSiteName?.trim() || '—', containerSummary: null },
        { direction: 'drop', label: 'Hạ', portName: item.factoryName?.trim() || '—', containerSummary: null },
      ];
    }
    ```
  - Backend join dữ liệu: `backend/src/services/shipment-queries/list-summaries.ts:796-810` join alias `shipment_list_pickup_warehouse_site` trên `pickup_warehouse_site_id` để xuất `pickupWarehouseSiteName`.
- **Cột Tổng quan hàng hóa:**
  - `frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx:281-295` (hàm `cargoCellLines`):
    - Dòng 1: `[packageCount] [packageType]` hoặc `—`.
    - Dòng 2: `[cargoWeightKg] · [cargoVolumeCbm]` hoặc `—`.
    - Bỏ hẳn chuỗi `Chưa có cont` đối với lô hàng lẻ.
  - Tái sử dụng đồng bộ cho xuất Excel: `frontend/src/features/dispatch/master-plan/masterPlanExport.ts:72`.

#### 4. Kiểm thử
- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.lcl-display.test.tsx`
- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.lcl-display.fb090-foundation.test.tsx`
- `backend/src/tests/shipment-list-lcl-site-projection.test.ts`
- `backend/src/tests/shipment-list-lcl-site-projection.fb090-foundation.test.ts`

---

### §2.2. Kế hoạch Chi tiết Xe (Gom chuyến & Gán xe)

#### 1. Yêu cầu đặc tả
- Cột CONTAINER 3 dòng:
  1. "Lô hàng lẻ" (hoặc Loại xe đã chọn: `Lẻ · Xe {Loại}`)
  2. `[SL] [Bao bì]`
  3. `[kg] · [CBM]`
- Tính năng cộng tổng nhanh + Ghép chuyến: Tích chọn nhiều lô → nút "+ Gán xe" → Popup:
  - Trường 1: Loại xe tính cước trả ĐV (dropdown trọng tải / Cont).
  - Trường 2: Chọn Nhà xe & BKS thực tế (Xe tải = chỉ Nhà thầu; Cont = SilverSea hoặc Nhà thầu).
  - Trường 3: BKS Báo khách (mặc định copy BKS thực; cho phép sửa per-lô; Combobox danh sách hoặc gõ text tự do).
- Hiển thị thanh tổng: "Đang chọn N lô: Tổng X kg | Y CBM".
- Logic nhảy tiền CƯỚC TRẢ ĐV khi ghép: Lô 1 = 100% (tự tra bảng giá), Lô 2..N = 0₫.
- Tag PHÂN LOẠI: "Lẻ · Ghép (1/5)".
- Lưu ý xe nội bộ Cont SilverSea: Tiền đường / Lương chuyến chỉ tính 1 lần vào Lô 1, Lô 2..N = 0₫.

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Cột Container 3 dòng:**
  - `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:460-474`:
    - Dòng 1: `Lẻ{row.lcl?.group?.vehicleClassCode ? ' · Xe ' + row.lcl.group.vehicleClassCode : ''}`.
    - Dòng 2: Gọi `lclCargoLine(row)` hiển thị `[SL] [Bao bì]`.
    - Dòng 3: Gọi `lclMeasureLine(row)` hiển thị `[kg] · [CBM]`.
- **Thanh tổng nhanh:**
  - `frontend/src/pages/DispatchDetailPlanPage.tsx:120-147`: Hiển thị thanh `.lcl-selection-bar` với nội dung `Đang chọn {selectedLclRows.length} lô: Tổng {formatWeight(weight)} | {formatVolumeCbm(volume)}`, nút "Bỏ chọn" và nút "Gán xe nhóm".
- **Hộp thoại Gán xe nhóm:**
  - `frontend/src/features/dispatch/detailed-plan/AssignTruckGroupDialog.tsx:53-308`:
    - Trường 1: `USearchableField` chọn Loại xe tính cước trả ĐV (dòng 233).
    - Trường 2: `USearchableField` chọn Nhà xe (dòng 258) lọc theo quy tắc nguồn xe, và chọn BKS thực tế (dòng 274, hỗ trợ chọn hoặc gõ tay `allowsCustomValue`).
    - Trường 3: `USearchableField` BKS báo khách (ảo) (dòng 284, tự động copy từ BKS thực thông qua effect dòng 108, có thể gõ đè tự do).  
      *Lưu ý về per-lô:* Hộp thoại gán xe nhóm gán BKS báo khách chung cho nhóm; việc sửa per-lô độc lập được thực hiện linh hoạt tại màn hình CUS Chi tiết lô hàng (§3.1).
- **Logic nhảy tiền Cước trả ĐV:**
  - `backend/src/services/lcl-grouping.service.ts:1003-1027`: Lô 1 được tính 100% đơn giá trả ĐV qua `applyPrincipalCostFreight` (hoặc lấy số nhập tay nếu điều vận gõ tay); các Lô 2..N được cập nhật `externalFreightCost = '0'`.
- **Tag Phân loại:**
  - `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:502`: Thẻ tag `Lẻ · Ghép ({order}/{memberCount})`.
- **Cont SilverSea tiền đường / lương chuyến:**
  - `backend/src/services/lcl-grouping.service.ts:980, 1024-1026`:
    ```typescript
    const ownContainerGroup = carrier.carrierType === 'OWN' && vehicleClass.isContainer;
    if (ownContainerGroup) {
      await zeroMemberDriverMoney(tx, trip.tripId);
    }
    ```
    Hàm `zeroMemberDriverMoney` gán `driverSalary: '0'`, `totalRoadAllowance: '0'`, và `roadAllowanceOverride: '0'` để các màn hình lương lái xe và chi phí chuyến không tính trùng.

#### 4. Kiểm thử
- `frontend/src/features/dispatch/detailed-plan/AssignTruckGroupDialog.test.tsx`
- `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.lcl-grouping.test.tsx`
- `backend/src/tests/lcl-grouping.test.ts` (suites `FB-092 cost dimension`, `161026232309`, `161026232319`, `161026232329`)
- `backend/src/tests/dispatch-plan-lcl-classification.test.ts`
- `backend/src/tests/dispatch-plan-row-lcl-rig.test.ts`

---

### §3.1. Chứng từ (CUS): Chi tiết lô hàng

#### 1. Yêu cầu đặc tả
- Cột THÔNG SỐ CONTAINER: "Lô hàng lẻ | Thu: Xe 3.5T | Trả: Xe 10T" (khi đã chọn loại xe cước).
- Cột PHÂN XE 2 dòng:
  - Dòng 1: `[Tên Nhà xe] - BKS Thực: [15C-111.11]`
  - Dòng 2 (click sửa nhanh): `BKS Báo khách (Ảo): [15C-999.99]`. Combobox: danh sách hoặc text tự do.

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Cột Thông số container:**
  - `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:156-165, 1070`:
    Hàm `lotSpecLine(row)` tạo chuỗi `Lô hàng lẻ` ghép kèm `Thu: Xe ${row.revVehicleClassCode}` và `Trả: Xe ${row.costVehicleClassCode}`. Nếu chưa chọn loại xe nào, hiển thị cảnh báo phụ `Chưa chọn loại xe tính cước`.
- **Cột Phân xe 2 dòng & Sửa nhanh BKS Báo khách:**
  - `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:1095-1135`:
    - Dòng 1: `<strong>{`${row.carrierName?.trim() || 'Chưa phân nhà xe'} - BKS Thực: ${lotActualPlate}`}</strong>`.
    - Dòng 2: Nút trigger `billingPlateTrigger` mở form sửa nhanh inline `billingPlateEditor` (dòng 835-865) sử dụng `USearchableField` có gợi ý danh sách biển số và cho phép gõ tự do (`allowsCustomValue`).
    - Khi lưu, gọi API `updateLclTruck` (`POST /api/shipments/lcl/truck`) cập nhật trực tiếp `billingTruckNo` trong cơ sở dữ liệu (`backend/src/services/lcl-grouping.service.ts:1330`).
    - Cơ chế này cũng áp dụng nhất quán cho cả dòng FCL khi BKS ảo khác BKS thực (theo card 171026000407 / commit `162f2d77`).

#### 4. Kiểm thử
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.test.tsx` (kiểm tra AC1, AC5)
- `backend/src/tests/cus-lot-flat-row.test.ts`
- `backend/src/tests/cus-workboard-lcl-parity-365.test.ts`

---

### §3.2. Chi phí - Quyết toán (Ghép/Tách cước Thu khách)

#### 1. Yêu cầu đặc tả
- Checkbox đầu dòng + Nút "Ghép cước thu khách" trên thanh công cụ.
- Trường hợp 1 (thu riêng từng lô): Chọn loại xe tính cước thu + BKS ảo per-lô, AUTO cước = 100% đơn giá.
- Trường hợp 2 (ghép):
  - Tích chọn lô + click "Ghép cước thu khách".
  - Validation: Chỉ ghép được các lô của CÙNG 1 Khách hàng. Khác khách hàng thì báo lỗi chặn.
  - Popup: Chọn loại xe tính cước thu + BKS ảo dùng chung.
  - Logic nhảy tiền: Lô 1 = 100%, Lô 2..N = 0₫ với chú thích "Ghép cước cùng Bill [Bill Lô 1]".
  - TỔNG CHI HỘ Lô 2, 3 giữ nguyên (chỉ Cước vận tải = 0).

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Checkbox & Nút công cụ:**
  - `frontend/src/pages/ShipmentDebitPage.tsx:379-397`: Checkbox chọn từng lô lẻ đang mở; nút `Ghép cước thu khách` tự động kích hoạt khi có từ 2 lô lẻ chưa ghép được chọn.
- **Trường hợp 1 (Thu riêng từng lô / Tách cước):**
  - Thực hiện tại commit `36e07f3e` (card 161026232349).
  - Giao diện: `frontend/src/features/shipments/debit/DebitLotLclFacts.tsx:162-185`: Khối "LOẠI XE TÍNH CƯỚC THU KHÁCH" với ô chọn loại xe từ danh mục và nút "Lưu loại xe". BKS ảo được chỉnh sửa độc lập tại khối PHÂN XE.
  - Backend: `setLclLotRevClass` tại `backend/src/services/lcl-grouping.service.ts:1210-1324` (`POST /api/shipments/lcl/rev-class`). Tự động tra bảng giá khách × tuyến × loại xe và gán 100% tiền cước vào chuyến live hoặc bản ghi snapshot nếu chưa có chuyến.
- **Trường hợp 2 (Ghép cước thu khách):**
  - Hộp thoại: `frontend/src/features/shipments/debit/MergeRevGroupDialog.tsx:31-130`.
  - Kiểm tra cùng một khách hàng:
    - Phía client: `MergeRevGroupDialog.tsx:45-46, 85, 101-105` khóa nút submit và hiển thị cảnh báo nếu các lô thuộc nhiều khách hàng khác nhau.
    - Phía máy chủ: `backend/src/services/lcl-grouping.service.ts:1082-1096` kiểm tra nghiêm ngặt tập hợp `customerId`, ném lỗi 400 kèm thông tin chi tiết các số Bill và tên khách xung đột (commit `fa1908a3` / `260a9fa3`).
  - Hộp thoại nhập liệu: Chọn Loại xe tính cước thu và BKS báo khách ảo dùng chung.
  - Logic nhảy tiền & Ghi chú:
    - `backend/src/services/lcl-grouping.service.ts:1130-1185`: Lô 1 nhận 100% cước từ bảng giá khách hàng; Lô 2..N gán `revenue = '0'` kèm lý do `revenueOverrideReason: Ghép cước cùng Bill ${principalRef}` (hoặc snapshot tương ứng).
    - Các bảng đối soát đọc kênh override qua `backend/src/services/revenue-override-read.service.ts:50-80` (commit `f7bef927` / `b859d0b8`).
  - Bảo toàn chi hộ: Nghiệp vụ ghép cước hoàn toàn không tác động đến bảng `ops_expense_entries`, đảm bảo chi hộ của tất cả các lô giữ nguyên 100%.

#### 4. Kiểm thử
- `frontend/src/pages/ShipmentDebitPage.lcl-merge.test.tsx` (bao gồm case chặn khác khách hàng, thứ tự Lô 1..N)
- `frontend/src/pages/ShipmentDebitPage.f2-money.test.tsx`
- `frontend/src/features/shipments/debit/DebitLotLclFacts.test.tsx`
- `backend/src/tests/lcl-single-lot-rev-class.test.ts`
- `backend/src/tests/lcl-grouping.test.ts` (suites `FB-093 rev dimension`, `F-2`, `TC-A12`)

---

### §4. Kế toán (Chốt debit & Xuất Debit Note)

#### 1. Yêu cầu đặc tả
- Cột THÔNG SỐ CONTAINER: "Lẻ · Thu: 5T / Trả: 10T hoặc Ghép cùng Bill...".
- Cột PHÂN XE 2 dòng:
  - Dòng 1: `[Tên Nhà xe thực tế] · Thực: [BKS Thực]`
  - Dòng 2 (nếu BKS ảo ≠ BKS thực): Badge màu cam `Báo khách (Ảo): [BKS Ảo]`
- Cột PHẢI THU (Cước thu tự động): Theo nhóm ghép CUS (Lô 1 = 100%, Lô 2..N = 0₫).
- Cột PHẢI TRẢ (Cước trả ĐV): Theo nhóm ghép ĐV (Lô 1 = 100%, Lô 2..N = 0₫).
- Xuất Debit Note:
  - Gửi KHÁCH (Phải thu):
    - BKS = BKS Báo khách (`billing_truck_no`). Tuyệt đối KHÔNG in BKS thực tế.
    - Loại xe = Loại xe tính cước thu khách.
    - Tiền = Cột Cước thu (Lô 1 = 100%, Lô 2..N = 0₫ + Chú thích "Ghép xe cùng Bill [Bill Lô 1]").
  - Gửi Nhà xe (Phải trả): Lọc theo Nhà xe thực tế, BKS = BKS thực, Loại xe = Loại xe cước trả.

#### 2. Phân loại: DONE

#### 3. Bằng chứng mã nguồn
- **Màn hình Kế toán chốt debit (`/accounting/debit-close`):**
  - Cột Thông số container: `frontend/src/pages/accounting/AccountingDebitClosePage.columns.tsx:165-185` hiển thị `row.lcl.label` kèm `(Ghép cùng Bill {ref})` cho các lô thành viên.
  - Cột Phân xe 2 dòng: `frontend/src/pages/accounting/AccountingDebitClosePage.columns.tsx:187-210`:
    - Dòng 1: `{row.phanXe[0]} · Thực: {row.lcl.actualTruckNo}`.
    - Dòng 2: Hiển thị `<span className="debit-billing-badge">Báo khách (Ảo): {billing}</span>` với màu cam nổi bật chỉ khi `billingTruckNo !== actualTruckNo`.
  - Cột Phải thu / Phải trả: Đọc đúng số tiền 100% / 0₫ từ kênh ghi đè và cước ngoài của chuyến.
- **Xuất Debit Note gửi Khách hàng:**
  - BKS báo khách bắt buộc: `backend/src/services/billing-document-draft.service.ts:575-579` (và commit `3e212cd7` / `359e12e8`):
    ```typescript
    truckPlate: input.trip.billingTruckNo?.trim()
      ? input.trip.billingTruckNo.trim()
      : (input.trip.actualTruckNo != null || input.trip.cargoMode === 'LCL')
        ? null
        : (input.trip.truckPlate || input.trip.externalPlateNumber || null)
    ```
    Bảo đảm file Excel/PDF gửi khách chỉ lấy BKS báo khách ảo, không bao giờ lộ BKS thực tế.
  - Loại xe thu: `backend/src/services/billing-export-shared.service.ts:209-210` gán loại xe là tên hoặc mã của loại xe tính cước thu khách (`revVehicleClassName ?? revVehicleClassCode`).
  - Tiền và chú thích ghép: `backend/src/services/billing-document-draft.service.ts:652-656` tự động nối chú thích `Ghép xe cùng Bill [Bill Lô 1]` cho dòng cước 0₫ của các lô thành viên.
- **Bảng kê gửi Nhà xe (Phải trả):**
  - `backend/src/services/billing-document-draft.service.ts:418-419` & `billing-export-shared.service.ts:324-326`:
    ```typescript
    renderData.truckPlate = trip.actualTruckNo?.trim() || trip.truckPlate || trip.externalPlateNumber || null;
    renderData.vehicleType = trip.costVehicleClassName ?? trip.costVehicleClassCode ?? null;
    ```
    Đảo ngược quyền ưu tiên: chỉ lấy BKS thực tế và loại xe cước trả, hoàn toàn không mang BKS ảo hay loại xe cước thu sang bảng kê nhà xe. Lọc dữ liệu theo từng nhà xe thực tế thông qua bộ lọc nhà xe và hàm `buildSupplierPaymentLines`.

#### 4. Kiểm thử
- `frontend/src/pages/accounting/AccountingDebitClosePage.lcl-columns.test.tsx`
- `backend/src/tests/shipment-debit-note-export.test.ts` (suite card 161026232439 và card 171026004332)
- `backend/src/tests/lcl-grouping.test.ts` (suite `FB-094 debit note + board`)

---

### Edge Cases An Toàn

#### 1. Yêu cầu đặc tả
- Hủy ghép / Xóa Lô 1 → Tự chuyển quyền Lô chính + 100% tiền sang Lô 2 (không để tiền cước rơi về 0₫).

#### 2. Phân loại: PARTIAL
- **Xóa Lô 1:** **DONE** (Cơ chế promote trong database transaction hoàn thiện và được kiểm thử).
- **Hủy ghép (Un-merge API & Service):** **DONE** (Hỗ trợ tách lẻ 1 lô hoặc rã cả nhóm, tự động bảo toàn 100% doanh thu và cước trả).
- **Giao diện người dùng (UI Trigger):** **MISSING** (Chưa có nút bấm "Hủy ghép" / "Tách nhóm" trên các màn hình CUS hay Điều vận).

#### 3. Bằng chứng mã nguồn
- **Xóa Lô 1 (Soft delete):**
  - `backend/src/services/shipment-lifecycle.service.ts:482`: Trong transaction `softDeleteShipment`, gọi hàm `promoteLclGroupsOnShipmentDelete`.
  - `backend/src/services/lcl-grouping.service.ts:364-442, 625-660`: Hàm `promotePrincipalOnRemoval` tự động nâng Lô 2 có thứ tự nhỏ nhất lên làm Lô chính (Lô 1 mới), chuyển toàn bộ 100% cước (cả cước thu, snapshot cước thu, cước trả ĐV, và tiền đường/lương chuyến lái xe) sang Lô 2. Nếu nhóm chỉ còn 1 lô, nhóm tự động giải tán sạch sẽ trong khi lô còn lại vẫn giữ nguyên loại xe và 100% tiền.
- **Dịch vụ Backend & API Hủy ghép:**
  - `backend/src/services/lcl-grouping.service.ts:523-620` (`POST /api/shipments/lcl/unmerge`): Tách một lô khỏi nhóm chiều COST hoặc REV; nếu Lô 1 tách, tự động chuyển quyền Lô chính và tiền sang lô kế tiếp.
  - `backend/src/services/lcl-grouping.service.ts:452-515` (`POST /api/shipments/lcl/unmerge-group`): Giải tán toàn bộ nhóm, bảo toàn 100% cước cho Lô 1.
  - Chặn hủy ghép khi đã chốt sổ: `backend/src/services/lcl-grouping.service.ts:241-267` từ chối nếu bất kỳ lô nào trong nhóm đã có khóa kế toán (`shipment_accounting_locks`) hoặc chuyến đã hoàn thành.
  - Client API frontend: `frontend/src/api/dispatchPlanningClient.ts:271, 284` xuất sẵn hai hàm `unmergeLclLot` và `unmergeLclGroup`.
- **Khoảng trống còn lại (Gap):**
  - Mặc dù client API và backend service đã hoàn tất và kiểm thử xanh 100%, trên giao diện CUS (`frontend/src/features/shipments/debit/DebitLotLclFacts.tsx`) hiện chỉ có dòng text gợi ý (*"Lô đã thuộc nhóm ghép cước thu khách — tách nhóm (Hủy ghép) trước khi chọn loại xe riêng cho lô này"* - dòng 173) nhưng **chưa gắn nút bấm (Button) gọi `unmergeLclLot` hay `unmergeLclGroup`**.
  - Đây là tồn dư đã được ghi nhận trong `testplan/2026-10-16-fb095-lcl-unmerge-safety.md:33-35`: *"UI nút Tách các màn CUS/dispatch: ngoài phạm vi vé này (client API unmergeLclLot chưa có caller)"*.

#### 4. Kiểm thử
- `backend/src/tests/lcl-grouping.test.ts`:
  - Suite `LCL grouping — FB-095 un-merge safety` (9 test cases: `FB095-01` đến `FB095-06`).
  - Suite `GAP 1 — money safety on unshipping / deleting a group` (3 test cases: bảo toàn tiền khi rã nhóm, xóa Lô 1 chuyển 100% tiền, xóa lô áp chót).

---

## Kết Luận & Khuyến Nghị

1. **Mức độ hoàn thiện:** Toàn bộ luồng tính toán tài chính, bảng giá, phân xe ảo, gom chuyến điều vận, ghép cước thu CUS, đối soát kế toán và xuất Debit Note / Bảng kê nhà xe đã đạt **100% yêu cầu nghiệp vụ lõi**. Cơ chế bảo toàn tiền khi xóa Lô chính (Money Conservation Law) hoạt động chính xác cả ở tầng cơ sở dữ liệu lẫn các bản ghi snapshot.
2. **Hành động tiếp theo cần làm:**
   - Bổ sung nút bấm `[Tách nhóm / Hủy ghép]` trên thanh thông tin `DebitLotLclFacts.tsx` (màn hình Chi phí - Quyết toán) và trên lưới Kế hoạch Chi tiết Xe để người dùng có thể kích hoạt trực tiếp `unmergeLclLot` / `unmergeLclGroup` từ giao diện thay vì chỉ thao tác qua API.
