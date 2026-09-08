# Role: OPS — Nhân viên vận hành

> **Vietnamese label**: Nhân viên vận hành (`Role.OPS`, formerly
> `FORWARDER`, renamed 2024-08).
> **Home route**: `/my-orders` (`routes.myOrders`).
> **Primary sidebar section**: `Công việc của tôi` (`my-work`).
> **Test accounts**: chọn theo môi trường qua `../testaccounts.txt` (role → username). Runner tự map `OPS` + env → username phù hợp. Lưu ý: `OPS` (`OPS`) chỉ tồn tại trên local qua `make seed`; trên staging mapping sang prod-mirror users cùng role.
> **Primary pages**:
> - `/my-orders` — `frontend/src/pages/ForwarderTripsPage.tsx` (Lệnh giao nhận)
> - `/my-forwarder-trips/:id` — `frontend/src/pages/ForwarderTripDetailPage.tsx`
> - `/my-advances` — `frontend/src/pages/ForwarderAdvancesPage.tsx` (Yêu cầu Tạm ứng)
> - `/my-settlements` — `frontend/src/pages/ForwarderSettlementsPage.tsx` (Phiếu thanh toán / Hoàn ứng)
> - `/my-settlements/new` — `frontend/src/pages/ForwarderSettlementCreatePage.tsx`
> - `/my-settlements/:id` — `frontend/src/pages/SettlementPrintPage.tsx` (print view)
>
> The OPS portal is field-staff-facing but **not** the driver app:
> the OPS works on behalf of the company, not from a truck cab. The
> mobile story is responsive web, not a PWA.
>
> Cross-cutting rules live in [`README.md`](README.md) §5.

---

## Scope boundary

OPS is the **giao nhận / field-ops** role. The OPS:

- Reads the trips assigned to them (`Lệnh giao nhận`).
- Submits **advance requests** (`Yêu cầu Tạm ứng`) to the office
  for cash to cover trip expenses.
- Submits **settlements** (`Phiếu thanh toán / Hoàn ứng`) after
  the trip is done, attaching receipts.
- Reads but does not write: trip ledger, customer ledger, master
  data, dispatch plans.
- **Cannot** dispatch (no `/dispatch`, `/dispatch-detail`).
- **Cannot** post to the ledger.

If the OPS is dropped into a forbidden route, AUTH-03 in §5 of the
README applies (silent redirect to `/my-orders`).

The OPS portal reuses the driver's mobile UX primitives in some
places (responsive cards, bottom CTAs), but it is a **separate
code path** — there is no PWA install prompt for OPS.

---

## Flow 1 — Lệnh giao nhận (Forwarder trip list)

**Route**: `/my-orders`
**Component**: `frontend/src/pages/ForwarderTripsPage.tsx`
**Allow**: `OPS` only (`opsOnly` per `App.tsx:356`).
**Pre-conditions**: at least 1 trip is in `Đang chạy` and is
linked to the OPS.

### Acceptance criteria

1. **OPS-LST-01 — Tabs & filters**
   - **Then** the page has tabs `Hôm nay`, `Đang chạy`,
     `Lịch sử` (matching the driver UX, but with a different
     label set). Each tab's count is shown.
2. **OPS-LST-02 — Card anatomy**
   - **Then** a trip card shows: `Mã chuyến`, `Khách hàng`,
     `Tuyến`, `Tài xế`, `Biển số`, `Trạng thái`. (No plate
     subtext quirk — the OPS card uses the office style.)
3. **OPS-LST-03 — Search & filter**
   - **Then** the user can search by customer / trip ID and
     filter by status. URL reflects the state.
4. **OPS-LST-04 — Empty state**
   - **Then** the empty state shows the Vietnamese copy
     (`Bạn chưa có lệnh giao nhận nào`) and a refresh control.

### Test steps

1. Log in as `OPS`. Land on `/my-orders`.
2. Walk the tabs; capture.
3. Apply a search; capture.

---

## Flow 2 — Chi tiết lệnh giao nhận (Forwarder trip detail)

**Route**: `/my-forwarder-trips/:id`
**Component**: `frontend/src/pages/ForwarderTripDetailPage.tsx`
**Allow**: `OPS` only (`opsOnly` per `App.tsx:358`).

### Acceptance criteria

1. **OPS-DET-01 — Page anatomy**
   - **Then** sections: `Tổng quan` (customer, route, plate,
     driver, container/seal), `Chứng từ` (the receipts and POD
     the driver uploaded), `Tạm ứng` (linked advance), `Hoàn
     ứng` (linked settlement).
