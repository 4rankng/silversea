# Role: DRIVER — Lái xe

> **Vietnamese label**: Lái xe (`Role.DRIVER`).
> **Home route**: `/my-trips` (`routes.myTrips`).
> **Primary sidebar section**: `Công việc của tôi` (`my-work`).
> **Test accounts**: chọn theo môi trường qua `../testaccounts.txt` (role → username). Runner tự map `DRIVER` + env → username phù hợp. Biển số xe đi kèm mỗi driver xem trong `testaccounts.txt`.
> **Primary pages**:
> - `/my-trips` — `frontend/src/pages/DriverTripsPage.tsx` (Hành trình của tôi)
> - `/my-trips/:id` — `frontend/src/pages/DriverTripDetailPage.tsx` (chi tiết chuyến)
> - `/my-trips/:id/pod` — `frontend/src/pages/DriverTripPodPage.tsx` (e-POD)
> - `/my-trips/two-orders` — `frontend/src/pages/driver/DriverTwoOrdersPage.tsx`
> - `/my-earnings` — `frontend/src/pages/DriverEarningsPage.tsx` (Thu nhập)
> - `/my-payslips` — `frontend/src/pages/driver/DriverPayslipsPage.tsx`
> - `/my-penalties` — `frontend/src/pages/DriverPenaltyPage.tsx` (Kỷ luật)
>
> The driver app is a **PWA** (add-to-home-screen on iOS is the primary
> install path). iOS safe-area-inset, mobile tap targets ≥ 48 px, and
> offline behavior are first-class concerns.
>
> Cross-cutting rules live in [`README.md`](README.md) §5. The
> mobile-specific rules in §5 (UI-02, UI-03) are critical for this role.

---

## Scope boundary

DRIVER is the **field** role. The driver:

- Receives planned trips assigned to their plate.
- Walks the trip from `Mới tạo` → `Đang chạy` → `Hoàn thành`.
- Captures the **container / seal** photos and the **e-POD** (electronic
  proof of delivery) on a separate screen.
- Reads their own **earnings**, **payslips**, and **penalties**.
- **Cannot** see other drivers' trips, financials, master data, or
  the office workspace.

If a driver navigates to a forbidden route, AUTH-03 in §5 of the README
applies (silent redirect to `/my-trips`).

---

## Flow 1 — Hành trình của tôi (My trips list)

**Route**: `/my-trips`
**Component**: `frontend/src/pages/DriverTripsPage.tsx`
**Allow**: `DRIVER` only (`driverOnly` per `App.tsx:347`).
**Pre-conditions**: the driver is logged in; at least 1 trip is assigned
to the driver's plate.

### Acceptance criteria

1. **DRV-LIST-01 — Full-bleed page on mobile**
   - **Given** a viewport of 390 × 844 (iPhone 14)
   - **When** the page mounts
   - **Then** the page uses the full viewport width; there is no
     secondary background block visible behind the page background
     (no double-background regression — verified in commit `0fcedcde`).
   - **Evidence**: screenshot at 390 × 844; visually inspect the
     vertical strip from top to bottom — no visible
     "page-on-color" + "color-on-page" layering.

2. **DRV-LIST-02 — Tabs: Hôm nay / Đang chạy / Lịch sử**
   - **Then** the page shows three tabs:
     - `Hôm nay` — trips with `scheduledPickupAt` within today (Asia/Ho_Chi_Minh).
     - `Đang chạy` — trips with status `Đang chạy`.
     - `Lịch sử` — trips with status `Hoàn thành` or `Đã hủy`.
   - Each tab's count is shown in the tab label.

