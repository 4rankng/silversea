# FB-061 (card 141026012010) — Kiểm soát phơi phiếu showed the fixture class

**Card:** `FB-061 verify-fail: dữ liệu seed/test lộ trên Kiểm soát phơi phiếu` —
admin, staging build `5ef12393`, 2026-10-14. `/accounting/phoi-phieu` → *Kiểm
soát phơi phiếu* listed factory `KHO-SEAM-1789702634486`, carrier
`STG VERIFY NHA XE 09`, customer `QA0915 QA-138 Credit Customer`, bills
`BL-QAKE-<timestamp>` and `E2E-*`, plates `99T-99999`, driver `Test Driver R15`,
`51K-PROBE`. Expected: seed/test data never on a production-facing board.

## Where the board reads from

`GET /api/expense-accounting/phoi-phieu/rows` →
`services/phoi-phieu-control.service.ts:114` (`listPhoiPhieuRows`). One query,
five projections:

| Column | Source |
|---|---|
| Nhà máy | `trips.factory_site_name` → `operational_sites` → `shipments.factory_name` |
| Khách hàng | `customers.name` via `shipments.customer_id` (join filters `deleted_at`) |
| Số Bill / Booking | `shipments.bl_number` / `booking_ref` |
| Biển số | `trip_carrier_info.external_plate_number` (external) or `trucks.license_plate` (own fleet) |
| Nhà vận tải / Lái xe | `trip_carrier_info.external_driver_name`, `customers` / `suppliers` by `external_entity_id`, `drivers.name` |

## Why the earlier rounds never reached it

Round 16 (f4a3b57e) gated the DEMO SEEDERS in production — that stops new
rows being authored, it does not purge rows already on staging. The purge
doctrine for this class is the registry (`backend/src/seed/qa-fixture-registry.ts`,
run by `make qapurge`), and the registry had **no surface at all** for three of
the tables the board reads:

- `trip_carrier_info` — external plate/driver/carrier rows; no `deleted_at`,
  no `status`
- `trucks` — own-fleet plate
- `drivers` — own-fleet driver

and its existing predicates missed every signature the card quotes: `BL-QAKE%`
/ `E2E-%` bills, `KHO-SEAM%` factory names, the `STG VERIFY%` carrier family,
and `operational_sites.code` (never in the predicate).

## Fix (data class, registry only)

| Surface | Action | Signatures added |
|---|---|---|
| `trip_carrier_info` (new) | `hard-delete` | `QA%` plate/driver, `99T-99999`, `51K-PROBE%`, `Test Driver%` |
| `trucks` (new) | `soft-delete` | `QA%`, `99T-99999`, `51K-PROBE%`, `-<10..13 digits>` |
| `drivers` (new) | `soft-delete` | `QA%`, `Test Driver%`, `-<10..13 digits>` |
| `shipments` (soft-delete) | — | `BL-QAKE%` and `E2E-%` across `bl_number` / `booking_ref` / `shipment_code` |
| `customers`, `suppliers` | — | `STG VERIFY%` names |
| `trips`, `shipments` (scrub) | — | `factory_*_name ILIKE 'KHO-SEAM%'` |
| `operational_sites` (scrub) | — | `code ILIKE 'QA%'`, `name`/`short_name` `KHO-SEAM%` |

No frontend change: `PhoiPhieuDialogs.test.tsx:237-241` forbids name-laundering
in the render layer on purpose, so the data-side purge is the sanctioned path.

## Verification

- `src/tests/qa-fixture-purge.test.ts` — 11 pass / 0 fail against the local DB,
  including three new cases: external-carrier rows purge while a real carrier
  row survives; probe trucks/drivers soft-delete while the real fleet stays;
  `BL-QAKE-*` / `E2E-*` lots soft-delete (which is what removes them from the
  board, since `tripConditions` filters `shipments.deleted_at`) while a real
  bill survives.
- `backend npx tsc --noEmit` → 0 errors.
- **Not run against staging** (rung 2 for the code, rung 0 for the board): the
  wave had no staging session, so the card's on-screen rows were not re-read
  after a purge. Run `make qapurge-dry` and expect 0 for the new surfaces
  before closing the card.

## Known limit (not closed by this change)

`trips`/`trucks`/`drivers` are LEFT-joined on the board without a
`deleted_at` filter, so a soft-deleted fleet master still prints its value on a
row that survives; only the shipment purge removes a board row. Same for a
supplier reached through `trip_carrier_info.external_entity_id` (the supplier
joins there carry no `deleted_at` filter, unlike the customer join). Closing
that would mean filtering deleted masters in the board query — a behaviour
change for real data, outside this card's data-class scope.