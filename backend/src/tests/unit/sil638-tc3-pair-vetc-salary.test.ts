/**
 * SIL-638 (id 742) TC3 — 2 DOUBLE legs pair into one physical run: VETC toll
 * booked ONCE for the pair (never ×2), and the driver wage = base cuốc +
 * pair surcharge (never the sum of two single cuốc).
 *
 * The pairing transaction (trip-pairs.service) applies the toll dedup to
 * BOTH pair kinds (KEP and KET_HOP — one physical run each) and the wage
 * rule reads the configured surcharge per kind. The pure laws live in
 * trip-pair-rules.service and are pinned here (BE unit-only ruling).
 *
 * KNOWN GAP (recorded, not silently shipped): the pair itself is created via
 * POST /trips/pairs (manual pairing dialog) — there is no fully automatic
 * pair row at issue time. Per the ticket brief, TC3's "tự động gom" rides
 * the existing /trips/pairs flow; no billing change was implemented here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backhaulTollDeductionForSecond,
  pairSurchargeFor,
  type BackhaulTollTrip,
} from '../../services/trip-pair-rules.service';

describe('SIL-638 TC3 — VETC once per pair (backhaul toll dedup)', () => {
  const secondTrip: BackhaulTollTrip = {
    tollsStations: 2,
    tollPerStationApplied: '55000',
    tollDeduction: '0',
    tollCost: '110000',
    reconciledTollCost: null,
  };

  it('the second trip of a pair nets out its gross toll (stations × per-station)', () => {
    const delta = backhaulTollDeductionForSecond(secondTrip);
    assert.equal(delta.tollDeduction, '110000');
    assert.equal(delta.tollCost, '0');
    assert.equal(delta.totalCostDelta, -110000);
  });

  it('a reconciled toll keeps the reconciled figure as the pair net', () => {
    const delta = backhaulTollDeductionForSecond({ ...secondTrip, reconciledTollCost: '110000', tollCost: '110000' });
    assert.equal(delta.tollDeduction, '110000');
    assert.equal(delta.tollCost, '110000');
    assert.equal(delta.totalCostDelta, 0);
  });

  it('no stations → no dedup (the pair bears zero toll honestly)', () => {
    const delta = backhaulTollDeductionForSecond({ ...secondTrip, tollsStations: 0 });
    assert.equal(delta.tollDeduction, '0');
    assert.equal(delta.totalCostDelta, -110000);
  });

  it('the math is kind-agnostic — KET_HOP pairs get the same single-booking law', () => {
    // The function takes no pair kind: trip-pairs.service calls it
    // unconditionally for KEP and KET_HOP, so the once-per-pair toll is the
    // same law for both (TC3 and TC7 VETC clause).
    assert.equal(backhaulTollDeductionForSecond(secondTrip).tollDeduction, '110000');
  });
});

describe('SIL-638 TC3/TC7 — pair salary = base cuốc + pair surcharge', () => {
  const settings = { kepSurcharge: 150000, ketHopSurcharge: 90000 };

  it('each pair kind reads its own configured phụ phí', () => {
    assert.equal(pairSurchargeFor('KEP', settings), 150000);
    assert.equal(pairSurchargeFor('KET_HOP', settings), 90000);
  });

  it('no surcharge configured (0) leaves the rule inactive — never silently zero a wage', () => {
    assert.equal(pairSurchargeFor('KEP', { kepSurcharge: 0, ketHopSurcharge: 0 }), 0);
  });
});
