# O01 two-way dispatch implementation report

## Status

- O01 persisted pairing slice is implemented on Monday, July 27, 2026.
- Migration `0141_two_way_dispatch_pairing` is generated and applied locally.
- Backend route/service verification is green.
- Frontend dispatch and driver ordered-pair surfaces are wired and verified with focused tests plus a green build.

## Backend delivered

- Added persisted pairing inputs to `trips`:
  - `planned_start_at`
  - `planned_end_at`
  - `canonical_origin`
  - `canonical_destination`
  - `cargo_weight_kg`
  - `vehicle_capacity_kg`
  - `active_trip_pair_id`
  - `active_trip_pair_order`
- Added `trip_pairs` persistence with ordered first/second trip membership, empty-distance and efficiency metrics, and break metadata.
- Added `backend/src/services/trip-pairs.service.ts` to:
  - validate same-vehicle/same-driver OWN-trip pairing;
  - persist authoritative trip pairing drafts transactionally;
  - block overlap, impossible repositioning, insufficient travel buffer, and overload;
  - break the pair automatically on cancellation or late first-trip completion;
  - expose read summaries for trip list/detail surfaces.
- Hooked lifecycle break behavior into `backend/src/services/trip-status-machine.service.ts`.
- Exposed `POST /api/trips/pairs` as ADMIN/MANAGER-only in `backend/src/routes/trips.ts`.
- Extended trip list/detail reads and the driver `two-orders` read model to return persisted ordered-pair data, including cross-day pairs.

## Frontend delivered

- Dispatch route now admits MANAGER and ADMIN.
- Dispatch page now supports inline two-way pairing on the existing trip cards:
  - select the return trip;
  - enter planned windows, endpoints, cargo weight, and vehicle capacity;
  - show persisted pair metrics and partner-trip summary once paired.
- Driver `Hai lệnh hôm nay` page now prefers the persisted ordered pair and renders:
  - ordered `Chuyến 1` / `Chuyến 2` cards;
  - cross-day pair context;
  - empty-distance / efficiency / time-buffer summary;
  - existing fallback same-day view when no persisted pair exists.

## Files changed

- `backend/drizzle/0141_two_way_dispatch_pairing.sql`
- `backend/drizzle/meta/0141_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/schema.ts`
- `backend/src/routes/trips.ts`
- `backend/src/services/driver.service.ts`
- `backend/src/services/trip-pairs.service.ts`
- `backend/src/services/trip-queries.service.ts`
- `backend/src/services/trip-status-machine.service.ts`
- `backend/src/tests/o01-trip-pairs.routes.test.ts`
- `frontend/src/App.tsx`
- `frontend/src/api/driverClient.ts`
- `frontend/src/api/tripClient.ts`
- `frontend/src/features/dispatch/components/DispatchTripCard.test.tsx`
- `frontend/src/features/dispatch/components/DispatchTripCard.tsx`
- `frontend/src/features/dispatch/hooks/useDispatchMutations.ts`
- `frontend/src/features/dispatch/utils.ts`
- `frontend/src/hooks/useTripQueries.ts`
- `frontend/src/pages/DispatchPage.tsx`
- `frontend/src/pages/driver/DriverTwoOrdersPage.test.tsx`
- `frontend/src/pages/driver/DriverTwoOrdersPage.tsx`
- `shared/src/constants/api-paths.ts`
- `shared/src/index.ts`
- `shared/src/schemas/index.ts`
- `shared/src/types/index.ts`

## QA artifacts

- `qa/2026-07-27_o01-two-way-dispatch_backend-route-test.log`
- `qa/2026-07-27_o01-two-way-dispatch_backend-typecheck.log`
- `qa/2026-07-27_o01-two-way-dispatch_frontend-typecheck.log`
- `qa/2026-07-27_o01-two-way-dispatch_frontend-driver-two-orders-test.log`
- `qa/2026-07-27_o01-two-way-dispatch_frontend-dispatch-card-test.log`
- `qa/2026-07-27_o01-two-way-dispatch_build.log`
- Existing earlier pure-domain artifacts retained:
  - `qa/2026-07-27_o01-two-way-dispatch_backend-test.log`
  - `qa/2026-07-27_o01-two-way-dispatch_typecheck-backend.log`

## Focused results

- `cd backend && npx tsx --test --test-force-exit --test-concurrency=1 src/tests/o01-trip-pairs.routes.test.ts`
  - pass
- `cd backend && npx tsc --noEmit`
  - pass
- `cd frontend && npx tsc -b`
  - pass
- `cd frontend && npx vitest run src/pages/driver/DriverTwoOrdersPage.test.tsx`
  - pass
- `cd frontend && npx vitest run src/features/dispatch/components/DispatchTripCard.test.tsx`
  - pass
- `make build`
  - pass

## Residual notes

- The frontend production build still emits chunk-size warnings for existing large bundles; the build itself is green and no new blocker is introduced by O01.

## 2026-07-27 authority hardening addendum

- Independent-review blocker O01 is fixed in the backend pairing authority path.
- `backend/src/services/trip-pairs.service.ts` now:
  - evaluates pairing eligibility from locked persisted trip fields, not caller-supplied draft values;
  - falls back to persisted trip-container cargo totals when `trips.cargo_weight_kg` is empty;
  - rejects forged schedule, location, cargo-weight, and vehicle-capacity values with a 422 instead of overwriting authoritative state;
  - persists the authoritative trip snapshot back onto the pair members, so the request body can no longer bypass overload, overlap, or location-buffer checks.
- Focused regression coverage was expanded in `backend/src/tests/o01-trip-pairs.routes.test.ts` to prove:
  - forged schedule/location/cargo/capacity requests are rejected through `POST /api/trips/pairs`;
  - direct `createTripPair(...)` calls reject forged cargo/capacity at the service boundary;
  - a matching authoritative payload still succeeds.

Additional QA artifacts:

- `qa/2026-07-27_o01-authority-hardening_backend-route-test.log` (red first run: assertion mismatch in the new verification test)
- `qa/2026-07-27_o01-authority-hardening_backend-route-test-rerun1.log` (green rerun)
- `qa/2026-07-27_o01-authority-hardening_backend-typecheck.log`

## Controller cleanup review

The first focused route artifact used `--test-force-exit`, which hid an open
Redis handle created by authenticated requests. The controller added explicit
HTTP, Redis, and database teardown to the test. The same 3/3 route suite now
exits naturally without force-exit in
`qa/2026-07-27_o01-two-way-dispatch_backend-route-test.rerun5.log`.
The intermediate interrupted teardown diagnostics are retained as red
fix-loop evidence.
