# Case QA-2026-09-23-09 — Drawer: the add-container form must ride the container table's column grid (card `20260923_9`)

- **Case ID:** QA-2026-09-23-09
- **Reported:** 2026-09-23. Chief, docx `20260923_9-form-them-cont-align-cot.docx`, kèm ảnh
  **"Ảnh 3 — Bước ⑥"** from the acceptance guide (`plans/reports/doc1-work/shots/raw/p1c.png`).
- **Verbatim requirement:** *"Form thêm container trong drawer Chi tiết lô: các ô nhập (Số container, Loại
  cont, Trọng lượng, Ngày giờ đóng/trả, nút Thêm/Hủy) trôi tự do KHÔNG thẳng hàng với các cột bảng container
  phía trên. Yêu cầu: hàng form thêm dùng CÙNG column grid của bảng — Số container thẳng dưới cột CONTAINER,
  Loại cont dưới LOẠI CONT, Trọng lượng dưới TRỌNG LƯỢNG (KG), ngày-giờ dưới GIỜ HẸN; nút Thêm/Hủy thẳng cột
  thao tác. Cột không có input (Tuyến, Điều vận, Nhà xe, Biển số) để ô trống khớp grid, không gộp tùy tiện."*
- **Surface:** `/shipments` CUS workboard → row "Chi tiết" → drawer → "Chi tiết container" ledger →
  "+ Thêm container" → the add row (`CusContainerAddRow`, `.cus-container-table > tfoot`).
- **Status:** case PREPARED — code landed with the card (see `plans/reports/c9-deepseek.md`); **rung 3
  (UI DRIVEN) is owed to the QA lane** (the ≤2px edge measurement is a browser measurement; jsdom has no
  layout).
- **Column note (interpretation, load-bearing):** the Chief's list names a **TRỌNG LƯỢNG (KG)** column and
  an **action column**, neither of which existed in the drawer ledger (its grid ended at *Giờ hẹn đóng/trả*,
  and its row actions lived as a hover-reveal icon inside the container cell). The fix adds both columns —
  see the regression fence below and `plans/reports/c9-deepseek.md` for the evidence and the width trade-off.

## Why this case exists (regression fence)

The add-container form was a flex row rendered **outside** the ledger table
(`.cus-container-ledger__add-form`), so nothing tied its controls to the columns above: at 1280 the số-cont
input spanned Container+Tuyến+part of Điều vận, the weight input sat under Biển số, the datetime input under
Nâng/Hạ, and the buttons floated past the table's right edge. The defect is visible in one glance
(`p1c.png`), which is exactly why it needs a fence tied to the DOM structure and not to a screenshot.

The add row is now the ledger table's **`<tfoot>` row**: one cell per column, controls in the cell of their
own column, an empty cell for every column without an input. Alignment then holds *by construction* at every
drawer width instead of by a duplicated width list.

## Steps (fixture: FCL lot with ≥1 container — e.g. `BULK-EXP-0088`)

1. Log in as CUS (`testplan/testaccounts.txt`), open `/shipments`, find a lot with containers.
2. Press "Chi tiết" → the drawer opens; press "Thêm container".
3. At **1280**, **2560** and **390** (viewport width), for each of the four inputs measure
   `|input.offsetLeft − column.offsetLeft|` against its column header cell (`CONTAINER`, `LOẠI CONT`,
   `TRỌNG LƯỢNG (KG)`, `GIỜ HẸN ĐÓNG/TRẢ`).
4. Verify the columns without an input (Tuyến, Điều vận, Nhà xe, Biển số, Nâng, Hạ) render as empty cells in
   the same row (no control stretching across two columns).
5. Verify Thêm/Hủy sit inside the row's **THAO TÁC** column, in line with the per-row Xóa icon of the
   container rows above.
6. Fill số cont + loại cont + trọng lượng + giờ hẹn and press "Thêm": the row persists (drawer ledger row +
   `Trọng lượng` cell shows the weight).
7. Press "Hủy": the add row disappears and the "Thêm container" trigger returns.
8. At 390 the add row is a card whose fields each own their whole row (single column: Số container,
   Loại cont, Trọng lượng, Giờ hẹn), the empty-order columns dropped and the buttons right-aligned
   (was "2-column labelled fields" — superseded by residual QA-2026-09-23-09-R1 below).

## Expected behavior

