# Role: CUSTOMER — Khách hàng

> **Vietnamese label**: Khách hàng (`Role.CUSTOMER`).
> **Home route**: `/portal/shipments` (`routes.portalShipments`).
> **Primary sidebar section**: `Portal` (`portal`).
> **Test accounts**: chọn theo môi trường qua `../testaccounts.txt` (role → username). Runner tự map `CUSTOMER` + env → username phù hợp. Lưu ý: `CUSTOMER` role **không tồn tại trên staging** (prod không có customer portal users); các case `CUSTOMER` chỉ chạy được trên local với `CUSTOMER-SAMSUNG` / `CUSTOMER-CANON`.
> **Primary pages**:
> - `/portal/shipments` — `frontend/src/pages/portal/PortalShipmentsPage.tsx`
> - `/portal/shipments/:id` — `frontend/src/pages/portal/PortalShipmentDetailPage.tsx`
> - `/portal/debit-notes` — `frontend/src/pages/portal/PortalDebitNotesPage.tsx`
> - `/portal/statement` — `frontend/src/pages/portal/PortalStatementPage.tsx`
>
> The customer portal is a **separate shell** (`CustomerPortalLayout`)
> with its own brand chrome (no internal sidebar / topbar, no
> nav to the office workspace). All routes are `customerOnly`
> per `App.tsx:365` onward.
>
> Cross-cutting rules live in [`README.md`](README.md) §5.

---

## Scope boundary

CUSTOMER is the **external client** role. The customer:

- Sees only the **shipments that belong to them** (row-scoped
  via `scopedByCustomer`).
- Sees only the **debit notes** that belong to them.
- Sees only their own **statement of account**.
- **Cannot** see any other customer's data, any trip internals,
  any financial reports, any admin pages, any master data, any
  audit log.
- **Cannot** mutate anything in this iteration. The portal is
  read-only in Wave 2; mutations (e.g. `Tải lên chứng từ`,
  `Xác nhận đã nhận hàng`) ship in a later wave.

If the customer is dropped into a forbidden route, AUTH-03 in
§5 of the README applies (silent redirect to
`/portal/shipments`).

The customer portal uses a different layout shell
(`CustomerPortalLayout` instead of the office `Layout`), so
cross-portal escape hatches must not exist. AC `CUST-PORTAL-04`
below is the regression hook for that.

---

## Flow 1 — Lô hàng của tôi (My shipments)

**Route**: `/portal/shipments`
**Component**: `frontend/src/pages/portal/PortalShipmentsPage.tsx`
**Allow**: `CUSTOMER` only (`customerOnly` per `App.tsx:365`).
**Pre-conditions**: at least 1 shipment is row-scoped to the
customer (the seed creates a few).

### Acceptance criteria

1. **CUST-SHIP-01 — Read-only list of own shipments**
   - **Then** the page shows the customer's own shipments,
     newest first. Each row: `Mã lô hàng`, `Ngày tạo`,
     `Tuyến` (`Điểm đi → Điểm đến`), `Trạng thái`,
     `Tổng tiền` (VND). The list does **not** show internal
     columns (`Biển số`, `Tài xế`, `Chi phí`, `Lợi nhuận`).
2. **CUST-SHIP-02 — Status filter & search**
   - **Then** the user can filter by `Trạng thái` (chip row)
     and search by `Mã lô hàng` / `Tuyến`. URL reflects the
     state.
3. **CUST-SHIP-03 — Row-scoped: no leak**
   - **Given** the customer is `CUSTOMER-SAMSUNG`
   - **When** the user navigates to a shipment ID that
     belongs to `CUSTOMER-CANON` directly
   - **Then** the page returns 404 / "Không tìm thấy" — the
     portal **must not** leak the other customer's data
     even via direct URL.
4. **CUST-SHIP-04 — Drill-down to detail**
   - **When** the user clicks a row
   - **Then** the page navigates to
     `/portal/shipments/:id`. The back button returns to
     `/portal/shipments` with the previous filter preserved.
5. **CUST-SHIP-05 — Empty state**
   - **Then** the empty state shows the Vietnamese copy
     (`Bạn chưa có lô hàng nào`) and an info banner pointing
     to the office contact.

### Test steps

1. Log in as `CUSTOMER-SAMSUNG`. Land on
   `/portal/shipments`.
2. Capture the list.
3. Apply a status filter; capture.
4. Click a row; capture the detail.
5. Open another tab; navigate to a shipment ID belonging to
   `CUSTOMER-CANON`; capture the 404.

### Regression hooks

- Backend: the shipments list endpoint must apply the
  `scopedByCustomer` filter for the CUSTOMER role (the
  casbin policy `p, CUSTOMER, shipments, read` with the
  row-scope object). A backend test must verify that
  CUSTOMER cannot read a shipment whose `customerId`
  differs from the user's.
- Frontend: dev-tools network tab shows the list call
  returns only the customer's own rows.

---

## Flow 2 — Chi tiết lô hàng (Shipment detail)

