# GPS Actual-Route Database — retire Google routing, capture real GPS tracks

> **Status: `pending approval`** — revised 2026-06-23 per user direction.
> ralplan consensus (Planner → Architect → Critic, 2 iterations) approved the core
> architecture; this revision applies the user's four new decisions (below). One
> load-bearing assumption (segmental slicing) is gated behind a Phase-0 probe.
> Not yet implemented. No source files mutated pending explicit approval.

## User decisions (2026-06-23, authoritative)
1. **Retire Google Directions entirely** — Google's routes are also wrong; remove the call, no Google fallback. *(Google Places autocomplete for the location search box is retained — it is not routing. Flag if it should also go.)*
2. **Store the full GPS trail per trip** — every point, all legs, no aggressive downsampling. "Store all for now."
3. **Build the route database keyed by location pair (A → B)** — segment each trip's trail into its A→B pieces; store the real driven path per pair.
4. **Update the A→B route when new trip data comes in** — each new capture refreshes that pair's route (latest valid drive wins).

## Goal
Replace the wrong Google-Directions polylines with a database of **real, GPS-captured routes** keyed by `(origin, destination)`, built incrementally from each completed trip via the existing Bách Khoa service layer. Multi-leg trips are supported in v1.

## Why
`route_distance_cache.polyline_path` holds Google Directions `overview_polyline.points`, consumed by `trip-queries.service.ts:370-396` (trip-detail) and `gps.service.ts:30-82` (dispatch). Google's suggested route between fuzzy Vietnamese place names is unreliable. The Bách Khoa layer already gives us ground truth: `getJourney()` (full trail) + `getTripSegments()` (real drive-legs with time windows) + `resolveCarId(plate)`.

---

## RALPLAN-DR Summary

### Principles
1. **GPS is the only routing truth.** No Google fallback. Absent captured data ⇒ no line (never a wrong line).
2. **Store all, derive per-pair.** Persist the full trip trail (lossless); derive reusable `(A,B)` routes by segmenting.
3. **Capture off the read path.** Completion hook + admin backfill only.
4. **Segment safely.** Per-leg derivation only when segment/leg alignment is unambiguous; else whole-trip raw + graceful skip.
5. **Idempotent everything** — migrations, upserts, journal reconcile are re-runnable.

### Decision Drivers
1. Accuracy for ALL trips (single + multi-leg) in v1.
2. No new infra (no queue/cron) — fits the awaited post-commit completion pattern.
3. Honest degradation (blank > wrong).

### ADR
- **Decision:** Retire Google Directions; store full GPS trails per trip; build/update per-`(A,B)` routes via time-window segmentation; multi-leg supported.
- **Alternatives retired:** Google COALESCE fallback (user rejected — Google wrong), single-leg-only canonical (superseded — segmentation makes multi-leg feasible), aggressive downsampling (user wants all data stored).
- **Consequences:** Transient blank maps on deploy until backfill; one unvalidated assumption (positional segmentation) gated behind Phase-0 probe.
- **Follow-ups:** consensus route from many samples (median path) once enough data exists; timestamped replay store if needed.

---

## Architecture

```
Trip completes (POST /:id/complete, post-commit)
  └─ captureTripGpsTrack(tripId)   [Promise.race timeout 8s, errors swallowed+logged]
       ├─ resolveCarId(plate)
       ├─ getJourney(carId, range)   ← day-paginated to capture ALL points (beats the 5000 cap)
       ├─ getTripSegments(carId, range)  ← per-drive-leg time windows
       ├─ STORE: trip_gps_tracks (full encoded trail, lossless)
       └─ SEGMENT & DERIVE (only if segmentCount === legCount AND distances sane):
            slice trail by each segment [start,end] → per-leg points
            map segment i → trip_leg i  (positional; both chronological)
            upsert route_polylines keyed by cleaned (leg.origin, leg.destination)
              ← latest-valid-wins (quality floor: pointCount, distance sanity)

Read paths (Google removed):
  trip-queries.service.ts  ── route_polylines only ──▶ JourneyCard
  gps.service.ts           ── route_polylines only ──▶ dispatch / computeRemainingRoute
  maps.service.getDistance ── Google Directions call REMOVED (route_distance_cache dormant)
```

---

## Phased Plan

### P-1 — Journal Reconcile (BLOCKER, manual, prod)
SSH to prod; `SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`. Diff against dev journal (account for missing `0060` forward, idx 59→`0061` jump, prod reportedly stopping at `0049`). Reconcile prod to include `0050`–`0062` so `0063` applies.
**Framing:** `.revert.sql` files on disk are rollback scripts, NOT journal entries.

