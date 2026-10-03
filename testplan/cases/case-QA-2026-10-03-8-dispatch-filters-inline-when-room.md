# Case QA-2026-10-03-8 — Dispatch filters show on the bar when width allows (card 20261002_282, R17)

## Claim
On the two dispatch screens the basic criteria — dates, status (Phân xe /
Điều xe), direction (Xuất / Nhập) — sit directly on the filter bar while the
bar holds its two-row budget. Only the criteria that can never fit (one port
facet per dispatch zone, nhà xe, giờ chạy, điểm giao nhận, đội xe…) stay
behind `Bộ lọc`. When the width forces a fold, the basic criteria join the
dialog and the trigger badge counts every applied criterion.

## Reproduce (pre-fix defect)
1. Login `dieuvan` (Abc123) at http://localhost:7175, viewport 1440×900.
2. `/dispatch` (Kế hoạch tổng quát): the bar shows search, Từ/Đến, `Bộ lọc`
   and `Tạo lô hàng` on ONE line with ~300px of empty space between `Bộ lọc`
   and `Tạo lô hàng`. Xuất / Nhập and Phân xe are only inside `Bộ lọc`.
3. `/dispatch-detail` (Kế hoạch chi tiết): Xuất / Nhập is only inside
   `Bộ lọc` while row 2 of the bar has free space.

## Expected behavior
- 1440 and 1280: `/dispatch` bar shows `Xuất / Nhập: …` and `Phân xe: …`
  directly; `/dispatch-detail` shows `Xuất / Nhập: …` directly. Bar ≤ 2 rows.
- `Bộ lọc` remains for the zone facets / nhà xe (master) and the structured
  criteria (detail). Its badge counts only what is behind it while the basic
  criteria are on the bar; `Đặt lại` in the dialog clears only those.
- When the bar would need a third row, the basic criteria move into the
  dialog (one copy only), the badge counts them, and `Đặt lại` clears them.
- `/shipments` is unchanged (already inline at ≥1280, folded with count at
  1024/768/390).

## Automated pins
- `frontend/src/design-system/FilterBar.test.tsx` — `fold.primary` renders on
  the bar beside a `neverInline` trigger, joins the dialog when folded, badge
  arithmetic and reset scope.
- `frontend/src/features/dispatch/master-plan/MasterPlanFilters.test.tsx`
- `frontend/src/features/dispatch/detailed-plan/DetailedPlanFilters.test.tsx`
