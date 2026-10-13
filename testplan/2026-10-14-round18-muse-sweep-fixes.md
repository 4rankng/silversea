# Round 18 — Muse Round-17 sweep fixes (4 findings)

Ngày: 2026-10-14 · branch `fix/round18-wave` (cut from main 5ef12393)

## Case 1 — ticket 141026001010 (P3): dispatch table uneven row heights

- Case ID: 2026-10-14-R18-01-dispatch-row-heights
- Reported: Muse Round-17 full sweep (staging) — the dispatch/schedule table
  regressed to UNEVEN ROW HEIGHTS. Hint: container-query or row-padding
  regression from the recent create-page/dispatch layout waves.
- Repro: `/dispatch` (master plan) and `/dispatch-detail` — visually compare
  same-shape rows; some rows render taller than peers without a content
  reason.
- Expected: rows whose cells carry the same number of content lines share one
  height; padding is uniform across the row's cells.

## Case 2 — FB-002: Enter-to-save regression (shipments/lot editing)

- Case ID: 2026-10-14-R18-02-enter-to-save
- Reported: pressing Enter in an edit field no longer saves, in the
  "Chi tiết lô hàng" documents editor / quick-edit dialogs context.
- Verified ground truth (probe, this branch):
  - `/shipments-detail` InlineEditor (documents, tờ khai): Enter-to-save
    WORKS — probe `__probe-enter.test.tsx` passed pre-fix; the regression is
    NOT there.
  - `/shipments` CUS quick-edit modal: Enter is DEAD. The `<form>` has NO
    submit button inside it (the Lưu button lives in the Modal footer outside
    the form), so HTML implicit submission only fires for a single-field mode
    (identity); documents (Bill + tờ khai rows), cargo (4 fields) and
    classification (2 fields) never submit on Enter. Notes moved from a
    single-line input ("Shift+Enter để xuống dòng" — Enter saved) to
    textareas with no save combo at all.
- Expected: Enter saves in single-line quick-edit fields (reuse the form's
  submit path so validation still runs); Shift+Enter inserts a newline where
  multiline exists; textareas save via Ctrl/Cmd+Enter with bare Enter as
  newline; Escape still closes; focus returns to the trigger cell.

## Case 3 — overlap guard warning missing (P3)

- Case ID: 2026-10-14-R18-03-overlap-warning
- Reported: the schedule/driver overlap guard previously blocked conflicting
  assignments; it now silently allows them. Restore a NON-BLOCKING warning.
- Investigation: the FB-038 warn-once family
  (`assertPlanRowRigAvailable`, `assertResourceAvailability`,
  `assertTripRigAvailable`) covers plan-save, issue/reassign and trip
  form paths. Gap found: the direct trip-create path (`POST /trips`) only
  runs the guard when the create payload carries a `plannedStartAt`
  timestamp; a date-only `departureDate` create on a truck whose LOT-LEVEL
  plan rows (pre-dispatch, cross-lot) hold the same rig saves with no
  warning — the driver-side guard `assertTripRigAvailable` is NOT wired into
  the plain createTrip path at all (only pre-departure/actuals PUTs).
- Expected: a same-rig overlap detected at trip create warns once
  (non-blocking, confirm proceeds), matching the family contract; no new
  hard block on weak evidence.

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
    (`DriverTripsPage.tsx`) labels its time chip "Giờ đóng / trả:" — the
    container-appointment vocabulary ("Giờ hẹn đóng/trả" = customerAppointmentAt
    per the CUS ledger) — but binds `card.scheduledAt` =
    `trips.plannedStartAt`, which every other surface calls "Giờ chạy"
    (dispatch editor vocabulary; the driver detail page renders the same
    field as "Ngày giờ kế hoạch"). A driver reading "Giờ đóng / trả: 14:30"
    is told the container closes/returns at 14:30 when 14:30 is the planned
    run start.
- Expected: the chip names what it renders (Giờ chạy), no binding change.

## Gates

Root lint 0 · BE tsc 0 · FE tsc 0 · scoped suites green. Evidence under
`qa/2026-10-14_round18_*`.
