// SIL-731 r2 — DOANH THU arming law (QA verdict 07/11, lô 100GX19033 id 121).
// The wire used to fabricate a '0' DOANH THU when the ONLY revenue-side fact
// was an entered-but-zero amount (ops expense with customer_charge_amount = 0
// on a lot with no trips and an unpriced dummy freight snapshot). The 24/10
// law: the cell stays BLANK until the rollup is determined; a computed zero
// (D02, card 20261002_293) stays a zero only once it IS determined.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { receivableCellFreightKnown, receivableDetermined, receivableDisplayValue } from '../../services/debit-receivable-arming';

describe('receivableDetermined (SIL-731 r2 arming law)', () => {
  test('lô 100GX19033 repro — ops charge entered 0 + freight unpriced + no revenue rows → NOT determined (blank)', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: false,
      freightKnown: false,
      psKnownTotal: null,
      opsChargeKnownTotal: 0,
    }), false);
  });

  test('PS thực tế entered 0 alone does not arm either', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: false,
      freightKnown: false,
      psKnownTotal: 0,
      opsChargeKnownTotal: null,
    }), false);
  });

  test('freight traced 0 → determined — computed zero stays a value (D02)', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: false,
      freightKnown: true,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
    }), true);
  });

  test('revenue rows exist (legacy caller without total) → determined', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: true,
      freightKnown: false,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
    }), true);
  });

  test('revenue rows with total 0 do not arm when freight is unpriced', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: true,
      freightKnown: false,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
      revenueRowsTotal: 0,
    }), false);
  });

  test('revenue rows with non-zero total arm even when freight is unpriced', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: true,
      freightKnown: false,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
      revenueRowsTotal: 250_000,
    }), true);
  });

  test('non-zero side amount arms as before (ops-only lot keeps its number)', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: false,
      freightKnown: false,
      psKnownTotal: null,
      opsChargeKnownTotal: 120_000,
    }), true);
    assert.equal(receivableDetermined({
      hasRevenueRows: false,
      freightKnown: false,
      psKnownTotal: 50_000,
      opsChargeKnownTotal: null,
    }), true);
  });

  test('no revenue-side fact at all → NOT determined', () => {
    assert.equal(receivableDetermined({
      hasRevenueRows: false,
      freightKnown: false,
      psKnownTotal: null,
      opsChargeKnownTotal: null,
    }), false);
  });
});

describe('receivableDisplayValue (SIL-731 r4 cell law — no lock exemption)', () => {
  test('QA repro R3Q-680-B / R4B-693-001 — cost-locked lot, snapshot froze 0, freight never traced → BLANK', () => {
    assert.equal(receivableDisplayValue({ value: 0, freightKnown: false, merged: false }), null);
  });

  test('unlocked uncalculated 0 stays blank (r3 law unchanged)', () => {
    assert.equal(receivableDisplayValue({ value: 0, freightKnown: false, merged: false }), null);
  });

  test('computed zero with freight traced stays a value (D02) — locked or not', () => {
    assert.equal(receivableDisplayValue({ value: 0, freightKnown: true, merged: false }), 0);
  });

  test('merge-group member 0 renders (lô ghép exemption)', () => {
    assert.equal(receivableDisplayValue({ value: 0, freightKnown: false, merged: true }), 0);
  });

  test('missing snapshot key (null) passes through as Chưa xác định', () => {
    assert.equal(receivableDisplayValue({ value: null, freightKnown: false, merged: false }), null);
  });

  test('non-zero frozen figure passes through untouched', () => {
    assert.equal(receivableDisplayValue({ value: 3_952_000, freightKnown: true, merged: false }), 3_952_000);
  });
});

describe('receivableCellFreightKnown (SIL-814 — a locked cell trusts the freeze-time freight)', () => {
  test('QA repro R3M-KR1 (id 772) — locked 06/11 froze 0/0 from snapshot 703, live channel now 3.952.000 → freight NOT trusted → cell BLANK', () => {
    assert.equal(receivableCellFreightKnown({ locked: true, frozenFreight: 0, liveFreight: 3_952_000 }), false);
    // through the display gate: the frozen 0 then reads chưa chốt, never a bare 0
    assert.equal(receivableDisplayValue({ value: 0, freightKnown: false, merged: false }), null);
  });

  test('frozen freight missing (pre-SIL-693 lock) → not known even when the live channel later prices the lot', () => {
    assert.equal(receivableCellFreightKnown({ locked: true, frozenFreight: null, liveFreight: 3_952_000 }), false);
  });

  test('frozen freight agrees with live channel → a computed zero (D02) keeps rendering', () => {
    assert.equal(receivableCellFreightKnown({ locked: true, frozenFreight: 0, liveFreight: 0 }), true);
    assert.equal(receivableDisplayValue({ value: 0, freightKnown: true, merged: false }), 0);
  });

  test('R3P-KR1 law — non-zero frozen receivable never reaches the zero branch (freeze untouched)', () => {
    assert.equal(receivableCellFreightKnown({ locked: true, frozenFreight: 3_952_000, liveFreight: 3_952_000 }), true);
    assert.equal(receivableDisplayValue({ value: 3_952_000, freightKnown: true, merged: false }), 3_952_000);
  });

  test('unlocked rows keep judging by the live channel (SIL-731 r4 unchanged)', () => {
    assert.equal(receivableCellFreightKnown({ locked: false, frozenFreight: null, liveFreight: 0 }), true);
    assert.equal(receivableCellFreightKnown({ locked: false, frozenFreight: 0, liveFreight: null }), false);
  });
});
