# Case QA-2026-10-03-7 — Quick assignment chips on Kế hoạch Chi tiết (card 20261002_274, A07)

- **Case ID:** QA-2026-10-03-7
- **Reported:** 2026-10-02, A07 (P3): quick Tất cả / Chưa gán xe / Đã gán xe filter on the dispatch detail plan.
- **Surface:** /dispatch-detail — the shared band's `quickFilters` slot (boxed Tabs, law §263), driving the same
  `assignmentStatus` state as the Điều xe select inside `Bộ lọc`.
- **Mutation surface:** none — filter clicks only.
- **Status:** case PREPARED — fix landed (see card for sha); UI DRIVEN local rung on the card; staging rung owed at wave cut.

## Steps

1. Login `dungnv`/Abc123 → /dispatch-detail at 1440.
2. The toolbar carries the boxed chip group "Lọc nhanh gán xe": Tất cả (active) | Chưa gán xe | Đã gán xe.
3. Click Chưa gán xe: only rows without a tractor plate remain (server-filtered via the existing
   `assignmentStatus` param); every rendered row's plate cell shows the placeholder.
4. Click Đã gán xe: only plated rows remain. Click Tất cả: the full list returns.
5. The Điều xe select inside `Bộ lọc` mirrors the chip state (open the dialog after clicking a chip).
6. At 768: the chips stay on the bar within the two-row budget.

## Expected

- Exact plate-semantics filtering per chip; the chips and the dialog select stay in sync; no new
  clipped/wrapped controls at any width.

## Local rung (2026-10-03)

- 39 rows → Chưa gán xe: 23 rows, 23 plate-less → Đã gán xe: 16 rows, 16 plated → Tất cả: 39.
- Screenshots on the card (1440 ×3 states + 768).
