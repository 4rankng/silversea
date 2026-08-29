# Role: DISPATCHER — Điều vận

> **Vietnamese label**: Điều vận (`Role.DISPATCHER`).
> **Home route**: `/dispatch` (`routes.dispatchMasterPlan`).
> **Primary sidebar section**: `Điều độ Phương tiện` (`dispatch-planning`).
> **Test account (local + staging)**: `dieuvan` / `Abc123`.
> **Primary pages**:
> - `/dispatch` — `frontend/src/pages/MasterPlanPage.tsx` (Kế hoạch tổng quát)
> - `/dispatch-detail` — `frontend/src/pages/DispatchDetailPlanPage.tsx` (Kế hoạch chi tiết)
> - `/fleet/vehicles` — `frontend/src/pages/FleetVehiclesPage.tsx` (Danh mục Xe nội bộ, read-only)
> - `/fleet/drivers` — `frontend/src/pages/FleetDriversPage.tsx` (Danh mục Tài xế, read-only)
> - `/suppliers` — `frontend/src/pages/DispatchSuppliersPage.tsx` (Nhà thầu phụ, read-only)
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
- **Cannot** post to the ledger, edit customers, change master data, or
  touch `/finance`, `/accounting`, `/config/*`.

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

### Test steps

1. Log in as `dieuvan`.
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
   - **Evidence**: `/audit-logs` (as `admin`) shows the row.

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

### Test steps

1. Log in as `dieuvan`.
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

## Flow 3 — Danh mục xe nội bộ (Own-fleet vehicle catalog, read-only)

**Route**: `/fleet/vehicles`
**Component**: `frontend/src/pages/FleetVehiclesPage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `DISPATCHER` (`dispatchOnly`).

### Acceptance criteria

1. **DISP-FV-01 — Read-only**
   - **Then** every row shows: `Biển số`, `Loại xe` (đầu kéo /
     rơ-moóc), `Tải trọng tối đa`, `Trạng thái` (ACTIVE / MAINTENANCE /
     INACTIVE). No `Sửa` / `Xóa` buttons are rendered.
   - **Evidence**: hover over a row; only the row's selection state
     changes; no action menu.

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

1. Log in as `dieuvan`. Open `/fleet/vehicles`.
2. Apply a filter; capture.
3. Click a row — confirm it does not navigate to an edit page (the row
   is non-clickable for DISPATCHER).

### Regression hooks

- The `dispatchOnly` route guard test in `App.tsx`.

---

## Flow 4 — Danh mục tài xế (Driver catalog, read-only)

**Route**: `/fleet/drivers`
**Component**: `frontend/src/pages/FleetDriversPage.tsx`
**Allow**: `dispatchOnly`.

### Acceptance criteria

1. **DISP-DR-01 — Read-only driver list**
   - **Then** columns: `Họ tên`, `SĐT`, `Biển số gắn với`,
     `Trạng thái` (ACTIVE / INACTIVE), `Số chuyến tháng này`. No
     edit/delete.
   - **Evidence**: baseline screenshot.

2. **DISP-DR-02 — Availability indicator**
   - **Given** the dispatcher is on the page during planning
   - **When** the user inspects a driver
   - **Then** the row shows a green dot (`Sẵn sàng`), yellow dot
     (`Đang chạy`), or red dot (`Nghỉ / bảo trì`) computed from
     the driver's current trip status.
   - **Evidence**: cross-check the dot against `/my-trips/<driver>`.

### Test steps

1. Log in as `dieuvan`. Open `/fleet/drivers`.
2. Capture the full list.
3. Spot-check 2 drivers against their current trip status.

---

## Flow 5 — Nhà thầu phụ (External supplier lookup, read-only)

**Route**: `/suppliers`
**Component**: `frontend/src/pages/DispatchSuppliersPage.tsx`
**Allow**: `dispatchOnly`. (ADMIN/MANAGER instead get
`/suppliers` → `SupplierListPage.tsx`, the payable-aware workspace.)

### Acceptance criteria

1. **DISP-SUP-01 — Read-only supplier list**
   - **Then** columns: `Mã nhà thầu`, `Tên`, `Loại dịch vụ`,
     `Tỉnh hoạt động`, `Bảng giá / chuyến`. No payables column, no
     edit/delete. (The financial view is at `/suppliers/:id` for
     ADMIN/MANAGER/ACCOUNTANT, denied to DISPATCHER.)

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

1. Log in as `dieuvan`. Open `/suppliers`.
2. Apply a province filter.
3. Open a row's drawer; capture.

### Regression hooks

- The route guard in `App.tsx:325` (`isDispatcher ? dispatchOnly(page(
  <DispatchSuppliersPage />)) : officeStaffOnly(page(<SupplierListPage
  />))`).
- Verify that direct navigation to `/suppliers/:id` (the payable
  detail) by a DISPATCHER is denied (404 / redirect).

---

## Flow 6 — Tạo lô hàng nhanh (Inline shipment creation from dispatch)

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
| Edit own-fleet vehicle / driver            | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| Read `/fleet/vehicles` `/fleet/drivers`    | ✅         | ✅    | ✅      | ❌     | ❌  | ❌  | ❌         | ❌       |
| Read `/suppliers` (dispatcher view)        | ✅         | n/a   | n/a     | ❌     | ❌  | ❌  | n/a        | ❌       |
| Read `/suppliers` (full payable view)      | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Create shipment                            | ✅         | ✅    | ✅      | ❌     | ❌  | ✅  | ❌         | ❌       |
| Read `/finance` `/profit` `/accounting`    | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Read `/config/*`                           | ❌         | ✅    | partial | ❌     | ❌  | ❌  | partial    | ❌       |
| Read `/audit-logs`                         | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Read `/customers` (list)                   | ❌         | ✅    | ✅      | ❌     | ❌  | ❌  | ✅         | ❌       |
| Inline-create customer                     | ✅         | ✅    | ✅      | ❌     | ❌  | ✅  | ❌         | ❌       |

`partial` = MANAGER can read most `/config/*` but is bounced from
`/config/app-settings`, `/config/master-data-import`,
`/config/business-calendar`. ACCOUNTANT can read
`/config/pricing-tables`, `/config/company-info`, etc.

## Out of scope (DISPATCHER)

- Editing master data (no `/config/*`).
- Posting to the ledger.
- Editing customers (read-only; can only create inline).
- Penalty issuance, salary, HR.

## Known open items (carry-over)

- **Trailer-error regression (r6 finding 2)**: the user-attached error
  string is not in the deployed bundle, but the intended contract is
  "publish is blocked when a tractor lacks a paired trailer, with a
  clear Vietnamese error". A real flow walkthrough is queued as a
  follow-up QA pass.
