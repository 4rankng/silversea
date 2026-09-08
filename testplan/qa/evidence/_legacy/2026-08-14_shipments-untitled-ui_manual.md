# Shipment toolbar manual QA

Date: 2026-08-14
Surface: `/shipments`
Role used locally: ADMIN (same shipment workspace component)

## Acceptance checks

- Untitled UI source-owned `Input`, `NativeSelect`, and `Button` primitives render on the shipment toolbar.
- Desktop controls use 34-36 px visual height; mobile controls restore 44 px touch targets.
- The action region wraps independently from the filter content based on the shipment workspace container width.
- Column headers use `white-space: normal` and `overflow-wrap: anywhere`.
- No horizontal document overflow at 1440, 1100, 900, 768, or 390 px.
- No pairwise control intersections at 1440, 900, 768, or 390 px on the first pass.
- The first 1100 px pass detected date-control intersections after the app sidebar reduced the workspace to 780 px. The layout was changed from a viewport breakpoint to a 900 px container breakpoint.
- The 1100 px rerun reported zero intersections and zero horizontal overflow.
- At 1440 px all seven visible column headers had `scrollWidth === clientWidth`, `white-space: normal`, and no overflow.

## Evidence

- `qa/2026-08-14_shipments-untitled-ui_desktop-1440-rerun_manual.png`
- `qa/2026-08-14_shipments-untitled-ui_scaled-1100-rerun_manual.png`
- `qa/2026-08-14_shipments-untitled-ui_tablet-900_manual.png`
- `qa/2026-08-14_shipments-untitled-ui_tablet-768_manual.png`
- `qa/2026-08-14_shipments-untitled-ui_mobile-390_manual.png`

Verdict: PASS
