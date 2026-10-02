# Card 20260929_204 — driver trip fixture (regression note)

Case ID: TC-204-01
Tool: `scripts/qa-driver-trip-fixture.mjs` — one command creates a driver-openable trip
(driver profile + a LIVE fulfillment + departure = today) on the local dev DB.

## Usage
- `cd backend && set -a && source .env && set +a && node ../scripts/qa-driver-trip-fixture.mjs pho`
  → prints the trip id + URL; the driver opens `/my-trips/<id>` and sees "Thêm chi phí".
- Re-run the same day → the SAME trip id (idempotent, keyed `QADRV-<yyyymmdd>-<username>`).
- `--purge` removes exactly that driver's prefix rows (per-driver scope — the earlier
  `QADRV-%` pattern crossed drivers and was fixed before landing).

## Known data facts (so nobody re-diagnoses)
- trips point at DRIVERS (driver_id), not users — pho = users.id ≠ drivers.id.
- a live trip claims one fulfillment (trips_fulfillment_id_live_uniq): each new day needs
  a fresh fulfillment row for the fixture shipment.
- the driver portal lists trips departing TODAY; the cost form needs a live fulfillment
  (CREATED-without-fulfillment trips show the ad-hoc empty state — on staging too).
