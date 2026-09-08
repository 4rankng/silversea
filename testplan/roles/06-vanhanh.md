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
> - `/ops/orders` — `frontend/src/pages/ops/OpsOrdersPage.tsx` (Kế hoạch làm hàng — ghim + khai chi phí; PRD `OpsVanHanh.md` §3)
> - `/ops/fleet-tracking` — `frontend/src/pages/ops/OpsFleetTrackingPage.tsx` (theo dõi xe phụ trách — read-only; PRD §4)
> - `/ops/wallet` — `frontend/src/pages/ops/OpsWalletPage.tsx` (Ví tạm ứng & chi phí; PRD §5)
> - `/ops/wallet/settlements/:id/print` — `frontend/src/pages/ops/OpsSettlementPrintPage.tsx` (print view)
>
> The OPS portal is field-staff-facing but **not** the driver app:
> the OPS works on behalf of the company, not from a truck cab. The
> mobile story is responsive web, not a PWA.
>
> Cross-cutting rules live in [`README.md`](README.md) §5.

---

## Đặc tả Ops 2026-09-06 — 3 màn hình mới

Nguồn: `2026.9.6_Man_hinh_ops.docx` → PRD
[`docs/prd/OpsVanHanh.md`](../../docs/prd/OpsVanHanh.md).
Bộ test case đầy đủ: [`../flows/05-ops-quy-chi-phi.md`](../flows/05-ops-quy-chi-phi.md).

| Màn hình (spec) | Route spec | Route hiện tại | Trạng thái |
|-----------------|-----------|----------------|-----------|
| Kế hoạch làm hàng & lệnh phụ trách | `/ops/orders` | `/my-orders` | Bổ sung **Ghim** + **form khai báo chi phí** |
| Theo dõi phương tiện được giao | `/ops/fleet-tracking` | — | **Màn hình mới**, read-only |
| Quản lý quỹ tạm ứng & chi phí | `/ops/wallet` | `/my-advances` + `/my-settlements` | Gộp 1 màn + **dashboard 4 card** |

Flow 1–6 bên dưới mô tả **hiện trạng** (`/my-*`) và vẫn dùng để regression cho
đến khi migrate xong. Flow 7–9 mô tả **đặc tả mới**. Khi hai bên mâu thuẫn,
đặc tả mới thắng.

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

## Flow 7 — Kế hoạch làm hàng (/ops/orders)

**Route**: `/ops/orders`
**Component**: `frontend/src/pages/ops/OpsOrdersPage.tsx`
**Allow**: `OPS` only (`opsOnly`).
**PRD nguồn**: `docs/prd/OpsVanHanh.md` §3

### Acceptance criteria

1. **OPS-ORD-01 — Danh sách lô theo ngày**
   - **Then** the page lists ALL company shipments for the picked date (default today,
     axis `expectedDeliveryDate`), excluding `CANCELED`, regardless of assignee;
     search by code / customer / container.
2. **OPS-ORD-02 — Ghim lệnh (sổ tay cá nhân)**
   - **When** the OPS pins a row
   - **Then** the pin is per-user, saved immediately, the row sorts to the top
     (newest pin first, stable within group), and survives reload and date changes.
3. **OPS-ORD-03 — Khai báo chi phí context-first**
   - **When** the OPS clicks a lot row
   - **Then** the expense dialog opens with Mã lô + Số Bill readonly auto-filled
     (`blNumber` IMPORT / `bookingRef` EXPORT); container select from the lot's
     containers (+ "Phí chung lô" when >1); Loại phí grouped Có/Không hóa đơn;
     Số tiền positive integer VND; receipt photos optional at save time.
4. **OPS-ORD-04 — Lưu khoản chi**
   - **Then** the entry saves as PENDING with `paidBy = current OPS user` and appears
     in /ops/wallet history; the wallet balance drops optimistically in the same
     session.
5. **OPS-ORD-05 — Mobile 390×844**
   - **Then** table stays tabular, tap targets ≥ 44px, no horizontal scroll.
6. **OPS-ORD-06 — Ghim không rò sang Ops khác (P0)**
   - **Given** Ops A đã ghim lô X
   - **When** Ops B đăng nhập và mở `/ops/orders` cùng ngày
   - **Then** lô X **không** được ghim trên tài khoản B; thứ tự của B là thứ tự tự nhiên.
     Ghim là bookmark cá nhân theo `user_id`, không phải cờ global trên lô.