3. **DRV-LIST-03 — Trip card anatomy**
   - **Given** a trip card on the journey board (`/my-trips`)
   - **Then** it shows, in this order (ticket 365943ea):
     1. **Header**: classification tag (`ĐƠN`/`KẸP`/`KẾT HỢP`/`LẺ`) + scheduled time.
     2. **Factory name** (headline, 16px bold, brand icon) — the primary
        identifier a driver scans for.
     3. **Route** (secondary, 13px, muted icon).
     4. **Container block** (tinted background): container number + type pill
        + seal pill, followed by lift port (`Nâng`) and drop port (`Hạ`)
        side-by-side below.
     5. **Operation tasks** (`tác vụ`) — chips rendered from the dispatch
        plan's `operationalNotes` field (e.g. `ĐẶT ĐẦU`, `ĐẢO VỎ`).
        Hidden when no notes are set.
     6. **Contact** (name + phone tel-link).
     7. **Remaining facts** (2-col grid): `Đầu kéo` (truck plate), `Mooc`
        (trailer plate).
     8. **Footer CTA**: `Xem chi tiết & Nhận lệnh` (NEW) or
        `Xem chi tiết` (RUNNING/HISTORY).
   - **Evidence**: card screenshot at 390px; DOM inspection confirming
     factory name renders before route; container + ports are visually
     grouped.

4. **DRV-LIST-04 — Container + ports side-by-side**
   - **Then** the container strip and the lift/drop port row are grouped
     in a single visual block (`.driver-journey-card__container-block`).
     At 360px, ports wrap below the container strip; at 768px they sit
     on the same row if space allows.
   - **Evidence**: screenshots at 360px and 768px showing the
     container-block layout.

5. **DRV-LIST-05 — Tap target ≥ 48 px**
   - **Then** every interactive element on the card is at least 48 × 48
     CSS pixels (per `c9012bd0` — the 48 px floor must out-rank the
     global button floor). Verify in dev-tools: the trip-card action
     and any inline button have `min-height: 48px`.

6. **DRV-LIST-06 — Pull-to-refresh / refresh button**
   - **Then** a pull-to-refresh or visible refresh control re-fetches
     the trip list. The control respects `prefers-reduced-motion`
     (no bouncy animation when the OS-level setting is on).

7. **DRV-LIST-07 — Empty state**
   - **Given** a driver with no trips
    - **Then** the page shows the empty-state illustration + copy
      (`Bạn chưa có chuyến nào`) and a refresh control.

### Test steps

1. Log in as `DRIVER` on a 390 × 844 mobile viewport (Chrome dev-tools
   device emulation or a real iPhone via PWA install).
2. Walk through the three tabs; capture each.
3. Tap a trip card → confirm the trip detail screen opens.

### Regression hooks

- `frontend/src/pages/DriverTripsPage.test.tsx` stays green (11 tests
  including operation-tags rendering + the factoryShortName preference);
  tag ordering (canonical seed 0066 → `display_order ASC NULLS LAST, label`)
  is pinned by
  `frontend/src/features/dispatch/detailed-plan/useDispatchTaskTags.test.tsx`.
- `pnpm exec playwright test --headed` (or the visual QA script under
  `qa/visual_qa_driver*`) at 390 × 844.

---

## Flow 2 — Chi tiết chuyến (Trip detail)

**Route**: `/my-trips/:id`
**Component**: `frontend/src/pages/DriverTripDetailPage.tsx`
**Allow**: `DRIVER` only.
**Pre-conditions**: the driver owns the trip (the trip's `driverId`
matches the logged-in user).

### Acceptance criteria

1. **DRV-DET-01 — Page identity & layout**
   - **Then** the page shows:
     - Header: `Mã chuyến`, `Trạng thái` (with color), customer, route.
     - Section: `Thông tin xe` (plate, container numbers, seal numbers).
     - Section: `Hành trình` (pickup → drop-off timeline with current
       step highlighted).
     - **No** cost form, **no** `Báo cáo đổ dầu` form, **no**
       `Nhập chi phí lô hàng` form (per `f61a7c84` and the
       trial-readiness scope; see regression-r6 finding 1 — 0
       matches for any cost-form string in the deployed bundle).
   - **Evidence**: dev-tools `getComputedStyle` / element search for
     any of: `Nhập chi phí`, `Báo cáo đổ dầu`, `Chi phí lô hàng`,
     `cost-form` — must return 0 matches in the DOM.

