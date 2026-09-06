# Roles: MANAGER + ADMIN — Quản lý / Quản trị

> **Vietnamese labels**: Quản lý (`Role.MANAGER`), Quản trị viên
> (`Role.ADMIN`).
> **Home route**: `/dashboard` (`routes.dashboard`).
> **Primary sidebar section**: `Vận hành` (`operations`).
> **Test accounts (local + staging)**:
> - `giamdoc` / `Abc123` — MANAGER
> - `admin` / `Abc123` — ADMIN
>
> The two roles share most of the office workspace. The only ADMIN-only
> delta is a small list of **strict-admin pages** at the end of this
> document. All other flows are identical, so they are documented
> together and called out per-flow where the role boundary matters.
>
> Cross-cutting rules live in [`README.md`](README.md) §5.
> The strict-admin pages are gated by `strictAdminOnly` in
> `App.tsx:218`.

---

## Scope boundary

MANAGER ⊂ ADMIN for almost every flow. The manager can:

- Read & write everything CUS, DISPATCHER, ACCOUNTANT, OPS can.
- Read & write the master-data admin pages (`/config/*`) except
  the strict-admin subset.
- Manage users (read + write for the non-strict-admin subset).
- View audit logs.

ADMIN additionally can:

- Read & write the **strict-admin** pages (`/admin-center`,
  `/config/app-settings`, `/config/master-data-import`,
  `/config/business-calendar`).
- Issue a master-data import (e.g. seeding routes, customers,
  pricing).

If a manager is dropped into a strict-admin route, AUTH-03 in §5 of
the README applies (silent redirect to `/dashboard`).

The flows below are listed once. The role column is `MGR | ADM` and
each AC states which role can perform it.

---

## Flow 1 — Tổng quan Quản trị (Admin dashboard)

**Route**: `/dashboard`
**Component**: `frontend/src/pages/DashboardPage.tsx`
**Allow**: `ADMIN`, `MANAGER` (per the role-bounce in `App.tsx:237`).
**Pre-conditions**: seed has at least 1 trip, 1 customer, 1 supplier.

### Acceptance criteria

1. **MGR-DASH-01 — KPI tiles**
   - **Then** the dashboard shows: `Tổng chuyến (tháng này)`,
     `Doanh thu (tháng này)`, `Tỷ lệ giao đúng hẹn`,
     `Công nợ quá hạn`, `Cảnh báo tồn kho` (if any),
     `Cảnh báo bảo trì xe` (if any).
2. **MGR-DASH-02 — Drill-down**
   - **When** the user clicks a KPI tile
   - **Then** the page navigates to the relevant list
     (`/trips`, `/finance`, `/debt`, `/fleet`, etc.) with the
     current month pre-selected.
3. **MGR-DASH-03 — Charts**
   - **Then** at least two charts are rendered: a 30-day revenue
     trend and a per-route volume bar chart. Charts respect
     `prefers-reduced-motion` (no entry animation when on).
4. **ADM-DASH-04 — Strict-admin health widget** (ADMIN only)
   - **Then** a widget is rendered at the top of the dashboard
     for the ADMIN that summarises the most recent
     `/admin-center` health signals (DB connections, queue depth,
     last backup timestamp). MANAGER does **not** see this widget.

### Test steps

1. Log in as `giamdoc` (MANAGER) and as `admin` (ADMIN) in two
   tabs.
2. Capture both dashboards. Diff them visually; the
   strict-admin health widget should appear only on the ADMIN
   dashboard.

---

## Flow 2 — Quản lý Người dùng (Users)

**Route**: `/users`
**Component**: `frontend/src/pages/UsersPage.tsx`
**Allow**: `officeStaffOnly` (per `App.tsx:342`).

### Acceptance criteria

1. **MGR-USR-01 — List & filter**
   - **Then** columns: `Họ tên`, `Username`, `Email`, `SĐT`,
     `Vai trò`, `Trạng thái` (`ACTIVE` / `LOCKED`).
2. **MGR-USR-02 — Create user**
   - **When** the user clicks `Tạo người dùng`
   - **Then** a dialog opens with: `Họ tên`, `Username`, `Email`,
     `SĐT`, `Vai trò` (dropdown with all 8 roles), `Mật khẩu
     tạm thời`. On submit, the user is created and an audit row
     is written. The temporary password is shown to the
     manager once and not stored in plaintext.
