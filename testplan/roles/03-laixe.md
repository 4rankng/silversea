# Role: DRIVER — Lái xe

> **Vietnamese label**: Lái xe (`Role.DRIVER`).
> **Home route**: `/my-trips` (`routes.myTrips`).
> **Primary sidebar section**: `Công việc của tôi` (`my-work`).
> **Test accounts (local + staging)**: `laixe` / `Abc123` (truck
> `15C-491.72`), `thu` / `Abc123` (`60C-23456`), `pho` / `Abc123`
> (`60C-45678`), `quyet` / `Abc123` (`60C-34567`).
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

2. **DRV-LIST-02 — Sub-tabs: Lệnh mới / Đã nhận / Lịch sử**
   - **Then** the `Hành trình` screen shows exactly three sub-tabs, in this
     order: `Lệnh mới` | `Đã nhận` | `Lịch sử`.
     - `Lệnh mới` — dispatched to this driver, not yet accepted.
     - `Đã nhận` — accepted and running (trip-start timestamp recorded).
     - `Lịch sử` — completed or cancelled.
   - The **bottom navigation keeps its existing 4 tabs** — none added or
     removed this phase.
   - Each sub-tab's count is shown in its label.
   - **Spec**: `ManHinhLaiXe.md` §1. **Case**: `TC-LX-NHANLENH-014`.

3. **DRV-LIST-03 — Layer-1 card anatomy: one card per container**
   - **Given** the shipment list on any sub-tab
   - **Then** **each container is its own card** — never one card per trip,
     never several containers merged into one card.
   - **And** each card shows, in this order:
     | Region | Content |
     |--------|---------|
     | Header | `[Tag: ĐƠN / KẸP / KẾT HỢP]` + `Giờ đóng / trả: HH:MM - DD/MM` |
     | Row 1 | `Nhà máy` **left-aligned** · `Cảng nâng` **right-aligned** |
     | Row 2 | `Tuyến đường` **left-aligned** · `Cảng hạ` **right-aligned** |
     | Row 3 | `Cont: [Số Cont] - [Loại cont]` (e.g. `40'HC`) |
     | Footer | `Xem chi tiết & Nhận lệnh` |
   - **No status pill on the card.** The header tag plus the footer CTA carry
     the card's state; this matches the project convention of coloured text
     over badge chrome. The plate moves to detail block 6
     (`DRV-DET-09`), so the old driver-name + `🚚 {Biển số}` subtext line is
     not part of this anatomy.
   - No horizontal scroll; type legible in direct sunlight.
   - **Spec**: `ManHinhLaiXe.md` §2.1. **Case**: `TC-LX-NHANLENH-015`.
   - **Evidence**: card screenshot with each region annotated; DOM check that
     the card count equals the container count (not the trip count).

4. **DRV-LIST-04 — Tap target ≥ 48 px**
   - **Then** every interactive element on the card is at least 48 × 48
     CSS pixels (per `c9012bd0` — the 48 px floor must out-rank the
     global button floor). Verify in dev-tools: the trip-card action
     and any inline button have `min-height: 48px`.

5. **DRV-LIST-05 — Pull-to-refresh / refresh button**
   - **Then** a pull-to-refresh or visible refresh control re-fetches
     the trip list. The control respects `prefers-reduced-motion`
     (no bouncy animation when the OS-level setting is on).

6. **DRV-LIST-06 — Empty state**
   - **Given** a driver with no trips
   - **Then** the page shows the empty-state illustration + copy
     (`Bạn chưa có chuyến nào`) and a refresh control.

7. **DRV-LIST-07 — Paired shipments render as an adjacent combo**
   - **Given** two shipments sharing a pair (`KẸP` or `KẾT HỢP`)
   - **Then** their two cards render **adjacent as one visual combo**,
     never split across the list, each carrying the shared tag.
   - For `KẾT HỢP`, the second card is **locked** until the first
     completes delivery; for `KẸP`, both run in parallel with no lock.
   - **Cases**: `TC-LX-NHANLENH-011`, `-012`, `TC-GHEP-009` … `-011`.

