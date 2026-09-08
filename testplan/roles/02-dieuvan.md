# Role: DISPATCHER — Điều vận

> **Vietnamese label**: Điều vận (`Role.DISPATCHER`).
> **Home route**: `/dispatch` (`routes.dispatchMasterPlan`).
> **Primary sidebar section**: `Điều độ Phương tiện` (`dispatch-planning`).
> **Test accounts**: chọn theo môi trường qua `../testaccounts.txt` (role → username). Runner tự map `DISPATCHER` + env → username phù hợp.
> **Primary pages**:
> - `/dispatch` — `frontend/src/pages/MasterPlanPage.tsx` (Kế hoạch tổng quát)
> - `/dispatch-detail` — `frontend/src/pages/DispatchDetailPlanPage.tsx` (Kế hoạch chi tiết)
> - `/fleet/vehicles` — `frontend/src/pages/FleetVehiclesPage.tsx` (Danh mục Xe nội bộ, CRUD)
> - `/fleet/drivers` — `frontend/src/pages/FleetDriversPage.tsx` (Danh mục Tài xế, create/edit)
> - `/suppliers` — `frontend/src/pages/DispatchSuppliersPage.tsx` (Nhà thầu phụ, CRUD)
> - `/config/customers` + `/config/routes` — catalog CRUD (identity fields)
>
> Cross-cutting rules live in [`README.md`](README.md) §5.

---

## Scope boundary

DISPATCHER is the **planning & allocation** role. The dispatcher:

- Plans which shipment legs go to which carrier (own fleet vs. external
  supplier) on the **Kế hoạch tổng quát** (master plan).
- Auto-splits a multi-container shipment into a per-plate grid on the
  **Kế hoạch chi tiết** (detailed plan) and assigns tractors + trailers.
- Reads fleet / drivers / suppliers for staffing the plan.
- Can **create shipments inline** in the same dialog as the planning
  step (per the CUS flow).
- Has full CRUD on the dispatch resource catalogs (`/fleet/vehicles`,
  `/fleet/drivers` create/edit only, `/suppliers`) and on
  `/config/customers` + `/config/routes` (identity fields; 1-day delete
  gate; financial fields stripped server-side).
- **Cannot** post to the ledger, touch `/finance`, `/accounting`, or
  config surfaces beyond customers/routes and the dispatch catalogs.

If the dispatcher is dropped into a forbidden route, AUTH-03 in §5 of the
README applies (silent redirect to `/dispatch`).

---

## Flow 1 — Kế hoạch tổng quát (Master plan / shipment-level allocation)

