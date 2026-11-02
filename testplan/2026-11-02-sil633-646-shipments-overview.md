# SIL-633 (id 737) + SIL-646 (id 751) — /shipments Overview: Card Typography + Row Height Clipping

## Scope & Tickets
- **SIL-646 (id 751)**: `/shipments` overview TABLE (desktop `≥1000px`). QA reported:
  1. Second line of multiple cells cut horizontally at bottom edge ("Nhập lẻ", "0,1 tấn · 0,1 CBM", "Đã điều xe", "Chờ đối soát").
  2. With no filter, third line ("Chi tiết" in Trạng thái) sticking out below row's bottom edge.
  3. Status cell measured `scrollWidth: 254 > clientWidth: 140` in every row.
- **SIL-633 (id 737)**: `/shipments` (Tổng quan lô hàng) shipment CARD in results list (`≤999px`). Owner reported:
  Card typography scale and component sizes drifted from house standard (eyebrows, empty notes touch floor, button size, cell padding).

## Root Cause Analysis

### SIL-646 (Desktop Table Row Height & Status Cell Overflow)
1. **User Agent Content-Box Leak on Triggers**:
   `.cus-dashboard-cell--editable` and `.cus-dashboard-cell--readonly` set `padding: 0;` on `td`, and delegate sizing to `div.cus-inline-trigger` / `button.cus-inline-trigger`. `div` default box-sizing in browsers is `content-box`. With `padding: 10px; border: 1px`, `div.cus-inline-trigger` computed 22px wider and 22px taller than its parent `td`, spilling out beyond the bottom and right edges of the table cell.
   *Fix*: Enforced `box-sizing: border-box;` on `.cus-dashboard-table, .cus-dashboard-table *, .cus-dashboard-table *::before, .cus-dashboard-table *::after`.
2. **Rigid Height on Status Actions**:
   In `@media (min-width: 1000px)`, `.cus-dashboard-table .cus-row-actions` had rigid `height: 100%`. When the status cell had 3 items (WorkflowBadge, primarySignal, and Chi tiết link button with `margin-top: auto`), it was constrained to the height of the row dictated by other cells. When other cells had only 1-2 lines, the 3rd line ("Chi tiết") was pushed past the bottom edge of the row.
   *Fix*: Changed `.cus-row-actions` to `min-height: 100%; height: auto; width: 100%;`, allowing intrinsic vertical growth to contain all items without clipping.
3. **Status Signal Truncation & Horizontal Overflow**:
   `.cus-dashboard-table .cus-row-actions__signal` carried `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`. This violated the NO TRUNCATE doctrine and caused the signal text to measure `scrollWidth: 254 > clientWidth: 140` (114px horizontal overflow).
   *Fix*: Replaced with `white-space: normal; overflow-wrap: anywhere; word-break: break-word; overflow: visible; text-overflow: clip; min-width: 0; max-width: 100%;`, and added `min-width: 0; overflow-wrap: anywhere; word-break: break-word;` to `td[data-label='Trạng thái']`.

### SIL-633 (Card Typography Scale & Component Sizes)
1. **Fact Eyebrows**:
   Previously in commit `5886f5c8` and `33a15ba5`, fact eyebrows were aligned with the shared `record-table` card band (`record-table.css ::before`): 11px token (`var(--text-label-size)`), 700 bold, UPPERCASE, tracked 0.04em, line-height `var(--ops-table-header-line-height, 1.35)`.
2. **Detail Action Geometry**:
   Page-owned height/font overrides on `.cus-dashboard-detail` (34px, 32px, 24px, 11px font) were retired, restoring the shared UUI sm button behavior: compactActionText 12px, 44px touch floor on narrow screens (`max-md:min-h-11`).
3. **Empty Notes Touch Floor Drift**:
   In `ShipmentsPage.css`, `.cus-dashboard-table .cus-dashboard-cell--empty-notes .cus-inline-trigger` had `min-height: 32px;`. This drifted below the 44px mobile touch floor (`--control-touch-h`).
   *Fix*: Updated to `min-height: var(--control-touch-h, 40px);`.
4. **Card Padding Alignment**:
   `td[data-label='Trạng thái']` on the card was inheriting `padding: 4px 8px;`, while editable cells were inset by `5px 10px;`.
   *Fix*: Set `padding: 5px 10px;` on `td:last-child` so the entire card column edge aligns consistently.

## Design-Language Sources Consulted
- **Untitled UI PRO**: Button component `size="sm"`, `color="link-color"`. CompactActionText 12px (`--text-control-compact-size`), `max-md:min-h-11` (44px touch floor on phone viewports).
- **House Design System (`docs/design-system/`, `docs/design-guidelines.md`)**:
  - NO TRUNCATE: `white-space: normal; overflow-wrap: anywhere; word-break: break-word;`.
  - Mobile touch floor: `--control-touch-h: 44px;`.
  - Operational table typography: `--ops-table-header-line-height: 1.35;`, `--ops-table-primary-size: 12px;`, `--ops-table-supporting-size: 11px;`.
  - Shared card pattern (`record-table.css`): 11px bold uppercase tracked fact labels.

## What Changed, Per File

