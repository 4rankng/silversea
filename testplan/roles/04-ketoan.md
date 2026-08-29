# Role: ACCOUNTANT — Kế toán

> **Vietnamese label**: Kế toán (`Role.ACCOUNTANT`).
> **Home route**: `/accounting` (`routes.accounting`).
> **Primary sidebar section**: `Công nợ & Dòng tiền` (`financials`).
> **Test account (local + staging)**: `ketoan` / `Abc123`.
> **Primary pages**:
> - `/accounting` — `frontend/src/pages/AccountingWorkspacePage.tsx` (Tổng Quan Kế Toán)
> - `/accounting/fuel-evidence` — `frontend/src/pages/FuelEvidenceReviewPage.tsx` (strict accountant)
> - `/finance/treasury` — `frontend/src/pages/TreasuryPositionPage.tsx` (`treasury.read` capability)
> - `/debt` — `frontend/src/pages/DebtListPage.tsx` (Công nợ phải thu)
> - `/debt/:id` — `frontend/src/pages/DebtDetailPage.tsx` (Chi tiết công nợ)
> - `/payables` — `frontend/src/pages/PayableListPage.tsx` (Công nợ phải trả)
> - `/payables/:id` — `frontend/src/pages/PayableDetailPage.tsx`
> - `/expenses` — `frontend/src/pages/ExpenseListPage.tsx` (Chi phí phát sinh)
> - `/expenses/new` `/expenses/:id/edit` — `frontend/src/pages/ExpenseEntryPage.tsx` (admin only)
> - `/advances` — `frontend/src/pages/AdvanceWorkspacePage.tsx` (Tạm ứng & Hoàn ứng)
> - `/profit` — `frontend/src/pages/ProfitPage.tsx` (Báo cáo Lợi nhuận)
> - `/finance` — `frontend/src/pages/FinancePage.tsx` (Báo cáo Lãi lỗ)
> - `/credit-overrides` — `frontend/src/pages/CreditOverrideQueuePage.tsx` (Duyệt vượt hạn mức)
> - `/governance-actions` — `frontend/src/pages/GovernanceActionsPage.tsx` (Trung tâm phê duyệt)
> - `/recoverable-costs` — `frontend/src/pages/RecoverableCostsPage.tsx`
> - `/shipments` — view-only (operations audit)
> - `/audit-logs` — `frontend/src/pages/AuditLogPage.tsx` (Nhật ký hệ thống)
>
> Cross-cutting rules live in [`README.md`](README.md) §5.
> **Financial precision** (DATA-02) and **audit log** (AUDIT-01) are
> critical for this role.

---

## Scope boundary

ACCOUNTANT is the **ledger & cash** role. The accountant:

- Posts journal entries (transactions) for AR (`PAYMENT_RECEIVED`,
  `PENALTY`, `MANAGEMENT_FEE`, `ADJUSTMENT`).
- Posts journal entries for AP (`VENDOR_EXPENSE`, `VENDOR_PAYMENT`,
  `OPS_ADVANCE`, `OPS_SETTLEMENT`, `EXTERNAL_CARRIER_COST`,
  `FUEL_EXPENSE`).
- Reviews fuel evidence, recoverable costs, credit overrides, and
  governance actions.
- Reads but does not edit most operational data (trips, fleet,
  shipments).
- **Cannot** dispatch (no `/dispatch`, `/dispatch-detail`).
- **Cannot** access strict-admin pages (`/admin-center`,
  `/config/app-settings`, `/config/master-data-import`,
  `/config/business-calendar`).

If the accountant is dropped into a forbidden route, AUTH-03 in §5 of
the README applies (silent redirect to `/accounting`).

A subtle RBAC note: the ACCOUNTANT sidebar is intentionally lean. Per
the regression comment in `Layout.tsx:222`, several items that *used*
to be in the sidebar (`/trips`, `/fleet`, `/salary`, `/penalties`,
`/customers`, `/suppliers`, `/config/pricing-tables`) are removed
because `App.tsx` bounces ACCOUNTANT off every `adminOnly` route, so
each was a silent dead link. The current sidebar only includes routes
ACCOUNTANT can actually visit.

---

## Flow 1 — Tổng Quan Kế Toán (Accounting dashboard)

