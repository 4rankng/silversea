# Role: DRIVER — Lái xe

> Current acceptance baseline (2026-09-17): `docs/prd/ManHinhLaiXe.md` governs. Earlier trial restrictions and PASS records below are historical, not evidence for this checkout. Offline queues/replay and hiding all cost entry are retired. Existing AC IDs are retained with corrected expectations.

> Typography update (2026-09-14): earlier numeric font-size expectations in this document are superseded by `testplan/qa/2026-09-14_typography-coherence.md`: 12px body/data/controls/actions, 11px labels/captions, 14px section titles, 16px overlay titles, 18px page titles and 20px principal metrics. Other behavior and layout requirements remain unchanged. Historical measurements below are retained as evidence.


> **Vietnamese label**: Lái xe (`Role.DRIVER`).
> **Home route**: `/my-trips` (`routes.myTrips`).
> **Primary sidebar section**: `Công việc của tôi` (`my-work`).
> **Test accounts**: chọn theo môi trường qua `../testaccounts.txt` (role → username). Runner tự map `DRIVER` + env → username phù hợp. Biển số xe đi kèm mỗi driver xem trong `testaccounts.txt`.
> **Primary pages**:
> - `/my-trips` — `frontend/src/pages/DriverTripsPage.tsx` (Hành trình của tôi)
> - `/my-trips/:id` — `frontend/src/pages/DriverTripDetailPage.tsx` (chi tiết chuyến)
> - `/my-trips/:fulfillmentId/pod` — `frontend/src/pages/DriverTripPodPage.tsx` (e-POD)
> - `/my-trips/two-orders` — `frontend/src/pages/driver/DriverTwoOrdersPage.tsx`
> - `/my-earnings` — `frontend/src/pages/DriverEarningsPage.tsx` (Thu nhập)
> - `/my-payslips` — `frontend/src/pages/driver/DriverPayslipsPage.tsx`
> - `/my-penalties` — `frontend/src/pages/DriverPenaltyPage.tsx` (Kỷ luật)
>
> The driver app is a **PWA** (add-to-home-screen on iOS is the primary
> install path). iOS safe-area-inset, mobile tap targets ≥ 48 px, and
> truthful API failures are first-class concerns. Internet is required; no offline queue, automatic mutation replay, heartbeat or health preflight.
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
     - `Đã nhận` — accepted (ORDER_RECEIVED timestamp); acceptance does not assert physical departure.
     - `Lịch sử` — completed or cancelled.
   - The **bottom navigation keeps its existing 4 tabs** — none added or
     removed this phase.
   - Each sub-tab's count is shown in its label.
   - **Spec**: `ManHinhLaiXe.md` §1. **Case**: `TC-LX-NHANLENH-014`.

3. **DRV-LIST-03 — Trip card anatomy**
   - Factory short name (full-name fallback) is the primary identifier; route is secondary.
   - Time and date share a line; operation and uppercase tasks are distinct from driver notes.
   - FCL uses one fulfillment/container card with number and type; a missing number still shows the type. LCL does not invent container fields.
   - Pickup/drop ports remain readable; import drop port is the empty-return port, not the factory address. CTA reflects the actual new/accepted/history state.
   - Verify long data at 360/390/820/1440px without clipping or repeated decorative cards. Source: PRD §2.2.

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

7. **DRV-LIST-07 — Paired shipments render as an adjacent combo**
   - **Given** two shipments sharing a pair (`KẸP` or `KẾT HỢP`)
   - **Then** their two cards render **adjacent as one visual combo**,
     never split across the list, each carrying the shared tag.
   - For `KẾT HỢP`, the second card is **locked** until the first
     completes delivery; for `KẸP`, both run in parallel with no lock.
   - **Cases**: `TC-LX-NHANLENH-011`, `-012`, `TC-GHEP-009` … `-011`.