2. **DRV-DET-02 — Container / seal capture button always works**
   - **Given** the driver is on the trip detail
   - **When** the user taps the container / seal capture button
   - **Then** a file picker opens. On a real device, the OS camera
     launches if the user grants camera permission; on a desktop
     browser, the file picker falls back to a regular file selection.
   - **Then** the button is **never** in a "dead-end" state (per
     `c95db3e0`): even if the camera fails or the user cancels, the
     button re-enables for another attempt within 1 s.
   - **Evidence**: tap the button 3 times in a row; capture
     screenshots; check the button's `disabled` attribute stays
     `false` between attempts.

3. **DRV-DET-03 — Start trip CTA**
   - **Given** the trip is in `Mới tạo`
   - **When** the user taps `Bắt đầu chuyến` (or equivalent)
   - **Then** the trip status flips to `Đang chạy`, an audit-log row
     is written, the page re-renders the new status color, and the
     next CTA (`Hoàn thành chuyến` / `Bước tiếp: e-POD`) becomes
     available.

4. **DRV-DET-04 — "Bước tiếp: e-POD" navigates to the e-POD screen**
   - **Given** the trip is in `Đang chạy` and is otherwise eligible
     for completion
   - **When** the user taps `Bước tiếp: e-POD`
   - **Then** the route changes to `/my-trips/:id/pod`. The
     navigation is a hard client-side push (back button returns to
     `/my-trips/:id`).
   - **Reference**: per Phần 4 ticket 2026-08-28, e-POD lives on its
     own screen.

5. **DRV-DET-05 — e-POD "bắt buộc" label is shown once**
   - **Then** the page shows exactly one label `e-POD bắt buộc`
     (per `4504399e` — the duplicate label was dropped). The
     visibility state of the e-POD CTA is the **only** signal
     gating trip completion.

6. **DRV-DET-06 — "Hoàn thành chuyến" button copy**
   - **Then** the button label is `Hoàn thành chuyến` (mixed case,
     not the AC literal `HOÀN THÀNH CHUYẾN`). Per the user's
     explicit override in the r4 round.
   - **Evidence**: button screenshot; `textContent` of the
     button matches the exact string above.

7. **DRV-DET-07 — Sync indicator (offline / pending / failed)**
   - **Given** the device is offline or the request fails
   - **When** the user triggers a mutation (start, complete, photo
     upload, e-POD submit)
   - **Then** the page shows one of:
     - `Đang đồng bộ…` (in-flight)
     - `Đang chờ đồng bộ` (queued in IndexedDB)
     - `Gửi chưa thành công. Hệ thống sẽ thử lại khi có mạng.` (failed,
       will retry on next online tick)
   - Per `2a1fa86e` — the SW background sync is wired.

8. **DRV-DET-08 — Fuel-screenshot image renders (auth-tokened URL)**
   - **Given** the trip has a fuel-evidence submission
   - **Then** the `Ảnh nhiên liệu` panel shows the captured pump
     screenshot — the `<img>` src must carry the JWT query token
     (`?token=…`). A raw `/api/photos/…` URL 401s in the browser
     because `<img>` cannot send Authorization headers; backend OCR
     is unaffected (it reads the stored bytes server-side), so OCR
     values can be correct while the image still renders broken
     (regression fixed 2026-08-29).
   - **Evidence**: dev-tools network — the `photo` request returns
     `200` (not `401`), and the image is visible on the card.

### Test steps

1. Log in as `DRIVER`. Open a trip from `/my-trips`.
2. Capture the trip detail page.
3. Tap container / seal capture 3× to verify the no-dead-end rule.
4. Tap `Bắt đầu chuyến` and capture the new state.
5. Tap `Bước tiếp: e-POD` and confirm navigation.
6. Toggle dev-tools "Offline" and trigger an action; capture the
   `Đang chờ đồng bộ` indicator.

### Regression hooks

- `frontend/src/pages/DriverTripDetailPage.test.tsx` and
  `DriverTripDetailPage.shipmentCostEntry.test.tsx`.
- The PWA `service-worker` is registered; verify with
  `navigator.serviceWorker.controller` in dev-tools.

---

## Flow 3 — e-POD (Electronic proof of delivery)

