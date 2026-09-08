# QA — Dispatch Lạch Huyện Phase 3: Detailed-plan order and atomic command

- Date: 2026-08-19
- Scope: `qa/2026-08-19_dispatch-lach-huyen_phase3_atomic-plan-command`
- Gate: phase 3 implementation complete, all automated gates green

## What shipped

### Server-owned detailed-plan ordering (`dispatch-planning.service.ts`)
- `dispatchDetailPriorityOrderSql()`: SQL CASE ordering **before** `LIMIT/OFFSET`
  - Cargo rank from canonical codes (`containerTypes.code like '20%'/'40%'`, `fulfillmentType='LCL_SHIPMENT'`), never translated labels: 20' → 40' → LCL → other
  - Direction rank: IMPORT → EXPORT → unknown
  - Transport date ascending, nulls last (`coalesce(..., '9999-12-31')`)
  - `fulfillmentId asc` stable tie-break
- Same `filters` predicate drives rows + count (unchanged shared-filter pattern)
- `classification` (nullable) added to row select + projection; legacy null rows render "Chưa phân loại" client-side
- Client `sortKey` overlay (runHour / deliveryPoint) is a user toggle only; default `null` → server order is authoritative

### Atomic command `PATCH /api/shipments/dispatch-detail-plan-rows/:fulfillmentId/plan`
- Shared contract: `atomicDispatchPlanEditSchema` (zod, shared with frontend) — dual versions (`expectedFulfillmentVersion`, `expectedShipmentVersion`), required `classification`, `isCombined`, full editor field set, cross-field rules:
  - OWN rejects `externalCarrierId`/`externalCarrierVehicleId`/`plateNumber`; EXTERNAL rejects `truckId`
  - `clearVehicle` mutually exclusive with any vehicle field; ≤1 vehicle source
- Service `updateDispatchDetailPlan` → `runIdempotent` (`SHIPMENT_FULFILLMENT_PLAN_UPDATE`) → `updateDispatchDetailPlanInTx`:
  - Lock order: shipment → fulfillment (same as dispatch issuance — deadlock-free)
  - **Guard union** (strongest of every legacy endpoint): actor write scope (`assertActorCanAccessShipment`), accounting lock (`assertShipmentAccountingUnlocked`), `READY_FOR_DISPATCH`, canceled-fulfillment exclusion, live-trip block (`loadLiveTripForFulfillment`), carrier validity (ACTIVE isCarrier customer), carrier↔vehicle compatibility, plate normalization + catalog match, estimate non-negative ints
  - Both rows updated atomically; either-row conflict → 409, nothing written
  - `isCombined` change bumps shipment version **only when the flag actually changes** — flag-preserving saves don't invalidate other tabs
  - Vehicle block optional as a whole (estimates/classification-only saves leave stored vehicle columns untouched); when present, ownership validated against the **incoming** carrier
  - In-app driver notification persisted in-tx, exactly-once (same-truck dedupe + prior-notification probe reuse legacy semantics)
  - Post-commit Web Push best-effort, only on new own-truck transition, never on replay
- Extracted tx-aware helpers shared with legacy paths (behavior-preserving): `resolveDispatchVehicleAssignment`, `decideDispatchDriverNotification`
- Governance registrations:
  - `IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLAN_UPDATE`
  - `MATERIAL_WRITE_RULES` pattern `/api/shipments/dispatch-detail-plan-rows/[^/]+/plan`
  - `REVIEWED_SERVICE_DURABLE_BOUNDARIES` entry in `material-write-registry-exhaustive.test.ts`
  - Audit suffix registration (`PATCH … /dispatch-detail-plan-rows/`, line 170) already covers the sub-path
- Legacy `/carrier`, `/plate`, `/estimates` endpoints untouched and still tested (22 pre-existing tests pass)
- Frontend: `updateDispatchDetailPlan` client fn + `DispatchDetailPlanRow.classification`

## Commands run + results

| Gate | Command | Result |
|------|---------|--------|
| shared build | `cd shared && npm run build` | OK (`tsc` + 24 bare-import fixes) |
| backend tsc | `cd backend && npx tsc --noEmit` | 0 errors |
| backend tests (focused) | `npx tsx --test src/tests/dispatch-detail-plan.test.ts` | **31/31** (24 pre-existing + 7 new: atomic happy path, flat-shipment-version, notify-once+replay, dual-version conflict rollback, carrier/vehicle incompat rollback, classification-required 400s, CUS 403 + accounting-lock 409, cargo-priority ordering) |
| material-write registry | `npx tsx --test src/tests/material-write-registry-exhaustive.test.ts` | 6/6 |
| backend tests (full) | `cd backend && npm test` | **2097/2097, 0 fail** (two consecutive clean runs; one earlier run had a transient 404-vs-403 in an unrelated suite that did not reproduce) |
| frontend tsc | `cd frontend && npx tsc -b` | 0 errors |
| frontend tests | `cd frontend && pnpm test` | **959/959** (172 files) |
| lint | `pnpm lint` | 0 errors (90 pre-existing warnings) |

## Defects found & fixed during gate

1. **Missing material-write registration** → runtime 500 "Material write audit context is incomplete": new endpoint added to `MATERIAL_WRITE_RULES` + registry test map. Caught by the fail-closed audit middleware test.
2. **Vehicle-block optionality**: atomic save originally required a truck for OWN (legacy plate semantics); editor saves that don't touch the vehicle block must not force one → vehicle block now optional as a whole; ownership validated against incoming carrier when present.
3. **Cross-carrier vehicle mixups**: `EXTERNAL + truckId` / `OWN + freeText/catalog vehicle` now rejected at the shared schema boundary (400) instead of being silently ignored.
4. **Duplicated edit fragment** (syntax error) — removed.

## Semantics decisions (documented in code)

- Shipment version bumps **iff** `isCombined` actually changes (lot-level flag; avoids gratuitous optimistic-lock invalidation).
- Vehicle block absent ⇒ stored vehicle columns preserved verbatim.
- `classification` is required on every atomic save; nullable only in persistence (legacy rows).
- isCombined and classification are independent; no trip-pairing inference.

## Out of scope (per plan)

- Editor UI swap to the atomic endpoint (Phase 5 frontend workspaces).
- Vehicle suggestions (Phase 4).