**Route**: `/accounting`
**Component**: `frontend/src/pages/AccountingWorkspacePage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `ACCOUNTANT` (`officeStaffOnly` per
`App.tsx:256`).
**Pre-conditions**: seed has at least 1 customer with non-zero
balance, 1 supplier with a payable, 1 trip in `Hoàn thành` state.

### Acceptance criteria

1. **ACC-DASH-01 — Hero KPIs render**
   - **Then** the page shows four hero KPIs at the top:
     `Tổng phải thu` (AR), `Tổng phải trả` (AP), `Quỹ hiện tại`
     (treasury), `Lợi nhuận ròng tháng này` (MTD net profit).
   - **Evidence**: full-page screenshot at 1440px.

2. **ACC-DASH-02 — Numbers match the underlying queries**
   - **Then** `Tổng phải thu` equals the sum of `customers.balance`
     across all `ACTIVE` customers; `Tổng phải trả` equals the sum
     of `suppliers.balance`; `Quỹ hiện tại` matches the treasury
     position from the `/finance/treasury` page. No off-by-one
     rounding; rounding to 2 decimal places using `round2dp()`.

3. **ACC-DASH-03 — Drill-down links**
   - **Given** a hero KPI
   - **When** the user clicks it
   - **Then** the page navigates to the relevant list page
     (`/debt`, `/payables`, `/finance/treasury`, `/profit`) with the
     current month pre-selected.

4. **ACC-DASH-04 — Month switcher**
   - **Then** a month picker at the top right allows the user to
     re-run the KPIs for any past month. Switching the month
     re-fetches the data and updates all four KPIs in < 1.5 s.

### Test steps

1. Log in as `ketoan`. Land on `/accounting`.
2. Capture the current month.
3. Click each hero KPI; capture the destination page.
4. Switch to a different month; capture the new state.

### Regression hooks

- `frontend/src/pages/AccountingWorkspacePage.test.tsx` and
  `AccountingWorkspacePage.styles.test.ts` stay green.

---

## Flow 2 — Công nợ phải thu (Accounts receivable)

**Route**: `/debt` (list) and `/debt/:id` (detail)
**Components**: `frontend/src/pages/DebtListPage.tsx`,
`frontend/src/pages/DebtDetailPage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `ACCOUNTANT` (`financeReaderOnly` per
`App.tsx:261`).

### Acceptance criteria

1. **ACC-AR-01 — List columns & sort**
   - **Then** the list shows: `Mã khách hàng`, `Tên`, `Hạn mức`,
     `Dư nợ`, `Quá hạn`, `Trạng thái` (`Bình thường` / `Cảnh báo` /
     `Khóa`). The default sort is `Quá hạn` desc.
   - **Reference**: `DebtListPage.sort.test.tsx`.

2. **ACC-AR-02 — Filter by status / province**
   - **Then** the user can filter by status, by province, and search
     by name. The URL reflects the state.

3. **ACC-AR-03 — Drill-down to ledger**
   - **Given** a customer row
   - **When** the user opens the detail
   - **Then** the page shows a chronological ledger of
     `TRIP_REVENUE`, `PAYMENT_RECEIVED`, `PENALTY`,
     `MANAGEMENT_FEE`, `ADJUSTMENT`. The running balance is shown
     on the right. Each row links to the underlying trip
     (`/trips/:id`) or governance action (`/governance-actions`).
   - **Reference**: `DebtDetailPage.ledger-sort.test.tsx`,
     `DebtDetailPage.payment.test.tsx`.

4. **ACC-AR-04 — Record a payment**
   - **Given** a customer
   - **When** the user posts a `PAYMENT_RECEIVED` transaction
   - **Then** the ledger row appears at the top, the running
     balance decreases by the payment amount, the customer's
     `balance` column updates, an audit-log row is written.
   - **Evidence**: ledger before/after screenshots; audit row
     in `/audit-logs`.

5. **ACC-AR-05 — Currency precision**
   - **Then** every monetary value uses VND with no decimals
     (`Intl.NumberFormat('vi-VN', { style: 'currency', currency:
     'VND', maximumFractionDigits: 0 })`).

### Test steps

1. Log in as `ketoan`. Open `/debt`.
2. Capture the list with default sort.
3. Click a customer with a non-zero balance.
4. Capture the ledger.
5. Post a payment of, e.g., 5,000,000 VND.
6. Capture the updated ledger + the audit row.