### P0 — Probe + Utils (validates the one assumption before building)
- **Probe script** (`backend/scripts/probe-gps.ts`, throwaway): for ~5 completed multi-leg trips, fetch `getJourney` + `getTripSegments`; **measure how often `segmentCount === legCount`** and the per-segment distance vs `trip_legs.km`. This is the evidence gate for positional segmentation.
- **Day-pagination** in `getJourney` (or a capture-layer wrapper): split the range by day, concat results → captures ALL points (current `reports.ts:212` `slice(0, 5000)` silently drops the tail of long trips).
- **`utils/polyline-codec.ts`** (new) — `encodePolyline`/`decodePolyline` (Google spec, 1e5). Round-trip test.
- **`utils/place-normalize.ts`** (new) — `placeNormalize(text)`: lowercase, trim, collapse whitespace, strip admin suffixes. **Must be byte-identical to the existing `.trim().toLowerCase()` key** in the two joins — refactor both callers to use it (eliminates key drift).
- **No downsample util needed for storage** (store all). Optional client-side render simplification only if Leaflet perf demands.
**Acceptance:** probe shows segment/leg alignment on the sample set (if alignment is poor, fall back to whole-trip-only display — see Risk); codec round-trips within 1e-5; placeNormalize parity on 20 samples.

### P1 — Schema + Idempotent Migration
- `trip_gps_tracks`: `id`, `tripId` (FK trips ON DELETE CASCADE, unique), `routeId`, `truckId`, `carId`, `licensePlate`, `encodedPolyline` (TEXT, **full lossless trail**), `pointCount` (INT), `distanceKm` (REAL), `startedAt`/`endedAt`, `status` TEXT + CHECK `IN ('ok','partial','empty','failed')`, `segmentMatched` (BOOL — whether per-leg derivation succeeded), `capturedAt`, `errorKind` (TEXT nullable). Index `(routeId)`, `(truckId, endedAt)`.
- `route_polylines`: `origin`/`destination` (cleaned TEXT), `encodedPolyline` (TEXT), `pointCount` (INT), `distanceKm` (REAL), `sourceTrackId` (FK trip_gps_tracks ON DELETE SET NULL), `routeId`, `derivedAt`. **UNIQUE `(origin, destination)`.**
- Migration `0063_gps_route_tracks.sql`: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, constraints via `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=...) $$`; `status` CHECK via DO-block (NOT inline, NOT enum — avoids `ALTER TYPE`/`DROP TYPE` traps). Paired `0063_gps_route_tracks.revert.sql`. Journal entry appended ONLY.
**Acceptance:** applies twice cleanly; `.revert.sql` drops both; tsc clean.

### P2 — Capture Service (`services/gps/capture.service.ts`, new)
`captureTripGpsTrack(tripId)`:
1. Load trip + legs + truck.licensePlate + routeId. **SKIP if `status === CANCELED`**.
2. Idempotency: skip RAW write if a non-`failed` `trip_gps_tracks` row exists (re-derive still allowed).
3. `carId = await resolveCarId(plate)`. Null/timeout ⇒ `status='empty', errorKind='portal_timeout'`, return.
4. Window: `departureDate 00:00 (UTC+7)` → `completedAt ?? now`, padded ±1h.
5. `journey = await getJourneyPaged(carId, range)` (day-paginated, ALL points). Empty ⇒ `status='empty'`.
6. **STORE full trail** (encoded, lossless) in `trip_gps_tracks` + `pointCount`, `distanceKm` (haversine sum), `startedAt`/`endedAt`.
7. **Segment & derive** (only when safe):
   - `segments = await getTripSegments(carId, range)`.
   - Guard: `segments.length === legs.length` AND for each i, `abs(segments[i].distanceKm − legs[i].km)/legs[i].km < 2.0`. Else set `segmentMatched=false`, skip derivation (whole-trip raw still stored). Log mismatch.
   - For each i: slice `journey` points to `seg.startTime ≤ t ≤ seg.endTime`; encode; upsert `route_polylines` keyed by `placeNormalize(legs[i].origin)` / `placeNormalize(legs[i].destination)`.
   - **Latest-valid-wins** (not distance-ranked): upsert unconditionally on each new valid capture, but reject candidates failing the quality floor (`pointCount < 20` or segment distance `> 3× leg.km`). Set `sourceTrackId`, `derivedAt=now`.
8. Structured logging + failure metric: `portal_timeout`, `empty`, `segment_mismatch`, `quality_rejected`, `ok`.
**Acceptance:** unit/integration — full trail stored (no truncation); per-leg derivation when aligned; whole-trip-only when not; CANCELED skip; latest-valid-wins upsert.