| # | Expectation |
|---|---|
| 1 | The add row is a row of the SAME table as the container rows (`table > tfoot > tr`), not a sibling form. |
| 2 | Every add-row control sits in the cell whose column index matches its column: Số container → 0 (CONTAINER), Loại cont → 1, Trọng lượng → 8, Giờ hẹn → 9, Thêm/Hủy → 10 (THAO TÁC). |
| 3 | Every row (data rows **and** the add row) carries one cell per column — 11 — so no column can silently shift. |
| 4 | Columns without an input keep an EMPTY cell (`td.cus-container-ledger__add-blank`, empty text) — never merged, never stretched. |
| 5 | The four input left edges match their column's left edge within **2px** at 1280 / 2560 / 390 (browser measurement; see the rung-3 snippet). |
| 6 | Column widths stay on one percentage grid summing to 100% (no px floor), so nothing goes off-screen at the drawer's 1180px cap and the table never scrolls horizontally. |
| 7 | The ledger renders the line's own weight in the new TRỌNG LƯỢNG (KG) column (`—` when the line has none). |
| 8 | The per-row Xóa keeps its contract: icon-only with `aria-label`, hover-reveal on fine pointers, always visible on coarse pointers/mobile, disabled with the trip tooltip on a live-trip row, 409 → toast. |
| 9 | The add flow is unchanged: Enter in the add row submits (the house select keeps Enter for committing a typed option), Hủy closes, errors render inline below the table, success toasts + the new line renders in the open drawer. |
| 10 | The "Loại cont" picker is never a sliver: the `width="content"` variant is gone (it collapsed to ~2px under `hideLabel` — case QA-2026-09-23-02) and the control now fills its 7% column cell like the row controls do. |

## Out of scope

- The lot-level delete/job-state surfaces and the drawer slide motion (cards `20260923_1` D1/D2/D3).
- The detail workboard ledger (`ShipmentsContainerLedger`) and the create-screen editor (`ShipmentContainerEditor`).
- Per-container weight *editing* in the ledger — the new column is display-only (the add form is the only
  weight entry point in the drawer).

## Automated fence (red-first, must stay green)

- `frontend/src/features/shipments/cus/CusContainerLedger.test.tsx`
  - `rides the ledger column grid: one cell per column, every control in its own column` — asserts the
    colgroup/thead list, `tfoot tr` presence, `cellIndex` per control and per data-row cell, and the empty
    cells at indices 2–7. **RED pre-fix** (the form was outside the table: no `tfoot`, wrong header list),
    GREEN post-fix.
  - `renders the line weight in the Trọng lượng column, em dash when missing` — RED pre-fix (no weight cell).
- `frontend/src/pages/ShipmentsPage.density.test.ts`
  - `keeps every ledger column on one percentage grid that sums to 100%` — colgroup ↔ CSS width parity, no px
    floor on a track.
  - `add-container form: the Loại cont select fills its column cell, never a sliver (QA-2026-09-23-02, card
    20260923_9)` (in `ShipmentsPage.test.tsx`) — the 150px floor retired with `width="content"`.
- Evidence: `qa/2026-09-24_c9-grid_red-first.log`, `qa/2026-09-24_c9-grid_frontend-vitest.log`,
  `qa/2026-09-24_c9-grid_frontend-tsc.log`.

## Rung-3 measurement (QA lane — the ≤2px criterion)

```js
// at 1280, 2560 and 390; after: click "Chi tiết" → "Thêm container"
const table = document.querySelector('.cus-container-table');
const cols = [...table.querySelectorAll('thead th')];
const index = (label) => cols.findIndex((th) => th.textContent.trim() === label);
const deltas = [
  ['Số container', 'Container'],
  ['Loại cont', 'Loại cont'],        // the UuiSelectField wrapper's cell
  ['Trọng lượng (kg)', 'Trọng lượng (kg)'],
  ['Giờ hẹn đóng/trả', 'Giờ hẹn đóng/trả'],
].map(([aria, column]) => {
  const input = table.querySelector(`tfoot [aria-label="${aria}"], tfoot .cus-container-ledger__add-select`);
  const cell = input.closest('th, td');
  return { field: aria, expected: index(column), actual: cell.cellIndex,
           dx: Math.abs(cell.getBoundingClientRect().left - cols[index(column)].getBoundingClientRect().left) };
});
console.table(deltas);
```

Rung-3 artifacts owed: screenshot per width (`qa/<date>_c9-grid_ui-<width>.png`), the `console.table`
output, driver log, and the DB row after pressing Thêm.

---

# Residual case QA-2026-09-23-09-R1 — mobile 390: every add-row field owns its whole row

