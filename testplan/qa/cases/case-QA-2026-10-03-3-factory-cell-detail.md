# Case QA-2026-10-03-3 — Factory cell: name only + detail peek (card 20261002_268)

- **Surface**: create/edit shipment form, container table factory cell
  (`/shipments/new`, CUS or dispatcher creator)
- **Class**: information-density + on-demand detail (A01 P2)
- **mutates**: one fixture site row inserted for the rung (`QA268-FAC1`, id 3075);
  nothing else persisted — the form itself is read-only until save
- **Source**: card 20261002_268 (A01, P2); design law §3 (surface overlays),
  §5 (density)

## Repro

1. Log in as `thanhdc` (CUS) or `dungnv` (dispatcher) on local/staging.
2. Open `/shipments/new`, commit a customer, then commit a factory in any
   container row's "Nhà máy" cell.
3. OBSERVED (pre-268 at HEAD): the cell shows only the short name and offers
   no way to see the full address or invoice info without leaving the form.
   EXPECTED (post-268): an info button appears beside the name; clicking it
   opens a read-only popover with the address and the lift-fee invoice group
   (Tên / Địa chỉ / MST, only non-null lines); Escape, the X button, or
   clicking outside closes it; the row stays 40px tall.

## Pass criteria

- AC1 name-only cell: unchanged behavior, asserted (cell shows short name).
- AC2 detail affordance: UI DRIVEN — click opens `role=dialog` popover with
  address + invoice group; Escape/X/outside close it; trigger toggles.
- AC3 no row stretch: cell + row height = 40px measured during the rung.
- AC4 screenshots at 1440 + 1280 with the popover open (embedded in card).
- Suites: create-form family 91/91 green; scoped eslint clean.

## Coverage notes (rung: UI DRIVEN, local dev)

Covered: CUS creator, 1280 + 1440, mouse + keyboard (Escape) dismissal,
trigger toggle, invoice group present for a site with data.
Not covered: dispatcher account click-through, 390/768 widths, ad-hoc row
(no site → no button, asserted by design), staging re-verification (QA wave),
invoice groups for drop-fee/cleaning-fee trios (client type carries only the
lift-fee trio today).
