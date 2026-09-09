import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFuelSurcharge, computeFreightRate } from './fuelSurcharge';
import { round2dp, roundInt } from './round';

test('computeFuelSurcharge applies the configured delta, liters, and share percent', () => {
  const result = computeFuelSurcharge({
    currentPrice: 50,
    basePrice: 0,
    sharePct: 50,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 2500, applicable: true });
});

test('computeFuelSurcharge returns zero when share percent is null', () => {
  const result = computeFuelSurcharge({
    currentPrice: 25000,
    basePrice: 20000,
    sharePct: null,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 0, applicable: false });
});

test('computeFuelSurcharge returns zero when base price is unset', () => {
  const result = computeFuelSurcharge({
    currentPrice: 25000,
    basePrice: null,
    sharePct: 50,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 0, applicable: false });
});

test('computeFuelSurcharge returns zero when current price does not exceed base price', () => {
  const result = computeFuelSurcharge({
    currentPrice: 20000,
    basePrice: 20000,
    sharePct: 50,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 0, applicable: false });
});

test('computeFuelSurcharge handles 100 percent customer share', () => {
  const result = computeFuelSurcharge({
    currentPrice: 1010,
    basePrice: 1000,
    sharePct: 100,
    quotaLiters: 50,
  });
  assert.deepEqual(result, { amount: 500, applicable: true });
});

test('computeFuelSurcharge uses round2dp then roundInt', () => {
  const result = computeFuelSurcharge({
    currentPrice: 3334,
    basePrice: 1,
    sharePct: 33,
    quotaLiters: 33,
  });
  assert.deepEqual(result, { amount: 36296, applicable: true });
});


// ─── computeFreightRate tests (correct formula) ────────────────────────────

test('computeFreightRate: NEWEB CONT40, fuel 27620 (parity with Excel)', () => {
  // Excel §6.1: basePrice=4100000, sharePct=2, fuelPrice=27620, baseFuel=17842.5926, liters=91
  // Expected: freight=4182000, surcharge=889744, total=5071744
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.freight, 4182000);
  assert.equal(result.surcharge, 889744);
  assert.equal(result.total, 5071744);
});

test('computeFreightRate: NEWEB CONT40, fuel 21740 (parity with Excel)', () => {
  // Excel §6.2: basePrice=4100000, sharePct=2, fuelPrice=21740, baseFuel=17842.5926, liters=91
  // Expected: freight=4182000, surcharge=354664, total=4536664
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 21740,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.freight, 4182000);
  assert.equal(result.surcharge, 354664);
  assert.equal(result.total, 4536664);
});

test('computeFreightRate: clamp to 0 when fuel below base', () => {
  // Câu 1 = B: fuel 16000 < base 17842.5926 ⇒ surcharge = 0
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 16000,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.freight, 4182000);
  assert.equal(result.surcharge, 0);
  assert.equal(result.total, 4182000);
});

test('computeFreightRate: fuel exactly at base ⇒ surcharge = 0', () => {
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 17842.5926,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.surcharge, 0);
  assert.equal(result.total, 4182000);
});

test('computeFreightRate: ASKEY 1.25T, fuel 27620 (parity with Excel)', () => {
  // Excel §6.1 ASKEY: basePrice=1200000, sharePct=4, fuelPrice=27620, baseFuel=17842.5926, liters=20
  // Expected: freight=1248000, surcharge=195548, total=1443548
  const result = computeFreightRate({
    basePrice: 1200000,
    sharePct: 4,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 20,
  });
  assert.equal(result.freight, 1248000);
  assert.equal(result.surcharge, 195548);
  assert.equal(result.total, 1443548);
});

test('computeFreightRate: fuelDelta is not rounded', () => {
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  // fuelDelta = 27620 - 17842.5926 = 9777.4074
  assert.ok(Math.abs(result.fuelDelta - 9777.4074) < 0.0001);
});


// ─── TC-CUOC-007 / TC-CUOC-008 boundary tests (Phase-1 evidence) ────────────
// Per docs/prd/CuocPhiThietKeDB.md §4.2 — `H`, `J` rounded separately HALF_UP
// to whole VND; `liters` and `fuelDelta` keep their precision.

test('computeFreightRate: SUNRISE+SJ 10T rounding boundary HALF_UP (TC-CUOC-007)', () => {
  // SUNRISE+SJ 10T, kỳ 18/7: liters=57.6, fuelPrice=27620, baseFuel=17842.5926
  // raw surcharge = (27620 - 17842.5926) * 57.6 = 9777.4074 * 57.6 = 563,178.6658...
  // HALF_UP → 563,179 (NOT 563,178 banker's round)
  const result = computeFreightRate({
    basePrice: 2_700_000,
    sharePct: 3,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 57.6,
  });
  assert.equal(result.freight, roundInt(round2dp(2_700_000 * 1.03)));
  assert.equal(result.surcharge, 563179);
  assert.equal(result.total, result.freight + 563179);
});

