import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { persistedRevenueFor } from '../../services/trip-create.service';

/**
 * QA 28/11 finding 14 (AstraQA2) — issuing a carrier order for a lot whose
 * customer/route has NO pricing froze the trip's revenue faces at a
 * fabricated 0. For a REV-grouped lot the effective freight reads the trip
 * override channel first, so the grouped primary lot's agreed customer
 * freight read ₫0 the moment Dispatch issued (QA: ₫120,000 → ₫0 on primary
 * 1541). The law now: MANUAL persists NULL (override read stays UNSET, the
 * board falls back to the intake snapshot); engine-priced results persist
 * their value, including a genuine computed 0.
 */
describe('persistedRevenueFor (trip-create MANUAL revenue faces)', () => {
  it('persists NULL when no pricing exists (MANUAL)', () => {
    assert.equal(persistedRevenueFor('MANUAL', 0), null);
  });

  it('persists the priced value for TABLE and TIER sources', () => {
    assert.equal(persistedRevenueFor('TABLE', 120000), '120000');
    assert.equal(persistedRevenueFor('TIER', 97500), '97500');
  });

  it('keeps a genuine engine-priced 0 — only MANUAL never fabricates', () => {
    assert.equal(persistedRevenueFor('TABLE', 0), '0');
    assert.equal(persistedRevenueFor('TIER', 0), '0');
  });
});
