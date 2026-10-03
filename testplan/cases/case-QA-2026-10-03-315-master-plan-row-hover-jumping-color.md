# Case QA-2026-10-03-315 — Master-plan and detailed-plan row hover color stability (card 20261003_315)

## Claim
Hovering a row on dispatch grids (`/dispatch` MasterPlanGrid and `/dispatch-detail` DetailedPlanGrid) renders ONE uniform, stable hover background across the entire row width.
1. No per-cell tone changes or two-tone jump when pointer moves between cells (eliminated accent hover tint on allocation cell/trigger).
2. Cells directly paint the row-hover tint so the table-wide `tbody tr:hover td` wash and cell boundaries never create a tone fracture.
3. Background transition is disabled (`transition: none !important;`) on row and cells so moving the mouse across cells never re-triggers transition animations or causes flicker.

## Reproduce (pre-fix defect)
1. Open `/dispatch` (Kế hoạch Tổng quát) on desktop (1280×800 or 1440×900) with hover-capable pointer.
2. Hover over a dispatch row: row gets light gray hover tint `color-mix(in srgb, var(--fg-1) 2%, var(--surface))`.
3. Move pointer across the row into the "Phân bổ nhà xe" column (cell 7):
   - `.master-plan-grid__cell--action:hover` and `.master-plan-grid__allocation-trigger:hover` paint an emerald green tint `color-mix(in srgb, var(--accent) 6%, transparent)` over that cell alone.
   - The cell jumps from neutral gray to green.
   - Moving the pointer out of cell 7 into cell 8 ("Ghi chú") causes the cell to jump back to gray with a 150ms transition.
   - Result: very irritating jumping/flickering color as pointer moves across the row.

## Expected behavior
1. When hovering any part of the row, all cells across the full row width share the EXACT same neutral hover tint `color-mix(in srgb, var(--fg-1) 2%, var(--surface))`.
2. Moving the mouse between cells (including over the allocation cell and its trigger) maintains the uniform tint with zero color change.
3. No transition delay or flicker retrigger occurs when crossing cell boundaries.
4. Sibling grid `/dispatch-detail` (DetailedPlanGrid) also paints uniform cell hover tint with `transition: none !important;`.

## Automated pins
- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.row-hover.styles.test.ts`:
  - `MasterPlanGrid paints uniform cell hover background across all cells` (PASS)
  - `MasterPlanGrid disables background transition on row and cells to eliminate hover retrigger flicker` (PASS)
  - `MasterPlanGrid does not paint accent hover background on cell--action or allocation trigger` (PASS)
  - `DetailedPlanGrid paints uniform cell hover background across all cells` (PASS)
  - `DetailedPlanGrid disables background transition on row and cells to eliminate hover retrigger flicker` (PASS)
- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.cellactions.styles.test.ts` (4/4 PASS)
- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.test.tsx` (44/44 PASS)
- `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx` (62/62 PASS)