7. **OPS-ORD-07 — Auto-fill là read-only, không gõ tay**
   - **Then** trong form khai báo chi phí, `Mã lô` / `Số Bill` / `Số Cont` ở trạng thái
     **readonly** — Ops không sửa được và không phải chọn lại lô trong form.

**Test case**: [`TC-OPS-KH-001` … `TC-OPS-KH-005`](../flows/05-ops-quy-chi-phi.md#51--màn-hình-1-kế-hoạch-làm-hàng--lệnh-phụ-trách-opsorders).

## Flow 8 — Theo dõi phương tiện (/ops/fleet-tracking)

**Route**: `/ops/fleet-tracking`
**Component**: `frontend/src/pages/ops/OpsFleetTrackingPage.tsx`
**Allow**: `OPS` only. **Read-only.**
**PRD nguồn**: `OpsVanHanh.md` §4

### Acceptance criteria

1. **OPS-TRK-01 — Chỉ xe được gán**
   - **Given** ADMIN set "Ops phụ trách" on trucks via the fleet config page
   - **Then** the page lists exactly those trucks (plate | trailer | current trip
     code + shipment code | driver | status | updated time); an OPS with no
     assignment sees the empty state.
2. **OPS-TRK-02 — Lệnh tự xuất hiện**
   - **When** DISPATCHER dispatches/assigns a trip to one of the OPS's trucks
   - **Then** the row updates automatically (polling ≤ 30s) with the new lệnh and
     status synced from driver-app actions (Chờ nhận lệnh / Đang vận chuyển /
     Đã hoàn thành / Đang rảnh).
3. **OPS-TRK-03 — Read-only tuyệt đối**
   - **Then** the page contains no mutating control, modal, or confirm action.
4. **OPS-TRK-04 — Phạm vi xe tách bạch giữa 2 Ops (P0)**
   - **Given** Ops A phụ trách xe `X`, Ops B phụ trách xe `Y`
   - **Then** danh sách của A chứa `X` và **không** chứa `Y`, và ngược lại.
     Kiểm chứng bằng 2 tài khoản chạy song song, không suy luận từ 1 tài khoản.
5. **OPS-TRK-05 — Trạng thái phản ánh đúng thao tác lái xe**
   - **When** lái xe bấm `Nhận lệnh vận chuyển` rồi `Hoàn tất lệnh vận chuyển`
   - **Then** ô trạng thái của xe đó đi đúng chuỗi `Chờ nhận lệnh` →
     `Đang vận chuyển` → `Đã hoàn thành`, khớp mốc thời gian thao tác trên app.

**Test case**: [`TC-OPS-XE-001` … `TC-OPS-XE-006`](../flows/05-ops-quy-chi-phi.md#52--màn-hình-2-theo-dõi-phương-tiện-được-giao-opsfleet-tracking).

## Flow 9 — Ví tạm ứng & chi phí (/ops/wallet)

**Routes**: `/ops/wallet`, `/ops/wallet/settlements/:id/print`
**Components**: `frontend/src/pages/ops/OpsWalletPage.tsx`,
`OpsSettlementPrintPage.tsx`
**Allow**: `OPS` only (print route same guard).
**PRD nguồn**: `OpsVanHanh.md` §5

### Acceptance criteria

1. **OPS-WAL-01 — Bốn thẻ & công thức**
   - **Then** SỐ DƯ HIỆN TẠI = Σ approved advances − (Σ APPROVED + Σ PENDING
     expenses); Đã duyệt green, Chờ duyệt amber, Bị từ chối red; the balance card
     is the dominant element.
2. **OPS-WAL-02 — Optimistic jump**
   - **When** the OPS saves an expense
   - **Then** balance drops and Chờ duyệt rises instantly (before refetch) and
     reconciles exactly after refetch.
3. **OPS-WAL-03 — Xin tạm ứng**
   - **When** the OPS submits the advance form (amount + required reason)
   - **Then** a PENDING row is created in the shared `advance_requests` flow
     (visible in /my-advances and the admin approval page); on approval the
     balance rises.
4. **OPS-WAL-04 — Nhãn nợ chứng từ**
   - **Then** any expense with amount but zero photos shows the red "Nợ chứng từ"
     tag in history.
5. **OPS-WAL-05 — Từ chối & gửi lại**
   - **When** ACCOUNTANT rejects an expense with a reason
   - **Then** the amount leaves Chờ duyệt, returns to the balance, shows under Bị
     từ chối with the reason; "Chụp lại/Gửi lại" re-enters PENDING.
6. **OPS-WAL-06 — Tạo đề nghị thanh toán**
   - **Then** the builder groups all my unsettled PENDING+APPROVED expenses by lot
     with Có/Không hóa đơn subtotals (from `forwarderExpenseTypes.requiresInvoice`);
     confirming creates a coded phiếu and locks its member set.
7. **OPS-WAL-07 — Export & in**
   - **Then** Excel downloads (per-lot rows + bucket totals) and the print route
     renders an A4 sheet without nav chrome.
8. **OPS-WAL-08 — Kế toán duyệt**
   - **Then** ACCOUNTANT/ADMIN can approve/reject each Ops expense (reason required
     on reject) and approve the phiếu once every member is APPROVED (→ đã quyết toán).
9. **OPS-WAL-09 — Micro-ledger: nhiều Ops chi trên cùng 1 lô vẫn gom về 1 mã lô (P0)**
   - **Given** Ops A chi khoản Nâng cont và Ops B chi khoản Bồi dưỡng, **cùng lô X**
   - **Then** mỗi khoản giữ đúng `paidBy` riêng, nhưng màn Kế toán hiển thị cả hai
     **gom dưới 1 mã lô X duy nhất** — không tách nhóm theo người chi.
10. **OPS-WAL-10 — Đồng bộ PC ↔ Mobile cùng một nguồn dữ liệu**
    - **When** Ops nhập + chụp biên lai trên điện thoại tại cảng, rồi mở trên máy tính
    - **Then** khoản chi hiện đủ ở cả hai thiết bị (và ngược lại). Trên mobile ô upload
      mở được camera (`accept="image/*"`).
11. **OPS-WAL-11 — Số dư chưa đổi khi tạm ứng còn Pending**
    - **Then** gửi yêu cầu tạm ứng **chưa được duyệt** không làm `[SỐ DƯ HIỆN TẠI]` tăng;
      chỉ khi Kế toán `Approved` số dư mới tăng.
12. **OPS-WAL-12 — Phân loại 2 rổ đúng danh mục**
    - **Then** rổ **Có hóa đơn** gồm Nâng/Hạ, Phí cảng, Lưu kho, Cơ sở hạ tầng;
      rổ **Không hóa đơn** gồm Phí làm hàng hải quan, Bồi dưỡng, Tiền luật, Cân xe —
      lấy từ `forwarderExpenseTypes.requiresInvoice`, không hard-code ở frontend.
13. **OPS-WAL-13 — Không gom trùng khoản đã quyết toán**
    - **Then** khoản đã nằm trong một phiếu đã quyết toán **không** bị gom lại vào
      đề nghị thanh toán mới.

**Test case**: [`TC-OPS-VI-001` … `TC-OPS-VI-014`](../flows/05-ops-quy-chi-phi.md#53--màn-hình-3-quỹ-tạm-ứng-cá-nhân--chi-phí-opswallet).

## Negative / RBAC table (OPS)

| Action                                  | OPS | ADMIN | MANAGER | DISPATCHER | CUS | ACCOUNTANT | DRIVER | CUSTOMER |
|-----------------------------------------|-----|-------|---------|------------|-----|------------|--------|----------|
| Read `/my-orders`                       | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Read `/my-forwarder-trips/:id`          | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Submit advance request                  | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Cancel pending advance                  | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Submit settlement                       | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Read `/my-settlements/:id` (print)      | ✅  | view  | view    | view       | ❌  | view       | ❌     | ❌       |
| Read `/ops/orders` (lots + expense)     | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Read `/ops/fleet-tracking`              | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Read `/ops/wallet` (+ print)            | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Pin / unpin a lot                       | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Create Ops lot expense (+ photos)       | ✅  | ❌    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
| Approve/reject Ops expense or phiếu     | ❌  | ✅    | ✅      | ❌         | ❌  | ✅         | ❌     | ❌       |
| Set "Ops phụ trách" on a truck          | ❌  | ✅    | ❌      | ❌         | ❌  | ❌         | ❌     | ❌       |
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
