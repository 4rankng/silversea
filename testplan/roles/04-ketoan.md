# Role: ACCOUNTANT — Kế toán

> **Vietnamese label**: Kế toán (`Role.ACCOUNTANT`).
> **Home route**: `/accounting` (`routes.accounting`).
> **Primary sidebar section**: `Công nợ & Dòng tiền` (`financials`).
> **Test accounts**: chọn theo môi trường qua `../testaccounts.txt` (role → username). Runner tự map `ACCOUNTANT` + env → username phù hợp.
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
- Reconciles fuel evidence and recoverable costs, and performs authorized
  financial changes directly on the source records.
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

1. **ACC-DASH-01 — Current accounting workspaces are discoverable**
   - Open the current accounting navigation and reach transport work, OPS costs/reconciliation, road costs, records and reports permitted for this accountant. Do not require the superseded four-hero-card dashboard layout.
2. **ACC-DASH-02 — Displayed amounts reconcile with their sources**
   - Compare each displayed amount with the same date, entity and status scope in its source detail. Distinguish actual expense, customer charge, received/paid cash and remaining debt. Missing historical allocation is unknown, not zero. Do not use a raw sum of cached partner balances as an independent accounting oracle.
3. **ACC-DASH-03 — Detail and navigation preserve context**
   - Open source/detail and return. Keep the chosen date/filter/tab and show the corresponding records; no dead or retired approval destination.
4. **ACC-DASH-04 — Date changes and loading are truthful**
   - Change the displayed work period/date filters. Show loading, then results for that exact scope; failed requests have an explicit retry. Do not invent a 1.5-second product SLA or show prior results as a completed new query.

### Test steps

1. Log in as ACCOUNTANT. Open `/accounting` and the two accounting-cost boards.
2. Use the current tabs, date controls, text search and source drilldowns at 390/820/1440px.
3. Change filters, navigate away/back and reload a deep link; verify scope and totals.
4. Compare selected details with the canonical API/source evidence. Record UI coverage separately from full financial integration tests.

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
     (`/trips/:id`) or the current read-only source/history view. Retired `/governance-actions` is never a destination.
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

1. Log in as `ACCOUNTANT`. Open `/debt`.
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

1. Log in as `ACCOUNTANT`. Open `/payables`.
2. Capture the list. Click a supplier.
3. Post a payment and capture the updated state.

---

## Flow 4 — Tạm ứng & Hoàn ứng (Advances & settlements)

**Route**: `/advances`; existing finance permissions apply.
**Canonical cases**: `flows/05-ops-quy-chi-phi.md`, `NO-APP-07..11`.

### Acceptance criteria

1. **ACC-ADV-01 — Request, funding and reconciliation are distinct**
   - Each row identifies the OPS recipient, requested amount, actual amount funded,
     outstanding balance and history. An unfunded request is not cash received;
     no approval status or approval tab is shown.
2. **ACC-ADV-02 — Record actual funding directly**
   - The authorized accountant selects the OPS recipient, fund/account, amount,
     date and source allocation and records the actual advance once. A valid
     request completes immediately, with a cash reference and audit record;
     there is no second actor, approval queue or automatic money from a request.
3. **ACC-ADV-03 — Reconcile without inventing payment**
   - For an actual 1,000,000đ advance and 1,200,000đ/800,000đ actual expense,
     reconciliation shows 200,000đ payable to OPS/returnable by OPS respectively.
     Only a separate actual payment/refund updates the cash balance; partial
     payments and reversals retain their source allocation and history.
4. **ACC-ADV-04 — Preserve paid history**
   - OPS can read the funded advance and its history. Posted cash cannot be
     overwritten or canceled as an unfunded request; corrections use the existing
     authorized adjustment/reversal action with a reason and period constraints.

### Test steps

1. Create an OPS request; verify the balance does not increase.
2. As an authorized finance user, record funding with its fund and reference;
   retry the same request and verify one cash movement.
