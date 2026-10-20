# Case 201026164000 — /shipments Table Row Height Uniformity (FB-043 Regression, Regression #33)

## 1. Context & Defect
- **Card:** `201026164000` (FB-043 regression, R26 Batch 6)
- **Route:** `/shipments` (CUS workspace table, `ShipmentsPage.tsx`, `CusShipmentRow.tsx`)
- **Reported behavior:** Rows on `/shipments` have uneven heights. Regular unassigned rows are ~75px (measured 76.6px), but rows with vehicle dispatch status in the LỊCH TRÌNH column ("Đã điều xe", "Đã phát lệnh cho tài xế") tower at ~90px–107.6px. In addition, rows with attention signals in Trạng thái wrap action buttons to a second line (86.0px).
- **Expected behavior (#33 / FB-043 contract):** All rows on `/shipments` must have uniform row height (spread <= 1.5px across all rendered rows).

## 2. Root Cause Analysis
1. In `CusShipmentRow.tsx`:
   - Both `<span>{vehicleReadinessLabel(item)}</span>` AND `<DispatchIssueStatusSummaryChip ... />` were rendered as sibling elements inside `.cus-inline-trigger` (`display: grid; gap: 3px`). When a shipment had plate assignment, it rendered two stacked status lines ("Đã điều xe" + "Đã điều xe", or "Đã điều xe" + "Đã phát lệnh cho tài xế").
   - Long appointment date strings and status text did not have `nowrap` + `ellipsis` on desktop table cells, allowing free line wrapping.
2. In `ShipmentsPage.css`:
   - `.cus-row-actions` in the Trạng thái column had `flex-wrap: wrap`, which caused the "Chi tiết" action button to wrap below the lifecycle badge and attention label when a warning signal was present.

## 3. Fix Applied
1. In `CusShipmentRow.tsx`:
   - Wrapped `vehicleReadinessLabel` and `DispatchIssueStatusSummaryChip` into a single flex container (`.cus-schedule-status-row`).
   - Deduplicated identical "Đã điều xe" text when all containers are plated and not issued so it is only displayed once.
2. In `ShipmentsPage.css`:
   - Enforced single-line nowrap ellipsis on all children of `.cus-inline-trigger` in the Lịch trình column on desktop tables (`@media (min-width: 1000px)`).
   - Enforced `flex-wrap: nowrap; justify-content: space-between;` on `.cus-row-actions` on desktop tables so action buttons never wrap below status signals.
3. Tests & QA:
   - Added `ShipmentsTableRowHeight.test.tsx` asserting DOM single status line contract, CSS nowrap/ellipsis contract, and uniform row heights with `getBoundingClientRect()`.
   - Captured browser BEFORE and AFTER screenshots and measurement JSONs under `qa/2026-10-20-fb043-row-height/`.

## 4. Verification Evidence
- **Before:** Min 76.6px, Max 107.6px, Spread 31.0px (FAIL > 1.5px).
- **After:** All 20 rows = 76.6px, Spread 0.0px (PASS <= 1.5px).
- **Gates:**
  - `pnpm lint`: 0 errors
  - `cd frontend && npx tsc -b`: 0 errors
  - `cd frontend && npx vitest run src/features/shipments/cus/ShipmentsTableRowHeight.test.tsx src/features/shipments/cus/CusShipmentRow.cus-cards.test.tsx src/pages/ShipmentsPage.density.test.ts src/pages/ShipmentsPage.test.tsx`: 4 files / 158 tests passed