**Route**: `/dispatch`
**Component**: `frontend/src/pages/MasterPlanPage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `DISPATCHER` (`dispatchOnly` per `App.tsx:242`).
**Pre-conditions**:
- At least 1 shipment exists in `Mới tạo` state with the
  `documents_sufficient` flag set.
- At least 1 own-fleet truck and 1 external supplier are seeded.

### Acceptance criteria

1. **DISP-MP-01 — Page shows the unassigned-shipments queue**
   - **Given** a dispatcher on `/dispatch`
   - **When** the page mounts
   - **Then** the left rail lists every shipment that is ready to be
     planned (status `Sẵn sàng điều xe` or equivalent), sorted by
     `scheduledPickupAt` ascending.
   - **Evidence**: baseline screenshot at 1440px.

2. **DISP-MP-02 — Carrier decision: own vs. external**
   - **Given** a selected shipment
   - **When** the user picks a carrier (own-fleet truck or external
     supplier)
   - **Then** the right pane shows the carrier's available capacity
     (own truck: `payloadKg` / `volumeM3`; supplier: contract rate +
     per-trip max).
   - **Then** if the shipment's required capacity exceeds the carrier's
     capacity, an inline warning appears in Vietnamese (`Vượt tải
     trọng khả dụng`) and the assign button stays disabled.

3. **DISP-MP-03 — Quick-issue datetime is bounded by the dialog**
   - **Given** the "Phát lệnh nhanh" (quick issue) dialog is open
   - **When** the user picks `Ngày giờ nhận` / `Ngày giờ giao`
   - **Then** both datetime inputs remain inside the dialog card
     (verifiable: the inputs are inside `dialog.querySelector` and not
     clipped by the viewport). Verified by the regression
     `f4683ffe` commit.
   - **Evidence**: dialog screenshot at 1440×900 and at 1024×720.

4. **DISP-MP-04 — Plan publishes a trip row**
   - **Given** a valid plan
   - **When** the user confirms
   - **Then** a trip row is created with status `Mới tạo`, the
     shipment's `dispatch_status` flips to `Đã điều xe`, and the row
     is visible in the dispatcher's `/dispatch` "Đã phát lệnh" tab.
   - **Evidence**: DB row; the trip also shows in `/my-trips` for the
     assigned driver.

5. **DISP-MP-05 — Conflict handling**
   - **Given** the same shipment was just planned in a second tab
   - **When** the user publishes the plan in the first tab
   - **Then** the server returns a 409 conflict; the UI shows a
     Vietnamese banner (`Lô hàng đã được điều xe bởi người khác`) with
     a "Tải lại" action; no half-state trip is left behind.

6. **DISP-MP-06 — Date filter follows the per-container appointment (fix 2026-08-29)**
   - **Given** a FCL shipment whose CUS-reappointed container carries a
     `customerAppointmentAt` that differs from `shipments.expectedDeliveryDate`,
     and CUS has already assigned a carrier (plannedCarrierType on the
     fulfillment is `OWN` or `EXTERNAL`)
   - **When** the dispatcher filters the master plan by the appointment day
   - **Then** the row surfaces under that day (not just under the shipment
     EDD) — empty state "Không có lô hàng nào cần phân xe" must only appear
     when the range is genuinely empty.
   - **When** the dispatcher filters by an unrelated day
   - **Then** the row drops out cleanly.
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-013](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-013---bộ-lọc-ngày-kế-hoạch-tổng-quát-hiển-thị-lô-đã-phân-nhà-xe-theo-appointment-container).

7. **DISP-MP-07 — Display is SHIPMENT-LEVEL (1 lô = 1 dòng kể cả nhiều container)**
   - **Given** a FCL shipment READY_FOR_DISPATCH có ≥ 5 container (ví dụ 5×40HC) và 1 lô LCL có ≥ 10 dòng hàng lẻ
   - **When** the dispatcher lands on `/dispatch`
   - **Then** mỗi lô hiển thị **đúng 1 dòng duy nhất** trên bảng — không rã theo container
   - **And** UI **không** hiển thị các cột "Số cont", "Biển số xe", "Cảng nâng/hạ" riêng từng container (chỉ tổng số lượng + khối lượng cộng gộp)
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-020](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-020).

8. **DISP-MP-08 — Pending-date shipments are hidden from `/dispatch`**
   - **Given** 1 lô READY_FOR_DISPATCH (đủ `Ngày giao hàng`) và 1 lô PENDING_DATE (thiếu `Ngày giao hàng`)
   - **When** the dispatcher views /dispatch hoặc search theo BL của lô PENDING
   - **Then** chỉ lô READY_FOR_DISPATCH xuất hiện; lô PENDING_DATE hoàn toàn vắng mặt kể cả khi xóa filter ngày
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-027](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-027).

9. **DISP-MP-09 — Multi-vendor allocation (1 lô → nhiều nhà xe)**
   - **Given** a FCL READY_FOR_DISPATCH có ≥ 4 container (tổng hợp 20'+40') và OWN + ít nhất 1 EXTERNAL carrier đều active
   - **When** the dispatcher mở dialog "Phân bổ nhà xe", thêm ≥ 2 dòng nhà xe (OWN + EXTERNAL) với tổng số cont khớp nhu cầu, lưu
   - **Then** chip trên master plan hiển thị cả OWN lẫn EXTERNAL (ví dụ `[OWN: 2×40'] [Biên Đông: 2×40']`)
   - **And** `/dispatch-detail` mở ra đúng N dòng container, pre-fill nhà xe đúng theo phân bổ (không random sai)
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-021](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-021).

10. **DISP-MP-10 — Allocation validation: tổng phân bổ > tổng cont → chặn lưu**
    - **Given** a FCL READY_FOR_DISPATCH có 2×40' (0×20'), OWN + 1 EXTERNAL active
    - **When** the dispatcher nhập OWN = 2×40', EXTERNAL = 1×40' (cố tình vượt 1)
    - **Then** bảng "Tổng phân bổ" hiển thị cảnh báo "vượt tổng cont" bằng tiếng Việt
    - **And** nút "Lưu phân bổ" **disabled** (hoặc backend trả 4xx nếu click)
    - **And** không có row mới nào được tạo trong `shipment_fulfillments`
    - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-022](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-022).

11. **DISP-MP-11 — Auto-split trigger: lưu overview → `/dispatch-detail` xuất hiện N dòng pre-fill nhà xe**
    - **Given** a FCL READY_FOR_DISPATCH có 3×40', OWN + EXTERNAL đều active
    - **When** the dispatcher phân bổ (OWN 2×40', EXTERNAL 1×40') và lưu thành công
    - **Then** chuyển sang `/dispatch-detail` thấy đúng 3 dòng container; 2 dòng pre-fill OWN, 1 dòng pre-fill EXTERNAL (khớp đúng phân bổ)
    - **And** cột biển số xe đang trống trên cả 3 dòng (chưa gán)
    - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-023](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-023).

### Test steps

1. Log in as `DISPATCHER`.
2. Land on `/dispatch`. Verify the unassigned queue.
3. Pick a shipment, choose a carrier, set datetime, publish.
4. Capture the resulting trip row in `/my-trips` (as the driver).
5. Open a second tab; repeat and confirm the 409 banner.

### Regression hooks

- The dispatch tests in
  `frontend/src/pages/DispatchPlanPage.css` are styling; the
  corresponding logic tests live in
  `backend/src/tests/integration/dispatch.test.ts` (or equivalent).
- E2E: `cd e2e && ./run_all.sh`.

---

## Flow 2 — Kế hoạch chi tiết (Detailed plan: plate × container grid)

**Route**: `/dispatch-detail`
**Component**: `frontend/src/pages/DispatchDetailPlanPage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `DISPATCHER` (`dispatchOnly` per `App.tsx:243`).
**Pre-conditions**: same as Flow 1, plus the shipment must have ≥ 2
containers (so the auto-split is meaningful).