### `frontend/src/pages/ShipmentsPage.css`
- Added `box-sizing: border-box;` to `.cus-dashboard-table, .cus-dashboard-table *, .cus-dashboard-table *::before, .cus-dashboard-table *::after`.
- Updated `.cus-dashboard-cell--editable > .cus-inline-trigger, .cus-dashboard-cell--readonly > .cus-inline-trigger`: aligned padding to `6px 10px` with `height: 100%; min-height: 100%;`.
- Updated `.cus-dashboard-table td[data-label='Trạng thái']`: added `min-width: 0; overflow-wrap: anywhere; word-break: break-word;`.
- Updated `.cus-dashboard-table .cus-row-actions`: changed from rigid `height: 100%` to `min-height: 100%; height: auto; width: 100%;`.
- Updated `.cus-dashboard-table .cus-row-actions__signal`: replaced nowrap/ellipsis with `white-space: normal; overflow-wrap: anywhere; word-break: break-word; overflow: visible; text-overflow: clip; min-width: 0; max-width: 100%;`.
- Updated `.cus-dashboard-cell--empty-notes .cus-inline-trigger`: changed `min-height: 32px;` to `min-height: var(--control-touch-h, 40px);`.
- Updated `.cus-dashboard-table tbody > tr > td:last-child`: aligned padding to `5px 10px;`.

### `frontend/src/features/shipments/cus/ShipmentsTableRowHeight.test.tsx`
- Strengthened FB-043 pin for `.cus-row-actions__signal` to assert `white-space: normal; overflow-wrap: anywhere;` per NO TRUNCATE doctrine.

### `frontend/src/features/shipments/cus/ShipmentsTableRowHeight.styles.test.ts` (New)
- Pinned `box-sizing: border-box;`, padding alignment, `min-height: 100%; height: auto;` on status actions, and NO TRUNCATE on status signal.

### `frontend/src/features/shipments/cus/ShipmentsCards.styles.test.ts` (New)
- Pinned card fact eyebrow typography (11px, bold, uppercase, tracked 0.04em, line-height 1.35), lack of page-owned geometry overrides on `cus-dashboard-detail`, uniform `var(--control-touch-h, 40px)` touch height across all card triggers including empty notes, and card edge padding alignment.

## Verbatim Gate Counts

### 1. Scoped Vitest: `src/features/shipments/cus/`
Output saved to `testplan/2026-11-02_sil633_646_vitest_cus.txt`:
```
Test Files  22 passed (22)
     Tests  192 passed (192)
```

### 2. TypeScript: `cd frontend && pnpm exec tsc -b`
Output saved to `testplan/2026-11-02_sil633_646_tsc.txt`:
```
0 errors
```

### 3. ESLint: `cd frontend && pnpm exec eslint src/features/shipments/cus/CusShipmentRow.tsx src/pages/ShipmentsPage.tsx`
Output saved to `testplan/2026-11-02_sil633_646_eslint.txt`:
```
0 errors
```

### 4. Page-Level Pin: `src/pages/ShipmentsPage.test.tsx`
Output saved to `testplan/2026-11-02_sil633_646_vitest_shipments_page.txt`:
```
Test Files  1 passed (1)
     Tests  123 passed (123)
```

## UI Verification (Rung 3 — UI DRIVEN)

Driven via Puppeteer with CUS authenticated session on local dev server (`http://localhost:7180`), backend API (`http://localhost:3002`).
Driver script: `testplan/2026-11-02_sil633_646_ui-driver.log`.

### Execution Results Across 4 Viewports
- **390px (Mobile)**: 20 rows, firstRowH=220px, clippingIssues=0, overflowIssues=0, detailBtn=44px (font-size: 12px), interactive click verified.
- **495px (Mobile Card Band)**: 20 rows, firstRowH=205px, clippingIssues=0, overflowIssues=0, detailBtn=44px (font-size: 12px), interactive click verified.
- **1307px (Desktop Reported Viewport)**: 20 rows, firstRowH=69px, clippingIssues=0, overflowIssues=0, detailBtn=16px (font-size: 12px), interactive click verified.
- **1440px (Desktop Full)**: 20 rows, firstRowH=69px, clippingIssues=0, overflowIssues=0, detailBtn=16px (font-size: 12px), interactive click verified.

### Persisted API State / Read-Only Identity Proof
- Endpoint: `GET http://localhost:3002/api/shipments/cus-workspace?limit=1`
- Status: `200 OK`, Total items: `525`
- Persisted data unchanged (read-only verification).

### UI Verification Table (Contract §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| SIL-646: Desktop table row height expands to fit multi-line content (no horizontal clipping at bottom edge) | UI DRIVEN | `testplan/2026-11-02_sil633_646_ui-1307.png`, `testplan/2026-11-02_sil633_646_ui-1440.png`, `testplan/2026-11-02_sil633_646_ui-driver.log` | Staging cluster deploy (orchestrator scope) |
| SIL-646: Status cell wraps full content without horizontal overflow (`scrollWidth <= clientWidth`) | UI DRIVEN | `testplan/2026-11-02_sil633_646_ui-1307.png`, `testplan/2026-11-02_sil633_646_ui-driver.log` (overflowIssues=0) | Staging cluster deploy |
| SIL-633: Card typography aligns to house scale (11px uppercase bold tracked eyebrows, 12px primary facts, 11px badges) | UI DRIVEN | `testplan/2026-11-02_sil633_646_ui-390.png`, `testplan/2026-11-02_sil633_646_ui-495.png`, `ShipmentsCards.styles.test.ts` | Staging cluster deploy |
| SIL-633: Card component sizes & touch floor (44px touch targets on narrow viewports, uniform empty notes, aligned padding) | UI DRIVEN | `testplan/2026-11-02_sil633_646_ui-390.png`, `testplan/2026-11-02_sil633_646_ui-495.png`, `testplan/2026-11-02_sil633_646_ui-driver.log` | Staging cluster deploy |

```
Status: DONE
Summary: SIL-646 fixed desktop row height clipping and horizontal status overflow; SIL-633 aligned card typography and component size to house scale.
Concerns/Blockers: none
```