2. **OPS-DET-02 — Read-only trip core**
   - **Then** the OPS cannot edit the trip itself. The page is
     informational; mutations happen via the advance /
     settlement pages.
3. **OPS-DET-03 — Linked advance & settlement teasers**
   - **Then** each teaser is a card with status and a "Xem chi
     tiết" link to `/my-advances` / `/my-settlements/:id`.
4. **OPS-DET-04 — Customer & container context**
   - **Then** the page surfaces the container numbers, seal
     numbers, factory, port — the same data the CUS sees on
     `/shipments/:id`. This is the OPS's primary reference for
     pickup / drop-off.

### Test steps

1. Log in as `OPS`. From `/my-orders`, click a trip.
2. Capture the detail. Drill into the advance teaser.
3. Return and drill into the settlement teaser.

---

## Flow 3 — Yêu cầu Tạm ứng (Advance requests)

**Route**: `/my-advances`
**Component**: `frontend/src/pages/ForwarderAdvancesPage.tsx`
**Allow**: `OPS` only.

### Acceptance criteria

1. **OPS-ADV-01 — List & status**
   - **Then** the page lists every advance the OPS has
     submitted, with: `Mã phiếu`, `Số tiền`, `Mục đích`,
     `Ngày tạo`, `Trạng thái` (`Chờ duyệt` / `Đã duyệt` /
     `Đã hoàn ứng` / `Đã hủy`).
