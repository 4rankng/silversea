# QA-AUDIT-UI48 — date-range contents stay inside independent controls

Environment local7175/API3002. ADMIN admin; existing dispatch/shipments/accounting objects and CUSTOMER portal read-only where reachable. No business records changed.

Repro: open /dispatch-detail at768 with a coarse pointer, open “Bộ lọc”, focus the time picker. Existing original `qa/2026-10-01_comprehensive-audit_ui45-active-pickers-final/30_768-shared-time-focused-options.png` shows year2026 beyond both date borders in the “Khoảng ngày vận chuyển” group. Pair is one half-width grid cell despite holding two complete dates.

1. At390/768/1440 drive the actual filter dialog and inline dispatch dates. Pair uses a complete host-grid row, remains content-bounded, both dates stay independent and each day/month/year/separator rectangle stays within its own bordered field. No clipping/overflow; existing40px ceiling remains.
2. Select/enter valid existing-range dates and read URL/filter request values; cross-boundaries still enforce min/max. Type an incomplete draft, blur, correct it, then clear/reset through real controls. Open/close its current calendar and preserve keyboard/focus semantics. No business POST/PUT/PATCH/DELETE.
3. Sweep all DateRangeFields source hosts and each actually mounted range at390/768/1440, including blank placeholders and complete2026 dates. Capture current PNG+DOM after actual focus/entry. Nested-dialog Escape is separately UI49; never assume its green from this case.
4. Keep complete shipment5 API before/after plus identical guarded Drizzle selected rows; preserve commands/exits and screenshot SHA manifest. Component regressions pin native independent inputs/labels and preserved order/partial/clear callbacks; CSS guard pins shared full host-grid row and bounded pair allocation. No fakeURL/new mocked API.

Not covered: successful business mutations, every date/dataset/calendar boundary, other engines/roles/staging and unmounted conditional host branches. Final all-axis route walk is separately accepted.
