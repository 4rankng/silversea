# Case 2026-10-16 — Thao tác card actions: Thêm/Xóa share one 50/50 row (owner report, mobile)

## Claim
On `/shipments-detail` ("Chi tiết lô hàng") at phone width, the per-container
"Thao tác" cell stacked its "＋ Thêm" and "Xóa" buttons as two fit-content
chips, top-left in a wide band — wasted space, unbalanced.

## Reproduce (pre-fix defect)
1. Log in locally (e.g. `admin` / `Abc123`) and open `/shipments-detail` at ≤1000px container width (phone 390px).
2. Scroll to any container card's "THAO TÁC" band.
3. Pre-fix: "＋ Thêm" sits alone on one line, "Xóa" alone on the next.

## Expected behavior
"＋ Thêm" and "Xóa" render side by side as one 50/50 row inside the Thao tác
band. The desktop ledger table (>1000px container) keeps its deliberate
stacked layout — its 7% actions column shears side-by-side labels.

## Fix
`ShipmentContainerLedger.tsx` wraps the pair in
`shipment-container-ledger__row-actions`; `ShipmentContainersPage.css` makes
that wrapper a 2-track grid inside `@container shipments-detail
(max-width: 1000px)` with `width: 100%` buttons.

## Verification
- Styles pin: `frontend/src/pages/shipment-container-ledger-card-actions.styles.test.ts`.
- UI DRIVEN: `qa/2026-10-16_thaotac-card-actions_*` (390px screenshot, DOM
  assertion, driver log).
