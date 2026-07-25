---
phase: 2
title: "Wave 1 — Pricing & Fuel Data Layer"
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: Wave 1 — Pricing & Fuel Data Layer

## Overview

Close the **revenue-correctness** gap before any financial-close wave touches P&L. Today the
trip's `revenue` is mostly entered by hand. The PRD wants it computed from pricing rules
(M2) and fuel cost computed from per-route/per-truck norms (M12.1) with photo-OCR input
(M12.3). Garbage in = garbage out for every downstream report, so this wave is sequenced
ahead of Waves 3 and 4.

**PRD modules touched:** M2 (2.1–2.5), M12.1, M12.3.

## Existing code built on

- `pricing_tables` (customer × route × price × effectiveDate) — covers M2.1 partially.
- `road_allowances` (route × trailer-type × baseAmount) — related but distinct.
- `fuel_config` (singleton norms: loaded/empty/supplement/unitPrice) — flat, not per route.
- `fuel_price_history` (unitPrice × effectiveDate).
- `routes` (distanceKm, isMountain, fixedFuelAllowance, defaultLegs jsonb).
- `trips` (rate snapshots, derived fuel/revenue figures, `fuelMode` AUTO/FLAT_RATE).
- LLM services (`backend/src/services/llm/`) and existing OCR endpoint `/api/ocr` already
  recognise container/seal numbers via MiniMax/OpenRouter — reusable for M12.3 pump photos.

## Requirements (mapped to PRD acceptance codes)

- **M2.1 — Fixed customer-route pricing** (partial gap)
  - Already: `pricing_tables` lookup at trip date; rate snapshot stored on trip.
  - Gap: prevent two prices for the same (customer, route, vehicleType) from overlapping
    in effective-date range. Add a constraint / validator. Allow price override before lock
    with mandatory reason; keep both original and applied price (M02-01-03).
- **M2.2 — Weight-tier pricing for bulk cargo** (new)
  - New `weight_pricing_tiers` table: route × cargoType × [minKg, maxKg) × pricePerKg ×
    effectiveDate. No overlapping ranges (M02-02-03).
  - On trip create with a bulk cargo type, system picks the matching tier, multiplies by
    weight, and explains which tier was used (M02-02-01).
  - Weight outside any tier → warn, force manual price with reason (M02-02-04).
- **M2.3 — Auto-revenue from lot weight** (new)
  - On shipment/trip, given actual weight + route + tier → compute freight revenue with a
    visible formula: `weight × tier.pricePerKg + surcharges + VAT`.
  - Recompute when source data changes **before lock**; after lock, require an adjustment
    (M02-03-04). Trips already have adjustment machinery.
- **M2.4 — Lift/up-down (nâng/hạ) price catalog** (new)
  - New `lift_pricing` table: port × containerType × direction(LIFT_UP/LIFT_DOWN) ×
    unitPrice × effectiveDate.
  - Forwarder expense entry suggests the price by port + container type + direction; user
    may override with reason; show suggested/actual/delta (M02-04-01).
  - Reused by M4.6 and M9.3.
- **M2.5 — Non-transport revenue tracking** (new)
  - New `ancillary_revenue` table: customer × (shipment|trip)? × type(LCL/CONSOLIDATION/
    SERVICE_DIFF/OTHER) × amount × tax × date × documentRef.
  - Each entry recorded exactly once; refunds/adjustments use negative amounts with reason
    (M02-05-03). Cannot edit a locked entry (M02-05-04).
- **M12.1 — Fuel norm config** (extension)
  - Extend `fuel_config` from singleton to per-route and per-truck-type norms:
    `fuel_norms` table: routeId? × truckTypeId? × loadedLitersPer100Km × emptyLitersPer100Km
    × flatRateLiters (for mountain routes) × effectiveDate.
  - Trip picks the right norm at trip date; mountain routes use flat-rate if configured
    (M12-01-03). Locked trips do not auto-recompute when config changes later (M12-01-04).
- **M12.3 — Pump-display photo OCR** (new)
  - New endpoint `POST /api/ocr/pump` (sibling to existing `/api/ocr`) that recognises
    litres × unit price = total from a fuel-pump photo.
  - Result is a *suggestion*; cross-check litres × unitPrice ≈ total (M12-03-03). Mismatch,
    blur, or missing EXIF/location → warn and fall back to manual entry (M12-03-03).
  - Store original photo + raw OCR result + confidence + confirmed value + editor.

## Architecture

All new tables live in `backend/src/db/schema.ts`. Pricing lookups go through a new
`backend/src/services/pricing.service.ts` that consolidates today's ad-hoc pricing lookup
in `config.service.ts`. Fuel-norm resolution moves to `backend/src/services/fuel.service.ts`.