### Acceptance criteria

1. **DISP-DP-01 — Auto-split grid renders**
   - **Given** a multi-container shipment
   - **When** the user opens the detailed plan
   - **Then** the page renders a grid: rows = planned plates, columns
     = container positions (`Đầu`, `Giữa`, `Cuối`, or single column for
     a 20ft tractor). Each cell is either empty or shows the assigned
     container number + seal.
   - **Reference**: commit `e4c4d1bc` / `f61a7c84` family (driver-side)
     and dispatcher history; visual layout is the same as master plan's
     right pane but row-per-plate.
   - **Evidence**: full-page screenshot.

2. **DISP-DP-02 — Plate assignment respects capacity**
   - **Then** the user cannot assign more containers to a plate than
     the plate's slot count (20ft → 1 container slot; 40ft → 2 slots;
     tractor+trailer combos per config). A red highlight + tooltip
     (`Vượt sức chứa`) appears on overflow attempts.
   - **Evidence**: try an invalid assignment; capture the error.

3. **DISP-DP-03 — Tractor ↔ trailer pairing**
   - **Given** a row that already has a tractor plate assigned
   - **When** the user picks a trailer
   - **Then** only trailers with the matching type (`FT20` ↔ 20ft
     trailer, `FT40` ↔ 40ft trailer) appear in the dropdown.
   - **Then** if the selected trailer is already in use on the same
     date, the dropdown disables it and shows a tooltip
     (`Rơ-moóc đang được sử dụng`).
   - **Evidence**: dropdown screenshot.

