# Round 18 — Muse Round-17 sweep fixes (4 findings)

Ngày: 2026-10-14 · branch `fix/round18-wave` (cut from main 5ef12393)

## Case 2 — FB-002: Enter-to-save regression (shipments/lot editing)

- Case ID: 2026-10-14-R18-02-enter-to-save
- Reported: pressing Enter in an edit field no longer saves, in the
  "Chi tiết lô hàng" documents editor / quick-edit dialogs context.
- Verified ground truth (probe, this branch):
  - `/shipments-detail` InlineEditor (documents, tờ khai): Enter-to-save
    WORKS — probe passed pre-fix; the regression is NOT there.
  - `/shipments` CUS quick-edit modal: Enter was DEAD. The `<form>` has NO
    submit button inside it (the Lưu button lives in the Modal footer outside
    the form), so HTML implicit submission only fires for a single-field mode
    (identity); documents (Bill + tờ khai rows), cargo (4 fields) and
    classification (2 fields) never submit on Enter. Notes moved from a
    single-line input ("Shift+Enter để xuống dòng" — Enter saved) to
    textareas with no save combo at all.
- Fix: the form answers Enter itself through the footer button's submit path
  (requestSubmit keeps validation); Shift+Enter stays inert in single-line
  fields; textareas keep bare Enter as newline and save via Ctrl/Cmd+Enter
  (help copy names the combo).
- Status: FIXED — pins in ShipmentsPage.test.tsx (2 new tests, 135/135); UI
  driven as cus on /shipments (`qa/2026-10-14_round18_fix2_ui-*`: toast +
  Bill persisted after reload).

## Case 1 — ticket 141026001010 (P3): dispatch table uneven row heights

- Case ID: 2026-10-14-R18-01-dispatch-row-heights
- Root cause (live-measured): card 091026091550's one-line-header rebalance
  cut `/dispatch-detail`'s Điều phối column 12% → 7.5% (~85px at the 1129px
  table): every plate·driver pair and the action row wrapped onto extra
  lines — assigned rows 164–198px beside 97px unassigned (the R22
  compact-row contract regressed). The same commit under-fed the schedule
  and route sort-button headers by 4–5px at the 1144 canvas.
- Fix: colgroup rebalanced with measured floors (assignment 12%, schedule
  17%, route 17.5%, notes 10.25%); live after: rows 81–117px, vehicle group
  one line, zero wrapped headers at 1144/1280/1440.
- Status: FIXED — new `DetailedPlanGrid.rowheights.styles.test.ts` +
  updated column-shares pin; dispatch detail-plan suites 27 files / 314
  tests pass. Evidence `qa/2026-10-14_round18_fix1_evidence.md`.

## Case 3 — overlap guard warning missing (P3)

- Case ID: 2026-10-14-R18-03-overlap-warning
- Reported: the schedule/driver overlap guard previously blocked conflicting
  assignments; it now silently allows them. Restore a NON-BLOCKING warning.
- Verified root cause (empirical probe `qa/drivers/round18-fix3-probe.mjs`):
  `assertTripRigAvailable` scanned the tractor's PLATE only — the SAME driver
  double-booked across two DIFFERENT tractors saved SILENTLY (201) on the
  direct trip create/edit path. Plate conflicts already warned
  (RIG_OVERLAP_COMPLETED family); driver conflicts were invisible.
- Fix: driverId claim scan at the warn tier inside `assertTripRigAvailable`
  (409 RIG_OVERLAP_COMPLETED + confirmOverlap retry; no new hard block);
  callers trip-create + trip-figure-updates wired. FE confirm plumbing
  already rides the family payload (ticket 111026105630). Review follow-up:
  the legacy reassignTrip fallback (no resolvable fulfillment/staged times)
  joins the same guard, and COMPLETED driver holders require a provable
  window like the completed-plate scan.
- Status: FIXED — backend unit pins in trip-overlap-warning.test.ts (5 driver
  cases incl. the fallback path + legacy-completed control), live API
  after-probe in `qa/2026-10-14_round18_fix3_evidence.md`.

## Case 4 — mislabeled time column (investigate)

- Case ID: 2026-10-14-R18-04-time-label
- Reported: possible mislabeled time column in the trips/dispatch view
  (candidates 'Giờ nhận xe'/'Giờ trả xe', or delivery-date related after the
  'Ngày giao dự kiến' → 'Ngày giao hàng' rename).
- Verified against the data:
  - 'Giờ nhận xe'/'Giờ trả xe' do not exist anywhere in the frontend.
  - The rename sweep left no stale label on dispatch grids (master-plan
    schedule blocks and the detail-plan schedule cell bind appointment /
    staged-end dates with matching copy).
  - REAL mislabel found: the driver journey card header
    (`DriverTripsPage.tsx`) labeled its time chip "Giờ đóng / trả:" — the
    container-appointment vocabulary ("Giờ hẹn đóng/trả" = customerAppointmentAt
    per the CUS ledger) — but binds `card.scheduledAt` =
    `trips.plannedStartAt`, which every other surface calls "Giờ chạy"
    (dispatch editor vocabulary; the driver detail page renders the same
    field as "Ngày giờ kế hoạch"). A driver reading "Giờ đóng / trả: 14:30"
    is told the container closes/returns at 14:30 when 14:30 is the planned
    run start.
- Fix: label-only ("Giờ chạy:"), binding unchanged.
- Status: FIXED — pin updated in DriverTripsPage.test.tsx (40/40), UI driven
  as dvthuc on /my-trips at 390 (`qa/2026-10-14_round18_fix4_ui-*`).

## Gates

Root lint 0 · BE tsc 0 · FE tsc 0 · scoped suites green. Evidence under
`qa/2026-10-14_round18_*`.