3. **MGR-USR-03 — Reset password**
   - **When** the user clicks `Đặt lại mật khẩu` on a row
   - **Then** a new random password is generated and shown
     once; the user's existing sessions are invalidated.
4. **MGR-USR-04 — Lock / unlock**
   - **When** the user clicks `Khóa` / `Mở khóa`
   - **Then** the user's status flips; on `Khóa`, the user is
     signed out at the next request. The action is audited.
5. **MGR-USR-05 — Role-based scoping**
   - **Then** the `Vai trò` dropdown excludes `CUSTOMER` for
     MANAGER (the customer is a portal user created via the
     customer-create flow, not the user admin). ADMIN can
     create `CUSTOMER` users.
6. **MGR-USR-06 — Drivers bound to a plate**
   - **When** the role is `DRIVER`
   - **Then** the dialog requires a `Biển số` selection. Saving
     without a plate shows an inline error.

### Test steps

1. Log in as `giamdoc`. Open `/users`.
2. Create a new OPS user. Capture.
3. Lock the user. Re-login as the user → confirm rejection.
4. Switch to `admin`; create a CUSTOMER user (this exercises
   the admin-only path).

---

## Flow 3 — Đội xe (Fleet)

**Route**: `/fleet`, `/fleet/:id/tires`,
`/fleet/trailers/:id/tires`
**Component**: `frontend/src/pages/FleetPage.tsx`,
`frontend/src/pages/TruckTiresPage.tsx`
**Allow**: `officeStaffOnly` (full workspace, not the dispatcher
read-only view).

### Acceptance criteria

1. **MGR-FLT-01 — Vehicle list & filter**
   - **Then** columns: `Biển số`, `Loại`, `Tải trọng tối đa`,
     `Lốp`, `Bảo trì lần cuối`, `Trạng thái`. Default sort:
     `Biển số` asc.
2. **MGR-FLT-02 — Edit a vehicle**
   - **When** the user clicks a row's `Sửa`
   - **Then** a modal opens with the vehicle's fields. On save,
     an audit row is written and the row updates.
3. **MGR-FLT-03 — Tire management**
   - **When** the user clicks `Lốp` on a vehicle row
   - **Then** the tire management page lists every tire
     position (front-left, front-right, …) with brand, DOT,
     tread depth, install date. The user can record a rotation
     or replacement; each action writes a tire-history row.
4. **MGR-FLT-04 — Maintenance schedule**
   - **Then** the page surfaces a `Bảo trì sắp tới` widget
     listing vehicles with `nextMaintenanceAt` within 30 days.
5. **MGR-FLT-05 — Cap table (per-truck profit partners)**
   - **When** the user opens the cap-table tab
   - **Then** the partner list per truck is shown with `role`
     (`INVESTOR` / `DRIVER`) and `%` share. Adding a partner
     requires `name`, `role`, `sharePct` (0 < x ≤ 100); the
     sum of `sharePct` per truck can be > 100 only if
     explicitly acknowledged (the dialog shows a warning).
   - **Reference**: `TruckCapRole` enum in
     `shared/src/constants/index.ts:370`.

### Test steps

1. Log in as `giamdoc`. Open `/fleet`.
2. Open a vehicle's tire management; record a rotation.
3. Open another vehicle's cap table; add a partner.
4. Capture before/after for each.

---

## Flow 4 — Sổ chuyến đi (Trip ledger)

**Route**: `/trips`, `/trips/:id`, `/trips/new`, `/trips/:id/edit`
**Components**: `frontend/src/pages/TripListPage.tsx`,
`TripDetailPage.tsx`, `TripCreatePage.tsx`, `TripEditPage.tsx`
**Allow list**: `officeStaffOnly`. **Create / edit**: `adminOnly`.

### Acceptance criteria

1. **MGR-TRP-01 — List columns**
   - **Then** columns: `Mã chuyến`, `Khách hàng`, `Tuyến`,
     `Biển số`, `Tài xế`, `Trạng thái`, `Doanh thu`,
     `Chi phí`, `Lợi nhuận`. Default sort: `Ngày tạo` desc.