4. **DISP-DP-04 — Trailer-error regression: publish is allowed when
   the tractor has a paired trailer**
   - **Given** all rows have a paired trailer
   - **When** the user clicks `Phát hành kế hoạch`
   - **Then** the plan publishes without the
     `Xe đầu kéo chưa có rơ-moóc khả dụng` error.
   - **Reference**: regression-r6 finding 2. The original user-attached
     error string is no longer in the deployed bundle, but the
     intended contract is "tractor must have a paired trailer before
     publish" — verified by walking through this flow with a tractor
     that has no trailer and confirming the publish is **blocked**
     with a clear Vietnamese error.
   - **Evidence**: a follow-up QA pass (open) should walk the
     `dispatch-detail` page on staging, deliberately un-pair a
     trailer, click publish, capture the actual error message, and
     compare against this AC.

5. **DISP-DP-05 — Publish audit**
   - **Given** a successful publish
   - **When** the action completes
   - **Then** an `audit_logs` row is written with action
     `dispatch.publish`, actor = dispatcher, payload = the per-row
     plate + container + trailer assignments.
   - **Evidence**: `/audit-logs` (as `ADMIN`) shows the row.

6. **DISP-DP-06 — Phân xe lại falls back when the fulfillment link is gone (fix 2026-08-29)**
   - **Given** an issued trip on `/dispatch-detail` whose
     `trip.fulfillmentId` no longer resolves to a row in
     `shipment_fulfillments` (legacy migration, manual fix, or a
     re-decomposition that left a stale link)
   - **When** the dispatcher opens the "Phân xe lại" dialog, changes
     `Loại xe` / `Đối tác xe ngoài` / plate / driver, and confirms
   - **Then** the route does **not** 404 with "Không tìm thấy tác vụ
     điều xe" — it falls back to the simple trip-vehicle reassign and
     the trip row updates in place (carrierType, externalCarrierId /
     plate / driver). The next `Phát lệnh` from the detail plan can
     re-link a fresh fulfillment if needed.
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-012](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-012---phân-xe-lại-khi-tác-vụ-điều-xe-bị-mấttái-cấu-trúc-fallback).

7. **DISP-DP-07 — Display is CONTAINER-LEVEL (1 cont = 1 dòng, không theo lô)**
   - **Given** dispatcher mở `/dispatch-detail` với 1 lô FCL 1 cont và 1 lô FCL 5 cont cùng hiển thị
   - **When** quan sát bảng
   - **Then** tổng số dòng = 6 dòng (không phải 2 dòng theo lô); mỗi dòng có Số Cont (hoặc "Chưa có số"), Loại Cont, Trọng lượng, Nhà xe (pre-fill), Biển số (đang trống)
   - **And** **không** dùng Expandable Rows (đã lỗi thời)
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-024](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-024).

8. **DISP-DP-08 — Vendor (Nhà xe) pre-filled từ Overview**
   - **Given** dispatcher đã lưu phân bổ ở `/dispatch` với OWN 2×40' + EXTERNAL 1×40'
   - **When** chuyển sang `/dispatch-detail` cho cùng lô
   - **Then** cột "Nhà xe" trên mỗi dòng container đã được điền sẵn đúng theo phân bổ (2 dòng OWN, 1 dòng EXTERNAL)
   - **And** cột "Biển số" đang trống (chưa gán)
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-023](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-023).