**Route**: `/portal/shipments/:id`
**Component**: `frontend/src/pages/portal/PortalShipmentDetailPage.tsx`
**Allow**: `CUSTOMER` only.

### Acceptance criteria

1. **CUST-DET-01 — Page anatomy**
   - **Then** sections: `Tổng quan` (mã lô hàng, ngày tạo,
     tuyến, trạng thái), `Container & Seal` (số container,
     số seal — only the count, not driver-only fields), `Chứng
     từ` (the documents the office uploaded), `Thanh toán`
     (linked debit notes + running balance).
2. **CUST-DET-02 — No driver / cost / audit data**
   - **Then** the page does **not** show: `Biển số`, `Tài xế`,
     `Chi phí`, `Lợi nhuận`, `Audit`. The customer-facing
     surface is intentionally thin.
3. **CUST-DET-03 — Read-only**
   - **Then** no edit, no upload, no confirm-action. The
     portal is read-only in Wave 2.
4. **CUST-DET-04 — Linked debit notes**
   - **Given** the shipment has 1+ debit notes
   - **Then** each note is a teaser card with: `Mã giấy báo
     nợ`, `Ngày phát hành`, `Số tiền`, `Trạng thái`
     (`Chưa thanh toán` / `Đã thanh toán một phần` / `Đã
     thanh toán`), and a link to
     `/portal/debit-notes` (or the note's detail if it ships
     in Wave 2).

### Test steps

1. From `/portal/shipments`, click any row.
2. Capture the detail. Walk the sections.
3. Confirm the absence of driver / cost / audit fields (dev-
   tools search for `Biển số` / `Tài xế` / `Lợi nhuận` —
   must return 0 matches in the customer-facing DOM).

### Regression hooks

- DOM-grep for forbidden fields: `Biển số`, `Tài xế`,
  `Chi phí`, `Lợi nhuận`, `Audit` — 0 matches expected in
  the customer detail.

---

## Flow 3 — Giấy báo nợ (Debit notes)

**Route**: `/portal/debit-notes`
**Component**: `frontend/src/pages/portal/PortalDebitNotesPage.tsx`
**Allow**: `CUSTOMER` only.

### Acceptance criteria

1. **CUST-DBN-01 — Read-only list of own debit notes**
   - **Then** columns: `Mã giấy báo nợ`, `Ngày phát hành`,
     `Kỳ`, `Số tiền`, `Đã thanh toán`, `Còn lại`,
     `Trạng thái`. Default sort: `Ngày phát hành` desc.
2. **CUST-DBN-02 — Filter & search**
   - **Then** the user can filter by `Trạng thái`, by `Kỳ`
     (month), and search by `Mã giấy báo nợ` / `Mã lô hàng`.
3. **CUST-DBN-03 — Drill-down to a PDF view**
   - **When** the user clicks a row
   - **Then** a PDF preview of the debit note is shown in a
     modal. The PDF is generated server-side from the
     template at `/config/debit-note-templates`. The
     preview offers a `Tải xuống` button.
4. **CUST-DBN-04 — Pay-online CTA (Wave 2)**
   - **Then** each `Chưa thanh toán` row shows a `Thanh toán`
     button. In Wave 2, the CTA is disabled with a tooltip
     (`Sắp ra mắt`); in Wave 3 it links to a payment
     integration (per `payment-integration` skill).
5. **CUST-DBN-05 — Currency formatting**
   - **Then** every monetary value uses VND with no
     decimals: `Intl.NumberFormat('vi-VN', { style:
     'currency', currency: 'VND', maximumFractionDigits: 0 })`.

### Test steps

1. Log in as `CUSTOMER-SAMSUNG`. Open `/portal/debit-notes`.
2. Capture the list. Apply a status filter.
3. Click a row; capture the PDF preview.
4. Confirm the `Thanh toán` button is disabled (Wave 2).

### Regression hooks

- Backend: the debit-notes list endpoint must apply the
  `scopedByCustomer` filter.

---

## Flow 4 — Sao kê công nợ (Statement of account)

**Route**: `/portal/statement`
**Component**: `frontend/src/pages/portal/PortalStatementPage.tsx`
**Allow**: `CUSTOMER` only.

### Acceptance criteria

1. **CUST-STMT-01 — Read-only running balance**
   - **Then** the page shows a chronological statement of
     the customer's account, with one row per debit note,
     one row per payment received, and a running balance
     column. The opening balance is the balance at the
     start of the selected period.
2. **CUST-STMT-02 — Period switcher**
   - **Then** the user can pick a period (`Tháng này`,
     `Quý này`, `Năm nay`, `Tùy chỉnh`). The data re-fetches
     within 1.5 s.
3. **CUST-STMT-03 — Export**
   - **Then** the user can export the current statement to
     CSV / XLSX via the toolbar. The file contains the
     same rows shown in the table.
4. **CUST-STMT-04 — Read-only**
   - **Then** no edit, no dispute-filing action. The
     statement is informational.

### Test steps

1. Log in as `CUSTOMER-SAMSUNG`. Open `/portal/statement`.
2. Capture the default period.
3. Switch to a different period; capture.
4. Click `Export` and capture the file.