> ### Historical migration evidence — 2026-09-09, superseded by current PRD
>
> **Decision 2026-09-07: the docx is authoritative — one card per container.**
> The list-screen migration landed 2026-09-07; the 2026-09-09 docx audit
> (`2026.8.27_Man_hinh_lai_xe.docx` / [`ManHinhLaiXe.md`](../../docs/prd/ManHinhLaiXe.md)
> §1–§2.1) confirms the built screen matches the binding anatomy:
>
> | Item | Historical expectation (not current acceptance) | Evidence |
> |------|--------------------|----------|
> | Sub-tabs | `Lệnh mới` / `Đã nhận` / `Lịch sử` with per-tab counts | `DriverTripsPage.tsx` `TABS` + bucket counts; `DriverTripsPage.test.tsx` "shows the New Orders tab by default with tab counts" |
> | Card unit | 1 card per container | one card per driver-owned fulfillment = 1 container (`shipmentContainers` join); FE test "tags sibling linked cards with KẸP and groups them visually" (2 containers → 2 cards in one combo) |
> | Header | `[Tag: ĐƠN/KẸP/KẾT HỢP]` + `Giờ đóng / trả: HH:MM - DD/MM` | `tagLabelFor` + `Giờ đóng / trả:` label + `formatCardTime` `HH:MM - DD/MM`; anatomy unit test |
> | Body rows | `Nhà máy`↔`Cảng nâng`, `Tuyến đường`↔`Cảng hạ`, `Cont: [Số] - [Loại]` | card pair rows + container line; anatomy unit test |
> | Footer | `Xem chi tiết & Nhận lệnh`, no status pill | footer button test across all 3 tabs |
> | Kẹp/Kết hợp | 2 separate cards stuck adjacent, shared tag; KẾT HỢP 2nd card locked | `groupCards` pair/shipment grouping + `pairLocked` note; FE unit tests + backend `pair-ket-hop-gating.test.ts` (KET_HOP lock + KEP parallel) |
>
> Superseded criteria — kept only so the earlier behaviour is traceable, **not** for
> acceptance: the old `DRV-LIST-02` (Hôm nay/Đang chạy/Lịch sử tabs) and the old
> `DRV-LIST-03` (per-trip card with plate subtext per `0fcedcde` and status pill per
> `TRIP_STATUS_COLORS`, `shared/src/constants/index.ts`).
>
> The 48 px tap-target floor (`DRV-LIST-04`, `c9012bd0`) and the full-bleed rule
> (`DRV-LIST-01`, `0fcedcde`) **survived the migration and now bind the new card**:
> the footer opts up to 48 px on phones (≤640px `#root` opt-up, c9012bd0 idiom).

### Test steps

1. Log in as `DRIVER` on a 390 × 844 mobile viewport (Chrome dev-tools
   device emulation or a real iPhone via PWA install).
2. Walk through the three sub-tabs (`Lệnh mới` / `Đã nhận` / `Lịch sử`);
   capture each.
3. Count cards vs. containers on a multi-container shipment — they must
   match 1:1 (`DRV-LIST-03`).
4. Tap a card → confirm the full-screen detail opens with all 7 blocks
   (`DRV-DET-09`).

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

1. **DRV-DET-01 — Page identity and current work**
   - Show the assigned work's schedule, factory/address/contact, cargo, pickup/drop ports, tasks, driver notes and configured invoice details according to PRD §3.1.
   - Do not repeat tractor/trailer or route rows in the detail body. Core tasks/notes remain visible when optional details collapse.
   - Authorized drivers can enter shipment costs and road expenses for their own eligible trip; completion has no finance reconciliation gate. Fuel evidence remains distinct from a money transaction.
   - Evidence: actual detail and both expense groups, including an existing trip without shipment linkage.

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

3. **DRV-DET-03 — Accept (start) CTA**
   - **Given** the trip is in `Mới tạo`
   - **When** the user taps the sticky `Nhận lệnh vận chuyển` bar (spec
     §2.2 Khối 7; the old inline `Bắt đầu chuyến` CTA is superseded)
   - **Then** the trip status flips to `Đang chạy` (acceptance timestamp
     recorded via ORDER_RECEIVED → IN_TRANSIT; later transport milestones remain separate),
     an audit-log row is written, the page re-renders the new status
     color, and the footer CTA (`Hoàn tất lệnh vận chuyển` → e-POD
     screen) becomes available.

