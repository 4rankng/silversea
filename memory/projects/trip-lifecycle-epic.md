# Trip Lifecycle Epic (Track 1)

**Status:** Phases 1–3 complete, Phase 4 (Hardening) in progress
**Source:** `docs/implementation-plan/trip-lifecycle-epic.md`
**Tracking:** `TASKS.md`

## What It Is
E2E implementation of the complete trip lifecycle: shared math, backend schema/API, frontend pages, and hardening tests. 50+ tasks across 4 phases.

## Progress

### Phase 1 — Foundation: Shared math + Backend schema ✅
- `round2dp()` helper
- `computeTripTotals()` pure function with exhaustive tests
- Money Zod `.transform(Number)` boundary
- Conditional `fuelSupplementReason` validation
- Extended trips table: identity + concurrency + rate snapshot cols
- `road_config` single-row table
- `trip_code_counters` table
- `trip_photos` table (replaced `photoUrls` jsonb)
- Drizzle migration generated and applied
- `StorageService` + `LocalStorageService`

### Phase 2 — Backend API ✅
- Refactored trip service to use shared `computeTripTotals`
- Rate snapshotting in createTrip + updateTripFigures
- Atomic `tripCode` generation (`TRP-{YYYYMM}-{0000}`)
- Pricing lookup on create (timezone-pinned to Asia/Ho_Chi_Minh)
- Optimistic concurrency via `version` column
- `LedgerService` with sorted advisory locks
- Lock procedure (status flip + ledger + audit in one txn)
- Full state-transition matrix with role checks
- Adjustment endpoint (`POST /api/ledger/adjustments`)
- Secure file upload (magic-byte, MIME, HEIC→JPEG, EXIF strip)
- Authenticated photo download
- Photo completion requirement gate
- Catalog bootstrap endpoint
- On-demand pricing endpoint
- Driver endpoints with allowlisted DTO
- Expanded audit logging

### Phase 3 — Frontend ✅
- TanStack Query & Table configured
- `tripClient.ts` typed fetch wrappers
- `useCatalogs` hook (5min stale)
- `round2dp` FE re-export
- TripLegFields, FuelConfigurator, AllowanceConfigurator, TotalsPanel, PhotoUploader
- TripCreatePage, TripEditPage, TripListPage
- Driver mobile pages (read-only, allowlisted)
- 409 optimistic-concurrency UX
- 422 zero-revenue lock confirmation

### Phase 4 — Hardening 🔄
Remaining integration tests:
- T4.1: Ledger balance integrity (parallel locks, same customer)
- T4.2: Deadlock prevention (two trips sharing entities)
- T4.3: Lock atomicity (forced mid-txn failure → full rollback)
- T4.4: Rate snapshotting (all 7 cols)
- T4.5: Optimistic concurrency (two PUTs same version → one 409)
- T4.6: Driver isolation (no sensitive cols in response)
- T4.7: State-machine transition unit tests

Completed:
- T4.8: DB revoke UPDATE/DELETE on ledger
- T4.9: Persistent upload volume + backup
- T4.10: Periodic ledger reconciliation

## Key People
- Backend services: `trip.service.ts`, `ledger.service.ts`, `reporting.service.ts`
- Frontend pages: `TripCreatePage`, `TripEditPage`, `TripListPage`, `TripDetailPage`
- Shared math: `shared/src/calculations/`

## Context
This was the primary development focus. All core business logic flows through the trip lifecycle.