> ### 🔧 Migration gap — list screen not yet rebuilt to spec
>
> **Decision 2026-09-07: the docx is authoritative — one card per container.**
> `DRV-LIST-02` and `DRV-LIST-03` above are written to
> `2026.8.27_Man_hinh_lai_xe.docx` / [`ManHinhLaiXe.md`](../../docs/prd/ManHinhLaiXe.md)
> §1–§2.1 and are the **binding** criteria.
>
> What is currently built in `DriverTripsPage.tsx` still differs and must be migrated.
> Until it is, `DRV-LIST-02` / `-03` are expected to **FAIL** (not BLOCKED) — that
> failure is the tracked work item, not a test defect:
>
> | Item | Currently built | Required (binding) |
> |------|-----------------|--------------------|
> | Sub-tabs | `Hôm nay` / `Đang chạy` / `Lịch sử` | `Lệnh mới` / `Đã nhận` / `Lịch sử` |
> | Card unit | 1 card per **trip** | **1 card per container** |
> | Header | `Mã chuyến` (monospace) | `[Tag: ĐƠN/KẸP/KẾT HỢP]` + `Giờ đóng / trả` |
> | Body | `Khách hàng`, `Tuyến`, `Tài xế` + `🚚 {Biển số}` subtext | `Nhà máy`↔`Cảng nâng`, `Tuyến đường`↔`Cảng hạ`, `Cont: [Số] - [Loại]` |
> | Footer | status pill (`TRIP_STATUS_COLORS`) | `Xem chi tiết & Nhận lệnh`, **no pill** |
>
> Superseded criteria — kept only so the earlier behaviour is traceable, **not** for
> acceptance: the old `DRV-LIST-02` (Hôm nay/Đang chạy/Lịch sử tabs) and the old
> `DRV-LIST-03` (per-trip card with plate subtext per `0fcedcde` and status pill per
> `TRIP_STATUS_COLORS`, `shared/src/constants/index.ts`).
>
> The 48 px tap-target floor (`DRV-LIST-04`, `c9012bd0`) and the full-bleed rule
> (`DRV-LIST-01`, `0fcedcde`) **survive the migration unchanged** and still apply to
> the new card.

### Test steps

1. Log in as `laixe` on a 390 × 844 mobile viewport (Chrome dev-tools
   device emulation or a real iPhone via PWA install).
2. Walk through the three sub-tabs (`Lệnh mới` / `Đã nhận` / `Lịch sử`);
   capture each.
3. Count cards vs. containers on a multi-container shipment — they must
   match 1:1 (`DRV-LIST-03`).
4. Tap a card → confirm the full-screen detail opens with all 7 blocks
   (`DRV-DET-09`).

### Regression hooks

- `frontend/src/pages/DriverTripsPage.test.tsx` stays green.
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

9. **DRV-DET-09 — Layer-2 detail carries all seven spec blocks**
   - **Given** a shipment card opened full-screen
   - **Then** the detail screen contains all seven blocks from
     `ManHinhLaiXe.md` §2.2, in order:
     1. **Lộ trình** — `Tuyến đường`, `Nhà máy`, `Cảng nâng`, `Cảng hạ`
     2. **Hàng hoá** — `Loại Cont`, `Số Cont`, `Số Chì` + `📷 Chụp ảnh Cont/Chì`
     3. **Liên hệ** — warehouse contact name + a **tap-to-call** phone number
     4. **Thông tin hoá đơn** — lift/drop invoice info + cleaning invoice info
     5. **Quy định tại điểm làm hàng** — sourced from the factory's driver note
     6. **Thông tin xe** — `Biển số Đầu kéo` + `Biển số Mooc`
     7. **Thao tác** — the sticky CTA (see `DRV-DET-10`)
   - Block 4 reads `liftFeeInvoice*` / `dropFeeInvoice*` / `cleaningInvoice*`
     and block 5 reads `strictRules` from the factory master data
     (`MasterDataNhaMay.md`); a field with no data renders `—`, never
     `null` / `undefined` / an unlabelled blank.
   - **Case**: `TC-LX-NHANLENH-016`.
   - **Evidence**: stitched full-scroll screenshot with the 7 blocks numbered.

10. **DRV-DET-10 — Primary CTA is sticky at the bottom**
    - **Given** a detail screen taller than the viewport (375 × 667)
    - **Then** `Nhận lệnh vận chuyển` stays **pinned to the bottom** and
      visible at every scroll position, ≥ 48 px tall, respecting
      `env(safe-area-inset-bottom)`, and the page reserves bottom padding
      so the CTA never covers the last block's content.
    - **Case**: `TC-LX-NHANLENH-017`.
    - **Evidence**: screenshots at top / middle / bottom scroll positions.

11. **DRV-DET-11 — Cont/Seal photos carry a real capture timestamp**
    - **When** the driver uses `📷 Chụp ảnh Cont/Chì`
    - **Then** the camera opens directly (not only a gallery picker) and the
      stored image carries the **actual capture timestamp** — not the upload
      or review time — in `Asia/Ho_Chi_Minh`, within 1 minute of the device
      clock, and visible on playback.
    - **Case**: `TC-LX-NHANLENH-018`.