**Route**: `/my-trips/:id/pod`
**Component**: `frontend/src/pages/DriverTripPodPage.tsx`
**Allow**: `DRIVER` only (`driverOnly` per `App.tsx:353`).
**Pre-conditions**: the trip is in `Đang chạy`; the driver is the
owner.

### Acceptance criteria

1. **DRV-POD-01 — Page anatomy**
   - **Then** the page shows these sections in order:
     1. Trip identity (mã chuyến, customer, route).
     2. `Phiếu bãi` (yard receipt) upload.
     3. `Biên bản` (incident report, optional) upload.
     4. `Tải tệp` button to add more attachments.
     5. Notes textarea.
     6. Submit CTA: `Gửi e-POD để duyệt`.

2. **DRV-POD-02 — Single pod-readiness gate**
   - **Then** the submit button is enabled **iff** the trip's
     pod-readiness check passes (per `767a0864` — the single gate).
     The duplicate "e-POD bắt buộc" label from the old gate is
     gone; the only signal is the submit button's disabled state.

3. **DRV-POD-03 — Submit shows the success toast**
   - **When** the user taps `Gửi e-POD để duyệt` and the server
     accepts
   - **Then** the toast `Đã gửi e-POD để duyệt` is shown; the
     trip status flips to a `pending review` state; the page is
     read-only (no further edits).

4. **DRV-POD-04 — Conflict-recovery banner is live**
   - **Given** the driver previously had a local edit that
     conflicts with a server-side change
   - **When** the page loads after the SW resolves the conflict
   - **Then** the page shows the banner
     `Đã tải lại chuyến và bỏ lệnh xung đột. Bấm "HOÀN THÀNH
     CHUYẾN" để thử lại.` (per `b1161733`; lowercase `xung đột`,
     uppercase `HOÀN THÀNH CHUYẾN` inside the quote).
   - **Reference**: regression-r6 finding 3 — banner confirmed
     live on staging.
   - **Evidence**: trigger a conflict (mutate the trip from another
     tab while offline, then come back online); capture the banner.

5. **DRV-POD-05 — Bypass / sync / retry banners**
   - **Then** the page also shows:
     - `Lệnh gửi e-POD đang chờ đồng bộ.` (pending).
     - `Gửi e-POD chưa thành công. Hệ thống sẽ thử lại khi có
       mạng.` (failed/retry).

6. **DRV-POD-06 — File picker for Phiếu bãi / Biên bản**
   - **Given** a PDF or JPG in the test fixture
   - **When** the user taps `Tải tệp`
   - **Then** a file picker opens; the selected file is uploaded
     and shown in the section's list with name, size, and a
     remove button (until submit).

### Test steps

1. Log in as `DRIVER`. From a trip in `Đang chạy`, tap
   `Bước tiếp: e-POD` on the trip detail page.
2. Capture the e-POD screen.
3. Upload a 1 MB PDF for `Phiếu bãi`.
4. Optionally upload a 200 KB JPG for `Biên bản`.
5. Type a short note.
6. Tap `Gửi e-POD để duyệt`; capture the success toast.
7. (Conflict-recovery) Open the same trip from `ADMIN`'s trip
   detail, change a field, go offline on the driver app, mutate
   the same field, come back online; capture the banner.

### Regression hooks

- `frontend/src/pages/DriverTripPodPage.test.tsx` stays green.
- The deployed bundle for the e-POD page contains `Phiếu bãi`,
  `Biên bản`, `Tải tệp`, `Đã gửi e-POD để duyệt`,
  `Đã tải lại chuyến và bỏ lệnh xung đột. Bấm
  "HOÀN THÀNH CHUYẾN" để thử lại.` (regression-r6 baseline).

---

## Flow 4 — Bốc hai chuyến (Two-orders screen, dispatcher's paired-trips view)

**Route**: `/my-trips/two-orders`
**Component**: `frontend/src/pages/driver/DriverTwoOrdersPage.tsx`
**Allow**: `DRIVER` only (`driverOnly` per `App.tsx:348`).

### Acceptance criteria