- **Case ID:** QA-2026-09-23-09-R1
- **Reported:** 2026-09-24 (Director, from the QA lane's rung on staging `b1781217`; QA report
  `testplan/qa/evidence/2026-09-23_staging-b1781217/REPORT.md` §(a)).
- **Verbatim:** *"mobile 390 — ô "Trọng lượng (kg)" chỉ 167px (~45% hàng để trống, không full-width).
  DOM childWidths: [343, 2, 167, 185, 51.3, 41]."* — QA's mapping of that array:
  `[Số container, Loại cont combobox, Trọng lượng, Giờ hẹn, Thêm, Hủy]`.
- **Provenance note (load-bearing):** that measurement is from build `b1781217`, which PRECEDES this
  card's fix — QA's own report says so ("The fix `ff3cc0a7` lives AHEAD of `b1781217`"). It therefore
  measured the DELETED flex form (`.cus-container-ledger__add-form`, `display:flex; flex-wrap:wrap`),
  where `Số container` took the first line (343), the Loại cont combobox collapsed to a ~2px sliver
  (case QA-2026-09-23-02), and Trọng lượng (167) shared the next line with that sliver — 45% blank.
  On the re-cut build (`ff3cc0a7`, verified live: `/api/health` buildHash) the same field rendered
  **160.5px in a 353px row** inside the 2-column card — the residual's substance (a field that does
  not use its row on a phone) was still true.
- **Surface:** same as QA-2026-09-23-09 — `/shipments` CUS workboard → "Chi tiết" → drawer →
  "Chi tiết container" → "+ Thêm container".
- **Status:** FIXED — CSS-only; rung 3 (UI DRIVEN) done on local dev 2026-09-24.

## Steps

1. Log in as CUS, open `/shipments`, open a lot's drawer, press "Thêm container".
2. Set the viewport to **390**.
3. Measure every visible add-row cell: `[...row.children].filter(c => getComputedStyle(c).display !== 'none')`
   → `getBoundingClientRect().width`.

## Expected behavior

| # | Expectation |
|---|---|
| R1 | At 390 every add-row field cell (Số container, Loại cont, Trọng lượng (kg), Giờ hẹn đóng/trả, Thao tác) is the row's FULL content width — no field sits in half a row with the other half blank. |
| R2 | Trọng lượng (kg) is full-width like every other field (the named residual). |
| R3 | The 2-column card survives for wider drawers: at a container width > 560px the add row is still `repeat(2, minmax(0, 1fr))` and the data rows' 2-column card is untouched at every width. |
| R4 | Table mode is unchanged: at 1280 the add row's cells keep `cellIndex` 0 / 8 / 9 and the input-to-column edge delta stays ≤ 2px. |
| R5 | The add flow still works after the layout change: fill + "Thêm" persists the container (drawer row + weight cell + DB row). |

## Fence (red-first, must stay green)

- `frontend/src/pages/ShipmentsPage.density.test.ts` →
  `gives every add-container field its whole row on phones` — asserts the `@container shipment-drawer
  (max-width: 560px)` rule sets the add row to one `minmax(0, 1fr)` track, and that the card mode
  (≤760px) still owns the row's `display: grid`. **RED** on the pre-change stylesheet
  (`qa/2026-09-24_c9b-mobile-weight_red-first.log`, 1 failed), GREEN after.
  jsdom has no layout, so the width itself is the rung-3 browser measurement below.
- Superseded expectation: §Expected behavior #8 previously read "2-column labelled fields" — replaced
  by the single-column phone card (R1/R2). The 2-column card is unchanged above 560px (R3).

## Rung-3 evidence (2026-09-24, local dev, CUS `cus`, lot 1269)

| Rung | Artifact |
|---|---|
| UI DRIVEN | `qa/2026-09-24_c9b-mobile-weight_ui-390.png` (stacked add row), `qa/2026-09-24_c9b-mobile-weight_ui-1280.png` (table mode), `qa/2026-09-24_c9b-mobile-weight_ui-before-390.png` (pre-change 2-column card) |
| widths | `qa/2026-09-24_c9b-mobile-weight_ui-widths.log` — 390: every cell 331 of 353 (was Trọng lượng 160.5); 700: `273.5px 273.5px`; 1280: cellIndex 0/8/9, dx 0.0 |
| DB side effect | `shipment_containers` id 677 `TSTU1234568` `cargo_weight_kg 7777.00` `shipment_id 1269` |
| driver | `qa/2026-09-24_c9b-mobile-weight_ui-driver.log` |