test('computeFreightRate: HALF_UP tie-break (TC-CUOC-007 boundary)', () => {
  // Force a half-integer to confirm HALF_UP, not banker's:
  // delta * liters = 0.5 ⇒ roundInt(round2dp(0.5)) = 1, not 0.
  const result = computeFreightRate({
    basePrice: 1_000_000,
    sharePct: 0,
    fuelPrice: 17843.0926,
    baseFuelPrice: 17842.5926,
    liters: 100, // fuelDelta=0.5, 0.5*100=50 → 50 (no tie)
  });
  assert.equal(result.surcharge, 50);

  // True half-integer at 0.5 boundary:
  const tie = computeFreightRate({
    basePrice: 1_000_000,
    sharePct: 0,
    fuelPrice: 17843.0926,
    baseFuelPrice: 17842.5926,
    liters: 1, // 0.5 * 1 = 0.5 → HALF_UP → 1 (NOT 0 banker's)
  });
  assert.equal(tie.surcharge, 1);
});

test('computeFreightRate: CONT20 NEWEB kỳ 21,740 (TC-CUOC-008 parity)', () => {
  // Largest liters (83.2) + scale-4 base fuel — most sensitive to scale regression.
  // basePrice=3500000, sharePct=2.5, fuelPrice=21740, baseFuel=17842.5926, liters=83.2
  // Expected: freight=3587500, surcharge=324394, total=3911894
  // 324394 = round(round2((21740 - 17842.5926) * 83.2))
  //         = round(round2(3897.4074 * 83.2))
  //         = round(round2(324,264.29568))
  //         = round(324264.30) = 324264
  // Actually recompute: (21740 - 17842.5926) = 3897.4074
  // 3897.4074 * 83.2 = 324,264.29568 → round2dp = 324264.30 → roundInt = 324264
  const result = computeFreightRate({
    basePrice: 3500000,
    sharePct: 2.5,
    fuelPrice: 21740,
    baseFuelPrice: 17842.5926,
    liters: 83.2,
  });
  assert.equal(result.freight, 3_587_500);
  assert.equal(result.surcharge, 324264);
  assert.equal(result.total, 3_911_764);
});

test('computeFreightRate: CONT20 NEWEB kỳ 27,620 (TC-CUOC-008 parity)', () => {
  // Same vehicle class, second fuel period. Parity must hold.
  // (27620 - 17842.5926) * 83.2 = 9777.4074 * 83.2 = 813,480.29568
  //   → round2dp = 813480.30 → roundInt = 813480
  const result = computeFreightRate({
    basePrice: 3500000,
    sharePct: 2.5,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 83.2,
  });
  assert.equal(result.freight, 3_587_500);
  assert.equal(result.surcharge, 813480);
  assert.equal(result.total, 4_400_980);
});

test('computeFreightRate: small negative fuelDelta clamps to 0 (Câu 1 = B)', () => {
  // Fuel just below base — must clamp to 0, NOT -1 due to epsilon.
  const result = computeFreightRate({
    basePrice: 1_000_000,
    sharePct: 5,
    fuelPrice: 17842.0,   // 0.5926 below base
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.surcharge, 0);
  // fuelDelta keeps precision (no rounding) — used for traceability/UI explanation.
  assert.ok(Math.abs(result.fuelDelta - (-0.5926)) < 1e-9);
});

test('computeFreightRate: zero liters ⇒ surcharge 0, freight still computed', () => {
  // Defensive: division-by-zero / no-op trip. Surcharge must be 0 (clamp),
  // freight must still reflect sharePct.
  const result = computeFreightRate({
    basePrice: 1_000_000,
    sharePct: 5,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 0,
  });
  assert.equal(result.surcharge, 0);
  assert.equal(result.freight, 1_050_000);
  assert.equal(result.total, 1_050_000);
});

test('computeFreightRate: round2dp called BEFORE roundInt — order matters', () => {
  // If order were reversed, 13.555 would round to 14 via roundInt (Math.round
  // banker's), then to 13.56 via round2dp — or vice versa depending on impl.
  // The contract is: round2dp first (2 decimals), THEN roundInt (whole VND).
  // 9777.4074 * 1 = 9777.4074 → round2dp = 9777.41 → roundInt = 9777
  // (NOT 9778 via Math.round of 9777.5+ if precision lost).
  const result = computeFreightRate({
    basePrice: 1_000_000,
    sharePct: 0,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 1,
  });
  assert.equal(result.surcharge, 9777);
});
