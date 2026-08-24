---
feature: cus-dieuvan-l2-adjustments
status: in-progress
updated: 2026-08-24
branch: main
commits: 
---

# CUS & Dispatch — Round 2 Adjustments

## Report

## [S1] Problem
Customer feedback requests adjustments to 4 screens: CUS Shipment Overview, CUS Shipment Detail, Dispatch Overview Plan, and Dispatch Detail Plan. Issues include columns that are too wide, missing date-scoped quantity filtering, missing delete-with-approval and edit-with-approval flows, column content/ordering mismatches, and a panel that exists only in Detail Plan but is needed in Overview Plan.

## [S2] Design

### Decisions resolved (previously blocked)

**Approval mechanism (items 1.4, 2.3):** Extend the `governanceActions` engine. Rationale: single consistent admin approval surface at `/governance-actions` (already has UI), vs. `shipment_change_requests` which has no admin review UI. New `actionKind`s: `SHIPMENT_DELETE_REQUEST` and `CONTAINER_EDIT_REQUEST`.

**Trip-vs-date gate (item 2.3):** Replace the `hasTrip` condition with a date-cutoff condition. The existing trip-assignment gate and the new date gate can disagree; date-cutoff takes precedence since it matches the customer's explicit requirement. The trip gate remains for other field types.

**Silver Sea permission (item 2.4):** Code already allows `OWN` carrier-type selection. The real gap is plate-number editing for OWN vehicles (intentionally locked). Implement shortName display + column shrink only; flag the plate restriction to the customer for clarification.

**Port short names (item 3.4):** Add `shortName` column to `ports` table (nullable), update admin CRUD form, display `shortName ?? name` in grid cells. Customer must populate data separately.

**Dispatch note field (item 3.5):** `operationalNotes` already exists end-to-end. Add edit affordance to Overview Plan grid (currently read-only there).

**Detail Plan column content (item 4.2):** Mirror 3.3 pattern — restructure "Documents" column to show route name + direction, rename to "Tuyến đường".

### Cross-cutting: Date-range quantity scoping (items 1.3, 3.6)
When a date range filter is active, only count containers whose `customerAppointmentAt` falls within the range. Shared helper `filterContainersByDateRange()` used by both CUS overview and dispatch overview services.

### Cross-cutting: Column width adjustments (items 1.1, 2.1, 2.4c)
Engineering judgment widths, verified against real content:
- CUS Overview: classification ~105-115px, cargo ~105-115px (down from 131px each)
- Shipment Detail: documents ~135-145px, container specs ~125-135px, pickup/drop-off ~135-145px, vehicle ~100-110px
- Freed width redistributed across remaining columns for balance

## [S3] Out of Scope
- Changes to `ShipmentDetailPage.tsx` (admin/ketoan-only screen, different from `ShipmentsDetailPage.tsx`)
- Portal/customer-portal screens
- Backend schema changes beyond what's needed for the listed items
- Populating port short-name data (customer responsibility)

## Tasks
- [ ] T1: CUS Overview — shrink classification & cargo columns — acceptance: columns visibly narrower, no mid-word wraps, table balanced (covers: S2; 1.1)
- [ ] T2: CUS Overview — split multi-type container lines — acceptance: 2+ container types render on separate lines (covers: S2; 1.2)
- [ ] T3: CUS Overview — date-range scopes quantities — acceptance: filtered date shows only that day's containers (covers: S2; 1.3)
- [ ] T4: CUS Overview — delete with approval flow — acceptance: pre-cutoff immediate delete, post-cutoff admin approval via governance engine (covers: S2; 1.4)
- [ ] T5: CUS Overview — swap import/export and bill/booking field order — acceptance: import/export appears first in DOM and visual order (covers: S2; 1.5)
- [ ] T6: Shipment Detail — shrink documents, container specs, pickup/drop-off columns — acceptance: columns narrower, no mid-word wraps, table balanced (covers: S2; 2.1)
- [ ] T7: Shipment Detail — swap Notes and Status column order — acceptance: status before notes (covers: S2; 2.2)
- [ ] T8: Shipment Detail — edit-with-approval by run date — acceptance: pre-run-date direct edit, post-run-date admin approval (covers: S2; 2.3)
- [ ] T9: Shipment Detail — vehicle column: shortName display + shrink — acceptance: shortName shown, column narrower (covers: S2; 2.4)
- [ ] T10: Dispatch Overview — add zone truck presence panel — acceptance: panel renders under Volume section, reuses ZoneTruckPresencePanel (covers: S2; 3.1)
- [ ] T11: Dispatch Overview — Customer & Factory column: bill replaces route as 3rd line — acceptance: customer/factory/bill display (covers: S2; 3.2)
- [ ] T12: Dispatch Overview — rename & restructure Documents column to Route & Shipping line — acceptance: route/shipping-line/direction, all bold (covers: S2; 3.3)
- [ ] T13: Dispatch Overview — port short names — acceptance: shortName ?? name fallback, schema migration + admin form (covers: S2; 3.4)
- [ ] T14: Dispatch Overview — operationalNotes edit affordance — acceptance: dispatch staff can edit notes on Overview Plan (covers: S2; 3.5)
- [ ] T15: Dispatch Overview — date-range scopes quantities — acceptance: same as T3 for dispatch service (covers: S2; 3.6)
- [ ] T16: Dispatch Detail — Customer & Route column: bill replaces route — acceptance: same pattern as T11 (covers: S2; 4.1)
- [ ] T17: Dispatch Detail — rename Documents to Route, restructure content — acceptance: route name + direction in cell (covers: S2; 4.2)
- [ ] T18: Dispatch Detail — move Notes column to last position — acceptance: Ghi chú is rightmost column (covers: S2; 4.3)