1. **DRV-2X-01 — Page renders the two paired trip cards**
   - **Given** a driver has 2 active trips (rare, but supported)
   - **Then** the page shows both trips in a single screen, each
     card comparable to the trip detail anatomy (DRV-DET-01).
2. **DRV-2X-02 — Cost form is still hidden**
   - **Then** the two-orders screen has no `Nhập chi phí` /
     `Báo cáo đổ dầu` form, same as DRV-DET-01.

### Test steps

1. Log in as `DRIVER` and confirm `/my-trips/two-orders` loads.
2. If the seed has no two-orders pair, create one via
   `DISPATCHER`/`ADMIN` first, then re-test.

---

## Flow 5 — Thu nhập (Earnings)

**Route**: `/my-earnings`
**Component**: `frontend/src/pages/DriverEarningsPage.tsx`
**Allow**: `DRIVER` only.

### Acceptance criteria

1. **DRV-EARN-01 — Earnings breakdown**
   - **Then** the page shows, for the current month:
     - Hero KPI: `Tổng thu nhập` (VND).
     - Breakdown by trip: `Mã chuyến`, `Ngày`, `Khách hàng`,
       `Tuyến`, `Doanh thu`, `Hoa hồng`, `Phạt`, `Thực nhận`.
   - **Evidence**: full-page screenshot at 390 × 844.

2. **DRV-EARN-02 — Currency formatting**
   - **Then** every monetary value uses `Intl.NumberFormat('vi-VN',
     { style: 'currency', currency: 'VND' })` and renders the
     grouping separator (`.`).

3. **DRV-EARN-03 — Month switcher**
   - **When** the user picks another month from the switcher
   - **Then** the data re-fetches and the hero KPI updates
     within 1 s.

4. **DRV-EARN-04 — Read-only**
   - **Then** no edit / payout-claim action is exposed. The page
     is purely informational; the actual payout happens via
     `/my-payslips` (Flow 6).

### Test steps

1. Log in as `DRIVER`. Open `/my-earnings`.
2. Capture the current month.
3. Switch to the previous month; capture.

---

## Flow 6 — Phiếu lương (Payslips)

**Route**: `/my-payslips`
**Component**: `frontend/src/pages/driver/DriverPayslipsPage.tsx`
**Allow**: `DRIVER` only.

### Acceptance criteria

1. **DRV-PAY-01 — List of payslips**
   - **Then** a list of the driver's payslips, newest first.
     Each row: `Kỳ lương`, `Tổng thực nhận`, `Trạng thái`
     (`Đã thanh toán` / `Chờ thanh toán` / `Đang khóa`).
2. **DRV-PAY-02 — Drill-down**
   - **When** the user taps a row
   - **Then** a detail view shows: `Kỳ lương`, `Ngày chốt`,
     `Tổng thu nhập`, `Các khoản khấu trừ`, `Thực nhận`,
     `Lịch sử điều chỉnh`.
3. **DRV-PAY-03 — No PII of other drivers**
   - **Then** the page is scoped to the logged-in driver; no
     other driver's row is reachable.

---

## Flow 7 — Kỷ luật (Penalties — read-only)

**Route**: `/my-penalties`
**Component**: `frontend/src/pages/DriverPenaltyPage.tsx`
**Allow**: `DRIVER` only.

### Acceptance criteria

1. **DRV-PEN-01 — Penalty list scoped to the driver**
   - **Then** the page shows the driver's own penalties, newest
     first. Each row: `Ngày`, `Lý do`, `Số tiền`, `Trạng thái`
     (`Hiệu lực` / `Đã hủy`).
2. **DRV-PEN-02 — No edit / appeal action**
   - **Then** the page is read-only. The driver cannot dispute
     the penalty from this screen — the office staff issues the
     penalty at `/penalties` and the driver is informed here.

### Test steps

1. Log in as `DRIVER`. Open `/my-penalties`.
2. Capture the list. If empty, capture the empty state.

---

## Flow 8 — Hành vi ngoại tuyến (Offline behavior)

The driver app is a PWA; **offline behavior is a first-class concern**,
not an edge case.

### Acceptance criteria

