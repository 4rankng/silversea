# Case QA-2026-09-22-04 — Hệ số per-cell fuel-surcharge multiplier (card _59, rulings 5)

- **Case ID:** QA-2026-09-22-04
- **Reported:** 2026-09-22, card `20260922_59` + operator ruling 5 (teammsg 2246); PM đợt-2 definition recorded on the card.
- **Surface:** quotation price grid (Báo giá, card _56's screen on the card-_66 data model) + the fuel-surcharge
  calculation + its snapshot; engine side per `backend/src/services/freight-pricing-engine.service.ts` contract.
- **Status:** case PREPARED — feature not yet implemented (_66 building). Asserts card acceptance + rulings only;
  runnable once _66/_59 land.
- **Engine-gate anchors:** TC-BG-26…TC-BG-30 in `testplan/2026-09-22-bao-gia-…` (2026-09-22 Báo giá & Chi phí
  requirements). This case adds the staged, mouse-through-level proof around those anchors.

## Scope fence (what this case does NOT assert)

Hệ số **meaning** (what business purpose the customer intends, or level granularity beyond cell) stays a
customer question — explicitly OUT of scope here. The case asserts the mechanic only: per-cell factor
(nhà máy × hạng xe), multiplies the fuel surcharge only, default 1, snapshotted. NOT sharePct (verified baked
into Giá cos: ASKEY ×1,04 / NEWEB ×1,02 / SUNRISE+SJ ×1,025 — never double-counted by hệ số).

## Mutation surface (HARD RULE)

Writes are limited to: (a) one hệ số cell on ONE named quotation row (ASKEY · 1.25T) via the grid editor, and
(b) nothing else. No row-action sweeps; no batch edits; positive controls at the end REVERT the cell to 1 and
assert the re-read shows 1. Fixture lot reads are non-mutating.

## Preconditions

- Staging `vantai.tingting.vip` with the LONG MINH quotation seeded on the _66 model: 10 vehicle classes ×
  3 route blocks (NEWEB / ASKEY / SUNRISE+SJ), hệ số default 1 everywhere.
- Fuel parameters fixed on the fixture quotation: Giá dầu tham chiếu = **17.842,593 đ/lít**; the applicable
  Giá dầu kỳ = **29.940 đ/lít** (fixture fuel period; lag per route block stands — NEWEB n=1).
- The engine gate has TC-BG-26/27/28 green in the backend run before the staging rung starts.

## Fixtures (named)

| Fixture | Value |
|---|---|
| Quotation | LONG MINH on the _66 model, all hệ số = 1 |
| Cell under test | ASKEY · Xe 1.25T (liters 20) |
| Control cells | ASKEY · Cont20 (liters 64), NEWEB · Cont40 (liters 91), SUNRISE+SJ · 10T (liters 57,6) |
| Fuel delta | 29.940 − 17.842,593 = **12.097,407 đ/lít** |

## Steps and expected values

1. **Regression — hệ số 1 is byte-identical.** Read every amount on the fixture quotation (API/DB, full
   precision) with all hệ số = 1. Expected: raw fuel surcharge per customer figures — ASKEY 1.25T =
   **241.948,14** (= 12.097,407 × 20); ASKEY Cont20 = **774.234,048** (× 64); SUNRISE+SJ 10T = **696.810,6432**
   (× 57,6); NEWEB Cont40 = **1.100.864,037** (× 91). Giá cos unchanged (1.248.000 / 3.952.000 / 3.162.000 /
   4.160.000 — the contract figures after share). Total per cell = Giá cos + surcharge, unchanged from the
   pre-_59 engine's numbers (TC-BG-26).
2. **Mechanic — hệ số ≠ 1 scales surcharge only.** Edit the ONE cell (ASKEY · 1.25T) to **1,1**; save; re-read.
   Expected: raw surcharge = 241.948,14 × 1,1 = **266.142,954**; Giá cos byte-identical **1.248.000**; cell
   total = 1.514.142,954. Every OTHER cell byte-identical to step 1 (ASKEY Cont20 still 774.234,048;
   NEWEB Cont40 still 1.100.864,037) — proves per-cell scope (TC-BG-27/28).
3. **Snapshot explains the number.** Open the calculation snapshot for the ASKEY · 1.25T cell: it must carry
   the raw inputs (fuel delta 12.097,407 × 20 ℓ), **hệ số 1,1**, the pre/post values, and read back as an
   explanation of 266.142,954 — no recomputation needed outside the app (TC-BG-30).
4. **Clamp stays.** With hệ số = 1,1, temporarily fixture a fuel period where kỳ < mốc (kỳ 16.000 < mốc
   17.842,593): surcharge = **0**, total = Giá cos. Restore the fixture period (TC-BG-29 clamp legacy).
5. **Positive control / revert.** Set the cell back to 1; re-read: 241.948,14 restored; snapshot records the
   revert. No other cell moved (compare full quotation read against step 1 baseline — byte-identical).

## Pass/Fail

- PASS = steps 1–5 all hold at full precision; the only amount that ever differs from the step-1 baseline is
  the single edited cell; snapshot carries hệ số; revert restores the baseline exactly.
- FAIL = any non-edited cell moved (level leak), Giá cos moved (surcharge-only leak), snapshot missing hệ số,
  or the hệ số=1 baseline differs from the pre-_59 engine anywhere on LONG MINH data.

## Rungs

- Engine values (steps 1–4): backend gate transcript (TC-BG-26…30) + API/DB read of the _66 quotation and its
  snapshot table (full-precision values quoted in the evidence).
- Steps 2/3 UI: staging mouse-through on the Báo giá grid — the single-cell edit, the re-read, and the
  snapshot view at 1280–2560; screenshots per the QA evidence hard gate.
