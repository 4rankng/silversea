# CUS overview: coherent compact records

User report: the shipment overview is fragmented into uneven label/value grids, clips its Bill, repeats scheduling warnings, and wastes space in its filters.

## Regression cases

- **CUS-OVERVIEW-01 — Narrow record layout:** As CUS, open `/shipments` at 390, 600, 640 and 820px. Search for a long Bill/customer identifier. Customer and documents use the full record width; field labels sit above values; classification/cargo may pair. No clipped identifiers, nested fixed label columns, half-width schedule highlight, or horizontal page overflow. At 1440px preserve the seven-column table.
- **CUS-OVERVIEW-02 — Filter density:** Search and the filter toggle align in one compact row where space permits. Open advanced filters. Criteria span the toolbar and remain readable; collapse again without losing selected filters. Actions form a compact wrapping row. Counters do not become oversized cards.
- **CUS-OVERVIEW-03 — Status clarity:** A record waiting for a date shows the scheduling issue once in its schedule section, retains its lifecycle badge and distinct financial/danger signals, and preserves vehicle assignment/order-issued information.
- **CUS-OVERVIEW-04 — Actions remain reachable:** Click identity, documents, classification, cargo, notes and detail. Each opens its existing dialog/drawer. Empty notes remain addable through a compact action. Cancel returns to the same record. Keyboard focus is visible and every action remains named.
- **CUS-OVERVIEW-05 — Content and scroll:** Inspect populated and empty notes, long factory/route names and multiple appointment groups. Typed line breaks survive. Main and overlay vertical scrolling remains available with hidden mobile tracks. Existing save, search, pagination and permissions are preserved.

Evidence belongs under `qa/2026-09-15_cus-overview/`. Record local Chrome viewport coverage separately from physical-device or staging coverage.
