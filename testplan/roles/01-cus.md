# Role: CUS — Nhân viên Chứng từ

> **Vietnamese label**: Nhân viên Chứng từ (`Role.CUS`, formerly CLERK, renamed 2024-08).
> **Home route**: `/shipments` (`routes.shipments`).
> **Primary sidebar section**: `Nghiệp vụ Chứng từ` (`document-ops`).
> **Test account (local)**: `cus` / `Abc123`. **(staging)**: `cus123` / `Abc123`.
> **Primary pages**:
> - `/shipments` — `frontend/src/pages/ShipmentsPage.tsx` (tổng quan lô hàng)
> - `/shipments-detail` — `frontend/src/pages/ShipmentsDetailPage.tsx` (chi tiết lô hàng)
> - `/shipments/new` — `frontend/src/pages/clerk/ClerkShipmentCreatePage.tsx`
> - `/shipments/:id` — `frontend/src/pages/ShipmentDetailPage.tsx`
> - `/recoverable-costs` — `frontend/src/pages/RecoverableCostsPage.tsx` (gated by `recoverable_costs.read` capability)
>
> Cross-cutting rules (auth, RBAC, audit, financial precision) live in
> [`README.md`](README.md) §5 and apply to every AC below.

---

## Scope boundary

CUS is the **document operations** role. CUS can:

- Read & write the **shipment (lô hàng) workspace**: create, edit, manage
  containers, attach declarations, view status.
- Read & write **customers** as a side-effect of the shipment flow (CUS
  may create a customer inline when creating a shipment, per
  `74a17b5c`).
- Read **recoverable costs** when the `recoverable_costs.read` capability
  is granted (typically the supervisor variant of CUS).

CUS **cannot**:

- Dispatch (no `/dispatch`, `/dispatch-detail`).
- Post to the ledger (no `/finance`, `/accounting`).
- View the master-data admin pages.

If a CUS user navigates to a forbidden route, AUTH-03 from §5 of the README
applies (silent redirect to `/shipments`).

---

## Flow 1 — Tạo lô hàng (Create shipment)

**Route**: `/shipments/new`
**Component**: `frontend/src/pages/clerk/ClerkShipmentCreatePage.tsx`
**Allow**: `ADMIN`, `MANAGER`, `CUS`, `DISPATCHER` (per `App.tsx:278` `shipmentCreatorOnly`)
**Pre-conditions**:
- At least one customer exists in the seed (`Công ty ABC`, `CP Vận tải Biển Bạc`).
- At least one route, one cargo type, one trailer type exist.

### Acceptance criteria

1. **CUS-SHIP-01 — Create form mounts and validates required fields**
   - **Given** a CUS user lands on `/shipments/new`
   - **When** the form is empty
   - **Then** the submit button is disabled until all required fields are
     valid; an inline message is shown for each missing field
     (Vietnamese: e.g. `Vui lòng chọn khách hàng`).
   - **Evidence**: screenshot of empty form, screenshot after typing
     only some fields.

2. **CUS-SHIP-02 — Customer field is a proper combobox (text + filter)**
   - **Given** the customer field is empty
   - **When** the user clicks it and types `BIÊN`
   - **Then** the dropdown shows exactly one row: `CP Vận tải Biển Bạc`
     (case-insensitive substring match). The typed text persists in the
     field after selection.
   - **Reference**: commit `6ef3b221` (`USearchableField` `searchable` prop).
   - **Evidence**: dev-tools screenshot of the dropdown open + the
     filtered result.