4. **DRV-DET-04 — "Bước tiếp: e-POD" navigates to the e-POD screen**
   - **Given** the trip is in `Đang chạy` and is otherwise eligible
     for completion
   - **When** the user taps `Bước tiếp: e-POD`
   - **Then** the route changes to `/my-trips/:fulfillmentId/pod`. The
     navigation is a hard client-side push (back button returns to
     `/my-trips/:id`).
   - **Reference**: per Phần 4 ticket 2026-08-28, e-POD lives on its
     own screen.

5. **DRV-DET-05 — e-POD "bắt buộc" label is shown once**
   - **Then** the page shows exactly one label `e-POD bắt buộc`
     (per `4504399e` — the duplicate label was dropped). The
     visibility state of the e-POD CTA is the **only** signal
     gating trip completion.

6. **DRV-DET-06 — Completion CTA copy across the two-CTA flow**
   - **Then** the trip detail footer CTA reads `Hoàn tất lệnh vận chuyển`
     and navigates to the e-POD screen (`/my-trips/:fulfillmentId/pod`); the uppercase
     `HOÀN THÀNH CHUYẾN` literal lives only on the e-POD screen and gates
     on both mandatory photos. Supersedes the r4 mixed-case override
     (`Hoàn thành chuyến`) — the docx-authoritative flow puts accept on the
     detail screen and completion on the e-POD screen.
   - **Evidence**: `textContent` of the detail footer button matches
     `Hoàn tất lệnh vận chuyển`; the e-POD footer button reads
     `HOÀN THÀNH CHUYẾN` (locked by `DriverTripPodPage.test.tsx`).

7. **DRV-DET-07 — API failure and explicit retry**
   - A business request may fail normally when the API is unavailable. Show the actual failure and retain unsent form values/files in the current screen.
   - Busy state prevents duplicate clicks; only an explicit retry resends. No IndexedDB queue, background replay, heartbeat or health-check prerequisite.
   - Restoring connectivity alone produces zero mutation requests. Warn before discarding unsent work.

8. **DRV-DET-08 — Authenticated evidence remains viewable**
   - Saved fuel/container/e-POD images must load and open through the existing authorized evidence client; do not prescribe JWT query-string URLs.
   - Driver ownership applies to direct file URLs as well as the UI. A failed image read gives recoverable feedback, never a broken image presented as success.
   - Evidence: normal authorized image GET200 and denied other-driver request, with secrets excluded from artifacts.

9. **DRV-DET-09 — Detail information hierarchy**
   - Follow the current PRD §3.1: schedule, full factory identity/address and grouped warehouse contact/phone; cargo and ports; uppercase task tags separated from driver notes; invoice groups and site rules.
   - No duplicated tractor/trailer, route, warehouse-phone or empty-return-port rows. Missing source data is explicit, never `null`/`undefined`.
   - Verify tap-to-call, long values, collapse behavior and the final action remaining reachable. Case: TC-LX-NHANLENH-016.

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
      clock, and visible on playback. Gallery/file input with unknown capture time stays unknown; never substitute upload time.
    - **Case**: `TC-LX-NHANLENH-018`.

12. **DRV-DET-12 — Driver costs are available with correct scope**
   - Both shipment cost and road expense groups are available on the driver's own eligible trip, including pre-existing trips without a shipment link.
   - Apply AC-CP-LX-01..10: distinguish invoiced customer-recoverable costs from company costs; preserve person owed, real amounts, source linkage and idempotency.
   - Driver cannot set customer actual charge or payment; do not create fake trips or automatically apply suggested rates. Case: TC-LX-NHANLENH-019.

13. **DRV-DET-13 — Ops step is bypassed this phase**
    - **Given** Điều vận has just assigned a plate
    - **Then** a push notification fires, the card lands in `Lệnh mới`, and
      the driver can tap `Nhận lệnh vận chuyển` **immediately** — no Ops
      confirmation gate in between. Tapping records the **acceptance
      timestamp** and moves the card to `Đã nhận`.
    - **Case**: `TC-LX-NHANLENH-020`.

### Test steps

