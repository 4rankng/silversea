# Case 2026-10-17-owner-customer-in-filter-lane — /shipments-debit: dropdown Khách hàng vào filter lane (reverses card _202)

## Claim

Owner request 2026-10-17: on `/shipments-debit` (Chi phí - Quyết toán), the
Khách hàng searchable dropdown ("Tất cả khách hàng") must live INSIDE the
filter control lane — the same strip as `Từ → Đến`, `Khóa lô`, the settlement
quick ranges (Tháng này/Tháng trước/Quý này) and `Xóa lọc` — not on its own
bar above the strip.

This **reverses card _202** (which deliberately pulled the customer picker out
of the strip as "the screen's primary axis, never folded into Bộ lọc").
Authority order §1: the explicit current owner decision wins over prior cards.

## Reproduce (pre-change shape)

1. Log in as CUS/MANAGER, open `/shipments-debit`.
2. Above the filter strip sits a separate `shipment-debit-customer-bar` row:
   the Khách hàng picker plus a caption hint "Đang xem tất cả khách hàng." /
   "Đang xem lô của <tên>.".
3. The filter strip below it starts with `Từ → Đến` — the customer axis reads
   as a detached toolbar, not part of the filter lane.

## Expected behavior (post-change)

- The Khách hàng picker is the FIRST control inside the shared filter strip
  (`ShipmentDebitRibbon`'s `FilterBar`), ahead of `Từ → Đến`; it is a bar
  child, so it renders inline at every width the strip holds (bar children
  never fold behind `Bộ lọc`).
- Filter logic is UNCHANGED: URL param `customer` (absent = all customers),
  selection cleared on change, summary query keys identical. This is a
  layout/DOM move only.
- The separate `shipment-debit-customer-bar` row is gone (no dead markup, no
  dead CSS family).
- The "Đang xem…" caption hint is dropped: it cannot ride the control lane
  without becoming third-row content the filter-bar law forbids, and it
  duplicated the picker trigger's own value. Owner asked only for the move.
- Sizing: the picker keeps its value-holding floor/cap (min 200px / max
  320px) as page-sheet sizing of the shared primitive; the strip's own wrap
  law (FilterBar.css) is untouched.
- 1440px: picker shares the lane with the range/lock/presets/actions. 390px:
  the strip wraps per its own measured law — no full-width stretch override
  for the picker (bar controls stay content-sized on phones).

## Scope / touchpoints

- `frontend/src/features/shipments/ShipmentDebitRibbon.tsx` — new props
  `customerValue` / `customerOptions` / `onCustomerChange`; renders the
  `SearchableSelect` as the first FilterBar child.
- `frontend/src/pages/ShipmentDebitPage.tsx` — customer-bar block deleted;
  values + URL writer handed to the ribbon.
- `frontend/src/pages/ShipmentDebitPage.css` — `.shipment-debit-customer-bar*`
  rules replaced by the in-strip picker sizing; phone full-width override
  removed (would break the bar's content-sized phone law).
- `frontend/src/pages/ShipmentDebitPage.test.tsx` — layout pins updated
  (picker inside the ribbon; hint gone; DOM order ribbon → header).

## Evidence plan

- Gates: `cd frontend && npx tsc -b`; `pnpm --dir frontend exec vitest run
  src/pages/ShipmentDebitPage*`; plus the pre-commit design:drift run.
- UI drive (rung 3): screenshots at 1440 and 390 proving the picker sits in
  the same lane as the date range; artifacts under
  `qa/2026-10-17_customer-in-filter-lane_*`.