### Regression hooks

- `DebtListPage.sort.test.tsx`, `DebtDetailPage.ledger-sort.test.tsx`,
  `DebtDetailPage.payment.test.tsx`.
- Backend: `customers.balance` updated only via the journal
  transaction path; no raw UPDATEs.

---

## Flow 3 — Công nợ phải trả (Accounts payable)

**Route**: `/payables` (list) and `/payables/:id` (detail)
**Components**: `frontend/src/pages/PayableListPage.tsx`,
`frontend/src/pages/PayableDetailPage.tsx`
**Allow**: `financeReaderOnly`.

### Acceptance criteria

1. **ACC-AP-01 — List columns & sort**
   - **Then** columns: `Mã nhà cung cấp`, `Tên`, `Loại` (`Nhà cung
     cấp` / `Nhà xe ngoài`), `Dư nợ`, `Quá hạn`, `Trạng thái`.
     Default sort: `Quá hạn` desc.
2. **ACC-AP-02 — Drill-down shows AP ledger**
   - **Then** the detail page shows `VENDOR_EXPENSE`,
     `VENDOR_PAYMENT`, `OPS_ADVANCE`, `OPS_SETTLEMENT`,
     `EXTERNAL_CARRIER_COST`, `FUEL_EXPENSE` rows in chronological
     order, with running balance.
3. **ACC-AP-03 — Record a vendor payment**
   - **When** the user posts a `VENDOR_PAYMENT`
   - **Then** the supplier's `balance` decreases, the ledger
     updates, an audit row is written.
4. **ACC-AP-04 — Read-only access for the dispatcher**
   - **Then** if a DISPATCHER navigates to `/payables/:id`, they
     are bounced to `/dispatch` (per `App.tsx:333` `financeReaderOnly`).

### Test steps

1. Log in as `ketoan`. Open `/payables`.
2. Capture the list. Click a supplier.
3. Post a payment and capture the updated state.

---

## Flow 4 — Tạm ứng & Hoàn ứng (Advances & settlements)

**Route**: `/advances`
**Component**: `frontend/src/pages/AdvanceWorkspacePage.tsx`
**Allow**: `financeReaderOnly`.

### Acceptance criteria

1. **ACC-ADV-01 — Tabs: Tạm ứng / Hoàn ứng / Đã đối soát**
   - **Then** the workspace has three tabs. Each row in the
     `Tạm ứng` tab shows: `Mã phiếu`, `OPS nhận`, `Số tiền`,
     `Ngày tạo`, `Trạng thái` (`Chờ duyệt` / `Đã duyệt` /
     `Đã hoàn ứng` / `Đã hủy`).
2. **ACC-ADV-02 — Approve an OPS advance**
   - **Given** an OPS-issued advance in `Chờ duyệt`
   - **When** the accountant clicks `Duyệt`
   - **Then** the status flips to `Đã duyệt`, an `OPS_ADVANCE`
     journal row is posted, the supplier / OPS balance updates.
3. **ACC-ADV-03 — Settle an advance**
   - **When** the OPS submits expenses against the advance and
     the accountant clicks `Đối soát`
   - **Then** an `OPS_SETTLEMENT` row is posted, the running
     balance clears the advance (or shows the residual as a
     new AP), the OPS is informed.
4. **ACC-ADV-04 — Read-only for OPS once it's been approved**
   - **Then** an OPS user can no longer edit a `Đã duyệt`
     advance; the OPS can only view the history.

### Test steps

1. From the seed, find an OPS advance in `Chờ duyệt` (create one
   via `giaonhan` if needed).
2. Approve it as `ketoan`. Capture.
3. Submit a settlement via `giaonhan`. Reconcile as `ketoan`.
   Capture.

---

## Flow 5 — Chi phí phát sinh (Ad-hoc expenses)

**Route**: `/expenses` (list) `/expenses/new` `/expenses/:id/edit`
**Components**: `frontend/src/pages/ExpenseListPage.tsx`,
`frontend/src/pages/ExpenseEntryPage.tsx`
**Allow list**: `financeReaderOnly`. **Allow create/edit**: `ADMIN`
only (`adminOnly` per `App.tsx:335`).

### Acceptance criteria