12. **DRV-DET-12 — Expense module stays hidden behind the feature flag**
    - **Then** neither the `Nhập chi phí lô hàng` form nor the
      `Báo cáo đổ dầu` form renders anywhere in the driver app this phase —
      no button, no menu entry, and no route reachable by typing the URL.
    - **But** the backend `trips` schema already carries the columns/relations
      for `Tiền nâng`, `Tiền hạ`, `Chi phí phát sinh`, `Tiền đường`,
      `Xăng dầu`, and `Hình ảnh biên lai`, ready for the next phase.
    - **Case**: `TC-LX-NHANLENH-019`.
    - **Evidence**: screenshots of all 4 tabs + `\d trips` schema dump.

13. **DRV-DET-13 — Ops step is bypassed this phase**
    - **Given** Điều vận has just assigned a plate
    - **Then** a push notification fires, the card lands in `Lệnh mới`, and
      the driver can tap `Nhận lệnh vận chuyển` **immediately** — no Ops
      confirmation gate in between. Tapping records the **trip-start
      timestamp** and moves the card to `Đã nhận`.
    - **Case**: `TC-LX-NHANLENH-020`.

### Test steps

1. Log in as `laixe`. Open a trip from `/my-trips`.
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

7. **DRV-POD-07 — Completion routes through e-POD, never around it**
   - **When** the driver taps `Hoàn tất lệnh vận chuyển` after dropping the
     container at the destination yard
   - **Then** the trip does **not** close; the app navigates straight to the
     e-POD upload screen and the trip stays in its running state until
     e-POD is done. Backing out returns to trip detail without leaving the
     trip in a half-closed state.
   - **Case**: `TC-LX-TIENDO-018`.

8. **DRV-POD-08 — Both photo slots are mandatory and gate the CTA**
   - **Then** the screen exposes exactly two upload areas —
     `Phiếu bãi / Phiếu hạ` and `Biên bản giao nhận` (the latter **must
     carry a stamp or signature**) — and `HOÀN THÀNH CHUYẾN` stays disabled
     until **both** uploads report **100 %**.
   - Calling the completion API directly with a missing photo is rejected
     server-side; there is no bypass.
   - **Case**: `TC-LX-TIENDO-019`.

9. **DRV-POD-09 — On-device compression before upload**
   - **Given** a ≥ 4 MB camera original
   - **Then** the bytes actually transmitted are **materially smaller** than
     the original (compression happens **on the phone**, before transfer),
     while the document text stays legible — compression must not destroy
     the evidence. A progress bar is shown; the upload completes in
     acceptable time on Slow 3G.
   - **Case**: `TC-LX-TIENDO-020`.
   - **Evidence**: original file size vs. request `Content-Length`.

10. **DRV-POD-10 — e-POD photos carry the real capture timestamp**
    - **Then** both images carry the **capture** time (not upload, not
      review), in `Asia/Ho_Chi_Minh`, within 1 minute of the device clock,
      readable both in the driver app and on the accountant's review screen.
    - **Case**: `TC-LX-TIENDO-021`.

11. **DRV-POD-11 — Completion moves the card to Lịch sử and syncs dispatch**
    - **When** `HOÀN THÀNH CHUYẾN` is tapped with both photos in place
    - **Then** the card leaves `Đã nhận`, appears under `Lịch sử`, never
      reappears in `Lệnh mới`, and the dispatcher dashboard reflects
      completion **without any manual action** on their side.
    - **Case**: `TC-LX-TIENDO-022`.

### Test steps

1. Log in as `laixe`. From a trip in `Đang chạy`, tap
   `Bước tiếp: e-POD` on the trip detail page.
2. Capture the e-POD screen.
3. Upload a 1 MB PDF for `Phiếu bãi`.
4. Optionally upload a 200 KB JPG for `Biên bản`.
5. Type a short note.
6. Tap `Gửi e-POD để duyệt`; capture the success toast.
7. (Conflict-recovery) Open the same trip from `admin`'s trip
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

1. Log in as `laixe` and confirm `/my-trips/two-orders` loads.
2. If the seed has no two-orders pair, create one via
   `dieuvan`/`admin` first, then re-test.

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

1. Log in as `laixe`. Open `/my-earnings`.
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

1. Log in as `laixe`. Open `/my-penalties`.
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

- **List screen not yet on spec (opened 2026-09-07)**: product confirmed the
  docx is authoritative — **one card per container**, sub-tabs
  `Lệnh mới` / `Đã nhận` / `Lịch sử`. `DriverTripsPage.tsx` still renders one
  card per trip with the old tab set, so `DRV-LIST-02` / `DRV-LIST-03` FAIL
  until the migration lands. Details and the field-by-field diff are in the
  *Migration gap* block under Flow 1.
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