2. **MGR-TRP-02 — Filter**
   - **Then** filter by `Trạng thái`, `Khách hàng`, `Biển số`,
     `Tài xế`, `Ngày tạo`. URL reflects the state.
3. **MGR-TRP-03 — Drill-down**
   - **When** the user clicks a row
   - **Then** the trip detail page shows every section
     (revenue, costs, fuel, penalty, e-POD, audit) in tabs.
4. **MGR-TRP-04 — Create / edit**
   - **Then** `/trips/new` and `/trips/:id/edit` are
     `adminOnly`. MANAGER who navigates to those routes is
     bounced to `/dashboard`.
5. **MGR-TRP-05 — Profitability flag**
   - **Then** the list highlights trips where
     `profit < 0` in red; the cell shows the VND amount with
     a tooltip explaining the cause (e.g. `Chi phí nhiên liệu
     vượt định mức`).

### Test steps

1. Log in as `giamdoc`. Open `/trips`.
2. Apply a date range and a customer filter. Capture.
3. Open a trip and walk the tabs.
4. Try `/trips/new`; confirm redirect.

---

## Flow 5 — Công nợ phải thu / phải trả

The MANAGER/ADMIN have the same AR/AP views as the accountant
(`/debt`, `/payables`, `/debt/:id`, `/payables/:id`). See
`04-ketoan.md` Flows 2 & 3 for the AC list.

**Allow** for `POST /transactions`: ADMIN, MANAGER, ACCOUNTANT.

---

## Flow 6 — Báo cáo Lãi lỗ / Lợi nhuận

Same as `04-ketoan.md` Flow 9.

---

## Flow 7 — Tạm ứng & Hoàn ứng

Same as `04-ketoan.md` Flow 4. MANAGER can approve.

---

## Flow 8 — Duyệt vượt hạn mức & Trung tâm phê duyệt

Same as `04-ketoan.md` Flows 6 & 7.

---

## Flow 9 — Chi phí phát sinh (Expense create / edit)

**Routes**: `/expenses/new`, `/expenses/:id/edit`
**Component**: `frontend/src/pages/ExpenseEntryPage.tsx`
**Allow create / edit**: ADMIN only (`adminOnly` per `App.tsx:335`).

### Acceptance criteria

1. **ADM-EXP-01 — Create**
   - **Then** ADMIN can create an ad-hoc expense with: `Loại
     chi phí` (dropdown from `forwarder_expense_types`), `Số
     tiền`, `Ngày`, `Mô tả`, `Chuyến liên quan` (optional),
     `Hóa đơn` (file upload, ≤ 10 MB).
2. **ADM-EXP-02 — Edit**
   - **Then** an existing expense can be edited until the
     month has been closed. After month-close, the form
     becomes read-only and shows a banner
     (`Kỳ đã chốt — không thể chỉnh sửa`).
3. **ADM-EXP-03 — Audit**
   - **Then** every create / edit writes an audit row visible
     in `/audit-logs`.

### Test steps

1. Log in as `admin`. Open `/expenses/new`.
2. Create an expense. Capture.
3. Edit it. Capture.
4. As `ketoan`, confirm the ledger reflects the expense.

---

## Flow 10 — Khách hàng (Customers)

**Route**: `/customers`, `/customers/:id`,
`/customers/:id/billing/new`
**Component**: `frontend/src/pages/CustomersPage.tsx`,
`DebtDetailPage.tsx`
**Allow list**: `officeStaffOnly`. **Billing new**: `adminOnly`.

### Acceptance criteria

1. **MGR-CUST-01 — List & filter**
   - **Then** columns: `Mã khách hàng`, `Tên`, `Mã số thuế`,
     `Hạn mức`, `Dư nợ`, `Trạng thái`. Default sort:
     `Dư nợ` desc.
2. **MGR-CUST-02 — Drill-down**
   - **When** the user clicks a row
   - **Then** the customer detail page (which is the same as
     `/debt/:id`) shows the AR ledger.
3. **MGR-CUST-03 — Create a customer (full intake)**
   - **Then** the create dialog supports the **7 financial
     fields** (`creditLimit`, `paymentTerms`, `taxCode`,
     `billingAddress`, `billingEmail`, `bankAccount`,
     `bankName`) that the CUS intake strips out. This is the
     canonical "office creates the customer" path.