9. **DISP-DP-09 — Push notification tới Lái xe khi gán biển số Xe nhà**
   - **Given** dispatcher gán biển số OWN (gắn với `DRIVER`) cho 1 dòng container Xe nhà, lưu
   - **When** `DRIVER` đăng nhập app Lái xe trong vòng 5 giây
   - **Then** chuyến xuất hiện trong tab "Lệnh mới" ngay lập tức
   - **And** push notification hiển thị tiếng Việt "Chuyến được điều phối" (hoặc tương đương)
   - **And** push xảy ra **trước** khi Ops đổi lệnh giấy (kể cả khi lô chưa `Đã phân xe` hẳn — miễn là 1 dòng Xe nhà đã có biển số)
   - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-026](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-026).

10. **DISP-DP-10 — Lô chỉ chuyển "Đã phân xe" khi TẤT CẢ container đã gán biển số**
    - **Given** lô FCL 3×40HC, đã pre-fill nhà xe, tài khoản OWN có biển số trong master data
    - **When** dispatcher gán biển số cho dòng 1 (lưu); gán dòng 2 (lưu); để dòng 3 **trống** (lưu)
    - **Then** sau mỗi bước lô vẫn ở trạng thái cũ (không `DISPATCHED`); DB `shipments.status` không đổi
    - **And** chỉ khi đủ cả 3 dòng có biển số → lô mới chuyển `Đã phân xe`
    - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-025](../flows/02-dieuvan-dispatch.md#tc-dv-dispatch-025).

11. **DISP-DP-12 — Phân loại chuyến: Đơn (1 chiều), Kẹp (2 chiều khép kín), Kết hợp (ghép chuyến)**
    - **Given** dispatcher đang ở `/dispatch-detail` sau khi pre-fill nhà xe
    - **When** đánh dấu phân loại cho từng dòng:
      - Đơn: 1 trip 1 chiều, không liên kết kẹp, phí đường × 1 bình thường
      - Kẹp: 2 trip cùng xe + cùng tài xế + cùng tuyến 2 chiều + thời gian không chồng lấn → liên kết cặp, phí VETC/đường chỉ tính 1 lần cho lộ trình khép kín
      - Kết hợp: ≥ 2 dòng container (cùng lô hoặc khác lô) gộp vào 1 xe, cùng tuyến, khung giờ overlap → 1 trip link N fulfillments
    - **Then** mỗi dòng hiển thị phân loại đúng; trip tạo ra khớp mô hình; phí đường / VETC tính đúng theo bảng so sánh tại `docs/prd/QuyTrinhO2C.md` §2b
    - **And** Kẹp không hợp lệ (khác tài xế, khác tuyến, thời gian chồng lấn, hoặc khác biển số) → không cho kẹp, cảnh báo "Không đủ điều kiện kẹp hàng", phí đường không được hưởng ưu đãi
    - **Reference**: [`02-dieuvan-dispatch.md` TC-DV-DISPATCH-007](../flows/02-dieuvan-dispatch.md), TC-DV-DISPATCH-008 (kẹp invalid), TC-DV-DISPATCH-029 (ghép cùng lô), TC-DV-DISPATCH-030 (ghép khác lô), TC-DV-DISPATCH-031 (kẹp invalid vì đổi tài xế), TC-DV-DISPATCH-032 (Đơn happy path).

### Test steps

1. Log in as `DISPATCHER`.
2. Open `/dispatch-detail`. Pick a multi-container shipment.
3. Drag/assign each container to a plate slot.
4. For each plate, pick a tractor and (if 40ft) a trailer.
5. Click `Phát hành kế hoạch`.
6. Confirm the trips appear in the right tabs / driver `/my-trips`.
7. (Regression-r6 follow-up) Repeat with a tractor that has no paired
   trailer; capture the error message verbatim and save into
   `qa/<date>_dispatch-trailer_regression.md`.

### Regression hooks

- The trailer pairing logic in
  `backend/src/services/dispatch/plate-assignment.ts` (or equivalent).
- A new E2E test that asserts the trailer-required error appears for
  unpaired tractors and is **not** shown for paired ones.

---

## Flow 3 — Danh mục xe nội bộ (Own-fleet vehicle catalog, CRUD)

**Route**: `/fleet/vehicles`
**Component**: `frontend/src/pages/FleetVehiclesPage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `DISPATCHER` (`dispatchOnly`).

### Acceptance criteria

1. **DISP-FV-01 — CRUD**
   - **Then** every row shows: `Biển số`, `Loại xe` (đầu kéo /
     rơ-moóc), `Tải trọng tối đa`, `Trạng thái` (ACTIVE / MAINTENANCE /
     INACTIVE). Each row is clickable to open the edit modal; a `Xóa`
     button appears in the action column. The header has a `Thêm xe đầu kéo`
     create button.
   - **Evidence**: click a row to open edit modal; click `Xóa` to confirm
     deletion.

2. **DISP-FV-02 — Filter by status & search by plate**
   - **Given** the filter bar
   - **When** the user types a plate fragment and toggles
     `Đang bảo trì`
   - **Then** the list updates within 300 ms and the URL query string
     reflects the filter.

3. **DISP-FV-03 — Capacity column drives Flow 1.2**
   - **Then** the column `Tải trọng tối đa (kg)` is the same value the
     master plan uses for the over-capacity warning.

### Test steps

1. Log in as `DISPATCHER`. Open `/fleet/vehicles`.
2. Apply a filter; capture.
3. Click a row — confirm the edit modal opens with the truck's data pre-filled.
4. Edit a field and save — confirm the change persists.
5. Click `Xóa` on a row — confirm the deletion dialog appears.

### Regression hooks

- The `dispatchOnly` route guard test in `App.tsx`.
- `backend/src/tests/dispatcher-catalog-create-authz.test.ts` —
  DISPATCHER PUT/DELETE on trucks/drivers/suppliers returns 200.

---

## Flow 4 — Danh mục tài xế (Driver catalog, CRUD)

**Route**: `/fleet/drivers`
**Component**: `frontend/src/pages/FleetDriversPage.tsx`
**Allow**: `dispatchOnly`.

### Acceptance criteria

1. **DISP-DR-01 — CRUD driver list (create + edit; NO delete)**
   - **Then** columns (4.9 Excel set): `Mã tài xế`, `Họ tên`, `Số CCCD`,
     `GPLX`, `Hạn bằng lái`, `SĐT`, `Ngân hàng nhận tiền`, `Số TK nhận tiền`,
     `Hình thức lương`. Each row is clickable to open the edit modal. The
     header has a `Thêm tài xế` create button.
   - **No `Xóa` button may render**: the drivers router is
     `disableDelete: true` (spec §4.2, backend 405 "Không hỗ trợ xóa"), so
     a delete affordance would be a guaranteed error for every role.
   - **Evidence (staging 09-06)**: POST `/api/drivers` → 201 and
     PUT `/api/drivers/:id` → 200 as DISPATCHER; row persisted in DB;
     DELETE returns 405 and no button offers it.

2. **DISP-DR-02 — Availability indicator**
   - **Given** the dispatcher is on the page during planning
   - **When** the user inspects a driver
   - **Then** the row shows a green dot (`Sẵn sàng`), yellow dot
     (`Đang chạy`), or red dot (`Nghỉ / bảo trì`) computed from
     the driver's current trip status.
   - **Evidence**: cross-check the dot against `/my-trips/<driver>`.

### Test steps

1. Log in as `DISPATCHER`. Open `/fleet/drivers`.
2. Capture the full list.
3. Spot-check 2 drivers against their current trip status.

---

## Flow 5 — Nhà thầu phụ (External supplier catalog, CRUD)

**Route**: `/suppliers`
**Component**: `frontend/src/pages/DispatchSuppliersPage.tsx`
**Allow**: `dispatchOnly`. (ADMIN/MANAGER instead get
`/suppliers` → `SupplierListPage.tsx`, the payable-aware workspace.)

### Acceptance criteria

1. **DISP-SUP-01 — CRUD supplier list**
   - **Then** columns: `Tên`, `Liên hệ`, `SĐT`, `Loại`, `Trạng thái`.
     No payables column. Each row is clickable to open the edit modal;
     a `Xóa` button appears in the action column. The header has a
     `Thêm nhà thầu phụ` create button. (The financial view is at
     `/suppliers/:id` for ADMIN/MANAGER/ACCOUNTANT, denied to DISPATCHER.)

2. **DISP-SUP-02 — Filter & search**
   - **Then** the user can search by name, filter by province, filter
     by service type. URL reflects the state.

3. **DISP-SUP-03 — Drill-down is a copy of contact info**
   - **Given** the user clicks a row
   - **When** the detail drawer opens
   - **Then** it shows `SĐT`, `Email`, `Địa chỉ`, `Người liên hệ`,
     `Bảng giá`. No balance, no payable history.
   - **Evidence**: drawer screenshot.

### Test steps

1. Log in as `DISPATCHER`. Open `/suppliers`.
2. Apply a province filter.
3. Open a row's drawer; capture.

### Regression hooks

- The route guard in `App.tsx:325` (`isDispatcher ? dispatchOnly(page(
  <DispatchSuppliersPage />)) : officeStaffOnly(page(<SupplierListPage
  />))`).
- Verify that direct navigation to `/suppliers/:id` (the payable
  detail) by a DISPATCHER is denied (404 / redirect).

---

## Flow 6 — Khách hàng & Tuyến đường catalogs (config CRUD)

**Routes**: `/config/customers`, `/config/routes`
**Components**: `frontend/src/pages/config/CustomersConfigPage.tsx`,
`frontend/src/pages/config/RoutesConfigPage.tsx`
**Allow**: `catalogEditorOnly` (ADMIN/MANAGER/ACCOUNTANT/CUS/DISPATCHER).

### Acceptance criteria

1. **DISP-CFG-01 — Customer CRUD**
   - **Given** a dispatcher on `/config/customers`
   - **When** they create a customer, click a row to edit identity
     fields (name, MST, contacts, address), and delete a row they
     just created
   - **Then** all three succeed. Backend allowance: POST/PUT/DELETE on
     `/api/customers` for CUS+DISPATCHER (`hasRouteScopedRoleAllowance`);
     financial/cost fields are stripped server-side; DELETE is
     age-gated to 1 day after creation (403 outside the window).
   - **Evidence (staging 09-06)**: create → row + DB row; edit
     contact → DB `contact_person` updated; delete fresh row → row and
     DB row gone.

2. **DISP-CFG-02 — Route CRUD**
   - Same allowance family as customers; verified working
     (`/config/routes` is the reference page the dispatcher catalogs
     were modeled on).

---

## Flow 7 — Tạo lô hàng nhanh (Inline shipment creation from dispatch)

The dispatcher has the same `shipments/new` permission as CUS (per
`App.tsx:278` `shipmentCreatorOnly`). This is the **same** flow as
`01-cus.md` Flow 1 and all CUS-SHIP-* ACs apply.

### Acceptance criteria

1. **DISP-INLINE-01 — Dispatcher can create a shipment**
   - **Given** a dispatcher
   - **When** they navigate to `/shipments/new`
   - **Then** the form mounts and behaves identically to the CUS
     flow. In particular, **DISP-INLINE-01a** the customer field is
     a proper combobox (CUS-SHIP-02) and **DISP-INLINE-01b** the
     `Thêm khách hàng` button is visible (CUS-SHIP-03 / CUS-CUST-02).
   - **Evidence**: see `01-cus.md` Flow 1.

2. **DISP-INLINE-02 — Newly-created shipment appears in the master plan**
   - **Given** the dispatcher creates a shipment
   - **When** they navigate back to `/dispatch`
   - **Then** the new shipment shows up in the unassigned queue if
     its `documents_sufficient` flag is set; otherwise it shows up
     after the CUS marks the documents as sufficient.

---

## Negative / RBAC table (DISPATCHER)

| Action                                     | DISPATCHER | ADMIN | MANAGER | DRIVER | OPS | CUS | ACCOUNTANT | CUSTOMER |
|--------------------------------------------|------------|-------|---------|--------|-----|-----|------------|----------|
| Read `/dispatch` `/dispatch-detail`        | ✅         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| Publish plan / create trip                 | ✅         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| Edit own-fleet vehicle / driver            | ✅         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| CRUD `/fleet/vehicles` (trucks)            | ✅ (no driver-assign delete gate) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CRUD `/fleet/drivers` (create+edit only)   | ✅ (delete unsupported §4.2, no button) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CRUD `/suppliers` (dispatcher view)        | ✅         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| CRUD `/config/customers` `/config/routes`  | ✅ (identity fields; ≤1-day delete) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Read `/fleet/vehicles` `/fleet/drivers`    | ✅         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| Read `/suppliers` (dispatcher view)        | ✅         | n/a   | n/a     | ❌     | ❌  | ❌  | n/a        | ❌       |
| Read `/suppliers` (full payable view)      | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Create shipment                            | ✅         | ✅    | ✅      | ❌     | ❌  | ✅  | ❌         | ❌       |
| Read `/finance` `/profit` `/accounting`    | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Read `/config/*`                           | partial (customers/routes + catalogs) | ✅ | partial | ❌ | ❌ | ❌ | partial | ❌ |
| Read `/audit-logs`                         | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Read `/customers` (list)                   | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Inline-create customer                     | ✅         | ✅    | ✅      | ❌     | ❌  | ✅  | ❌         | ❌       |

`partial` = MANAGER can read most `/config/*` but is bounced from
`/config/app-settings`, `/config/master-data-import`,
`/config/business-calendar`. ACCOUNTANT can read
`/config/pricing-tables`, `/config/company-info`, etc.

## Out of scope (DISPATCHER)

- Deciding or overriding the transportation classification (Đơn `SINGLE`, Kẹp `DOUBLE`, Kết hợp `COMBINED`, Lẻ `LCL`) or the lot-level combined flag (`shipments.is_combined`). These are **CUS's call** at intake. DISPATCHER executes vehicle/trailer assignment adhering to CUS's classification and 20ft combination constraints.
- Editing config master data **other than** customers/routes/trucks/drivers/suppliers (pricing tables, cargo types, ports writes, etc.).
- Posting to the ledger.
- Editing customer **financial** fields (credit limit, payment terms beyond identity) — stripped server-side for CUS/DISPATCHER.
- Penalty issuance, salary, HR.

## Known open items (carry-over)

- **Trailer-error regression (r6 finding 2)**: the user-attached error
  string is not in the deployed bundle, but the intended contract is
  "publish is blocked when a tractor lacks a paired trailer, with a
  clear Vietnamese error". A real flow walkthrough is queued as a
  follow-up QA pass.

---

## QA Matrix v2.0 Acceptance Criteria (2026-09-08)

### Flow 1 Additions — Task Tag Pool & Quick Select (TC_TAG_01 - TC_TAG_04)
1. **DISP-TAG-01 — 9 Task tags active including XƯỞNG 2**
   - All 9 tags rendered: Đảo vỏ, Đặt đầu, Đặt đuôi, Di động, Giao thẳng, Gửi bãi, Lấy vỏ ICD đi đóng, Trả vỏ, XƯỞNG 2.
   - Clicking chip toggles active state.
   - Preserves manual free text joined by semicolon.
   - Inline "+ Thêm tag" button available.