Pricing selection rule (single source of truth):
```
resolveFreightPrice({customerId, routeId, vehicleType, cargoType, weightKg, date})
  → if cargoType.isBulk: use weight_pricing_tiers
    else: use pricing_tables
  → return { source: 'TIER'|'TABLE'|'MANUAL', price, formula, snapshotFields }
```

The trip create/update flow calls `resolveFreightPrice`, stores the snapshot on the trip
(extend `trips` with `pricingSource`, `pricingFormula`, `pricingSnapshot jsonb`), and the
UI shows the formula breakdown.

## Related Code Files

- Modify: `backend/src/db/schema.ts` (add 5 tables + extend trips)
- Create: `backend/src/services/pricing.service.ts`, `fuel.service.ts`
- Modify: `backend/src/services/config.service.ts` (delegate pricing to new service)
- Modify: `backend/src/services/trip.service.ts` (auto-revenue on create/update)
- Modify: `backend/src/services/ocr.service.ts` (add pump-photo recognition)
- Create: routes under `backend/src/routes/config.ts` for the new catalogs
- Modify: `frontend/src/pages/config/PricingTablesConfigPage.tsx` (overlap warning UI)
- Create: `frontend/src/pages/config/WeightPricingTiersConfigPage.tsx`
- Create: `frontend/src/pages/config/LiftPricingConfigPage.tsx`
- Create: `frontend/src/pages/config/FuelNormsConfigPage.tsx`
- Modify: trip create/edit UI to show formula breakdown and price-override-with-reason

## Implementation Steps

1. Schema: add `weight_pricing_tiers`, `lift_pricing`, `ancillary_revenue`, `fuel_norms`,
   plus trip pricing-snapshot columns. Generate migration.
2. Build `pricing.service.ts` with `resolveFreightPrice` + overlap validators.
3. Build `fuel.service.ts` with `resolveFuelNorm(routeId, truckTypeId, date)`.
4. Wire auto-revenue into trip create/update; surface formula in trip detail.
5. Add price-override-with-reason flow (reuse adjustment machinery).
6. Add M2.5 ancillary revenue CRUD + report grouping.
7. Extend `ocr.service.ts` with pump-photo recognition; add `/api/ocr/pump` endpoint.
8. Frontend config pages for the 4 new catalogs + trip formula breakdown.
9. Tests: weight-tier boundary (M02-02-03), override-reason retention (M02-01-03),
   locked-trip no-recompute (M12-01-04), OCR mismatch fallback (M12-03-03).

## Success Criteria

- [ ] M02-01-03: overridden price keeps original + reason + editor; locked trip immutable.
- [ ] M02-02-03: overlapping weight tiers rejected; boundary weights pick correct tier.
- [ ] M02-03-01: revenue formula `weight × price + surcharges + VAT` visible on trip.
- [ ] M02-04-01: lift/up-down expense shows suggested / actual / delta / editor.
- [ ] M02-05-03: ancillary revenue refunds use negative amounts with reason; no silent edits.
- [ ] M12-01-03: mountain routes use flat-rate norm when configured; trip shows applied norm.
- [ ] M12-01-04: changing `fuel_norms` later does not recompute a locked trip.
- [ ] M12-03-03: pump-photo OCR returns suggestion + confidence; mismatch falls back to manual.
- [ ] Existing trip P&L still reconciles after the refactor (regression check).

## Risk Assessment

- **Existing `trips.revenue` semantics drift** — today revenue is hand-edited; switching to
  auto-computed changes accountant workflows. Mitigation: keep manual override always
  available with reason; add a `pricingSource` indicator so accountants see whether a number
  is AUTO or MANUAL.
- **Backfill** — historical locked trips should not be re-computed. The resolver is only
  invoked on create/edit, never on read, so historical data is safe by construction.
- **OCR accuracy on pump photos** — Vietnamese pump displays vary widely. Mitigation: always
  require user confirmation; never auto-write fuel figures from OCR alone.

## Open PRD questions to confirm before this wave

- M2.1 §5: confirm price override is allowed before lock (assumed yes).
- M2.2 §3: confirm rounding rule for weight-tier pricing (PRD leaves it open).
- M2.2 §6: unit-of-measure entry — confirm tonnes default; what if entry is in kg?
- M2.3 §5: confirm that post-lock weight change goes through adjustment (assumed yes).
- M2.4 §6: confirm port can change price mid-day handling (PRD lists as edge case).
- M2.5 §1: confirm the four ancillary-revenue types (LCL / consolidation / service-diff /
  other) are the complete set.
- M12.1 §1: confirm whether per-truck-type norms are needed, or per-route is enough.
- M12.1 §5: confirm mountain flat-rate behaviour and whether per-driver exceptions exist.
- M12.3 §6: confirm what counts as "photo metadata trustworthy" (EXIF GPS? phone geotag?).
