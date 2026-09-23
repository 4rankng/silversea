# Case QA-2026-09-22-06 — Container price-class selection by cargo weight (card _58 selection half, ruling 4)

- **Case ID:** QA-2026-09-22-06
- **Reported:** 2026-09-22, card `20260922_58` + operator ruling 4 (teammsg 2246); PM đợt-2 note recorded on the card.
- **Surface:** quotation price grid (4 container classes per customer quotation, card _66 model) + lot pricing
  (price-column choice from container type + cargo weight entered by cus/điều vận).
- **Scope note:** the container-class **catalog half** (creating the 4 classes + migrations) is FullStack's _58
  catalog-half job — NOT this case's surface. This case covers the **selection half**: price-column choice from
  container type + entered cargo weight, the boundaries, the missing-weight block, and the labels.
- **Status:** case PREPARED — feature not yet implemented (_66 building). Asserts card acceptance + rulings;
  runnable once _66/_58 land.
- **Engine-gate anchors:** TC-BG-18…TC-BG-25 in the 2026-09-22 Báo giá & Chi phí requirements.

## Scope fence

- **In scope:** the 4-class grid + selection mechanics only — weight → column choice, the three boundaries,
  the missing-weight block, and catalog labels verbatim.
- **Out of scope:** the catalog/migration half of _58 (FullStack's current lane job); the empty-heavy-cell
  inherit rule (ruling Q2 đợt 2, owned by card _66) — noted here only so a runner doesn't mistake it for a
  FAIL: with cargo weight present but the heavy cell blank, pricing does NOT block; it inherits the light
  price and is marked **giá tạm** (UI must show the inheritance). Do not assert either way in this case.
- Fuel norms do NOT change with weight (customer file: Cont20 64/64 ℓ, Cont40 70/70 ℓ) — weight switches only
  the price column; any liters change = FAIL.

## Mutation surface (HARD RULE)

Writes: the **trọng tải (cargo weight)** field on ONE named fixture lot per step, entered by the cus/điều vận
role on the fixture lot's intake form — single edits, one field, reverted by the positive control. No
row-action sweeps; no batch weight edits; no quotation grid edits in this case.

## Preconditions

- Staging with the LONG MINH fixture quotation (cases 04/05 seed) carrying the 4 container classes with
  distinct prices so the selected column is observable: Cont20 nhẹ/nặng = 3.900.000 / 4.200.000 (fixture);
  Cont40 nhẹ/nặng = 4.160.000 / 4.460.000 (fixture).
- A fixture lot LONG-MINH-QA with a Cont20 row and a Cont40 row, pricing visible.
- Backend gate has TC-BG-18…25 green before the staging rung starts.

## Fixtures (named)

| Fixture | Value |
|---|---|
| Fixture lot A | LONG-MINH-QA-A, Cont20 row, cargo weight editable by cus/điều vận |
| Fixture lot B | LONG-MINH-QA-B, Cont40 row, same |
| Fixture weights | 18 t (nhẹ), 22 t (nặng), 20,0 t (boundary), 15 t (Cont40 nhẹ), 25 t (Cont40 nặng) |
| Grid | 4 container classes, distinct fixture prices so the chosen column is visible in the amount |

## Steps and expected values

1. **Labels verbatim** (staging): the vehicle-class catalog/grid shows the four labels exactly as the
   customer file writes them: **"Cont 20 - Trọng tải < 20 tấn"**, **"Cont 20 - Trọng tải > 20 tấn"**,
   **"Cont 40 nhẹ - Trọng tải < 20 tấn"**, **"Cont 40 nặng - Trọng tải > 20 tấn"** (card criterion 1).
2. **18 t → nhẹ column.** On fixture lot A (Cont20): enter cargo weight **18**; read the priced amount.
   Expected: price from column **"Cont 20 <20t"** — fixture amount 3.900.000; liters stay **64** (fuel norms
   unchanged). (Card criterion 2.)
3. **22 t → nặng column.** Same lot A: weight **22** → amount from **"Cont 20 >20t"** — 4.200.000; liters
   still 64. (Card criterion 2.)
4. **20,0 t exactly → NẶNG.** Same lot A: weight **20,0** → amount from the nặng column — **4.200.000**
   (ruling 4a: < 20 nhẹ, ≥ 20 nặng). This boundary is the kill-pin for `<`/`<=` implementation slips.
5. **Cont40 pair.** On fixture lot B: weight **15** → "Cont 40 nhẹ" column (4.160.000); weight **25** →
   "Cont 40 nặng" (4.460.000); liters stay **70** in both. (Card criterion 3.)
6. **Weight basis is cargo, not gross.** On lot A with weight 18 entered: the case's evidence must show the
   classified value equals the entered cargo weight (booking intake field), NOT gross (cargo + tare). The
   engine-side unit pin (TC-BG-21-class) plus the intake-field provenance in the transcript prove the basis
   (ruling 4b). If only gross were available at pricing time, the case FAILS (no reclassification from tare).
7. **Missing weight blocks pricing.** Clear the weight on lot A; trigger pricing. Expected: **blocked** with
   the message naming the missing field — **"Thiếu trọng tải"** — and NO price rendered; absolutely no
   silent default to the nhẹ column (ruling 4c; card criterion 5: "không tính bừa"). Same for lot B.
8. **Positive control / revert.** Re-enter 18 t on lot A and 15 t on lot B (the light-class fixtures
   restored); re-read:
   selection returns to the nhẹ columns, amounts byte-identical to steps 2/5.

## Pass/Fail

- PASS = labels verbatim; 18/22/20,0 map to nhẹ/nặng/nặng and 15/25 to Cont40 nhẹ/nặng with liters unchanged;
  the basis is the entered cargo weight; missing weight blocks with "Thiếu trọng tải" and never defaults;
  revert restores the baseline selections.
- FAIL = 20,0 → nhẹ; any liters change on reclass; gross-based classification; missing weight silently
  defaulting to nhẹ; label drift from the customer's verbatim strings; revert drift.

## Rungs

- Selection math + boundaries (steps 2–7 values): backend gate transcript (TC-BG-18…25) + API/DB transcript
  of the pricing decision for the named fixture lots (recorded class + chosen column + weight used).
- Labels + block message + UI rung (steps 1, 7): staging mouse-through at 1280–2560 — the catalog labels, the
  weight edit → price change on the named lots, the "Thiếu trọng tải" block, and the reverted state;
  screenshots per the QA evidence hard gate.
