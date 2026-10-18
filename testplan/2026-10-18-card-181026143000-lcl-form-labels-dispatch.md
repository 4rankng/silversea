# Card 181026143000 — Spec 2026.10.17: Điều chỉnh form Tạo lô hàng lẻ (LCL) + sync Điều vận

Nguồn: user spec docx 2026.10.17 (`Dieu_chinh_form_tao_lo_hang_le.docx`, cache
`doc_58c2e6857719`); brief worktree `fix-lcl-form-labels-dispatch`.

## Kết luận verification (2026-10-18, base 64c6d8e1)

**Spec đã được thỏa mãn đầy đủ tại base của branch này** — không có gap nào
cần sửa code. Spec này chính là user directive 2026-10-17 mà **FB-105** đã
implement trước khi card này được cắt (commits `5a17e299` create form +
`3628dae4` dispatch, cả hai đã có trong `8fc1bcf5`). Card 181026143000 là lần
ingest lặp của cùng một tài liệu spec. Việc của card này: xác minh từng mục
specAgainst source, chạy toàn bộ gate scoped, và pin các case regression dưới
đây vào đúng test hiện hữu — không re-implement, không churn code.

## Case matrix — spec item → implementation → test → evidence

### TC-LCL-181026143000-01 — Label động theo Hình thức xuất nhập khẩu (spec §2.1a)

Steps: mở `/shipments/new` (ClerkShipmentCreatePage → ShipmentCreateWorkspace),
chọn Khách hàng catalog + Loại hàng = Hàng lẻ, rồi đổi Hình thức XNK.

Expected & actual (PASS):
- Nhập khẩu: label ô Nhà máy = `Nhà máy (Điểm trả hàng) *`; ô Kho =
  `Kho lấy hàng (CFS/Cảng) *`, placeholder `Chọn hoặc nhập kho CFS lấy hàng...`
- Xuất khẩu: label ô Nhà máy = `Nhà máy (Điểm lấy hàng) *`; ô Kho =
  `Kho trả hàng (CFS/Cảng) *`, placeholder `Chọn hoặc nhập kho CFS hạ/giao hàng...`

| Mục | File | Test |
|---|---|---|
| Label + placeholder + dấu * | `frontend/src/features/shipments/create/ShipmentCreateLclRouteSection.tsx` (Nhà máy 96-100, Kho 184-208) | `ShipmentCreateWorkspace.lcl-points.test.tsx` «names the Kho and the Nhà máy by hình thức xuất nhập khẩu» |

### TC-LCL-181026143000-02 — Validation Nhà máy khi Hàng lẻ (spec §2.2, 1b)

Steps: form LCL catalog lot, bỏ trống Nhà máy → bấm «Tạo lô hàng»; lặp lại với
checkbox «Lệnh chạy ngoài» bật.

Expected & actual (PASS): LCL catalog lot thiếu Nhà máy → issue
`shipment-operational-site` «Chọn nhà máy.» (chấp nhận pick catalog HOẶC text
tự do); Kho (CFS/Cảng) cũng vậy (`shipment-pickup-warehouse`). Bật «Lệnh chạy
ngoài» (isAdHoc) → cả hai waiver theo MasterDataNhaMay §4 (hybrid intake), dấu
* biến mất ở cả 2 ô.

| Mục | File | Test |
|---|---|---|
| CREATE validation set + ad-hoc waiver | `frontend/src/features/shipments/create/shipment-create-model.ts` (getShipmentCreateReadiness, dòng 234-244) | `shipment-create-model.test.ts` (LCL catalog vs ad-hoc readiness); `ShipmentCreateWorkspace.asterisk-contract.test.tsx` «marks every enforced LCL field…» + «LCL ad-hoc waives the catalog marks (route and warehouse)» |
| Text tự do tính là đã điền (combobox 1c) | `ShipmentCreateLclRouteSection.tsx` (allowsCustomValue + onCustomValue) | `ShipmentCreateWorkspace.lcl-points.test.tsx` «counts typed operating points as filled» |

### TC-LCL-181026143000-03 — Combobox + nút Thêm (spec §2.2, 1c)

Expected & actual (PASS): cả 2 ô là combobox chọn danh mục hoặc gõ text tự do;
nút `+ Thêm nhà máy` mở dialog «Thêm nhà máy», nút `+ Thêm kho` mở dialog
«Thêm kho» (quick-add 6 trường, FB-077/20261009_10), tạo xong tự chọn site mới.

| Mục | File | Test |
|---|---|---|
| Combobox + custom text | `ShipmentCreateLclRouteSection.tsx` | như case 02 + `ClerkShipmentCreatePage.test.tsx` TC-CUS-FACTORY-SEARCH-09 (matrix FCL/LCL × FACTORY/WAREHOUSE, `Thêm kho`/`Thêm nhà máy`) |

### TC-LCL-181026143000-04 — Bố cục (spec §2.3, 1d)

Expected & actual (PASS): ô Kho nằm trong card «Điểm vận hành & tuyến», cùng
section với Tuyến đường + Nhà máy; card «Thông tin hàng» chỉ còn Loại hàng,
Quy cách đóng gói, Số lượng, Trọng lượng (kg), Thể tích (CBM).

| Mục | File | Test |
|---|---|---|
| Layout move | `ShipmentCreateWorkspace.tsx` (LclRouteSection chỉ render cho LCL, 625-645) + `ShipmentCreateLclCargoFields.tsx` (4 trường hàng) | `ShipmentCreateWorkspace.lcl-points.test.tsx` «keeps both operating points inside the "Điểm vận hành & tuyến" card» |

