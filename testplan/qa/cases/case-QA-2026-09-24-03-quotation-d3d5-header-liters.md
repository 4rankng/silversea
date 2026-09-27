# Case QA-2026-09-24-03 — Báo giá: header bảng đè cột + hàng "Tổng lít" mang hậu tố tiền

- **Case ID:** QA-2026-09-24-03 (card `20260923_10`)
- **Reported:** 2026-09-24, found on the staging rung of the quotation version-history feature
  (`20260922_62`, landing `d9f11e41`), build `6c8b162e`. QA report: `plans/reports/qa-260924-0010-cut10-rung-manifest-q62-q65.md`.
- **Surface:** `/config/quotations` (Báo giá) — the frames list table and the live 10-column grid
  of the selected quotation.
- **Status:** case PREPARED — fixes: D3 = header wrap rule in `QuotationConfigPage.css`; D5 = the
  liters row drops the đồng formatter. Red-first fence:
  `frontend/src/pages/config/QuotationConfigPage.d3d5.test.tsx` (2 assertions).

## Why this case exists (regression fence)

Two display defects that a user would call "broken", both width-independent:

- **D3 — frames-table header collision.** The shared `.tt-table thead th` contract is
  `white-space: nowrap` under `table-layout: fixed` (`frontend/src/components/Table.css`). In the
  frames panel — width-capped `minmax(280px, 380px)` — the header **NGÀY HIỆU LỰC** overflows its
  column and paints over **GHI CHÚ**. Seen at 1280/1440/1920/2560 in every state (empty + populated).
- **D5 — liters row carried the currency suffix.** The grid's `Tổng lít dầu/chuyến` row rendered
  through `formatCurrency`, so a fuel volume showed as **"20 ₫"**. Liters are a count, not money;
  the row label already names the unit.

The existing suite could not see either: jsdom has no layout (header overlap is invisible to
`textContent`/DOM assertions), and the liters row was only ever asserted by presence.

## Steps

1. Log in (`testplan/testaccounts.txt`), open `/config/quotations`.
2. Frames list (left panel): inspect the header row — NGÀY HIỆU LỰC and GHI CHÚ.
3. Select a quotation; in the grid, read the `Tổng lít dầu/chuyến` row.
4. Repeat at 1280 / 1440 / 1920 / 2560 widths and a 390px viewport.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | No header text paints over a neighbouring column; **NGÀY HIỆU LỰC** and **GHI CHÚ** each stay inside their own cell (wrap is legal; overlap is not). |
| 2 | The `Tổng lít dầu/chuyến` row renders a bare count (e.g. `20`, `64`) — **no `₫`/`đ` suffix**, no raw float tails (`33.800000000000004`). |
| 3 | Money rows (Giá cos / Phụ phí / Tổng) keep the đồng formatter — the unit fix is scoped to liters. |
| 4 | The frames list stays fixed-layout and clickable; wrapping the header must not reflow the data cells. |

## Out of scope

- D4 (version read-view / old-version export float tails) and D6 (version date filter end-boundary)
  — tracked separately from the `_62` QA report.
- Column width tuning of the frames panel itself (the cap is the design contract).

## Automated fence (red-first, must stay green)

- `frontend/src/pages/config/QuotationConfigPage.d3d5.test.tsx` →
  - `D3: quotation table headers wrap, so no header paints over its neighbour column` — extracts the
    `.quotation-frames__table thead th, .quotation-grid thead th` block from
    `QuotationConfigPage.css` and requires `white-space: normal` + `overflow-wrap: anywhere`.
  - `D5: the liters row renders a bare count, never a currency suffix` — renders the page, opens a
    frame, and requires the liters cells to read `20`/`64` with no `[₫đ]` in the row.
- RED pre-fix (`qa/2026-09-24_c10-d3d5_ui-red.log`, 2 failed) → GREEN post-fix
  (`qa/2026-09-24_c10-d3d5_ui-green.log`, 17 passed) + `tsc -b` exit 0
  (`qa/2026-09-24_c10-d3d5_frontend-tsc.log`).
