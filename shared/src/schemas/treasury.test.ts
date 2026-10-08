import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TREASURY_FUND_LABELS, treasuryFundCodeSchema, treasuryFundLabel } from './treasury';

/** Card 2026-10-05_381 (REQ-5.10-13) — the customer spec 5.10 names the two fund
 *  sources "Quỹ tiền mặt" and "Quỹ công ty". The system shipped the first as the
 *  abbreviation "Quỹ TM", repeated across five frontend surfaces and three backend
 *  messages, so the accounting screens disagreed with the spec and one wording
 *  change meant editing eight places.
 *
 *  Two things must hold together, and this file pins both:
 *   1. the display label is the customer's word, read from ONE shared constant, so
 *      the next wording change is a single edit rather than a sweep; and
 *   2. the internal codes COMPANY / TM stay untouched, because treasury account
 *      rows and posted movements are keyed by them — a display rename must never
 *      orphan historical data. */
describe('treasury fund labels (card 2026-10-05_381)', () => {
  test('names the two fund sources exactly as the customer spec does', () => {
    assert.equal(TREASURY_FUND_LABELS.COMPANY, 'Quỹ công ty');
    assert.equal(TREASURY_FUND_LABELS.TM, 'Quỹ tiền mặt');
  });

  test('reads a label through the shared helper rather than an inline literal', () => {
    assert.equal(treasuryFundLabel('COMPANY'), 'Quỹ công ty');
    assert.equal(treasuryFundLabel('TM'), 'Quỹ tiền mặt');
  });

  test('leaves the internal fund codes untouched so existing rows keep their data', () => {
    assert.deepEqual(treasuryFundCodeSchema.options, ['COMPANY', 'TM']);
  });

  test('carries no legacy "Quỹ TM" wording, and every code resolves a label', () => {
    for (const code of treasuryFundCodeSchema.options) {
      assert.ok(
        !treasuryFundLabel(code).includes('Quỹ TM'),
        `nhãn của ${code} vẫn còn chữ "Quỹ TM"`,
      );
      assert.equal(TREASURY_FUND_LABELS[code], treasuryFundLabel(code));
    }
  });
});
