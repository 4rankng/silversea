# Card 181026143000 — Spec 2026.10.17: Điều chỉnh form Tạo lô hàng lẻ (LCL) + sync Điều vận

Nguồn: user spec docx 2026.10.17 (`Dieu_chinh_form_tao_lo_hang_le.docx`, cache
`doc_58c2e6857719`); brief worktree `fix-lcl-form-labels-dispatch`.

## Kết luận verification + 2 code fix (2026-10-18, base 64c6d8e1 → branch)

Phần lớn spec đã được **FB-105** implement tại base (commits `5a17e299` +
`3628dae4`, trước khi card được cắt — card là lần ingest lặp). Phiên làm việc
thứ hai (sau yêu cầu owner "phải có code changes") đã drive UI rung 3 toàn
chuỗi và tìm ra **2 defect thật trong vùng spec**, sửa trên branch này:

1. **§1a dialog title** — `OperationalSiteCreateDialog` hard-code
   "Thêm kho lấy hàng" cho kho ở CẢ hai chiều (đúng lớp lỗi "fix cứng cho cả
   Nhập + Xuất" mà spec phàn nàn). Fix: dialog đặt tên theo chiều của lô —
   Xuất khẩu = "Thêm kho trả hàng" (commit `fix(forms)…§1a`).
2. **§1c pattern/token** — nút "+ Thêm kho" dùng inline palette riêng kèm
   fallback XANH `#2563eb` (vi phạm emerald house tokens + rule "one pattern,
   one shared implementation"). Fix: chuyển về class dùng chung
   `csc-utility-button csc-utility-button--dashed` như nút "+ Thêm nhà máy"
   kề trên (commit `fix(forms)…§1c`).

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

### TC-LCL-181026143000-06 — Kho quick-add dialog đặt tên theo chiều (fix §1a, branch)

Steps: form LCL, chọn Xuất khẩu → bấm "+ Thêm kho" → dialog mở.
Expected & actual (PASS): title "Thêm kho trả hàng" (Xuất), "Thêm kho lấy
hàng" (Nhập/neutral). Trước fix: "Thêm kho lấy hàng" cố định cả hai chiều.

| Mục | File | Test |
|---|---|---|
| Title theo chiều | `frontend/src/components/shipment/OperationalSiteCreateDialog.tsx` (prop `tradeDirection`), `ShipmentCreateModals.tsx`, `ShipmentCreateWorkspace.tsx` | `ShipmentCreateWorkspace.lcl-points.test.tsx` «titles the kho quick-add dialog by hình thức xuất nhập khẩu»; UI driver rung 3 |

### TC-LCL-181026143000-07 — "+ Thêm kho" dùng shared dashed button (fix §1c, branch)

Steps: form LCL (customer bất kỳ) → quan sát nút "+ Thêm kho" dưới ô Kho.
Expected & actual (PASS): class `csc-utility-button csc-utility-button--dashed`
giống hệt "+ Thêm nhà máy"; không còn inline palette/fallback `#2563eb`;
cao ≤ 40px ở 390/768/1440.

| Mục | File | Test |
|---|---|---|
| Shared class + token | `frontend/src/features/shipments/create/ShipmentCreateLclRouteSection.tsx` | `ShipmentCreateWorkspace.lcl-points.test.tsx` «renders "+ Thêm kho" through the shared dashed utility button»; width sweep 390/768/1440 |

## UI driver rung 3 (tất cả artifact dưới qa/2026-10-18_181026143000_*)

Driver `testplan/qa/scripts/2026-10-18-181026143000-lcl-form-dispatch.mjs`
(admin, worktree vite :7176 → API :3002, DB dev :5441, viewport 1440×900):

- §1a: label/placeholder/asterisk đúng chuỗi spec ở NHẬP + XUẤT (ui-1..3.png,
  DOM text assert trong driver log).
- §1c: combobox mở danh mục (khách trống → "Không tìm thấy kết quả" + gõ tự
  do OK); nút "+ Thêm kho"/"+ Thêm nhà máy" có mặt; dialog title
  "Thêm kho TRẢ hàng" khi Xuất khẩu / "Thêm kho LẤY hàng" khi Nhập khẩu
  (ui-5/5b.png — fix branch).
- §1d: kho nằm cùng card "Điểm vận hành & tuyến" với Tuyến đường/Nhà máy;
  card "Thông tin hàng" đúng 5 nhãn, không có Kho (DOM assert).
- §1b: submit thiếu Nhà máy + Kho → bị chặn tại form, error field-level nêu
  tên nhà máy + kho (ui-6.png).
- §2: TẠO THẬT 2 lô LCL (IMPORT + EXPORT, Bill `QA-181026143000-I/E…`) qua
  form; DB side-effect: detail API trả về pickup_location/delivery_location
  đúng chiều (IMPORT: lift=kho, drop=nhà máy; EXPORT: đảo). Kế hoạch Tổng quát
  (`/dispatch`) cột Cảng nâng/Cảng hạ + Kế hoạch Chi tiết Xe
  (`/dispatch-detail`, tìm nhanh theo Bill) cột Nâng hàng/Trả hàng đúng chiều
  (ui-7..9.png).
- Width sweep `…-widths.mjs`: 390/768/1440 — dashed class render, ≤40px,
  dialog title đúng + vừa viewport (ui-width-*.png, widths.log).
- `qa/2026-10-18_181026143000_driver.log` — log đầy đủ, EXIT 0 (ALL PASS).

## Gate evidence (2026-10-18, worktree fix-lcl-form-labels-dispatch)

- `qa/2026-10-18_lcl-form-labels-dispatch_fe-vitest-scoped.log` — 10 file,
  **245/245 pass** (243 có sẵn + 2 test mới của 2 fix), EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_be-scoped.log` — 3 suite BE shape,
  **4/4 pass**, EXIT 0 (dev DB :5441).
- `qa/2026-10-18_lcl-form-labels-dispatch_fe-tsc.log` — EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_be-tsc.log` — EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_lint.log` — EXIT 0.
- `qa/2026-10-18_lcl-form-labels-dispatch_make-build.log` — EXIT 0 (6.25s).

## Phạm vi không cover

- Full FE/BE suite không chạy trong worktree (bộ scoped đã phủ mọi file test
  chạm vùng spec; các gate typecheck/lint/build chạy toàn repo và exit 0).
- Driver chạy với tài khoản ADMIN duy nhất; các role khác (MANAGER/clerk/CUS)
  không drive trong phiên này — RBAC của các route không đổi.
- Chỉ worktree vite :7176 (local dev); staging/prod không đụng per §2 non-negotiables.
- 2 lô QA mỗi lần chạy driver là side-effect có chủ đích trên dev DB (Bill
  `QA-181026143000-*`, đặt ngày giao 20/10/2026) — dùng để chứng minh cột
  điều vận; không cleanup vì DB dev dùng chung.
