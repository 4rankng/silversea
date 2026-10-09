# REG-091026190530 — Driver IMPORT "Cảng hạ" dead row (FB-082)

- **Case ID:** REG-091026190530
- **Reported:** 2026-10-09 18:06 — Telegram "Phần mềm QLVT Cty…" (Tiệp Vũ), FB-082 batch.
- **Symptom:** driver app on an IMPORT trip shows "Cảng hạ" empty ("Chưa có nơi trả rỗng") while "Địa chỉ giao hàng" / the card's "Giao hàng" line carries the discharge yard (bãi hạ) — the two rows contradict each other.
- **Root cause:** `driverLocationLabels` (frontend/src/features/driver/driver-display.ts) still ran pre-ruling KP-063 semantics — IMPORT `drop` = `returnDepot` — but the 2026-09-18 delivery-stage ruling killed the return-depot stage BE-side (`returnDepotName` always null; `deliveryName` = the container's dropoff port or the dispatcher's free-text override). Every IMPORT trip therefore rendered a structurally dead "Cảng hạ" row.
- **Fix:** IMPORT `drop` = distinct depot (legacy data, if present) `??` the drop-chain value; named fallbacks ("Chưa có cảng hạ" on the detail grid, "Chưa có nơi hạ" on the journey card) fire only when the whole chain is empty. EXPORT/unknown directions unchanged.
- **Regression pins:** `frontend/src/features/driver/driver-display.test.ts` (new, unit), `DriverTaskInfoSections.test.tsx` (FB-082 case + fallback pin), `DriverTripsPage.test.tsx` (IMPORT table depot-null row — old DRV-R02 expectation superseded by the 2026-09-18 ruling; factory exclusion from the drop chain is owned and pinned BE-side in delivery-stage).
- **Expected behavior:** IMPORT journey card and trip detail show the container's dropoff port/yard as Hạ/Cảng hạ; the delivery row keeps showing the same name when equal (P1_5).