4. **MGR-CUST-04 — Maker-checker for new customers**
   - **Then** a customer created by MANAGER enters a
     `pending` state until a second financial-role user
     approves it (the maker-checker path). ADMIN's creations
     are auto-approved. CUS/DISPATCHER creations bypass the
     queue (per `6ef3b221`).
5. **MGR-CUST-05 — Lock a customer**
   - **When** the user clicks `Khóa`
   - **Then** the customer's status flips to `LOCKED`; the
     dispatcher / CUS cannot create new shipments against
     the customer until it is unlocked.

### Test steps

1. Log in as `giamdoc`. Open `/customers`.
2. Create a customer (full intake, with financial fields).
   Capture.
3. Log in as `ketoan`. Approve the pending customer. Capture.
4. Lock the customer; try to create a shipment as `cus`.
   Confirm rejection with a Vietnamese toast.

---

## Flow 11 — Nhà cung cấp / Nhà xe ngoài (Suppliers)

**Route**: `/suppliers`, `/suppliers/:id`
**Components**: `frontend/src/pages/SupplierListPage.tsx`,
`PayableDetailPage.tsx`
**Allow list**: `officeStaffOnly`. **Detail**: `financeReaderOnly`.

### Acceptance criteria

1. **MGR-SUP-01 — List & filter**
   - **Then** columns: `Mã nhà cung cấp`, `Tên`, `Loại`
     (`Nhà cung cấp` / `Nhà xe ngoài`), `Dư nợ`, `Trạng thái`.
2. **MGR-SUP-02 — Drill-down**
   - **Then** the detail page is the AP ledger (same as
     `/payables/:id`).
3. **MGR-SUP-03 — Create / edit**
   - **Then** `officeStaffOnly` can create / edit; the form
     supports the supplier's pricing per route (table editor).

### Test steps

1. Log in as `giamdoc`. Open `/suppliers`.
2. Create a supplier. Capture.
3. Add a per-route price. Capture.

---

## Flow 12 — Lương & Chấm công (Salary & attendance)

**Route**: `/salary`
**Component**: `frontend/src/pages/SalaryAttendancePage.tsx`
**Allow**: `officeStaffOnly`.

### Acceptance criteria

1. **MGR-SAL-01 — Period switcher**
   - **Then** the page is scoped to a salary period (defined
     in `/config/salary-periods`). The user can switch
     periods; the data re-fetches.
2. **MGR-SAL-02 — Attendance grid**
   - **Then** the grid is `Tài xế` × `Ngày` with cells
     marked `Có mặt` / `Nghỉ` / `Phép`. The OPS can fill
     attendance; the manager approves.
3. **MGR-SAL-03 — Lock a period**
   - **When** the user clicks `Chốt kỳ`
   - **Then** the period becomes read-only; an audit row is
     written; a payslip run is generated for each driver.

### Test steps

1. Log in as `giamdoc`. Open `/salary`.
2. Switch periods; capture.
3. Approve a cell edited by OPS. Capture.
4. Lock the period; capture the audit row.

---

## Flow 13 — Kỷ luật (Penalties — issue side)

**Route**: `/penalties`
**Component**: `frontend/src/pages/PenaltyPage.tsx`
**Allow**: `officeStaffOnly`.

### Acceptance criteria

1. **MGR-PEN-01 — Issue a penalty**
   - **Then** the form: `Tài xế`, `Lý do` (from
     `/config/penalty-reasons`), `Số tiền`, `Ngày`,
     `Mô tả chi tiết`, `Chuyến liên quan` (optional).
2. **MGR-PEN-02 — Cancel a penalty**
   - **When** the user clicks `Hủy` on a row in `Hiệu lực`
   - **Then** the penalty flips to `Đã hủy`; an
     `UNLOCK_REVERSAL` journal row is posted to reverse the
     impact on the driver's pay.
3. **MGR-PEN-03 — Audit**
   - **Then** every issue / cancel writes an audit row.

### Test steps

1. Log in as `giamdoc`. Open `/penalties`.
2. Issue a penalty. Capture.
3. Cancel the penalty. Capture the audit row + the journal
   reversal.

---

## Flow 14 — Cài đặt ứng dụng & master-data (Config — strict subset)

**Routes**: `/config/*` (the bulk of which is `adminOnly`),
with a few `officeStaffOnly` and `strictAdminOnly` exceptions.
**Component**: `frontend/src/pages/ConfigPage.tsx` (and the
many `pages/config/*`).