### P3 — Retire Google + Repoint Joins
- **Remove the Google Directions call** from `maps.service.getDistance` (`backend/src/services/maps.service.ts:99-190`). The `GET /api/maps/distance` endpoint either returns null/empty for polyline+distance, or is removed; `RoutesConfigPage` km-prefill becomes manual entry (verified: `route_distance_cache.distance_km` is NOT in financial calc — `trip_legs.km`/`routes.distanceKm` are authoritative). `route_distance_cache` table left **dormant** (no destructive drop in v1).
- **Keep** `/api/maps/autocomplete` (Google Places — location search, not routing). *(Confirm with user.)*
- Repoint BOTH joins to `route_polylines` ONLY (no Google COALESCE):
  1. `trip-queries.service.ts:370-396` → read `route_polylines.encoded_polyline` by cleaned `(origin,destination)`.
  2. `gps.service.ts:30-82` (`fetchLegsWithRoutes`) → same.
  3. `maps.service.ts` (3rd consumer) → no longer reads polyline for trip display (Google removed).
- Kill-switch flag `enableGpsRoutes` (Zod, `ENABLE_GPS_ROUTES`, default **true**): when false, joins return null (no line). Lets us disable without redeploy. No Google to fall back to.
**Acceptance:** no Google Directions call remains (grep clean); joins return GPS polyline or null; flag=false ⇒ no lines.

### P4 — Completion Hook + Backfill + Recapture + Casbin
- `routes/trips.ts:163-186`: before `res.json(trip)`, `await Promise.race([captureTripGpsTrack(trip.id), timeout(8000)]).catch(err => log.warn(...))`. Fits the existing awaited post-commit block.
- **Backfill is now critical** (no Google fallback ⇒ blank maps until seeded). `POST /api/v1/admin/gps/backfill` (range or tripIds): iterate COMPLETED/LOCKED trips **sequentially** (`for...of await`), CANCELED skip, per-trip try/catch. Run on deploy day to repopulate maps.
- `POST /api/v1/admin/gps/recapture/:tripId`: force re-capture + re-derive (also re-derives any `route_polylines` whose `sourceTrackId` belongs to this trip).
- Casbin `gps-admin` action (ADMIN + MANAGER only); DRIVER/ACCOUNTANT-write ⇒ 403.
**Acceptance:** backfill sequential, idempotent; recapture re-derives; RBAC 403 for unauthorized.

### P5 — (Future enhancement, not v1) Consensus route
Once many trips exist per `(A,B)` pair, compute a **median/consensus path** instead of latest-wins (robust to one-off detours). Out of scope for v1.

---

## Critical Files

| Layer | File | Change |
|---|---|---|
| config | `backend/src/config/index.ts` | Add `enableGpsRoutes` Zod field (default true) |
| schema | `backend/src/db/schema.ts` | Add `trip_gps_tracks`, `route_polylines` |
| migration | `backend/src/db/migrations/0063_gps_route_tracks.sql` (+ `.revert.sql`) | Idempotent DDL + DO-block CHECK; paired rollback |
| journal | `backend/src/db/migrations/_journal.json` | Append `0063` entry ONLY |
| capture | `backend/src/services/gps/capture.service.ts` (new) | full-trail capture, day-pagination, segmentation, latest-wins upsert |
| reports | `backend/src/services/gps/reports.ts` | add `getJourneyPaged` (day-paginated) keeping `getJourney` |
| util | `backend/src/utils/polyline-codec.ts` (new) | encode/decode (1e5) |
| util | `backend/src/utils/place-normalize.ts` (new) | `placeNormalize` (refactor the 2 join callers) |
| route | `backend/src/routes/trips.ts:163-186` | 8s-race capture hook before `res.json` |
| route | `backend/src/routes/admin-gps.ts` (new) | backfill + recapture |
| query | `backend/src/services/trip-queries.service.ts:370-396` | read `route_polylines` only |
| query | `backend/src/services/gps.service.ts:30-82` | read `route_polylines` only |
| service | `backend/src/services/maps.service.ts:99-190` | **REMOVE** Google Directions call; `route_distance_cache` dormant |
| casbin | `backend/src/casbin/policy.csv` | `gps-admin` action ADMIN+MANAGER |
| router | `backend/src/index.ts` | mount admin-gps |

---

## Risk Register

