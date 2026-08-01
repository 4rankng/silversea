import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { saveBillingDocumentSchema } from './index';

const checksum = 'a'.repeat(64);

describe('secure billing document write contract', () => {
  test('accepts only immutable source identities for a Debit Note', () => {
    const parsed = saveBillingDocumentSchema.parse({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: 42,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      sourceRefs: [{
        sourceType: 'TRIP',
        sourceId: 11,
        financialPostingId: 91,
        financialPostingVersion: 3,
        postingChecksum: checksum,
      }],
    });
    assert.equal(parsed.type, 'DEBIT_NOTE');
    assert.equal(parsed.sourceRefs[0]?.sourceType, 'TRIP');
  });

  test('rejects browser-authored money, exclusions, overrides and ad-hoc rows', () => {
    const result = saveBillingDocumentSchema.safeParse({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: 42,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      sourceRefs: [{
        sourceType: 'TRIP',
        sourceId: 11,
        financialPostingId: 91,
        financialPostingVersion: 3,
        postingChecksum: checksum,
      }],
      lines: [{
        sourceType: 'ADHOC',
        sourceId: null,
        lineType: 'ADHOC',
        description: 'Forged',
        typeLabel: 'Forged',
        unit: 'lần',
        baseAmount: 999_999_999,
        amountOverride: 1,
        excluded: true,
        sortOrder: 0,
      }],
      baseAmount: 999_999_999,
    });
    assert.equal(result.success, false);
  });

  test('rejects forged or incomplete financial-posting provenance', () => {
    for (const sourceRef of [
      { sourceType: 'TRIP', sourceId: 11, financialPostingId: 91, financialPostingVersion: 3, postingChecksum: 'bad' },
      { sourceType: 'TRIP', sourceId: 11, financialPostingId: 91, postingChecksum: checksum },
      { sourceType: 'ADHOC', sourceId: 11 },
    ]) {
      const result = saveBillingDocumentSchema.safeParse({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: 42,
        rangeFrom: '2026-08-01',
        rangeTo: '2026-08-31',
        sourceRefs: [sourceRef],
      });
      assert.equal(result.success, false);
    }
  });
});