---

## Flow 5 — Escape hatches (must not exist)

The customer portal must not provide any path into the office
workspace. If a customer finds a way in, that's a security bug.

### Acceptance criteria

1. **CUST-PORTAL-01 — Direct navigation to office route is
   blocked**
   - **Given** a customer
   - **When** the user navigates directly to `/dashboard`,
     `/shipments`, `/dispatch`, `/accounting`, `/audit-logs`,
     `/users`, `/config/*`, `/my-trips`, `/my-orders`, etc.
   - **Then** the user is bounced to `/portal/shipments`
     (AUTH-03 in §5 of the README). The route is rendered
     only inside the customer shell, which is not reachable
     from the office shell.
2. **CUST-PORTAL-02 — No internal sidebar/topbar**
   - **Then** the rendered DOM in the customer shell
     contains the customer-portal topbar only. Dev-tools
     search for `Sidebar` / `Office` (the className prefix
     used by the office sidebar) returns 0 matches in the
     customer shell's DOM.
3. **CUST-PORTAL-03 — Logout is the only exit**
   - **Then** the topbar shows the customer's name and a
     `Đăng xuất` button. There is no `Chuyển sang nội bộ`
     or "back to admin" link.
4. **CUST-PORTAL-04 — API calls return 403/404 for foreign
   data**
   - **Given** a customer
   - **When** any office-only API is called with the
     customer's token (e.g. `GET /api/trips/:id`)
   - **Then** the API returns 403 or 404 — the customer's
     token must not be able to read office data even if the
     UI is bypassed.
5. **CUST-PORTAL-05 — Session timeout is shorter than the
   office session**
   - **Then** an idle customer session expires after 30
     minutes (vs. 8 hours for office users). The portal
     shows a "Phiên sắp hết" prompt 5 minutes before
     expiry, with a "Gia hạn" button.

### Test steps

1. Log in as `CUSTOMER-SAMSUNG`. Open dev-tools.
2. From the address bar, type `/dashboard` and hit Enter.
   Confirm redirect to `/portal/shipments`.
3. Open a second tab. Paste the URL of any office page
   (`/shipments`, `/dispatch`, etc.). Confirm redirect.
4. With dev-tools, send a `GET /api/trips` call using the
   customer's token. Confirm 403.
5. Inspect the rendered DOM for the office sidebar
   (`document.querySelector('[class*="Sidebar"]')`); confirm
   0 matches in the customer shell.

### Regression hooks

- Backend authz test suite must cover the CUSTOMER role's
  denials for every office-only resource.
- A frontend test that mounts the customer shell and
  asserts no office nav items are reachable.

---

## Negative / RBAC table (CUSTOMER)

| Action                                  | CUSTOMER | ADMIN | MANAGER | DISPATCHER | OPS | CUS | ACCOUNTANT | DRIVER |
|-----------------------------------------|----------|-------|---------|------------|-----|-----|------------|--------|
| Read own shipments (row-scoped)         | ✅       | ✅    | ✅      | ✅         | ❌  | ✅  | ✅         | ❌     |
| Read another customer's shipments       | ❌       | ✅    | ✅      | ✅         | ❌  | ✅  | ✅         | ❌     |
| Read own debit notes                    | ✅       | ✅    | ✅      | ❌         | ❌  | ❌  | ✅         | ❌     |
| Read own statement                      | ✅       | ✅    | ✅      | ❌         | ❌  | ❌  | ✅         | ❌     |
| Read `/shipments` (office list)         | ❌       | ✅    | ✅      | ✅         | ❌  | ✅  | ✅         | ❌     |
| Read `/dispatch` `/accounting`          | ❌       | ✅    | ✅      | partial    | ❌  | ❌  | ✅         | ❌     |
| Read `/audit-logs` `/config/*`          | ❌       | ✅    | partial | ❌         | ❌  | ❌  | partial    | ❌     |
| Read `/my-*` (driver / OPS portals)     | ❌       | ❌    | ❌      | ❌         | ❌  | ❌  | ❌         | ❌     |
| Mutate any office data                  | ❌       | ✅    | partial | partial    | ❌  | partial | partial | partial|

`partial` = the role can mutate only the resources it owns
(e.g. CUS can mutate shipments but not finance; DISPATCHER
can publish plans but not edit master data).

## Out of scope (CUSTOMER)

- Any office workspace route.
- Any mutation in this iteration (Wave 2 is read-only).
- Driver / OPS portals.
- Audit log / master data / config.

## Known open items (carry-over)

- **Pay-online CTA (CUST-DBN-04)**: the `Thanh toán` button
  is disabled in Wave 2 with a `Sắp ra mắt` tooltip. Wave 3
  will wire a payment integration (per
  `payment-integration` skill). The AC explicitly allows the
  disabled state for Wave 2.
- **Customer-portal layout audit**: `CustomerPortalLayout`
  is a separate React component (`App.tsx:10`) and must
  not import or render the office `Layout`. A lint rule or
  an `arch-layering` test could enforce this; not in place
  yet.
