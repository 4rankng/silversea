# Regression spec — FB-082 driver delivery row names the destination

**Ticket:** FB-082 (round 16 retest) — card 121026141020
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** covered by FE vitest + local UI drive
**Cycle:** 2026-10 round 16

## Goal

On `/my-trips/:id` (IMPORT), 'Địa chỉ giao hàng' showed the same value as
'Cảng hạ' (Bãi JJ LOGISTICS) instead of the delivery destination — the
factory address (CÔNG TY TNHH NEWEB VIỆT NAM, Lô đất CN01, KCN Đồng Văn III,
Phường Đồng Văn, Tỉnh Ninh Bình) that 'Địa chỉ nhà máy' already showed.

Root cause: the delivery stage was sourced from the drop chain (the
container's dropoff port, else the dispatcher free-text override). The
2026-09-18 ruling made that chain the HẠ point in every direction — so once
the dropoff port is recorded, both rows read the same yard. The delivery row
is a different physical stage: the destination the goods are handed over to
(the factory). Round 15 passed only because that trip had no recorded port
(the free-text fallback carried).

## Fix

- `frontend/src/features/driver/driver-display.ts` — new
  `driverDeliveryDestination({ fullName, name, address })` owns the
  destination label; `driverLocationLabels` no longer emits `delivery`
  (drop/returnDepot unchanged — HẠ stays port-first per the ruling).
- `frontend/src/pages/driver/DriverTaskInfoSections.tsx` — 'Địa chỉ giao
  hàng' (IMPORT) renders the destination label; hidden when no factory data
  (EXPORT unchanged: no row).
- `frontend/src/pages/DriverTripsPage.tsx` — the card's 'Giao hàng' chip is
  gone: fed from the drop chain it could only repeat the 'Hạ' chip beside it
  or the factory headline above it.

## Acceptance criteria

### TC-FB082-001 — delivery row names the factory destination

- **Given** an IMPORT trip with a recorded dropoff port and factory data
- **Then** 'Cảng hạ' shows the port, 'Địa chỉ giao hàng' shows
  `<factory full name>, <factory address>` — never the same value twice.

Covered by `DriverTaskInfoSections.test.tsx` FB-082 cases (red at HEAD) and
UI DRIVEN 2026-10-12 (`qa/2026-10-12_fb082_ui-1-delivery-row.png`, phone
390px, dvthuc, trip 44277).

### TC-FB082-002 — no destination data hides the row

- **Given** an IMPORT trip with neither factory name nor address
- **Then** 'Địa chỉ giao hàng' is absent (the drop point stays on 'Cảng hạ').

Covered by `DriverTaskInfoSections.test.tsx`.

### TC-FB082-003 — card list no longer duplicates the stage

- **Given** the driver journey card list
- **Then** no 'Giao hàng' chip renders next to 'Hạ' with the same value.

Covered by `DriverTripsPage.test.tsx` (chip removal pin) and UI DRIVEN
(`qa/2026-10-12_fb082_ui-2-card-chips.png`).

## Notes

- The old pins (KP-063 / 091026190530 / P1_5 in DriverTaskInfoSections.test,
  driver-display.test `delivery` assertions, DriverTripsPage `showDelivery`
  table) carried the superseded drop-chain sourcing and were repointed to the
  destination contract with the FB-082 rationale in the test bodies.
- EXPORT and the legacy distinct-depot 'Trả rỗng' behavior are unchanged
  (driver-display.test pins them).