| Risk | Mitigation |
|---|---|
| **Segmentation positional match unvalidated** (the one assumption) | **Phase-0 probe** measures alignment before building; graceful whole-trip fallback if `segmentCount ≠ legCount` or distances off |
| **Blank maps on deploy** (no Google fallback until backfill) | Sequence deploy → immediate backfill of historical trips; transient window acknowledged; `enableGpsRoutes=false` kill-switch if needed |
| **Long-trip truncation** (5000 cap drops tail) | Day-paginated `getJourneyPaged` captures ALL points |
| **Storage growth** (full trails) | ~15KB/trip encoded; tens of MB for thousands of trips — fine for PG. Monitor; future retention policy if needed |
| **Concurrent completion race** (same A→B pair) | Latest-valid-wins upsert on unique `(origin,destination)` index serializes conflicts |
| **Detour overwrites a good route** (latest-wins) | Quality floor rejects `pointCount<20` / `distance>3×leg.km`; consensus path (P5) is the long-term fix |
| **Place-name orphaning** (leg edited post-capture) | Recapture re-derives; orphaned canonicals re-seeded by next trip on that pair |
| **Prod journal drift blocks `0063`** | P-1 manual reconcile before `0063` |
| **Unauthorized backfill** | Casbin `gps-admin` ADMIN+MANAGER only |
| **Capture failures silent** | Structured logs + failure metric (`portal_timeout`, `empty`, `segment_mismatch`, `quality_rejected`) |
| **Portal 8s timeout blocks completion** | `Promise.race(timeout(8000))` + `.catch`; recover via backfill |

---

## Verification Plan

**Unit (`cd backend && npm test`):**
- `polyline-codec.round-trip.test.ts`
- `place-normalize.parity-with-existing-key.test.ts`
- `gps-capture.stores-full-trail-no-truncation.test.ts`
- `gps-capture.segment-derives-when-aligned.test.ts`
- `gps-capture.whole-trip-fallback-on-mismatch.test.ts`
- `gps-capture.latest-valid-wins-upsert.test.ts`
- `gps-capture.skips-canceled.test.ts`

**Integration:**
- `completion-hook.writes-tracks-and-polylines.test.ts`
- `completion-hook.respects-8s-race.test.ts`
- `joins.read-route_polylines-only.test.ts` (assert Google never read)
- `enableGpsRoutes.false-returns-null.test.ts`
- `admin-gps.rbac-403.test.ts`
- `admin-gps.backfill-sequential-skip-canceled.test.ts`
- `migration.0063-idempotent-apply-twice.test.ts`

**Manual e2e (vantai first):**
1. Backfill a historical multi-leg trip ⇒ its map shows the **real** driven line per leg.
2. Complete a new single-leg trip ⇒ real line.
3. Complete a 2nd trip on the same A→B pair ⇒ that pair's route refreshes (latest wins).
4. Confirm **no Google line anywhere** (grep network for `maps.googleapis.com/maps/api/directions` ⇒ absent).
5. A pair with no captured data yet ⇒ no line (not a wrong line).

**Type checks (3 CI commands):** backend, frontend, shared `tsc --noEmit`.

---

## Rollout (manual — CI/CD billing-blocked)
1. **P-1:** SSH prod, reconcile `__drizzle_migrations`.
2. Deploy schema + code (`ENABLE_GPS_ROUTES=true`).
3. Verify via psql: tables exist, journal idx `0063` present.
4. **Immediately run backfill** on COMPLETED/LOCKED trips (date range) to seed `route_polylines` — closes the transient blank-window.
5. vantai: separate SSH to `/opt/vantai`; repeat.
6. Monitor capture-failure metric + status mix for 24h.
7. **Rollback:** `ENABLE_GPS_ROUTES=false` (maps go blank, no wrong data); `.revert.sql` drops tables if a full revert is needed (manual). Re-enabling Google would require restoring `maps.service.getDistance` + the join — intentionally not kept as a one-liner (user retired it).

---

## Resolved (from prior round) & Remaining
- ✅ Multi-leg: supported in v1 via segmentation (was deferred).
- ✅ Reversibility: kill-switch flag (no Google to restore).
- ✅ Storage: full trails, no downsample.
- ✅ Race: latest-valid-wins on unique index.
- ✅ Truncation: day-pagination.
- ✅ RBAC, CANCELED skip, observability, migration idempotency.
- ❓ **Confirm:** keep Google Places autocomplete? (Plan assumes yes.)
- ❓ **Confirm:** accept transient blank maps on deploy until backfill completes?
- ❓ **Probe gate:** Phase-0 must show reasonable segment/leg alignment, else v1 falls back to whole-trip-only display (still accurate, just not per-leg keyed).
