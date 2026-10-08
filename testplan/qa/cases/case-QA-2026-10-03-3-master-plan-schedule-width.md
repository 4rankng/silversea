# Case QA-2026-10-03-3 — Master-plan schedule column slimmed to 10% (card 20261003_303)

- **Case ID:** QA-2026-10-03-3
- **Reported:** 2026-10-03, PM directive: "reduce width of column Thời gian & lịch trình".
- **Surface:** /dispatch Kế hoạch Tổng quát — desktop table shape (container >900px).
- **Mutation surface:** none — read-only geometry assertions.
- **Status:** case PREPARED — fix landed (see card for sha); staging rung owed at wave cut.

## Steps

1. Login `dungnv`/Abc123 → /dispatch at 1440.
2. Column widths (measured): Thời gian & lịch trình 10% (~113px @1440), Ghi chú 14%,
   Phân bổ nhà xe 13%, Tổng quan hàng hóa 11% — the freed schedule width lands there.
3. Dates render on one line ("02/10/2026"); hour lines intact; "1 x 40DC" count strings
   unbroken (no-truncation doctrine — no ellipsis anywhere in the cell).
4. Repeat at 1280 / 1920 / 2560 — same allocation ratios, zero clipped leaves.
5. At 768 / 390 the container-record shape applies (colgroup hidden; §8 inline record);
   row height stays within the 305px budget.

## Expected

- The schedule column fits its content classes; freed width serves the starved columns;
  no mid-value wraps or clipping anywhere in the row.

## Sweep record

- DetailedPlanGrid `detailed-plan-grid__col--schedule` (13%): measured reserved 147px vs
  natural leaf max 112px at 1440 — content fits, NOT in the overwidth class; no change.
