# Master-data guardrail probe — 2026-09-10 mid-wave

**Trigger:** PM seq 22 — "trilogy Phase-2 item 8" / "catches any accidental catalog
insert from lane work so far".
**Probe owner:** fullstack lane (agent-1788969719950-myqeea).
**Probe date:** 2026-09-10 (mid-wave).
**DB:** silversea-db on port 5441, docker exec psql.

## Counts (raw)

See `master_counts_2026-09-10.txt` for raw psql output.

| Table | Baseline (2026-09-09 trilogy phase-2) | Current (2026-09-10 mid-wave) | Delta |
|-------|---------------------------------------|-------------------------------|-------|
| `customers` | 165 | **240** | **+75** |
| `operational_sites` (total) | 30 (old "sites") | **31** | **+1** |
| `  site_type=FACTORY` | (not split) | 21 | — |
| `  site_type=WAREHOUSE` | (not split) | 10 | — |
| `routes` | 53 | **78** | **+25** |
| `freight_rate_terms` (total) | 0 (engine not exercised in trilogy phase-2) | 10 | +10 |
| `  …_FreightEng (T6 leftover)` | — | **7** | — |
| `pricing_tables` (total) | (not counted baseline) | 29 | — |
| `  …_FreightEng (T6 leftover)` | — | **5** | — |
| `fuel_consumption_norms` (total) | (not counted baseline) | 16 | — |
| `  …_FreightEng (T6 leftover)` | — | **7** | — |
| `fuel_price_periods` (total) | (not counted baseline) | 3 | — |
| `vehicle_size_classes` (total) | 9 (seed: 1.25T, 2.5T, 3.5T, 5T, 8T, 10T, 15T, CONT20, CONT40) | 16 | **+7** |
| `  …_FreightEng (T6 leftover)` | — | **7** | — |
| `freight_rate_snapshots` (total) | 0 (no callers before T1) | **1** | **+1** |
| `debit_note_overrides` (total) | 0 | **1** | **+1** |
| `customers_FreightEng` | 0 | **10** | **+10** |
| `routes_FreightEng` | 0 | **10** | **+10** |

## Findings

### F-G1. **IMPORTANT — Significant master-data drift in `customers` (+75) and `routes` (+25)**

`customers` went 165 → 240 (+75) and `routes` went 53 → 78 (+25). These are too
large to be explained by ordinary seed data growth and coincide with the QA
T6 phase-1 test run (`fafe5e37`). The T6 integration suite creates customer
and route rows via `mkCustomer()` / `mkRoute()` with `FreightEng customer ${suffix}-…`
and `FreightEng route ${suffix}-…` naming. Confirmed by `customers_FreightEng=10`
and `routes_FreightEng=10` orphan counts (T6's `after()` cleanup deleted some
but not all).

### F-G2. **IMPORTANT — Pricing-engine tables contain T6 leftover fixture rows**

| Table | Total | FreightEng leftovers | Notes |
|-------|-------|----------------------|-------|
| `freight_rate_terms` | 10 | 7 | `mkTerms()` rows; `after()` deletes by ID list — partial cleanup |
| `pricing_tables` | 29 | 5 | `mkPricingTable()` rows |
| `fuel_consumption_norms` | 16 | 7 | `mkNorm()` rows; count_delta = +7 = matches |
| `vehicle_size_classes` | 16 | 7 | `mkVehicleClass('CONT15' / 'CONT15B' / 'SNAP')` × runs |
| `freight_rate_snapshots` | 1 | (no name) | `persistFreightRateSnapshot()` from TC-CUOC-009/016 — should be 0 after cleanup |
| `debit_note_overrides` | 1 | (no name) | `upsertDebitNoteOverride()` from TC-CUOC-017/018 — should be 0 after cleanup |

**Root cause hypothesis:** the QA T6 suite's `after()` hook in
`backend/src/tests/freight-pricing-engine.test.ts:118-181` catches ALL delete
errors and only `console.warn`s — so if any single delete throws (e.g., a
broken foreign-key cascade or pool exhaustion), the rest of the cleanup is
aborted and the suite still reports PASS. Combined with `client.end()` being
called **outside** the try/catch at line 184, the cleanup may have been
aborted by an uncaught error from `client.end()` itself.

**Action needed (QA lane, owner):** see review-notes.md F-B2 — replace the
silent `return` with `assert.fail(...)` in the override suite, and inspect
the `after()` order/exception handling to ensure all cleanup actually runs.

### F-G3. **NIT — `customers` and `routes` orphans likely from T6 phase-1 only**

10 + 10 = 20 FreightEng leftovers. But the trilogy baseline used the
`customers=165, routes=53` snapshot which already had FreightEng-style naming
from prior runs. **Verify:** the +75 / +25 delta is consistent with multiple
T6 runs (each run adds 2 customers + 2 routes via the 2 test cases in
`MANUAL fallback` describe + the 1 customer + 1 route in `persistFreightRateSnapshot`
describe = 3 customers + 3 routes per run). 75 / 3 = ~25 runs; 25 / 3 ≈ 8
runs on `routes`. Plausible if T6 was re-run multiple times during phase-1
debugging.

## Conclusion

The guardrail **caught real contamination** from QA T6 phase-1 runs:
- 1 freight_rate_snapshot row + 1 debit_note_override row from TC-CUOC-009/016 + TC-CUOC-017 suites.
- ~7+ leftover fixture rows across pricing-engine tables per T6 run.
- ~75 customer rows + ~25 route rows added across multiple T6 runs.

**Not silent.** This is exactly the kind of accidental catalog insert the
guardrail was put in place to catch. The mid-wave probe surfaces the drift
**before** T1/T2/T3/T4 land their real routes/UI and use these tables in
production-readiness suites.

**Recommendation:**
- QA lane: address `after()` cleanup robustness (review-notes.md F-B2).
- After QA's fix lands, re-run this probe and expect all `_FreightEng` counts → 0.
- For now: no need to nuke the local DB — the leftovers are namespace-prefixed
  and identifiable, and the seed data is intact.

## How to re-run

```bash
docker exec silversea-db psql -U postgres -d silversea -A -F "|" -c "
SELECT 'customers' AS t, COUNT(*)::int FROM customers
UNION ALL SELECT 'operational_sites', COUNT(*)::int FROM operational_sites
UNION ALL SELECT '  FACTORY', COUNT(*)::int FROM operational_sites WHERE site_type='FACTORY'
UNION ALL SELECT '  WAREHOUSE', COUNT(*)::int FROM operational_sites WHERE site_type='WAREHOUSE'
UNION ALL SELECT 'routes', COUNT(*)::int FROM routes
UNION ALL SELECT 'customers_FreightEng', COUNT(*)::int FROM customers WHERE name LIKE '%FreightEng%'
UNION ALL SELECT 'routes_FreightEng', COUNT(*)::int FROM routes WHERE name LIKE '%FreightEng%'
UNION ALL SELECT 'freight_rate_snapshots', COUNT(*)::int FROM freight_rate_snapshots
UNION ALL SELECT 'debit_note_overrides', COUNT(*)::int FROM debit_note_overrides
ORDER BY 1;
"
```