### Acceptance criteria

1. **MGR-CFG-01 — MANAGER can read most `/config/*`**
   - **Then** MANAGER can navigate to:
     - `/config/pricing-tables` (Bảng giá cước)
     - `/config/company-info` (Thông tin công ty)
     - `/config/tire-positions`
     - `/config/debit-note-templates` (and the editor at
       `/config/debit-note-templates/new` and `:id`)
   - **And** MANAGER is **denied**:
     - `/config/app-settings`
     - `/config/master-data-import`
     - `/config/business-calendar`
     - `/config/llm-settings` (redirects to
       `/config/app-settings`)
2. **MGR-CFG-02 — Edit pricing tables**
   - **Then** the user can edit a pricing row in place; the
     change is audited.
3. **ADM-CFG-03 — ADMIN edits master data**
   - **Then** ADMIN can edit:
     - `/config/routes`, `/config/factories`, `/config/ports`
     - `/config/cargo-types`, `/config/penalty-reasons`,
       `/config/fuel`, `/config/fuel-norms`
     - `/config/weight-pricing-tiers`, `/config/lift-pricing`,
       `/config/ancillary-revenue`
     - `/config/trip-expense`, `/config/cap-table`,
       `/config/customers`, `/config/trailers`,
       `/config/trucks` (and `/config/trucks/:truckId/owners`)
     - `/config/road-allowances`,
       `/config/expense-categories`,
       `/config/forwarder-expense-types`,
       `/config/salary-periods`
   - **Evidence**: each page's `Sửa` button is present for
     ADMIN, hidden for non-`officeStaffOnly`/`adminOnly`
     roles.
4. **ADM-CFG-04 — Master-data import**
   - **Then** `/config/master-data-import` accepts a CSV /
     XLSX upload, dry-runs the diff, and applies on
     confirmation. Every applied row is audited.
5. **ADM-CFG-05 — App settings**
   - **Then** `/config/app-settings` is `strictAdminOnly`. It
     exposes: feature flags, LLM provider config (note:
     `/config/llm-settings` is a legacy redirect here), the
     agent-directive config, and the OCR rate-limit.

### Test steps

1. Log in as `giamdoc`. Open each `officeStaffOnly` config
   page; confirm editable. Open each `strictAdminOnly` page;
   confirm redirect.
2. Switch to `admin`. Open the same pages; confirm editable
   everywhere. Open `/config/master-data-import`; upload a
   test CSV; capture the dry-run and apply.

---

## Flow 15 — Trung tâm quản trị (Admin center)

**Route**: `/admin-center`
**Component**: `frontend/src/pages/AdminCenterPage.tsx`
**Allow**: `ADMIN` only (`strictAdminOnly` per `App.tsx:287`).

### Acceptance criteria

1. **ADM-CTR-01 — Health hub**
   - **Then** the page surfaces:
     - DB pool stats (active, idle, max).
     - Redis ping latency.
     - OCR call budget remaining.
     - Last backup timestamp + size.
     - Number of unresolved `audit_logs` ERROR rows in the
       last 24h.
2. **ADM-CTR-02 — Action shortcuts**
   - **Then** the page links to the strict-admin config
     pages, the master-data import, the user admin, and the
     audit log (filtered to `ERROR`).
3. **ADM-CTR-03 — Read-only**
   - **Then** the page is read-only; it does not expose
     destructive actions. Killing a stuck job is via a
     separate CLI command, not the UI.

### Test steps

1. Log in as `admin`. Open `/admin-center`.
2. Capture the health hub. Drill into a tile; capture.

---

## Flow 16 — Nhật ký hệ thống (Audit logs)

Same as `04-ketoan.md` Flow 12.

---

## Ghi chú hồi quy 2026-09-06 — Nút "Tạo mới" trên danh mục Nhà máy / Kho

- **Nguồn:** báo cáo khách hàng (Frank Ng relay, 2026-09-06): "Danh sách nhà máy đang không có nút
  tạo mới" (x2, nhấn mạnh admin role).
