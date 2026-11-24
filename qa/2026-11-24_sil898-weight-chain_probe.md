# SIL-898 — declared-weight chain probe (freeze + row display) against restored staging repro rows

Date: 2026-11-24 · Lane: fix/sil-898-dispatch-weight · QA gate: behavioral probe (not a unit test — DB IO)

## Method

Staging DB (vantai) dumped READ-ONLY (`pg_dump`) and restored into a throwaway local database
`silversea_probe` (container `ss-prod-db`); the live dev DB was untouched. The changed freeze
(`deriveLotPricingGrounds` → `resolveDeclaredCargoWeightKg` → `classifyLotPricingBasis`) and the
changed row read (`listDispatchDetailPlanRows`) were executed directly against the repro rows
QA round 8 reported (R3Q-676-2 / R3Q-680-B, role dungnv). Probe scripts were throwaway and
deleted after the run; the probe database was dropped.

## Staging ground truth (audit_logs + rows)

- shipment 808 `R3Q-676-2`: container 765 `RTAU4012043` cargo_weight_kg **NULL**, lot NULL,
  **no trips**; family R3Q-676 siblings (807/814/815) containers declare **5000.00** each.
- shipment 810 `R3Q-680-B`: container 767 `RTAU4012043` cargo_weight_kg **0.00** (zeroed
  07/11 16:32 by the dispatcher's own container-line write, audit 16076), lot NULL, three
  **canceled trips (437/438/444) whose trip_containers snapshot 5000.00**.
- audit trail: 16:30:49 weight "5000" written → 16:31:01 dispatch SUCCEEDED → 16:31:32 trip
  canceled → 16:32:10 weight "0" written → next issue 409 "Thiếu trọng tải".

## Freeze results (before → after)

| Lot | Before fix | After fix |
|---|---|---|
| 808 R3Q-676-2 (container NULL, family unanimous 5000) | SKIP MISSING_WEIGHT → 409 | **LOCK CONT20.LIGHT weightKg=5000** (family step) |
| 810 R3Q-680-B (container 0.00, own trips @5000) | SKIP MISSING_WEIGHT → 409 | **LOCK CONT20.LIGHT weightKg=5000** (own-trip step) |
| 807 / 814 healthy siblings (container 5000) | LOCK | LOCK — unchanged |
| PROBE-C synthetic: family declares 5000 AND 21000 | — | **SKIP MISSING_WEIGHT** (disagreement → no inheritance, never a default) |
| PROBE-D synthetic: family declares nothing | — | **SKIP MISSING_WEIGHT** (honest block kept) |

## Row display results (read parity, dispatcher actor)

| Lot | displayed container.cargoWeightKg | cargoWeightKgRaw (editor seed) |
|---|---|---|
| 807 / 814 / 815 | "5000.00" (unchanged) | own column |
| 808 | **"5000"** (chain-inherited) | null (own column empty — editor stays honest) |
| 810 | **"5000"** (own canceled-trip weight) | "0.00" (own column) |

## Not covered

- Live HTTP + click-through on /dispatch-detail with the running SPA (UI DRIVEN rung 3):
  not driven from this lane — verification is service-level execution against the restored
  staging rows (rung 2, DB/API verified). QA's staging repro remains the UI evidence path.
- Own-trip step for an OWN-carrier lot: staging repro is EXTERNAL; the trip-container join is
  carrier-agnostic and unit-pinned by source law.