### TC-LCL-181026143000-05 — Dispatch columns cho lô LCL (spec §3)

Steps: tạo lô LCL Nhập/Xuất (pick hoặc gõ tên kho CFS + nhà máy) → mở
`/dispatch` (Kế hoạch Tổng quát, MasterPlanPage → MasterPlanGrid) và
`/dispatch-detail` (Kế hoạch Chi tiết Xe, DispatchDetailPlanPage →
DetailedPlanGrid).

Expected & actual (PASS):
- LCL NHẬP KHẨU: Nâng = tên Kho lấy hàng (CFS); Hạ/Trả = tên Nhà máy.
- LCL XUẤT KHẨU: Nâng = tên Nhà máy; Hạ/Trả = tên Kho trả hàng (CFS).
- Không có catalog site → dùng text tự do đã lưu (`pickup_location` /
  `delivery_location`); không biết gì → «—», không bao giờ «Chưa có cont».
- FCL giữ nguyên cặp cảng cont (DSP-PORT-01), không đảo.

| Mục | File | Test |
|---|---|---|
| Quy tắc dùng chung (một rule cho mọi surface) | `frontend/src/features/shipments/liftDropPoints.ts` | `liftDropPoints.test.ts` (cả 2 chiều + FCL) |
| Kế hoạch Tổng quát (cột Cảng nâng/Cảng hạ) | `MasterPlanGrid.tsx` (aggregateContainerPortGroupLines 175-190) | `MasterPlanGrid.lcl-display.test.tsx` (2 chiều, whitespace, «—») |
| Kế hoạch Chi tiết Xe (cột Nâng hàng/Trả hàng) | `DetailedPlanGrid.tsx` (388-418) | `DetailedPlanGrid.test.tsx` DSP-PORT-02 (2 chiều + fallback + «—», FCL pin DSP-PORT-01) |
| BE shape — detail plan rows (`liftDrop`) | `backend/src/services/dispatch-planning-detail-plan-read.service.ts` (538-546) | `backend/src/tests/dispatch-plan-lift-drop-lcl.test.ts` |
| BE shape — list projection (`pickupWarehouseSiteName`) | `backend/src/services/shipment-queries/list-summaries.ts` | `backend/src/tests/shipment-list-lcl-site-projection.test.ts`; `shipment-detail-lift-drop-projection.test.ts` |
| Chi tiết lô (surface thứ ba cùng rule) | `frontend/src/pages/ShipmentDetailPage.tsx` (268) | `ShipmentDetailPage.test.tsx` «LCL Nhập: Nâng = Kho lấy hàng (CFS), Hạ = Nhà máy» |

## Quyết định tại các chỗ spec mơ hồ

1. **Premise «hiện trạng SAI» đã stale so với base**: spec nói label đang fix
   cứng «Kho lấy hàng *», nhưng FB-105 (đúng directive 2026-10-17 này) đã xử
   lý từ 2026-10-17 sáng, trước khi card được cắt 2026-10-18 14:30. Quyết
   định: verify + pin bằng evidence, không viết code trùng.
2. **Trạng thái chưa chọn Hình thức XNK**: spec không định nghĩa label khi
   trường Hình thức còn trống. Hành vi giữ label tiền-FB-105 trung tính
   («Nhà máy», «Kho lấy hàng») — pinned trong test là cố ý, không bịa thêm.
3. **Kho (CFS/Cảng) cũng bắt buộc**: spec §2.2 chỉ gọi tên Nhà máy, nhưng
   §2.1 vẽ «*» trên cả ô Kho. Validation hiện hành yêu cầu cả hai điểm (FB-105
   §2) — nhất quán với dấu * trên label; ghi nhận đây là hành vi có chủ đích.
4. **Tên cột**: Tổng quát dùng «Cảng nâng/Cảng hạ», Chi tiết Xe dùng
   «Nâng hàng/Trả hàng» — spec gộp chung («Cảng nâng / Nâng hàng (Điểm lấy)»);
   cả hai đọc đúng một rule dùng chung `resolveLiftDropPoints`.
5. **Fallback text tự do**: spec không nói gì khi kho/nhà máy được gõ tay chứ
   không chọn danh mục; hành vi: tên gõ tay được lưu vào pickup/delivery
   location và hiện đúng cột theo chiều (create-model test pin mapping).

## Gate evidence (2026-10-18, worktree fix-lcl-form-labels-dispatch)

- `qa/2026-10-18_lcl-form-labels-dispatch_fe-vitest-scoped.log` — 10 file,
  **243/243 pass**, EXIT 0 (form + labels + validation + dispatch + detail).
- `qa/2026-10-18_lcl-form-labels-dispatch_be-scoped.log` — 3 suite BE shape,
  **4/4 pass**, EXIT 0 (dev DB :5441).
- `qa/2026-10-18_lcl-form-labels-dispatch_fe-tsc.log` — EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_be-tsc.log` — EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_lint.log` — EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_make-build.log` — EXIT 0 (6.25s).

## Phạm vi không cover

- Full FE/BE suite không chạy (card verification có bộ scoped bao trọn mọi
  file test chạm spec; không thay đổi code sản phẩm).
- UI driver (rung 3) không chạy trong phiên này: mọi claim dừng ở mức
  TEST-VERIFIED (vitest against real components) + CODE-READ; hành vi UI
  thật của các màn đã được FB-105 và các card trước drive. Nếu chủ card cần
  rung 3 cho card này, cần một lượt click `/shipments/new` + `/dispatch` +
  `/dispatch-detail` thủ công.
