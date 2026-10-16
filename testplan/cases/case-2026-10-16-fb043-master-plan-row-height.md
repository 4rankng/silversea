# FB-043 (card 141026001010) — /dispatch rows must be uniform height

**Card:** `Bảng điều xe dòng không đều nhau (regression FB-043)` — OPS staging,
2026-10-14. Rows in `/dispatch` differ in height: a lot with several stacked
trips (each block is a head line plus a `nhà máy · container` sub line)
renders ~2x a single-trip lot, and the notes cell with `Xem thêm` varies with
it. Expected: uniform row heights, dense and compact.

## Why round 1 did not hold

Round 1 (2026-10-14, commits `91f0df85` + `54b71bdc`) gave the **detail-plan**
grid (`/dispatch-detail`, `DetailedPlanGrid.css`) a row-height contract and
fixed a specificity trap in `DispatchPlanEditorCell.css`. The card's evidence
is on `/dispatch` → `MasterPlanGrid`, which received nothing: no row budget,
no cell body, and every value line explicitly `white-space: normal` inside a
`vertical-align: top` cell. Column rebalancing cannot fix that class — each
rebalance just starves a different column — so the row itself must be bounded.

## Fix

| Change | Why |
|---|---|
| `MasterPlanGrid.tsx` — all 8 `<td>`s wrap their content in `.master-plan-grid__cell-body` | one shared budget owner, same anatomy as `DetailedPlanGrid__cell-body` |
| `MasterPlanGrid.css:111` — `--mpg-row-h: 96px` on the grid | the budget, declared once; holds two trip blocks (4 dense lines ≈ 72px) plus one status line |
| `@container (min-width: 901px)` band — body is a column flex box of that height that clips, value lines/port blocks/route grid hold one line with an ellipsis, `Chi tiết` / `Xem thêm` stay `flex: 0 0 auto` | no cell can inflate the row; the row action never clips |
| `@container (max-width: 900px)` card band — body resets to `display: block; height: auto; overflow: visible`, lines back to wrapping | the ≤900px layout is a stacked record, not a dense row; the two bands can never co-apply |

## Verification

- `npx vitest run src/features/dispatch` → 61 files / 589 tests pass.
- `npx tsc --noEmit` → 0 errors.
- New pins: `MasterPlanGrid.rowheights.styles.test.ts` (4 cases) guard the
  body wrapper count, the band-scoped fixed height, the pinned row actions and
  the card-band reset — the class, not a pixel value.
- Not driven in a live UI (rung 2): the CSS cascade and DOM structure are
  proven by the pins above; no staging session was used in this wave. Row
  heights on real staging data remain unmeasured.