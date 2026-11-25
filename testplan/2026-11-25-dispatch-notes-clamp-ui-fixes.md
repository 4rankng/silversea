# 2026-11-25 — Dispatch Table Notes Clamp & UI Deficiencies Fix

## Source
Owner visual review screenshot (2026-11-25) on `/dispatch` (`Kế hoạch Tổng quát`) and sibling `/dispatch-detail` (`Kế hoạch Chi tiết Xe`).

## Cases

### TC-DISPATCH-NOTES-01 — Long notes clamp to 2 lines with `Chi tiết` modal trigger (`/dispatch` & `/dispatch-detail`)
- **Precondition:** Shipment lot has a multi-paragraph `factoryNotes` (`NM:`), `opsRecoveryNotes` (`OPS:`), or `operationalNotes` (>60 chars or multi-line).
- **Steps:**
  1. Open `/dispatch` (`Kế hoạch Tổng quát`) and `/dispatch-detail` (`Kế hoạch Chi tiết Xe`).
  2. Inspect the `Ghi chú` column for rows with long notes.
  3. Click the `Chi tiết` button under the clamped note.
- **Expected:**
  - Note text clamps to 2 lines (`.master-plan-grid__note-preview` / `.detailed-plan-grid__note-preview` / `.dispatch-driver-note--compact .dispatch-driver-note__text`) so row height stays compact.
  - A compact `Chi tiết` button appears under each long note and opens the full note modal (with Copy + Edit for editable operational notes).

### TC-DISPATCH-NOTES-02 — `Thêm ghi chú` action styling & placement (`/dispatch`)
- **Steps:** Inspect a row on `/dispatch` where `operationalNotes` is empty and `OPS:`/`NM:` notes exist.
- **Expected:** `Thêm ghi chú` renders below existing notes with distinct action link styling (`.master-plan-grid__notes-add-trigger`), not indistinguishable plain grey text above notes.

### TC-DISPATCH-NOTES-03 — Scoped container detail link (`/dispatch`)
- **Steps:** Inspect an FCL row on `/dispatch`.
- **Expected:** Container detail trigger reads `Chi tiết cont` and aligns left beneath the cargo summary instead of floating orphaned on the bottom-right.

### TC-DISPATCH-NOTES-04 — Sticky table header on desktop scroll (`/dispatch`)
- **Steps:** Scroll down `/dispatch` at `≥1360px`.
- **Expected:** `thead th` stays sticky under the topbar (`top: var(--topbar-h, 56px)`) with a single document scrollbar (no nested vertical scrollbar).

### TC-DISPATCH-NOTES-05 — LCL package count displays unit when `packageType` is empty (`/dispatch` & `/dispatch-detail`)
- **Steps:** Inspect an LCL row with `packageCount = 5` and `packageType = null`.
- **Expected:** Cargo line displays `5 kiện` instead of bare `5`.