2. **OPS-ADV-02 — Create a new request**
   - **When** the user clicks `Yêu cầu tạm ứng`
   - **Then** a dialog opens: `Số tiền`, `Mục đích` (free
     text, required), `Chuyến liên quan` (optional, dropdown
     of OPS's active trips), `Ngày cần tiền`. On submit, a
     new row in `Chờ duyệt` appears; the office is notified.
3. **OPS-ADV-03 — Cancel a pending request**
   - **When** the OPS clicks `Hủy` on a row in `Chờ duyệt`
   - **Then** the status flips to `Đã hủy`; an audit row is
     written. After approval, the OPS can no longer cancel
     (must go through the settlement flow).
4. **OPS-ADV-04 — Read-only after approval**
   - **Then** a `Đã duyệt` advance is read-only. The OPS
     can no longer edit or cancel; they can only view.

### Test steps

1. Log in as `OPS`. Open `/my-advances`.
2. Submit a new request. Capture.
3. Cancel the request. Capture the `Đã hủy` state.
4. As `ACCOUNTANT`/`MANAGER`, approve a different request.
   Switch back to `OPS`; confirm the row is read-only.

---

## Flow 4 — Phiếu thanh toán / Hoàn ứng (Settlements)

**Routes**: `/my-settlements`, `/my-settlements/new`,
`/my-settlements/:id`
**Components**: `frontend/src/pages/ForwarderSettlementsPage.tsx`,
`frontend/src/pages/ForwarderSettlementCreatePage.tsx`,
`frontend/src/pages/SettlementPrintPage.tsx`
**Allow**: `OPS` only.

### Acceptance criteria

1. **OPS-STL-01 — List & status**
   - **Then** the page lists every settlement the OPS has
     submitted, with: `Mã phiếu`, `Tạm ứng gốc`, `Số tiền
     thực chi`, `Chênh lệch`, `Trạng thái` (`Chờ đối soát` /
     `Đã đối soát` / `Yêu cầu bổ sung` / `Đã hủy`).
2. **OPS-STL-02 — Create a settlement**
   - **Given** the OPS has an `Đã duyệt` advance
   - **When** the user clicks `Hoàn ứng`
   - **Then** the create page opens with the advance
     pre-selected. The user adds line items (one per
     expense): `Loại chi phí` (dropdown from
     `forwarder_expense_types`), `Số tiền`, `Hóa đơn`
     (file upload, ≤ 10 MB), `Mô tả`. The total of the
     line items must equal the `Số tiền thực chi`; a
     mismatch shows an inline error.
3. **OPS-STL-03 — Submit for review**
   - **When** the user clicks `Gửi đối soát`
   - **Then** the settlement status flips to
     `Chờ đối soát`; the accountant is notified.
4. **OPS-STL-04 — Add evidence when requested**
   - **Given** the accountant set the status to
     `Yêu cầu bổ sung` with a note
   - **When** the OPS uploads the missing receipt
   - **Then** the settlement re-enters `Chờ đối soát`; the
     note is shown in the activity log.
5. **OPS-STL-05 — Print view**
   - **When** the user opens `/my-settlements/:id`
   - **Then** the page is a print-friendly view (A4, no
     navigation chrome) showing the line items, totals,
     and the OPS's signature box. The print stylesheet
     hides every sidebar / nav element.

### Test steps

1. Log in as `OPS`. From `/my-advances`, pick an
   `Đã duyệt` advance and click `Hoàn ứng`.
2. Add 2 line items; upload 2 small PDFs; submit.
3. Capture the print view (`/my-settlements/:id`).
4. As `ACCOUNTANT`, request evidence. Switch back to
   `OPS`, upload the missing file. Capture.

---

## Flow 5 — Hành vi trên thiết bị di động (Mobile UX)

OPS is not a PWA, but the role is field-staff and the
common access pattern is a phone browser.

### Acceptance criteria

1. **OPS-MOB-01 — Responsive at 390 × 844**
   - **Then** the `/my-orders` list and the trip detail
     page render correctly at 390 × 844. Tap targets ≥ 48
     CSS pixels. No horizontal scroll.
2. **OPS-MOB-02 — File upload from camera**
   - **When** the OPS taps `Tải hóa đơn` on mobile
   - **Then** the file picker offers `Chụp ảnh` (camera)
     and `Chọn tệp` (file picker). On iOS Safari, the
     `accept="image/*"` attribute triggers the camera
     option.
3. **OPS-MOB-03 — Safe-area-inset**
   - **Then** any sticky CTA at the bottom respects
     `env(safe-area-inset-bottom)`. Verify on iPhone 14
     (home indicator present) and iPhone 8 (no indicator).

### Test steps

1. Open the OPS portal in iOS Safari (or a Chrome
   emulation at 390 × 844).
2. Walk the flows; capture.
3. Trigger a file upload from the camera; confirm.

---

## Flow 6 — Notifications (in-app)

### Acceptance criteria

1. **OPS-NOT-01 — Pending-action banner**
   - **Then** when the OPS has any `Chờ duyệt` advance or
     `Yêu cầu bổ sung` settlement, the topbar shows a
     small badge with the count.
2. **OPS-NOT-02 — Approve / reject events**
   - **When** the office approves or rejects one of the
     OPS's requests
   - **Then** the OPS sees a toast on next page load
     (or, if online, real-time via SSE) and the row's
     status updates.

### Test steps

1. As `OPS`, open `/my-advances`. Submit a request.
2. As `ACCOUNTANT`, approve. Switch back to `OPS`;
   confirm the toast and the row's new status.

---

## Negative / RBAC table (OPS)

| Action                                  | OPS | ADMIN | MANAGER | DISPATCHER | CUS | ACCOUNTANT | DRIVER | CUSTOMER |
|-----------------------------------------|-----|-------|---------|------------|-----|------------|--------|----------|
| Read `/my-orders`                       | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Read `/my-forwarder-trips/:id`          | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Submit advance request                  | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Cancel pending advance                  | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Submit settlement                       | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Read `/my-settlements/:id` (print)      | ✅  | view  | view    | view       | ❌  | view       | ❌     | ❌       |
| Read `/dispatch`                        | ❌  | ✅    | ✅      | ✅         | ❌  | ❌         | ❌     | ❌       |
| Read `/finance` `/accounting`           | ❌  | ✅    | ✅      | ❌         | ❌  | ✅         | ❌     | ❌       |
| Read `/shipments`                       | ❌  | ✅    | ✅      | ✅         | ✅  | ✅         | ❌     | scoped   |
| Read `/audit-logs`                      | ❌  | ✅    | ✅      | ❌         | ❌  | ✅         | ❌     | ❌       |
| Read `/customers` (list)                | ❌  | ✅    | ✅      | ❌         | ❌  | ✅ (read)  | ❌     | ❌       |

`view` = office staff can read the settlement print view at
`/settlements/:id` (the non-OPS route, gated by
`officeStaffOnly` per `App.tsx:363`).

## Out of scope (OPS)

- Office workspace (`/shipments`, `/dispatch`, `/finance`,
  `/config/*`).
- Customer / supplier management.
- Dispatching.
- Trip / customer ledger.

## Known open items (carry-over)

- **Legacy username `giaohan`** fails login (no `n`); only
  `OPS` works. This is documented in `testaccounts.txt`
  so QA doesn't waste cycles trying the typo.
- **PWA**: OPS is **not** a PWA. The driver app's offline
  story does not apply. Any future offline work for OPS
  should be a separate plan.