1. **ACC-EXP-01 — Read-only list for the accountant**
   - **Then** the list shows every ad-hoc expense with: `Mã chi
     phí`, `Loại`, `Số tiền`, `Ngày`, `Người tạo`, `Trạng thái`.
     No `Sửa` / `Xóa` button is rendered (the accountant
     cannot create / edit expenses at this endpoint).
2. **ACC-EXP-02 — Accountant uses the Advance / Settlement / AP
   pages to post costs**
   - **Then** the canonical cost-posting path for the accountant
     is the journal-entry pages (AP, advance settlement), not
     `/expenses/new`. The `/expenses/new` route is `adminOnly`.
3. **ACC-EXP-03 — Drill-down**
   - **When** the user clicks a row
   - **Then** a read-only detail view shows the receipt upload
     (if any) and the linked trip.

### Test steps

1. Log in as `ketoan`. Open `/expenses`.
2. Try to navigate to `/expenses/new` — confirm redirect to
   `/accounting`.
3. Click a row and confirm the read-only detail.

---

## Flow 6 — Duyệt vượt hạn mức (Credit override queue)

**Route**: `/credit-overrides`
**Component**: `frontend/src/pages/CreditOverrideQueuePage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `ACCOUNTANT` (`officeStaffOnly`).

### Acceptance criteria

1. **ACC-CRED-01 — Queue is FIFO and scoped to financial roles**
   - **Then** the queue lists every pending credit-override
     request sorted by `createdAt` ascending. Each row:
     `Mã yêu cầu`, `Khách hàng`, `Hạn mức hiện tại`, `Hạn mức
     đề xuất`, `Lý do`, `Người yêu cầu`, `Ngày tạo`.
2. **ACC-CRED-02 — Approve / reject**
   - **When** the user clicks `Duyệt` / `Từ chối`
   - **Then** the request's status flips; the customer's
     `creditLimit` is updated (on approve); an audit-log row
     is written; the request disappears from the queue.
3. **ACC-CRED-03 — Re-approval flow**
   - **Then** an override request that was previously
     `Từ chối` cannot be re-submitted by the same actor; the
     original requester must re-create the request.

### Test steps

1. As `admin`, create a credit-override request for a customer
   (or use the seed).
2. Switch to `ketoan` and approve.
3. Capture before/after.

---

## Flow 7 — Trung tâm phê duyệt (Governance actions)

**Route**: `/governance-actions`
**Component**: `frontend/src/pages/GovernanceActionsPage.tsx`
**Allow**: `officeStaffOnly`.

### Acceptance criteria

1. **ACC-GOV-01 — Inbox of pending actions**
   - **Then** the page shows every approval-pending action
     touching the ledger: credit overrides, return-for-evidence
     requests, salary-period locks, debit-note approvals. Each
     row links to the underlying entity.
2. **ACC-GOV-02 — Action execution writes an audit row**
   - **When** the user clicks `Duyệt` / `Từ chối`
   - **Then** the action executes server-side; an audit-log row
     is written; the inbox refreshes.

---

## Flow 8 — Đối soát nhiên liệu (Fuel evidence review)

**Route**: `/accounting/fuel-evidence`
**Component**: `frontend/src/pages/FuelEvidenceReviewPage.tsx`
**Allow**: `ACCOUNTANT` only (`accountantOnly` per `App.tsx:257`).

### Acceptance criteria

1. **ACC-FUEL-01 — Queue of fuel-evidence submissions**
   - **Then** every driver-uploaded fuel receipt waiting for
     review is listed: `Mã chuyến`, `Biển số`, `Lít`, `Số tiền`,
     `Hóa đơn (ảnh)`, `Trạng thái`.
2. **ACC-FUEL-02 — Approve / reject**
   - **When** the user clicks `Duyệt`
   - **Then** a `FUEL_EXPENSE` journal row is posted, the
     trip's `fuelCost` is updated, the evidence status flips
     to `Đã duyệt`. On reject, the row is marked `Bổ sung
     chứng từ` and the driver is asked to re-upload.
3. **ACC-FUEL-03 — OCR is rate-limited**
   - **Then** the per-user OCR call is rate-limited (per
     `66cbf165`); the accountant cannot burn through the OCR
     budget. The rate-limit window resets on a new day.
4. **ACC-FUEL-04 — Fuel image renders for the accountant**
   - **When** the queue lists a submission
   - **Then** the receipt image is visible on the review card —
     the `<img>` src must carry the JWT query token
     (`?token=…`); a raw `/api/photos/…` URL 401s in the
     browser because `<img>` cannot send Authorization
     headers (regression fixed 2026-08-29).

### Test steps

1. As `laixe`, submit a fuel receipt for a completed trip.
2. As `ketoan`, open `/accounting/fuel-evidence`.
3. Approve the receipt. Capture before/after.

---

## Flow 9 — Báo cáo Lãi lỗ (P&L) & Lợi nhuận (Profit)

**Routes**: `/finance` (Lãi lỗ), `/profit` (Lợi nhuận)
**Components**: `frontend/src/pages/FinancePage.tsx`,
`frontend/src/pages/ProfitPage.tsx`
**Allow**: `financeReaderOnly`.

### Acceptance criteria

1. **ACC-PL-01 — P&L line items**
   - **Then** `/finance` shows: `Doanh thu`, `Chi phí trực tiếp`
     (xăng, cầu đường, phí khác), `Chi phí nhân sự` (lương tài
     xế), `Chi phí quản lý`, `Lợi nhuận gộp`, `Lợi nhuận ròng`.
     The numbers tie back to the journal entries; the sum of
     `TRIP_REVENUE` equals the top-line `Doanh thu`.
2. **ACC-PL-02 — Profit per truck**
   - **Then** `/profit` shows a per-truck breakdown: `Biển số`,
     `Số chuyến`, `Doanh thu`, `Chi phí`, `Lợi nhuận`. The numbers
     use `computeTripTotals()` from `shared/src/calculations/`.
3. **ACC-PL-03 — Export**
   - **Then** the user can export the current view to CSV / XLSX
     via the toolbar. The file is generated client-side and
     contains the same numbers shown in the table.

### Test steps

1. Log in as `ketoan`. Open `/finance` and `/profit`.
2. Switch months; confirm the data updates.
3. Click `Export` and capture the file.

---

## Flow 10 — Sổ quỹ / Ngân hàng (Treasury position)

**Route**: `/finance/treasury`
**Component**: `frontend/src/pages/TreasuryPositionPage.tsx`
**Allow**: any role with `treasury.read` capability (typically
`ADMIN`, `MANAGER`, `ACCOUNTANT`).

### Acceptance criteria

1. **ACC-TRS-01 — Capability gating**
   - **Then** a role without `treasury.read` is redirected away
     from `/finance/treasury` and the sidebar item is hidden.
2. **ACC-TRS-02 — Cash position per account**
   - **Then** the page shows, per bank / cash account: `Mã tài
     khoản`, `Loại` (`Tiền mặt` / `Ngân hàng`), `Số dư hiện tại`,
     `Số dư cuối ngày hôm qua`, `Biến động 7 ngày` (sparkline).
3. **ACC-TRS-03 — Cash-flow projection**
   - **Then** the bottom of the page shows a 14-day cash-flow
     projection: scheduled `PAYMENT_RECEIVED` rows minus scheduled
     `VENDOR_PAYMENT` / `OPS_ADVANCE` rows. The numbers are in
     VND and use no decimals.

### Test steps

1. Grant `treasury.read` to `ketoan` (it should be there by
   default in the seed; verify in the seed log).
2. Open `/finance/treasury`. Capture.
3. Hover the sparkline; capture the tooltip with the 7-day
   detail.

---

## Flow 11 — Đối soát chi phí (Recoverable costs) — capability-gated

**Route**: `/recoverable-costs`
**Component**: `frontend/src/pages/RecoverableCostsPage.tsx`
**Allow**: `recoverable_costs.read` capability, plus the role-based
guard (ADMIN, MANAGER, ACCOUNTANT, CUS-with-capability).

### Acceptance criteria

1. **ACC-RECON-01 — Flag / approve a recoverable cost row**
   - **Then** the accountant can mark a row as `Đã đối soát`
     (reconciled). The flag is server-authoritative (a PATCH to
     the dedicated endpoint, not a direct row update).
2. **ACC-RECON-02 — Disagreement workflow**
   - **When** the accountant disagrees with a CUS flag
   - **Then** the accountant can post a note (`Ghi chú đối soát`)
     and flip the row back to `Chờ kiểm tra` with the note
     attached. The CUS is notified.
3. **ACC-RECON-03 — Bulk reconcile**
   - **Then** a multi-select with a "Đối soát tất cả đã chọn"
     bulk action posts the same flag for every selected row in a
     single transaction. No partial state on failure.

### Test steps

1. From a prior round or the seed, ensure at least one
   recoverable-cost row exists.
2. As `ketoan`, mark it reconciled. Capture.
3. Disagree with a CUS flag and post a note. Capture.

---

## Flow 12 — Nhật ký hệ thống (Audit log)

**Route**: `/audit-logs`
**Component**: `frontend/src/pages/AuditLogPage.tsx`
**Allow**: `officeStaffOnly`.

### Acceptance criteria

1. **ACC-AUD-01 — Filter by actor / action / date range**
   - **Then** the user can filter by `Người thực hiện`, `Hành
     động`, `Đối tượng` (resource), and a date range. The
     filter composes; the URL reflects the state.
2. **ACC-AUD-02 — Row drill-down**
   - **When** the user clicks a row
   - **Then** a side-panel shows the full before/after JSON diff
     for the action.
3. **ACC-AUD-03 — Read-only**
   - **Then** no edit / delete. The audit log is append-only.
4. **ACC-AUD-04 — Coverage**
   - **Then** every state-changing action in this document
     (Flow 2.4, 3.3, 4.2, 6.2, 7.2, 8.2) produces an audit row.

### Test steps

1. Trigger an action (e.g., post a payment in Flow 2).
2. Open `/audit-logs`, filter by `Hành động = payment.received`,
   confirm the row.

---

## Flow 13 — Tổng quan lô hàng (Shipments — audit-only)

**Route**: `/shipments`
**Component**: `frontend/src/pages/ShipmentsPage.tsx`
**Allow**: any shipment-read role (incl. ACCOUNTANT).

### Acceptance criteria

1. **ACC-SHIP-01 — Read-only**
   - **Then** the accountant sees the same list as CUS, with no
     financial columns (the financial detail is at `/debt/:id`).
2. **ACC-SHIP-02 — Drill-down to trip audit**
   - **When** the user opens a shipment and then a linked trip
   - **Then** the trip detail is the office-staff trip detail
     (`/trips/:id`), which includes cost lines, fuel evidence
     status, and the trip's own audit-log teaser.

---

## Negative / RBAC table (ACCOUNTANT)

| Action                                | ACCOUNTANT | ADMIN | MANAGER | DISPATCHER | OPS | CUS | DRIVER | CUSTOMER |
|---------------------------------------|------------|-------|---------|------------|-----|-----|--------|----------|
| Read `/accounting`                    | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Post journal entries (AR/AP)          | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/debt` `/payables`              | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/finance/treasury`              | cap        | cap   | cap     | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/finance` `/profit`             | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/expenses` (list)               | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Create / edit expense (`/expenses/new`)| ❌         | ✅    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/accounting/fuel-evidence`      | ✅         | ❌    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/credit-overrides` `/governance-actions` | ✅  | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Approve credit override               | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/recoverable-costs`             | cap        | ✅    | ✅      | ❌         | ❌  | cap | ❌     | ❌       |
| Read `/shipments` (audit)             | ✅         | ✅    | ✅      | ✅         | ❌  | ✅  | ❌     | scoped   |
| Read `/dispatch`                      | ❌         | ✅    | ✅      | ✅         | ❌  | ❌  | ❌     | ❌       |
| Read `/admin-center`                  | ❌         | ✅    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/config/app-settings`           | ❌         | ✅    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/audit-logs`                    | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |

`cap` = requires the capability. `scoped` = row-scoped to own
shipments.

## Out of scope (ACCOUNTANT)

- Dispatch planning.
- Editing customers (read-only at best; no `/customers` for the
  accountant via the sidebar).
- Editing fleet / trucks / drivers.
- Strict-admin pages.
- Driver or OPS portals.

## Known open items (carry-over)

- **Sidebar lean-down**: the accountant sidebar is intentionally
  short. If a product change adds a new financial route, the
  sidebar config in `Layout.tsx:201` must be updated, and the
  corresponding `App.tsx` route guard must allow ACCOUNTANT.
