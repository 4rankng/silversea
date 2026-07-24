# GPS geotag foundation module shipped — complete, callable, and deliberately inert

**Date**: 2026-07-24 20:30
**Severity**: Medium
**Component**: cross-monorepo — shared / backend / frontend (event-driven GPS capture → store → submit → view)
**Status**: Shipped, not integrated

## What Happened

Built the mobile GPS geotagging foundation across the silversea monorepo: a Zod schema in `@tingting/shared`, a `photo_geotags` table + service + `/api/geotag` route in backend, and `useGeolocation` + a `geotagClient` in frontend. Tests green (shared 144 incl. 10 new, backend 746/746 incl. 5 freshness, frontend 212/212 incl. 6). Then stopped. Intentionally did **not** wire it into M8.5 container/seal, M9.5 port-receipt, or M12.3 fuel-pump uploads. That's the explicit "next time" the user asked for. The module ships complete and callable but inert.

## The Brutal Truth

This is the satisfying kind of stop, not the panicked kind. Every instinct screamed "wire one consumer in, prove it end-to-end" — and saying no to that is harder than shipping more code. The temptation to demonstrate value by gluing it into a real upload flow is real, because a foundation with zero callers feels like a bet nobody's taken. But shipping it inert with a clear contract is the correct call: it keeps the surface area reviewable and lets three integration teams land against a stable seam instead of a moving one. The uncomfortable part is admitting the verification is unit-level only. No camera button has ever pressed through this pipe.

## Technical Details

- **Schema** (`shared/src/schemas/geotag.ts`): `entityType` enum `['trip_photo','trip_expense_photo','expense_photo']`, lat/lng bounds, `accuracy`/`altitude`/`gpsAt`/diagnostics, Vietnamese messages. Barrels wired.
- **Table** (`backend/drizzle/0110_cheerful_gabe_jones.sql`): polymorphic `photo_geotags(entity_type, entity_id, ...)`, `doublePrecision` coords, `recorded_by` FK, and the load-bearing `CREATE UNIQUE INDEX photo_geotags_entity_uniq ON (entity_type, entity_id)` — gives upsert idempotency (M0X-HT-04).
- **Service** (`backend/src/services/geotag.service.ts`): freshness gate ported from payroll — `GPS_FRESHNESS_MAX_STALE_S = 300`, `GPS_FRESHNESS_MAX_SKEW_S = 60`; rejects fixes >300s stale or >60s future. Per-entity ownership resolution returns 404 (not 403), matching `photo-authz.service.ts`.
- **Authz**: 8 Casbin rows — DRIVER/FORWARDER/MANAGER/ACCOUNTANT read+write, ADMIN via wildcard.
- **Client** (`frontend/src/lib/gps/geolocation.ts`, `useGeolocation`): warm-fix `watchPosition`, accuracy-pause ≤50m, visibility-pause, 15s freshness expiry, `awaitAccurateSample`. One-shot `getCurrentPosition` rejected.

## What We Tried

- **EXIF geotagging** — ruled out. The upload pipeline strips EXIF via Sharp, so EXIF would never survive to storage. Explicit JS capture via `navigator.geolocation` is the only path.
- **Adding lat/lng columns to each of the 3 photo tables** — rejected for a polymorphic table. One migration, extensible to future entities, single service.

## Root Cause Analysis

There was no bug here — but the load-bearing insight is the gap it exposes. Existing GPS in this codebase is **truck-only and server-pulled** (Bách Khoa hardware writes `trip_gps_tracks` / `vehicle_last_positions`). The frontend had **never** called `navigator.geolocation`; `ContainerScanner.tsx` literally carried the comment *"Geolocation is intentionally omitted."* So phone-side GPS capture was genuinely greenfield on the client. We did not invent the capture pattern — we ported the proven client-side logic from the Go/Gin/MySQL payroll reference (warm-fix watch, freshness window). The payroll code gave us the *patterns*, not the code. That distinction matters and is why it ported cleanly.

## Lessons Learned

- **Port patterns, not code.** The payroll reference gave us the warm-fix + freshness-gate shape; reimplementing in TS preserved domain fit without dragging in a foreign runtime. Copy-paste across languages rots.
- **Ship the seam before the consumers.** Inert-but-complete beats half-wired-and-moving. Reviewers got a stable contract; integrators get a frozen target.
- **404-not-403 is an ownership posture, not a typo.** Returning 404 for entities a user can't see avoids leaking existence. Matched the existing `photo-authz.service.ts` on purpose.
- **Phantom coverage is real coverage debt.** shared had no test runner wired — 144 tests "passing" was a lie until `tsx` was hooked up (fix M1). A suite that can't run isn't a suite.
- **Validate, don't cast, on read paths.** The GET route originally *cast* `entityType` instead of validating it (fix L1). Casts lie about bad input instead of rejecting it.

## Next Steps

1. **M8.5** — wire `useGeolocation` into the driver container/seal photo capture; submit via `geotagClient` on upload success. **Owner:** driver-portal dev.
2. **M9.5** — port-receipt photo (forwarder) reuses the same seam. **Owner:** forwarder-portal dev.
3. **M12.3** — fuel-pump expense receipt via `expense_photo` entityType. **Owner:** accountant-portal dev.
4. **End-to-end verification** — none exists yet. First consumer (M8.5) must add an integration test covering the full capture→submit→view round trip. Until then, the 1102 tests prove the parts, not the product.
