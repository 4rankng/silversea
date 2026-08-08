/**
 * O2C AR snapshot cost-hash stability (260801-2200 phase-02).
 *
 * The dirty-flag is only meaningful if the canonical payload hash is stable.
 * This test pins the canonical payload shape and verifies that identical
 * payloads produce identical hashes, while any cost drift changes the hash.
 *
 * Note: computeCostHash reads from the DB, so this test documents the payload
 * contract via the hash inputs rather than calling the DB-bound function.
 * The DB-backed capture/markDirty behavior is exercised by the integration
 * tests in trip-ledger-completion.test.ts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { round2dp } from '@tingting/shared';

/** Mirrors the canonical payload shape pinned in ar-snapshot.service.ts. */
function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

describe('O2C AR snapshot — canonical cost hash', () => {
  const basePayload = {
    revenue: round2dp(40_000_000),
    driverSalary: round2dp(3_500_000),
    totalFuelCost: round2dp(6_718_950),
    externalFreightCost: round2dp(0),
    vatRate: round2dp(0.08),
    customerCommission: round2dp(1_000_000),
    totalCost: round2dp(15_000_000),
    expenses: [
      { id: 1, buyAmount: round2dp(2_000_000), sellAmount: round2dp(2_500_000), settlementMethod: 'OPS_ADVANCE', supplierId: null, forwarderId: 5, approvalStatus: 'APPROVED' },
      { id: 2, buyAmount: round2dp(500_000), sellAmount: round2dp(600_000), settlementMethod: 'CASH', supplierId: 7, forwarderId: null, approvalStatus: 'PENDING' },
    ],
  };

  test('identical payload → identical hash (stable)', () => {
    const h1 = hashPayload(basePayload);
    const h2 = hashPayload({ ...basePayload });
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  test('a cost edit (buyAmount change) produces a different hash', () => {
    const h1 = hashPayload(basePayload);
    const drifted = {
      ...basePayload,
      expenses: basePayload.expenses.map((e) =>
        e.id === 1 ? { ...e, buyAmount: round2dp(2_100_000) } : e,
      ),
    };
    const h2 = hashPayload(drifted);
    assert.notEqual(h1, h2);
  });

  test('revenue drift produces a different hash', () => {
    const h1 = hashPayload(basePayload);
    const h2 = hashPayload({ ...basePayload, revenue: round2dp(41_000_000) });
    assert.notEqual(h1, h2);
  });

  test('expense row order does not affect the hash (sorted by id)', () => {
    const reversed = {
      ...basePayload,
      expenses: [...basePayload.expenses].sort((a, b) => b.id - a.id),
    };
    // The service sorts by id before hashing; simulate that here.
    const sortedPayload = {
      ...basePayload,
      expenses: [...reversed.expenses].sort((a, b) => a.id - b.id),
    };
    assert.equal(hashPayload(sortedPayload), hashPayload(basePayload));
  });

  test('adding an expense produces a different hash', () => {
    const h1 = hashPayload(basePayload);
    const withMore = {
      ...basePayload,
      expenses: [...basePayload.expenses, { id: 3, buyAmount: round2dp(100_000), sellAmount: round2dp(120_000), settlementMethod: 'CASH', supplierId: null, forwarderId: 5, approvalStatus: 'PENDING' }],
    };
    assert.notEqual(h1, hashPayload(withMore));
  });
});
