# Case QA-2026-10-03-1 — Grid cell "Chi tiết" actions sit bottom-right (card 20261002_302)

- **Case ID:** QA-2026-10-03-1
- **Reported:** 2026-10-03, PM directive (screenshot on card 20261002_302).
- **Verbatim requirement:** *"chi tiet shoult be at bottom right of cell, not there, dont occupy text space"*.
- **Surface:** /dispatch Kế hoạch Tổng quát grid — the Tổng quan hàng hóa cell (containers "Chi tiết")
  and the Ghi chú cell (operational + factory note "Chi tiết").
- **Mutation surface:** none — read-only assertion of geometry; the modal opened from the trigger is
  closed with Hủy (non-mutating path).
- **Status:** case PREPARED — fix landed (see card for sha); UI DRIVEN rung on local dev captured on the
  card; staging rung owed at wave cut.

## Steps

1. Login `dungnv`/Abc123 → /dispatch (Kế hoạch Tổng quát), viewport 1440.
2. Find a row whose cargo cell carries the "Chi tiết" trigger: the summary lines
   (container types / weight) occupy the cell full-width; "Chi tiết" sits on its OWN
   right-aligned row at the bottom-right of the cell — never beside the summary text.
3. Find a row with a long operational or factory note (truncated + trigger): the note wraps
   full-width; "Chi tiết" sits bottom-right of the note line, on its own row.
4. Repeat at 1280 / 1920 / 2560 — same shape.
5. At 768: same shape (column rule governs ≥768).
6. At 390: the §8 phone record keeps its inline shape by design ("Hàng 1 x Container · 22 t ·
   Chi tiết" one line) — a budget-pinned exception, not a defect (law row 2026-10-03).

## Expected

- The note text wraps without the action stealing width; the action is reachable at the
  bottom-right; no clipped or overlapped text.

## Pass criteria

- Steps 2–5 hold; no horizontal overflow; phone (390) keeps the budget-pinned inline shape.