1. Log in as `DRIVER`. Open a trip from `/my-trips`.
2. Capture the trip detail page.
3. Tap container / seal capture 3× to verify the no-dead-end rule.
4. Tap `Bắt đầu chuyến` and capture the new state.
5. Tap `Bước tiếp: e-POD` and confirm navigation.
6. Fail the business API request; capture the actual error and retained input. Restore connectivity and verify no automatic mutation, then retry explicitly.

### Regression hooks

- `frontend/src/pages/DriverTripDetailPage.test.tsx` and
  `DriverTripDetailPage.shipmentCostEntry.test.tsx`.
- Verify no offline queue/replay or connectivity preflight is registered; installed shell behavior must not imply offline business capability.

---

## Flow 3 — e-POD (Electronic proof of delivery)

**Route**: `/my-trips/:fulfillmentId/pod`
**Component**: `frontend/src/pages/DriverTripPodPage.tsx`
**Allow**: `DRIVER` only (`driverOnly` per `App.tsx:353`).
**Pre-conditions**: the trip is in `Đang chạy`; the driver is the
owner.

### Acceptance criteria

1. **DRV-POD-01 — Page anatomy**
   - **Then** the page shows these sections in order:
     1. Trip identity header (mã chuyến + status pill).
     2. Operational note from CUS / điều vận (when present) — spec A3.
     3. The e-POD card (`TripPodSubmission`): `e-POD bắt buộc` eyebrow, the
        two **mandatory** upload areas — `Phiếu bãi / Phiếu hạ` and
        `Biên bản giao nhận` (must carry stamp / signature) — each slot
        with its own upload control, the `Tải tệp` button for extra
        attachments, and the shared progress bar showing
        saved-category readiness (`X%`). Network byte progress alone never makes evidence ready.
     4. Footer: `HOÀN THÀNH CHUYẾN` — the single completion action; it
        submits the open e-POD draft then completes the trip, and the
        missing-photo gaps are listed above the button until both are in.
   - The old "Biên bản (incident report, optional)" reading and the
     standalone `Gửi e-POD để duyệt` submit section are superseded by the
     mandatory-both + fused completion flow (DRV-POD-08 is the gate).

2. **DRV-POD-02 — Single pod-readiness gate**
   - **Then** the submit button is enabled **iff** the trip's
     pod-readiness check passes (per `767a0864` — the single gate).
     The duplicate "e-POD bắt buộc" label from the old gate is
     gone; the only signal is the submit button's disabled state.

3. **DRV-POD-03 — Completion submits the e-POD then closes the trip**
   - **When** `HOÀN THÀNH CHUYẾN` is tapped with both mandatory photos in
     place and a `DRAFT` submission open
   - **Then** the success message confirms the evidence was saved and the trip
     completes and navigates back to `/my-trips` (the card moves to
     `Lịch sử`); if the submission fails (offline, conflict, rejected)
     completion is aborted — the server's evidence gate rejects an
     incomplete e-POD anyway, so there is no bypass.

4. **DRV-POD-04 — Stale state / reassignment recovery**
   - If another authorized user changes version, locks or reassigns work, a stale mutation is rejected clearly.
   - Keep unsent evidence visible; no background replay or silent discard. Refresh authoritative state explicitly; do not retry a command no longer allowed for this driver.
   - Evidence: controlled conflict and real ownership/version service tests, separately identified.

5. **DRV-POD-05 — File failure preserves input and saved evidence**
   - Failed files remain in their category with filename, explicit retry and discard. Successfully stored files remain viewable and are not uploaded again.
   - Retry uses the same prepared bytes/capture instant and idempotency identity; reconnect alone sends nothing.
   - Upload/submit failure leaves completion blocked until both required categories are saved. UI-DC-22/23 cover regressions.

6. **DRV-POD-06 — File and camera input**
   - File picker accepts supported image/PDF files and renders each successfully saved file as readable thumbnail or download entry.
   - Camera and gallery paths remain distinct: only known shutter time is labeled capture time. Gallery without capture metadata stays unknown; upload time may be shown as upload time.
   - File rejection is specific and recoverable, with no invented saved state.

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
     until **both categories are saved and openable**, not merely 100% byte progress.
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
      readable in the driver and accounting evidence views. Gallery files with unknown capture time must not be stamped with selection/upload time.
    - **Case**: `TC-LX-TIENDO-021`.

