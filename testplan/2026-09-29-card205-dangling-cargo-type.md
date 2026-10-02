# Dangling cargo type on shipments: trip create must say what is broken (card 20260929_205)

Board-reported (local census 2026-09-29): 30 live shipments point at
`cargo_types` rows that do not exist (QA/import debris, e.g. lots whose BL is
`Q23-BILL-SHP-*`, referencing ids beyond `max(cargo_types.id)`), because
`shipments` has FK only on `route_id` — `customer_id` and `cargo_type_id` are
unchecked. POST /trips on such a lot failed with the generic
"Loại hàng hóa không tồn tại", or — when the operator picked a real cargo type
to work around it — the misleading "Loại hàng của chuyến không khớp với lô
hàng nguồn."

## Reproduction (pre-fix)

1. Shipment whose `cargo_type_id` points at a missing row (status
   PENDING_DATE / READY_FOR_DISPATCH / DISPATCHED, `deleted_at` NULL).
2. POST /api/trips with that `shipmentId`:
   - without `cargoTypeId` → 400 "Loại hàng hóa không tồn tại" (generic, no
     way out named);
   - with any real `cargoTypeId` → 409 "Loại hàng của chuyến không khớp với lô
     hàng nguồn." (wrong diagnosis — the LOT's stored ref is the phantom).

## Root cause

Master refs carry no DB FK (repo convention: master-data integrity is
app-layer, `assertShipmentMasterRefsExist`). The shipments intake already
refuses NEW dangling refs; the trips write path never checked the source lot's
cargo ref, and its seeding branch could even write a phantom
`data.cargoTypeId` INTO the lot.

Fix (`backend/src/services/trip-create.service.ts`): on a shipment-linked
create the lot's cargo type is resolved in-transaction before the mismatch
check; a dangling ref raises 409 naming the lot by display key (Bill/Booking)
with the way out. Up-front guards refuse a dangling `customerId`
(400 "Khách hàng không tồn tại.") and a dangling direct `cargoTypeId`
(400 "Loại hàng không tồn tại."). No migration, no schema change — cleaning the
existing dirty rows is a separate data decision.

## Regression cases

Backend suite: `backend/src/tests/dangling-cargo-type.test.ts`
(isolation runner: `TZ=UTC node backend/scripts/test-isolated.mjs --filter dangling`).

| ID | Requirement | Expected proof |
|---|---|---|
| CARD205-T1 | A live lot with dangling `cargo_type_id` is visible to the census join (`scripts/qc-census-dangling-refs.mjs`) | Census-equivalent LEFT JOIN reports the fixture row (`qa/2026-09-29_card205_dangling-suite-green.log`) |
| CARD205-T2 | POST /trips on such a lot is refused 409 with "không còn tồn tại" + "chỉnh lại loại hàng của lô", naming the lot's BL | Suite test "refuses with an error naming the lot and the fix"; no trip row written |
| CARD205-T3 | A real trip cargo type on a phantom-ref lot must NOT produce the mismatch error | Suite test "a real trip cargo type must not produce the misleading mismatch error" |
| CARD205-T4 | A genuine mismatch (both cargo types real) still rejects 409 "không khớp" | Suite characterization test (green before and after the fix) |
| CARD205-T5 | createShipment cannot create dangling `cargo_type_id` / `customer_id` (existing master-refs guard) | Suite tests "createShipment refuses a dangling …" |
| CARD205-T6 | createTrip cannot seed a phantom cargo type into a lot, and cannot be created with dangling `cargoTypeId`/`customerId` on the direct path | Suite tests in "recurrence guards" |