3. **CUS-SHIP-03 — Inline customer creation (`Thêm khách hàng`)**
   - **Given** the customer field is focused
   - **When** the user types a name that matches no existing customer and
     clicks the `Thêm khách hàng` button
   - **Then** a dialog opens. The user fills `Tên khách hàng` (required),
     optionally `Mã số thuế`, `Địa chỉ`, `SĐT`, `Email`, and submits.
   - On success: the dialog closes, a success toast appears, the new
     customer is selected in the field, and the dropdown re-opens with
     the new row present.
   - **RBAC**: CUS and DISPATCHER are allowed (casbin policy from
     `74a17b5c`); other roles are denied (see Negative / RBAC table).
   - **Reference**: `frontend/src/features/shipments/create/CustomerCreateDialog.tsx`.
   - **Evidence**: screenshot of dialog; re-open dropdown to show the
     newly created row; audit-log row `POST /customers` with actor =
     CUS.

4. **CUS-SHIP-04 — Required financial fields are hidden in the create dialog**
   - **Given** the customer-create dialog is open
   - **When** the user inspects the fields
   - **Then** the 7 financial fields (`creditLimit`, `paymentTerms`,
     `taxCode`, `billingAddress`, `billingEmail`, `bankAccount`,
     `bankName`) are not present in the dialog UI; they are stripped by
     the `customer-intake.service` so CUS cannot accidentally set
     financial state.
   - **Evidence**: dialog screenshot; backend payload diff showing the
     7 keys are absent.