11. **DRV-POD-11 — Completion moves the card to Lịch sử and syncs dispatch**
    - **When** `HOÀN THÀNH CHUYẾN` is tapped with both photos in place
    - **Then** the card leaves `Đã nhận`, appears under `Lịch sử`, never
      reappears in `Lệnh mới`, and the dispatcher dashboard reflects
      completion **without any manual action** on their side.
    - **Case**: `TC-LX-TIENDO-022`.

### Test steps

1. Log in as `DRIVER`. From a trip in `Đang chạy`, tap
   `Bước tiếp: e-POD` on the trip detail page.
2. Capture the e-POD screen.
3. Upload a 1 MB PDF for `Phiếu bãi`.
4. Upload the required 200 KB JPG for `Biên bản giao nhận`.
5. Type a short note.
6. Tap `HOÀN THÀNH CHUYẾN`; capture the success message and completed trip.
   Verify no approval label or intermediate approval state.
7. (Conflict-recovery) Open the same trip from `ADMIN`'s trip
   detail, change a field, go offline on the driver app, mutate
   the same field, come back online; capture the banner.

### Regression hooks

- `frontend/src/pages/DriverTripPodPage.test.tsx` stays green.
- The deployed bundle for the e-POD page contains `Phiếu bãi`,
  `Biên bản`, `Tải tệp`, a truthful saved/completed message (no approval wording),
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
2. **DRV-2X-02 — Paired costs keep a single source**
   - Each job links to its existing cost surface. Shared paired costs are counted once, not multiplied by cards or containers.
   - No duplicate-entry form or extra finance gate is introduced on the two-orders view. Source: AC-CP-LX-07.

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

1. **DRV-EARN-01 — Truthful earnings breakdown**
   - Current period shows the authoritative agreed salary/allowance/production amounts, deductions, total, paid and remaining where supplied.
   - Distinguish tentative, closed and paid; never infer payment from closing or invent commission formulas.
   - Known zero displays 0 ₫; unavailable amounts remain unknown with error/retry. Currency does not animate through fictitious balances. UI-DC-11/12/20.

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
     is purely informational; `/my-payslips` (Flow 6) displays issued payroll and actual payment history; it does not pay money.

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

## Flow 8 — Online-only failures and safe-area handling

Existing DRV-OFF identifiers remain for traceability; they no longer require offline operation.

1. **DRV-OFF-01 — No connectivity prerequisite**
   - Invoke the normal business API directly. No heartbeat, health endpoint or offline service-worker command queue gates the action.
2. **DRV-OFF-02 — Truthful read failure**
   - Failed list/detail reads show an error and explicit retry, not fabricated empty work or zero money. Previously loaded data must not be advertised as freshly synchronized.
3. **DRV-OFF-03 — Retained input, manual retry**
   - Failed writes keep form values and selected evidence in the mounted screen. Reconnecting sends no mutation. Explicit retry uses the original command/file identity and cannot duplicate saved data. Warn before discarding unsent work.
4. **DRV-OFF-04 — Safe-area and action clearance**
   - Bottom navigation and final actions respect safe-area insets. At maximum scroll, every action is wholly above the nav and its center hits the real button; 360/390/820/1440px browser checks plus separate physical-device checks.

### Test steps

1. Hold/fail a real read, then retry explicitly. Record controlled failure separately from normal API evidence.
2. Fail a write/upload, inspect retained data; restore connectivity without clicking and assert zero replay.
3. Retry manually; verify one source record and readable saved evidence. Test cancel/back warning and physical safe-area separately.

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

## Historical evidence and current execution gaps

The 2026-09-09 card migration and trial-era r6 observations remain historical evidence only. The old no-cost-form restriction and offline conflict queue have been retired by the current PRD. Do not treat those old PASS statements as proof of the current branch.

Use actual clicks after scrolling the target into view; never bypass a covering overlay with a DOM `el.click()` and call the interaction PASS. Current executed coverage, failed cases and physical-device gaps are recorded in `plans/260917-ui-audit/reports/driver-customer.md` and `testplan/2026-09-17-ui-audit-driver-customer.md`.
