# Case: SIL-849 (id 978) — /salary calendar trip-days + cost split disagree with /timesheet

- Case ID: SIL-849
- Reported: 17/11/2026 (board plan.tingting.vip/tingtingsoft/SIL id 978, build 8bbdfa05, role Accountant ngocntm, month 11/2026)
- Status: FIXED (this card)

## Reproduction (pre-fix)

1. /salary → driver Bùi Ngọc Long: detail 'Tiền chuyến (1 chuyến) 100.000 ₫' + 'Lương thực nhận
   100.000 ₫', but the month calendar has NO trip day — 1/11 shows 'Nghỉ tuần' — and the internal
   split says 'Lương chuyến (0 ngày) 0 ₫'. /timesheet shows Đ on Sun 2026-11-01, Chuyến 1;
   /timesheet/doi-chieu: ĐƠN 1, CHUYẾN 1, LƯƠNG 100.000 ₫.
2. /salary → driver Trần Trung Hiếu: 'Tiền chuyến (2 chuyến) 200.000 ₫' but the calendar paints 16
   green trip-days (1–15/11 'Chưa có số Bill/Booking – KCN Đồng Văn, Ninh Bình' + 17/11
   'R3K-J2 – KCN Quế Võ') and the split says 'Lương chuyến (16 ngày)'; /timesheet + /doi-chieu show
   only 1 Q entry = 2 chuyến.
3. Reload /salary and re-open Long: the 17/11 cell shows 'R3K-J2' on one load and 'Chờ việc' on the
   next; the same lot also appears on Hiếu's calendar.

Expected: the /salary calendar trip-days and the 'Lương chuyến (N ngày)' split agree with
/timesheet + /doi-chieu (Long: 1 trip-day on 1/11; Hiếu: trip-days for his 2 trips only); the same
driver/month renders the same calendar on every load. Pay figures unchanged (they already match
Đối chiếu).

## Root cause

Two parallel trip→day derivations:

- /timesheet + /doi-chieu + the pay figures read the chấm công board
  (`driver_timesheet_days`): symbols Đ/K/Q/L/N/P per calendar day (auto-symbols stamped on trip
  COMPLETION business date, SIL-737; `countDayTrips` weights Q = 2).
- The /salary calendar and `tripDays` (Lương chuyến N ngày) read the legacy `driver_work_days`
  rows that `syncTripWorkDays` stamps from a trip's DEPARTURE→ARRIVAL range on IN_TRANSIT /
  COMPLETED transitions. That source drifts: a multi-day run paints one trip across 15 days
  (Hiếu), a Sunday completion carries money but no board-confirmed row (Long), and reassigned
  trips leave orphan TRIP_DAY rows on the previous driver — the best-effort post-transaction
  resyncs (`dispatch-planning-commands.service`) then add/remove those rows outside any
  transaction, so cells flipped between loads (R3K-J2 on two drivers).

## Fix

The board is the single trip-day authority for /salary:

- `getBoardTripDays(driverId, start, end)` (`attendance-summary.service.ts`) — trip-carrying board
  days (Đ/K/Q, accountant's `tripAdjustment` included) over every calendar month the salary period
  touches.
- `mergeBoardTripDaysIntoWorkDays` (`salary-board-trip-days.service.ts`, pure) — calendar rows =
  board trip days over the accountant's manual rows: a board day wins (id/note survive); an
  unconfirmed legacy TRIP_DAY demotes to its attendance default (weekday STANDBY / Sunday
  WEEKLY_OFF); manual STANDBY/PERSONAL_LEAVE/WEEKLY_OFF rows pass through. Labels come from the
  driver's COMPLETED internal-fleet trips by SIL-683 business completion date
  (`getCompletedTripLabelByDay`) — the same day-rule the auto symbols use.
- `computeLiveSalary` (`salary-calculation.service.ts`) — `tripDays`/`totalTripSalary`/
  `standbyDays`/`supplementPay` (the Phân bổ chi phí block) derive from the board; the two split
  rows still sum to paidDays × dailyRate. `paidDays`/`adjustment`/`netSalary` stay on the
  attendance basis — pay figures untouched.
- Obsolete `getTripLabelsForWorkDays` (labels by legacy row tripIds) removed; no other consumers.

## Pins

- `backend/src/tests/salary-board-trip-days.service.test.ts` — bucket range (custom period crossing
  months), Đ/K/Q/L/N/P + adjustment weighting, board-wins / legacy-demote / Sunday-demote /
  manual-row passthrough merge rules.
