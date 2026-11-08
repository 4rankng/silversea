// SIL-731 r2 — DOANH THU arming law (QA verdict 07/11, lô 100GX19033 id 121).
// The wire used to fabricate a '0' DOANH THU when the ONLY revenue-side fact
// was an entered-but-zero amount (ops expense with customer_charge_amount = 0
// on a lot with no trips and an unpriced dummy freight snapshot). The 24/10
// law: the cell stays BLANK until the rollup is determined; a computed zero
// (D02, card 20261002_293) stays a zero only once it IS determined.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { receivableDetermined } from '../../services/debit-receivable-arming';

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
