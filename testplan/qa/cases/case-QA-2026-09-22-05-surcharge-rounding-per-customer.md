# Case QA-2026-09-22-05 — Per-customer surcharge rounding (card _60, ruling 7)

- **Case ID:** QA-2026-09-22-05
- **Reported:** 2026-09-22, card `20260922_60` + operator ruling 7 (teammsg 2246).
- **Surface:** quotation fuel-parameter block (per-customer rounding rule: hàng nghìn "3 số" / hàng chục nghìn
  "4 số") + the fuel-surcharge calculation + snapshot.
- **Status:** case PREPARED — feature not yet implemented (_66 building). Asserts card acceptance + rulings;
  runnable once _66/_60 land.
- **Engine-gate anchors:** TC-BG-31…TC-BG-36 in the 2026-09-22 Báo giá & Chi phí requirements.

## Scope fence

Rounding applies to the **fuel surcharge ONLY** (ruling 7: the rounding cell sits in the fuel-parameter block;
Giá cos is a contracted number — rounding it would silently rewrite the contract). Nothing here asserts or
permits rounding of Giá cos, the cell total, receivable totals, or any other amount.

## Rounding semantics (verified before writing)

The customer's examples are exact **Excel ROUND semantics: half away from zero** (`=ROUND(x; -n)`). Verified
against every probe used below:

| Probe | 4 số (×10⁴) | 3 số (×10³) |
|---|---|---|
| 241.948,14 | 24,194814 → 24 → **240.000** | 241,94814 → 242 → **242.000** |
| 774.234,048 | 77,4234 → 77 → **770.000** | 774,234 → 774 → **774.000** |
| 696.810,6432 | 69,681 → 70 → **700.000** | 696,81 → 697 → **697.000** |
| 823.250 (customer) | 82,325 → 82 → **820.000** | 823,25 → 823 → **823.000** |
| 825.000 (half-point) | 82,5 → away-from-zero → 83 → **830.000** | — |
| 823.500 (half-point) | — | 823,5 → away-from-zero → 824 → **824.000** |

## Mutation surface (HARD RULE)

Writes: ONE rounding-rule edit on the named fixture customer (LONG MINH) in the quotation's fuel-parameter
block (sequence: unconfigured → 4 số → 3 số → unconfigured). No batch customer edits; no row-action sweeps.
Positive control at the end restores **unconfigured** and asserts the re-read matches the unconfigured
baseline.

## Preconditions

- Staging with the LONG MINH fixture quotation (same seed as case 04), rounding rule **unconfigured**.
- Fuel delta fixture: 29.940 − 17.842,593 = 12.097,407 đ/lít; liters per cell as case 04.
- Backend gate has TC-BG-31…36 green before the staging rung starts.

## Fixtures (named)

| Fixture | Value |
|---|---|
| Customer rule under test | LONG MINH · surcharge rounding: unconfigured → 4 số → 3 số → unconfigured |
| Raw surcharge values | 241.948,14 (ASKEY 1.25T), 774.234,048 (ASKEY Cont20), 696.810,6432 (SUNRISE+SJ 10T) |
| Boundary probes | 823.250 (customer's example), 825.000 (4-số half-point), 823.500 (3-số half-point) |
| Control | Giá cos values from case 04 step 1 (1.248.000 / 3.952.000 / 3.162.000 / 4.160.000) |

## Steps and expected values

1. **Unconfigured = deterministic, raw kept.** Rule unconfigured: read every surcharge — expected exactly
   **241.948,14 / 774.234,048 / 696.810,6432**; nothing rounds, nothing blocks (card criterion 3: the branch
   must be pinned by test, not assumed).
2. **"4 số".** Set LONG MINH · 4 số; re-read. Expected: 241.948,14 → **240.000**; 774.234,048 → **770.000**;
   696.810,6432 → **700.000**; probe 823.250 → **820.000** (customer's own example, exact).
3. **"3 số".** Set 3 số; re-read. Expected: 241.948,14 → **242.000**; 774.234,048 → **774.000**;
   696.810,6432 → **697.000**; probe 823.250 → **823.000** (exact).
4. **Half-away-from-zero at the half-points.** Probe 825.000 at 4 số → **830.000** (not 820.000 — kills
   truncation and banker's rounding). Probe 823.500 at 3 số → **824.000**.
5. **Snapshot carries raw + rounded + rule.** With 4 số on: the ASKEY · 1.25T snapshot shows raw
   241.948,14 AND rounded 240.000, labelled "làm tròn 4 số (chục nghìn)"; readable as an explanation without
   recomputing outside the app (card criterion 4).
6. **Giá cos control.** After every rule change (steps 2–4), re-read Giá cos: **byte-identical** to the
   case-04 baseline. One rounded Giá cos anywhere = FAIL.
7. **Positive control / revert.** Rule back to unconfigured; re-read: the step-1 raw baseline restored
   exactly; Giá cos unchanged.

## Pass/Fail

- PASS = unconfigured keeps raw exactly; 823.250 → 820.000 / 823.000 exact at their rules; both half-points
  round away from zero; snapshots show raw + rounded + rule; Giá cos byte-identical throughout; revert
  restores the raw baseline.
- FAIL = Giá cos or any total rounded; a half-point rounds toward zero; unconfigured branch non-deterministic
  or blocks; snapshot missing raw, rounded, or rule; revert drift.

## Rungs

- Engine values (steps 1–7): backend gate transcript (TC-BG-31…36) + API/DB read of the quotation snapshot
  carrying raw + rounded; the probes are pure arithmetic — proven with real figures in the backend gate.
- UI rung: staging mouse-through on the Báo giá fuel-parameter block — the rule edit, the re-read, the
  snapshot view; screenshots 1280–2560 per the QA evidence hard gate.