3. Record expenses, reconcile and verify the residual. Record a partial payment
   or refund separately; verify balances, permissions and immutable history.

---

## Flow 5 — Chi phí phát sinh (Ad-hoc expenses)

**Route**: `/expenses` (list) `/expenses/new` `/expenses/:id/edit`
**Components**: `frontend/src/pages/ExpenseListPage.tsx`,
`frontend/src/pages/ExpenseEntryPage.tsx`
**Allow list/create/edit**: `financeReaderOnly` (`ADMIN`, `MANAGER`, `ACCOUNTANT`). Source permissions, posted/locked records and required correction history still apply.

### Acceptance criteria

1. **ACC-EXP-01 — Accessible expense list**
   - The accountant can view and search expenses, open the permitted create/edit action, and identify amount, supplier, category, date and status. Historical records remain traceable.
2. **ACC-EXP-02 — Direct entry with accurate recovery**
   - `/expenses/new` opens for ACCOUNTANT. Required supplier/category selection supports click-and-type search. Valid data saves directly; no approval step. Failed catalog queries show retry, preserve entered amount/note and disable Save until required choices are available. A failed mutation retains the draft and does not replay automatically.
3. **ACC-EXP-03 — Existing record and missing-record behavior**
   - Open an existing expense and verify persisted values/evidence and applicable locks. A missing/inaccessible expense shows the actual error plus retry/return; it must not open a blank editable form that could create a different cost.

### Test steps

1. Log in as ACCOUNTANT. Open `/expenses`, type a filter and open a record.
2. Open `/expenses/new`, search/select supplier and category, enter valid/invalid amounts and use the date picker.
3. Force a required catalog or save API failure, retry manually, and verify draft preservation with no duplicate submit.
4. Open a nonexistent edit ID and verify explicit recovery. Inspect 360/390/820/1440px controls, validation and reachable actions.

Current browser and component evidence: FIN-UI-09/10/11/12 in `../2026-09-17-ui-audit-finance-ops.md`; not a claim that every financial mutation was newly browser-run.

---

## Flow 6 — Hạn mức tín dụng (Direct authorized changes)

**Location**: the existing customer financial settings, within current permissions.
The retired `/credit-overrides` queue is not a working page or alternative command.

### Acceptance criteria

1. **ACC-CRED-01 — No credit approval queue**
   - No navigation, pending queue or form requests a second user's approval.
     An old approval link cannot revive the retired workflow.
2. **ACC-CRED-02 — Direct authorized change**
   - A role already entitled to change the customer's financial settings saves
     valid values directly. Required reasons, credit rules, access scope,
     concurrency protection and the before/after audit remain enforced.
3. **ACC-CRED-03 — Corrections are ordinary authorized edits**
   - An invalid request shows its error without creating a pending request.
     A corrected request is validated and saved directly; retry cannot duplicate
     the change or create a queued re-approval.

### Test steps

1. Open the customer financial settings as an authorized user; change and save
   a valid value, then read back the value and audit history.
2. Repeat as an unauthorized role; verify denied access and unchanged data.
3. Try the retired queue URL/API; verify no action, no queue and no data mutation.

---

## Flow 7 — Thao tác tài chính trực tiếp (No approval inbox)

### Acceptance criteria

1. **ACC-GOV-01 — No governance inbox**
   - `/governance-actions` is retired, is absent from navigation and cannot be
     used to submit, check, approve or reject ledger actions. Work is done at
     the underlying entity with its existing permissions and validation.
2. **ACC-GOV-02 — Direct commands retain audit and financial safeguards**
   - Authorized receipt/payment, evidence correction, salary-period close and
     debit actions complete in the same request and write the corresponding
     business/audit history. Unauthorized actors remain denied; evidence,
     version, period locks and idempotency remain enforced. No pending result
     or second-actor step is introduced.

---

## Flow 8 — Đối soát nhiên liệu (Fuel evidence review)

