# Case: card 101026163000 (FB-006) — create-grid "Nhà máy" cell keeps full combobox after a pick

- Case ID: 2026-10-10-card101026163000
- Reported: 10/10/2026 16:26 (QA round 13, staging e2bb8ea0; round 12 had passed)
- Status: FIXED (this card)

## Reproduction (pre-fix, local HEAD 101fd195)

On `/shipments/new` (CUS `thanhdc`), pick a customer, then pick a factory in the
row's "Nhà máy" cell. The cell keeps rendering the full editable combobox
(bordered control + search icon + "Xoá" clear button) next to the magnifier,
instead of collapsing to the factory name + magnifier. Probes 10/10 (1440px):
after a mouse pick AND after an Enter pick the editor sits at opacity 1, the
name span at opacity 0, and focus remains inside the cell — a single Tab lands
on the magnifier button, still inside the cell, so the chrome lingers. The cell
collapses only when focus leaves the cell entirely.

Expected: once a pick commits, the cell shows only the factory name + the
magnifier detail affordance (card 20261002_268 compact-row design); the picker
chrome is visible only while its menu is open.

## Root cause

`ShipmentContainerCell` reveals the editor chrome on `:focus-within` OR
`:has([aria-expanded='true'])`. After a committed pick react-aria keeps focus
on the combobox input (correct — keyboard flow must continue), so `:focus-within`
alone pins the chrome open indefinitely. The condition, not the focus
management, is wrong for catalog-picker cells.

## Fix + pins

Picker cells (new `picker` modifier) reveal their editor only while a picker
menu is open inside the cell; the base `:focus-within` reveal rules exclude
them via `:not(.csc-container-cell--picker)` so the ≤1037px stacked-layout
override (ClerkShipmentCreatePage.css "stacked records are forms") keeps
winning. Applied to the create-row catalog cells (Loại container, Nhà máy,
Tuyến đường, Cảng nâng, Cảng hạ) and the CUS ledger pure-picker cells
(Loại cont, Tuyến, Nâng, Hạ). Text cells (Số container, Trọng lượng, Biển số)
and the CUS "Nhà xe" cell (free-text NEW_EXTERNAL mode + switch buttons, no
menu) deliberately keep the focus-within reveal.

Pinned by:

- `frontend/src/features/shipments/create/ShipmentContainerCell.picker-reveal.styles.test.ts`
  — the CSS contract: focus-within reveal excludes `--picker` cells; menu-open
  reveal still applies (observed RED pre-fix).
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.factory-cell.test.tsx`
  — the factory cell `td` carries `csc-container-cell--picker`; a text cell does not.