- **Hành vi mới:** `/config/factories` có nút **Tạo mới** ở toolbar → dialog tạo nhà máy/kho với bộ
  chọn **Khách hàng** (toàn bộ danh mục khách hàng, không chỉ khách đã có nhà máy), mã, tên đầy đủ,
  tên ngắn, địa chỉ, liên hệ, Google Maps, tuyến đường (bắt buộc với nhà máy). Tạo qua
  `POST /api/shipments/operational-sites` — quyền ADMIN/MANAGER/CUS/DISPATCHER
  (`SHIPMENT_INTAKE_MUTATION_ROLES`). Sau khi tạo: hàng mới xuất hiện (invalidate query), toast
  xác nhận.
- **Trước đó:** trang chỉ xem/sửa/ngưng hoạt động — tạo mới chỉ diễn ra trong form nhận lô của CUS
  (luồng CUS vẫn giữ nguyên, song song).
- **QA:** driver `scripts/test-factory-customer-create.mjs` (flow A) hoặc thủ công: tạo nhà máy cho
  một khách chưa có nhà máy → hàng mới hiện trong bảng; mở dialog sửa thấy đúng dữ liệu vừa nhập.
- **Đã chạy 2026-09-06 (local, UI-driven): PASS** — artifacts `qa/2026-09-06_factory-customer-creation/`.

## Negative / RBAC table (MANAGER + ADMIN)

| Action                                  | MANAGER | ADMIN | Other roles |
|-----------------------------------------|---------|-------|-------------|
| Read `/dashboard`                       | ✅      | ✅    | bounced     |
| Read `/users`                           | ✅      | ✅    | bounced     |
| Write user / reset password / lock      | ✅      | ✅    | bounced     |
| Create CUSTOMER user                    | ❌      | ✅    | bounced     |
| Read `/fleet` (full workspace)          | ✅      | ✅    | DISPATCHER read-only |
| Read `/trips`                           | ✅      | ✅    | bounced     |
| Create / edit trip                      | ❌      | ✅    | bounced     |
| Read `/shipments`                       | ✅      | ✅    | CUS write, others scoped |
| Create `/shipments`                     | ✅      | ✅    | CUS, DISPATCHER |
| Read `/customers` (full)                | ✅      | ✅    | ACCOUNTANT read |
| Read `/suppliers` (full)                | ✅      | ✅    | DISPATCHER read-only |
| Read `/finance` `/profit` `/accounting` | ✅      | ✅    | ACCOUNTANT full, others bounced |
| Read `/salary` `/penalties`             | ✅      | ✅    | bounced     |
| Read `/expenses/new`                    | ❌      | ✅    | bounced     |
| Read `/credit-overrides`                | ✅      | ✅    | ACCOUNTANT full |
| Read `/governance-actions`              | ✅      | ✅    | ACCOUNTANT full |
| Read `/recoverable-costs`               | ✅      | ✅    | CUS / ACCOUNTANT with capability |
| Read `/audit-logs`                      | ✅      | ✅    | ACCOUNTANT only |
| Read `/dispatch` `/dispatch-detail`     | ✅      | ✅    | DISPATCHER write, others bounced |
| Read `/config/*` (most)                 | partial | ✅    | ADMIN-only strict subset; ACCOUNTANT partial |
| Read `/config/app-settings`             | ❌      | ✅    | bounced     |
| Read `/config/master-data-import`       | ❌      | ✅    | bounced     |
| Read `/config/business-calendar`        | ❌      | ✅    | bounced     |
| Read `/admin-center`                    | ❌      | ✅    | bounced     |
| Read `/my-*`                            | ❌      | ❌    | DRIVER / OPS only |

## Out of scope (MANAGER + ADMIN)

- The customer portal (`/portal/*`).
- The driver app (`/my-trips`, `/my-earnings`, `/my-penalties`).
- The OPS portal (`/my-orders`, `/my-advances`, `/my-settlements`).

## Known open items (carry-over)

- **Maker-checker for customer creation** is on the MANAGER path
  but bypassed for CUS/DISPATCHER (per `6ef3b221`). The second
  approver must be a different user with the same financial
  role. Tests must use two distinct users.
- **Strict-admin pages**: only `admin` can reach. The
  `strictAdminOnly` guard is at `App.tsx:218`. The redirect
  target is the role-specific home, **not** the dashboard
  (because the home for ADMIN is `/dashboard` and the home
  for MANAGER is also `/dashboard`).