**Route**: `/accounting/fuel-evidence`
**Component**: `frontend/src/pages/FuelEvidenceReviewPage.tsx`
**Allow**: `ACCOUNTANT` only (`accountantOnly` per `App.tsx:257`).

### Acceptance criteria

1. **ACC-FUEL-01 — Fuel evidence to reconcile**
   - **Then** every driver-uploaded fuel receipt waiting for
     review is listed: `Mã chuyến`, `Biển số`, `Lít`, `Số tiền`,
     `Hóa đơn (ảnh)`, `Trạng thái`.
2. **ACC-FUEL-02 — Record or correct evidence directly**
   - **When** an authorized user records valid fuel evidence
   - **Then** it is saved directly. Reconciliation updates the existing cost
     source once; adding or replacing a photo does not post a second cost or
     money movement. Missing evidence is shown as missing evidence, with an
     explanation of what to add, rather than an approval/rejection state.
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

1. As `DRIVER`, submit a fuel receipt for a completed trip.
2. As `ACCOUNTANT`, open `/accounting/fuel-evidence`.
3. Record/reconcile the receipt directly. Capture before/after and verify no duplicate cost.

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

1. Log in as `ACCOUNTANT`. Open `/finance` and `/profit`.
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
2. **ACC-TRS-02 — Actual cash position per account**
   - Show account identity, cash/bank type, company/TM fund, opening/cutover context and actual posted balance. Drill into the real source transactions. Unknown legacy fund/allocation is explicit; no assumed projected receipt becomes cash.
3. **ACC-TRS-03 — Historical cutoff and source traceability**
   - Apply the supported cutoff/filter and verify the resulting balances against actual receipts/payments/reversals. Unpaid requests, scheduled work and created debit are not cash. The old speculative 14-day cash-flow forecast is not a current PRD requirement.

### Test steps

1. Use the existing ACCOUNTANT `treasury.read` permission; do not expand permissions just to make the test pass.
2. Open `/finance/treasury`, change supported filters, open account/source detail and return.
3. At 360/390/820/1440px verify account name, code, fund and conversion status occupy separate readable lines and amounts/actions remain reachable.
4. For money assertions use owned local cash fixtures and actual posting/reversal evidence; screenshots alone do not establish balance correctness.

---

## Flow 11 — Đối soát chi phí (Recoverable costs) — capability-gated

**Route**: `/recoverable-costs`
**Component**: `frontend/src/pages/RecoverableCostsPage.tsx`
**Allow**: `recoverable_costs.read` capability, plus the role-based
guard (ADMIN, MANAGER, ACCOUNTANT, CUS-with-capability).

### Acceptance criteria

1. **ACC-RECON-01 — Reconcile a recoverable cost row directly**
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
2. As `ACCOUNTANT`, mark it reconciled. Capture.
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
| Create / edit expense (`/expenses/new`)| ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/accounting/fuel-evidence`      | ✅         | ❌    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Use retired approval queues           | ❌         | ❌    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Edit customer financial settings     | existing | existing | existing | ❌ | ❌ | ❌ | ❌ | ❌ |
| Read `/recoverable-costs`             | cap        | ✅    | ✅      | ❌         | ❌  | cap | ❌     | ❌       |
| Read `/shipments` (audit)             | ✅         | ✅    | ✅      | ✅         | ❌  | ✅  | ❌     | scoped   |
| Read `/dispatch`                      | ❌         | ✅    | ✅      | ✅         | ❌  | ❌  | ❌     | ❌       |
| Read `/admin-center`                  | ❌         | ✅    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/config/app-settings`           | ❌         | ✅    | ❌      | ❌         | ❌  | ❌  | ❌     | ❌       |
| Read `/audit-logs`                    | ✅         | ✅    | ✅      | ❌         | ❌  | ❌  | ❌     | ❌       |

`cap` = requires the capability. `scoped` = row-scoped to own
shipments. `existing` = only the actions already permitted on that entity;
removing approvals grants no additional financial permissions.

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