1. **DRV-OFF-01 — Service worker registered**
   - **Given** a PWA installed on iOS
   - **When** the driver opens the app
   - **Then** `navigator.serviceWorker.controller` is non-null after
     the first navigation; subsequent reloads work offline.

2. **DRV-OFF-02 — Trip list caches**
   - **Given** the driver opened `/my-trips` once while online
   - **When** the device goes offline
   - **Then** opening `/my-trips` again still renders the last
     cached list with an `OfflineBanner` (`Bạn đang ngoại tuyến —
     dữ liệu có thể cũ`).

3. **DRV-OFF-03 — Mutations queue and replay**
   - **Given** the device is offline
   - **When** the driver starts a trip, captures a photo, or
     submits an e-POD
   - **Then** the mutation is stored in IndexedDB and a
     `Đang chờ đồng bộ` indicator is shown. When the device
     comes back online, the SW replays the queue. On success,
     the indicator clears; on conflict, the conflict-recovery
     banner from DRV-POD-04 is shown.

4. **DRV-OFF-04 — Safe-area-inset**
   - **Then** the bottom nav and any sticky CTA respect
     `env(safe-area-inset-bottom)` — no overlap with the iOS
     home indicator. Verify in the iOS simulator at
     iPhone 14 (with a home indicator) and iPhone 8 (no home
     indicator).

### Test steps

1. Open the PWA in iOS Safari / Chrome on Android. Confirm
   `serviceWorker.controller` is set.
2. Toggle dev-tools "Offline". Re-open the app, walk the
   flows. Confirm the indicators.
3. Toggle back online; confirm the queue drains and the UI
   reconciles.

---

## Negative / RBAC table (DRIVER)

| Action                             | DRIVER | ADMIN | MANAGER | DISPATCHER | OPS | CUS | ACCOUNTANT | CUSTOMER |
|------------------------------------|--------|-------|---------|------------|-----|-----|------------|----------|
| Read `/my-trips`                   | ✅ own | ❌    | ❌      | ❌         | ❌  | ❌  | ❌         | ❌       |
| Start / complete trip              | ✅ own | ✅ all| ✅ all  | ✅ plan only| ❌  | ❌  | ❌         | ❌       |
| Submit e-POD                       | ✅ own | ❌    | ❌      | ❌         | ❌  | ❌  | ❌         | ❌       |
| Read own earnings / payslips       | ✅     | ❌    | ❌      | ❌         | ❌  | ❌  | ❌         | ❌       |
| Read own penalties                 | ✅     | view all| view all| view all  | ❌  | ❌  | view all   | ❌       |
| Read other drivers' data           | ❌     | ✅    | ✅      | view only  | ❌  | ❌  | ❌         | ❌       |
| Read `/dispatch` `/dispatch-detail`| ❌     | ✅    | ✅      | ✅         | ❌  | ❌  | ❌         | ❌       |
| Read `/finance` `/accounting`      | ❌     | ✅    | ✅      | ❌         | ❌  | ❌  | ✅         | ❌       |
| Read `/audit-logs`                 | ❌     | ✅    | ✅      | ❌         | ❌  | ❌  | ✅         | ❌       |

## Out of scope (DRIVER)

- Office workspace (no `/shipments`, `/dispatch`, `/finance`, etc.).
- Editing master data.
- Editing customers.
- Issuing penalties.

## Known open items (carry-over from past rounds)

- **Cost form regression-r6 finding 1**: confirmed 0 cost-form strings
  in the deployed `DriverTripDetailPage` chunk and 0 matches in the
  live DOM. ACs DRV-DET-01 and DRV-2X-02 lock this in.
- **e-POD conflict-recovery banner (r6 finding 3)**: confirmed live on
  staging via lowercase `xung đột`. AC DRV-POD-04 codifies the exact
  banner string for future regression.
- **Sidebar-overlay on the test rig**: the desktop sidebar can
  occlude buttons when Playwright is run with mouse clicks. Use
  `page.evaluate("el => el.click()")` or scroll the element into
  view first. Real-device / real-mouse interactions are unaffected.