5. **CUS-SHIP-05 — Successful create navigates to detail**
   - **Given** a fully valid form
   - **When** the user clicks the primary save button
   - **Then** the user is redirected to `/shipments/:id` (the new
     shipment's detail page) within 1.5 s. The shipment appears at the
     top of `/shipments` with status `Mới tạo`.
   - **Evidence**: network tab; final URL; toast text.

6. **CUS-SHIP-06 — Maker-checker is bypassed for CUS / DISPATCHER**
   - **Given** a CUS user is creating a customer inline (Flow 1.3 above)
   - **When** the form is submitted
   - **Then** the customer is created immediately — no "pending approval"
     queue, no second-actor gate. (The maker-checker path is reserved
     for ADMIN/MANAGER; the `shouldGovernCreate` predicate returns
     `false` for CUS/DISPATCHER per `6ef3b221`.)
   - **Evidence**: timing of creation vs. UI; backend logs.

7. **CUS-SHIP-07 — Field-level validation matches the contract**
   - Required: `customerId`, `routeId`, `cargoTypeId`, `weightKg`,
     `loadingType` (`HANG` or `VO`).
   - Optional but validated when present: `containerNumbers` (regex
     `^[A-Z]{4}\d{7}$`), `sealNumbers`, `factoryId`, `portId`,
     `scheduledPickupAt`, `scheduledDeliveryAt`.
   - **Then** invalid values surface a Vietnamese error inline; the
     submit button stays disabled.
   - **Evidence**: try each invalid value, screenshot the error.

8. **CUS-SHIP-08 — No PII / secrets leak in client bundle**
   - **Given** the source bundle of the create page
   - **When** a regex sweep is run for `password`, `secret`, `token`,
     `apiKey`
   - **Then** no matches are found in any user-visible string (only
     internal `useAuth` references are allowed).

9. **CUS-SHIP-09 — Factory selection auto-fills and locks route + location**
   - **Given** the ad-hoc flag (`CUS-SHIP-10`) is **off**
   - **When** the user picks a customer, then a factory that has a route
     configured
   - **Then** `Tuyến đường` and `Vị trí đóng/trả hàng` are filled from the
     factory record and rendered **read-only**; the factory dropdown lists
     **only** that customer's factories; changing customer resets the
     factory choice.
   - **Spec**: `docs/prd/MasterDataNhaMay.md` §3.
   - **Cases**: `TC-CUS-CREATE-021` … `-024`.
   - **Evidence**: screenshot of the two locked fields after selection.

10. **CUS-SHIP-10 — Ad-hoc order flag (`Lệnh chạy ngoài`)**
    - **Given** a CUS user on `/shipments/new`
    - **When** they inspect the top of the form without scrolling
    - **Then** a checkbox labelled exactly
      `Lệnh chạy ngoài (Tối ưu xe rỗng)` is present and **unchecked by
      default**, on both desktop and mobile (tap target ≥ 44 px).
    - **When** it is checked
    - **Then** `Tuyến đường` and `Vị trí đóng/trả hàng` **unlock** for manual
      entry, and cước-phí quota validation is bypassed so the shipment can
      be saved and handed to Điều vận immediately.
    - **When** it is unchecked again while free text is present
    - **Then** the user is warned (Vietnamese) that those fields must be
      re-picked from the catalogue — typed data is **not** silently wiped.
    - The flag persists on the shipment (`is_ad_hoc`) and is still checked
      when the shipment is reopened for editing.
    - **Spec**: `docs/prd/MasterDataNhaMay.md` §4.1.
    - **Cases**: `TC-CUS-CREATE-026`, `-027`, `-028`, `-036`.
    - **Evidence**: screenshots of the flag off → on → off sequence.

11. **CUS-SHIP-11 — Ad-hoc bypass is scoped to cước phí only**
    - **Given** the ad-hoc flag is **on**
    - **When** the user submits with an ISO-6346-invalid container number,
      an invalid/inverted date pair, a quantity ≤ 0, or an empty required
      field
    - **Then** **every one** of those is still rejected with a specific
      Vietnamese error. The flag never relaxes data-safety validation.
    - **Cases**: `TC-CUS-CREATE-029`.
    - **Evidence**: 4 error screenshots.

12. **CUS-SHIP-12 — Free text stores `Raw_*` with a null ID, and never
    touches master data**
    - **Given** the ad-hoc flag is on
    - **When** the user types a string matching no catalogue row into
      `Khách hàng`, `Nhà máy`, `Tuyến đường`, `Cảng nâng`, or `Cảng hạ`
      and saves
    - **Then** the typed string survives blur, the shipment stores
      `Raw_<field>_Name` with the corresponding `*_ID = null`, and
      `count(*)` of `customers`, `operational_sites`, `routes`, and `ports`
      is **unchanged**.
    - ID and free text are **mutually exclusive per field**, and a single
      shipment may mix both modes across different fields.
    - **Spec**: `docs/prd/MasterDataNhaMay.md` §2.1.
    - **Cases**: `TC-CUS-CREATE-030`, `-031`, `-032`.
    - **Evidence**: before/after `count(*)` queries + the shipment row.

13. **CUS-SHIP-13 — Free text vs. inline create are distinct mechanisms**
    - **Given** the ad-hoc flag is on
    - **When** the user clicks `+ Tạo mới` instead of typing free text
    - **Then** the button is still available, a real master-data row **is**
      created, it is auto-selected, it appears in later dropdowns, and the
      shipment stores the **ID** (not `Raw_*`).
    - Typing free text must never create a row; `+ Tạo mới` must always
      create one. The flag changes neither behaviour.
    - **Cases**: `TC-CUS-CREATE-034` (contrast with `-031`).
    - **Evidence**: `count(*)` +1 vs. `count(*)` unchanged, side by side.

14. **CUS-SHIP-14 — Combobox behaviour on all five master-data fields**
    - **Given** `Khách hàng`, `Nhà máy`, `Tuyến đường`, `Cảng nâng`,
      `Cảng hạ`
    - **Then** each one: opens a catalogue list on the arrow; filters by
      substring **ignoring case and Vietnamese diacritics** (`hai phong`
      matches `Hải Phòng`); supports `↑`/`↓` + `Enter`; and on `Esc` or
      outside-click **closes the list while keeping the typed text**.
    - A free-text value must be visually distinguishable from a
      catalogue-selected value.
    - **Cases**: `TC-CUS-CREATE-033`.
    - **Evidence**: per-field screenshots of filter + retained text.

15. **CUS-SHIP-15 — Ad-hoc shipments render fully downstream**
    - **Given** a saved ad-hoc shipment
    - **Then** the shipment list, shipment detail, dispatcher board, and the
      driver app all show the typed names — **no empty cells, no `null`, no
      `undefined`**; the list/detail carry a `Chạy ngoài` marker rendered as
      **coloured text, not a badge**; and dispatch is not blocked by the
      missing `Factory_ID`.
    - Accounting: an ad-hoc shipment is **not** folded into any catalogue
      customer's receivables; reports group it under its own `Chạy ngoài`
      bucket rather than a `null` group.
    - **Cases**: `TC-CUS-CREATE-035`, `-037`.
    - **Evidence**: screenshots across the three roles + report grouping.

### Test steps (manual)

1. `pnpm dev` is up; `pgrep -f vite` confirms.
2. Open `http://localhost:7174`; log in as `cus` / `Abc123`.
3. Land on `/shipments`. Click `+ Tạo lô hàng` (or navigate to
   `/shipments/new`).
4. Exercise AC 1–7 in order.
5. For AC 2: type `BIÊN`; confirm one row.
6. For AC 3: type a unique name like `E2E TEST <unix-ms>`, click
   `Thêm khách hàng`, fill the dialog with just the name, submit, then
   re-open the dropdown and confirm the new row is present.
7. For AC 7: try `containerNumbers = "BAD"` and confirm the regex error.
8. Capture all screenshots into
   `qa/<date>_cus_create-shipment/`.

### Regression hooks

- `pnpm test` from repo root (incl.
  `frontend/src/pages/clerk/ClerkShipmentCreatePage.test.tsx`).
- Backend authz test for `POST /customers` (CUS, DISPATCHER allow;
  DRIVER, OPS, CUSTOMER deny).
- `qa/<date>_cus_create-shipment_lint.log`,
  `qa/<date>_cus_create-shipment_backend-test.log`,
  `qa/<date>_cus_create-shipment_frontend-test.log`.

---

## Flow 2 — Xem danh sách lô hàng (Shipment list / overview)

**Route**: `/shipments`
**Component**: `frontend/src/pages/ShipmentsPage.tsx`
**Allow**: any role with shipment-read casbin policy (ADMIN, MANAGER,
DISPATCHER, CUS, ACCOUNTANT, CUSTOMER scoped).

### Acceptance criteria

1. **CUS-LIST-01 — List renders the columns expected by CUS**
   - **Given** a CUS user on `/shipments`
   - **When** the page mounts
   - **Then** the visible columns are: `Mã lô hàng`, `Khách hàng`,
     `Tuyến`, `Trạng thái`, `Cập nhật`. The CUS does **not** see
     financial columns like `Doanh thu` or `Lợi nhuận`.
   - **Evidence**: full-page screenshot at 1440px.

2. **CUS-LIST-02 — Filter / search bar works**
   - **Given** at least 5 shipments in the seed
   - **When** the user types a customer name fragment in the search
     input
   - **Then** the list filters in < 300 ms; the URL query string
     reflects the filter so the state is shareable / reload-safe.

3. **CUS-LIST-03 — Status filter chips**
   - **Given** the chip row at the top
   - **When** the user clicks `Mới tạo` / `Đang chạy` / `Hoàn thành` /
     `Đã hủy`
   - **Then** the list filters; multi-select is allowed; an "all" chip
     resets the filter.
   - **Reference**: `TRIP_STATUS_LABELS` in
     `shared/src/constants/index.ts:403`.

4. **CUS-LIST-04 — Shipment stays "Đang chạy" until the driver full-closes (skip kế toán, fix 2026-08-29)**
   - **Given** a trip is in `Đang chạy` and the kế toán review flow is
     intentionally offline (`skip kế toán for now, we build later`)
   - **When** the driver submits the e-POD (status `SUBMITTED`) on
     `/my-trips/:id/pod` — Ops/Forwarder has **not** marked the
     expense scopes complete yet, and kế toán is not in the loop
   - **Then** the CUS-side shipment status recompute does **not** advance
     past `Đang chạy` while expense scopes are incomplete (the retired
     `Chờ duyệt phí` intermediate no longer exists; the lot stays
     `Đang chạy` until it closes directly).
   - **Then** the CUS list keeps showing the shipment as `Đang chạy`.
   - **When** the driver then hits `HOÀN THÀNH CHUYẾN`
   - **Then** the CUS list recomputes the shipment to `Hoàn thành`
     (COMPLETED) via the driver full-close path.
   - **Reference**: [`04-laixe-tien-do-epod.md` TC-LX-TIENDO-017](../flows/04-laixe-tien-do-epod.md#tc-lx-tiendo-017---sau-khi-nộp-e-pod-lô-hàng-vẫn-ở-đang-chạy-skip-kế-toán-chờ-hoàn-thành-chuyến-mới-chuyển).

4. **CUS-LIST-04 — Row click navigates to detail**
   - **Given** a row
   - **When** the user clicks it
   - **Then** the browser navigates to `/shipments/:id`; back-button
     returns to `/shipments` with the previous filter preserved.

5. **CUS-LIST-05 — Empty / loading / error states are explicit**
   - **Given** the page is in each of the three states
   - **When** it mounts
   - **Then** an empty-state illustration + copy appears for "no data",
     the `<PageLoader />` for loading, and a Vietnamese error banner
     (with a "Thử lại" retry button) for fetch failure. No raw
     exception text in the UI.

### Test steps

1. Log in as `cus`. Land on `/shipments`.
2. Capture a baseline screenshot.
3. Apply a filter and capture the result.
4. Click a row and capture the detail page.
5. Reload the filtered URL and confirm filter survives.

### Regression hooks

- `qa/<date>_cus_shipment-list_*.png`.
- The underlying query uses
  `frontend/src/api/*` + casbin; backend test
  `shipments.read` for `CUS` role must stay green.

---

## Flow 3 — Xem chi tiết lô hàng (Shipment detail)

**Route**: `/shipments/:id`
**Component**: `frontend/src/pages/ShipmentDetailPage.tsx`
**Allow**: shipment-read casbin.

### Acceptance criteria

1. **CUS-DET-01 — Header shows identification + status**
   - **Given** a shipment ID
   - **When** the page loads
   - **Then** the header shows: `Mã lô hàng`, `Khách hàng`, `Tuyến`,
     `Trạng thái` (with the canonical color from
     `TRIP_STATUS_COLORS`), `Ngày tạo`, `Người tạo`.

2. **CUS-DET-02 — Containers / seals section is editable for CUS**
   - **Given** a CUS user
   - **When** the user edits `containerNumbers` / `sealNumbers` inline
   - **Then** the change persists on blur, an audit-log row is written,
     and the list re-renders the new value.

3. **CUS-DET-03 — Tabs / sections visible to CUS**
   - **Then** the CUS sees: `Tổng quan`, `Container & Seal`, `Chứng từ`,
     `Lịch sử`. The CUS does **not** see: `Tài chính`, `Phê duyệt`.

4. **CUS-DET-04 — Linked trip teaser**
   - **Given** the shipment has one or more linked trips
   - **When** the user scrolls to the trip section
   - **Then** each trip shows `Mã chuyến`, `Biển số`, `Tài xế`,
     `Trạng thái` with a link to the trip detail. CUS is read-only
     here (no `Sửa` button on the trip row).

### Test steps

1. From `/shipments`, click any row.
2. Walk through each tab.
3. Edit a container number; capture before/after.
4. Verify the audit log row in `/audit-logs` (login as `admin` if
   needed; or trust the toast message).

### Regression hooks

- The shipment detail tests in
  `frontend/src/pages/ShipmentDetailPage*.test.tsx`.
- Backend `shipments.read` for CUS.

---

## Flow 4 — Đối soát chi phí (Recoverable costs) — capability-gated

**Route**: `/recoverable-costs`
**Component**: `frontend/src/pages/RecoverableCostsPage.tsx` /
`features/recoverable-costs/RecoverableCostsWorkspace.tsx`
**Allow**: `ADMIN`, `MANAGER`, `ACCOUNTANT`, **CUS with `recoverable_costs.read` capability**.

### Acceptance criteria

1. **CUS-RECON-01 — Capability gating**
   - **Given** a CUS user without the `recoverable_costs.read` capability
   - **When** they navigate to `/recoverable-costs` directly
   - **Then** they are bounced to `/shipments` (home). The sidebar item
     is also hidden.
   - **Evidence**: network tab; sidebar screenshot.

2. **CUS-RECON-02 — CUS with the capability can read & flag rows**
   - **Given** a CUS user with the capability
   - **When** they open the page
   - **Then** they can view the list, filter by status, and flag a row
     as "needs review" but cannot change the underlying amount.
   - **Evidence**: flag action screenshot; backend log.

3. **CUS-RECON-03 — State transitions are server-authoritative**
   - **Then** a row's `needsReview` flag can only be flipped through the
     dedicated endpoint; the UI does not PATCH the row directly.

### Test steps

1. Log in as `cus` (without capability) → confirm redirect.
2. Grant the capability to `cus` in the DB (or use a test seed) →
   reload; confirm the sidebar item appears.
3. Open `/recoverable-costs` and walk through the list.
4. Capture before/after of a flagged row.

### Regression hooks

- `frontend/src/pages/RecoverableCostsPage.test.tsx`.
- The capability lookup test in
  `frontend/src/components/Layout.test.ts` (item hidden by default).

---

## Flow 5 — Nghiệp vụ chứng từ (Document operations) — cross-flow

Document operations (declarations, attachments, etc.) span across the
shipment detail tabs. The CUS owns:

- Uploading `Chứng từ` files (PDF, JPG, PNG) up to 10 MB each.
- Linking a declaration number to a container.
- Marking a shipment's documents as "Đã đủ" (sufficient).

### Acceptance criteria

1. **CUS-DOC-01 — File upload works**
   - **Given** an attached test file (PDF, 1 MB)
   - **When** the user drops it on the upload zone or picks it via the
     file input
   - **Then** the file uploads in chunks (if > 5 MB) or a single POST,
     progress bar shows, on success the file appears in the list with
     a thumbnail / icon, file name, uploader, timestamp.
   - **Evidence**: network tab; uploaded file's URL is reachable.

2. **CUS-DOC-02 — Oversize / wrong-type rejection**
   - **Then** files > 10 MB or with MIME not in
     `pdf|jpeg|png|webp|heic` are rejected with a Vietnamese toast
     (e.g. `Tệp vượt quá 10 MB` / `Định dạng không hỗ trợ`).

3. **CUS-DOC-03 — "Đã đủ" toggle is one-way and audited**
   - **When** the user flips the documents toggle to `Đã đủ`
   - **Then** the toggle is disabled afterwards; an audit-log row is
     written; the shipment status recomputes to `Sẵn sàng điều xe` if
     dispatch prerequisites are otherwise satisfied.

### Test steps

1. From a shipment detail page, open the `Chứng từ` tab.
2. Upload a sample PDF.
3. Try to upload a 12 MB file → confirm rejection.
4. Try to upload a `.exe` → confirm rejection.
5. Toggle `Đã đủ` and capture the audit row.

### Regression hooks

- Upload integration test in
  `backend/src/tests/integration/documents.test.ts` (or equivalent).
- The audit-log row is visible to ADMIN/MANAGER/ACCOUNTANT.

---

## Flow 6 — Customer management (read + inline create)

CUS does not get a dedicated `/customers` page in the sidebar (only ADMIN/
MANAGER/ACCOUNTANT do), but the **inline create** in Flow 1 is the primary
way CUS touches customers. CUS **cannot** edit or delete a customer; that
is the office staff's job.

### Acceptance criteria

1. **CUS-CUST-01 — `/customers` redirects to home**
   - **Given** a CUS user
   - **When** they navigate to `/customers`
   - **Then** they are redirected to `/shipments`. (The route is
     `officeStaffOnly` per `App.tsx:272`.)
   - **Evidence**: dev-tools URL bar.

2. **CUS-CUST-02 — Inline create is the only path**
   - **Then** the only way CUS can create a customer is the
     `Thêm khách hàng` button on the shipment-create form (Flow 1.3).
     No separate customer CRUD UI is exposed to CUS.

3. **CUS-CUST-03 — The creator is auto-linked to the customer**
   - **Given** a CUS user creates a customer inline
   - **When** the create succeeds
   - **Then** the `creatorUserId` is set to the CUS user, so the CUS
     can later see "their" customers via the scoped bootstrap (commit
     `8b4332fd`).
   - **Evidence**: backend row inspection; `/customers` filter by
     `createdBy` as `admin` returns the new row.

### Regression hooks

- Backend authz test: CUS cannot `PATCH /customers/:id`,
  `DELETE /customers/:id`, or `GET /customers` (list).
- CUS can `POST /customers` only via the intake endpoint that strips
  the 7 financial fields.

---

## Negative / RBAC table (CUS)

| Action                          | CUS | DISPATCHER | ADMIN | MANAGER | DRIVER | OPS | ACCOUNTANT | CUSTOMER |
|---------------------------------|-----|------------|-------|---------|--------|-----|------------|----------|
| Read `/shipments`               | ✅  | ✅         | ✅    | ✅      | ❌     | ❌  | ✅         | scoped   |
| Create `/shipments`             | ✅  | ✅         | ✅    | ✅      | ❌     | ❌  | ❌         | ❌       |
| Edit shipment containers/seals  | ✅  | ❌         | ✅    | ✅      | ❌     | ❌  | ❌         | ❌       |
| Toggle `Đã đủ` documents        | ✅  | ❌         | ✅    | ✅      | ❌     | ❌  | ❌         | ❌       |
| Inline-create customer          | ✅  | ✅         | ✅    | ✅      | ❌     | ❌  | ❌         | ❌       |
| Edit / delete customer          | ❌  | ❌         | ✅    | ✅      | ❌     | ❌  | ✅ (read)  | ❌       |
| Read `/dispatch`                | ❌  | ✅         | ✅    | ✅      | ❌     | ❌  | ❌         | ❌       |
| Read `/recoverable-costs`       | cap | cap        | ✅    | ✅      | ❌     | ❌  | ✅         | ❌       |
| Read `/finance` `/profit`       | ❌  | ❌         | ✅    | ✅      | ❌     | ❌  | ✅         | ❌       |
| Read `/audit-logs`              | ❌  | ❌         | ✅    | ✅      | ❌     | ❌  | ✅         | ❌       |

`cap` = requires the `recoverable_costs.read` capability.
"scoped" = customer can only see their own shipments (row-scope by
`customerId`).

## Out of scope (CUS)

- Anything ledger- or finance-facing (`/finance`, `/accounting`,
  `/treasury`, `/profit`, `/payables`, `/expenses`, `/advances`).
- Dispatch planning.
- Master-data admin (no `/config/*`).
- Penalty issuance (`/penalties`).
- Salary & HR (`/salary`).
- Driver or OPS portals.

## Known open items (carry-over from past rounds)

- **CUS sidebar copy**: "Nghiệp vụ Chứng từ" is the section name; the
  section is collapsed by default unless the user is on `/shipments`. The
  "open by default" rule lives in `PRIMARY_SECTION_BY_ROLE.CUS =
  'document-ops'` in `Layout.tsx:74`.
- **Customer create button**: in some desktop viewports, the sidebar
  overlay can occlude the inline "Thêm khách hàng" button when running
  Playwright with a mouse click. The button is reachable via direct
  `.click()` dispatch (verified in the r6 regression sweep). This is a
  test-rig quirk, not a real bug, but it is documented here so future
  E2E scripts know to use a forced click or to scroll the button into
  view first.
