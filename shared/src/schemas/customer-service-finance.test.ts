import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  accountingTransportRegisterQuerySchema,
  accountingTransportRegisterResponseSchema,
} from './customer-service-finance';

describe('accounting transport register contract', () => {
  test('normalizes bounded pagination and strict filters', () => {
    const parsed = accountingTransportRegisterQuerySchema.parse({
      from: '2026-07-01',
      to: '2026-07-31',
      customerId: '12',
      carrierId: '18',
      ownership: 'EXTERNAL',
      readiness: 'READY',
      search: '  MSKU1234565  ',
    });
    assert.deepEqual(parsed, {
      from: '2026-07-01',
      to: '2026-07-31',
      customerId: 12,
      carrierId: 18,
      ownership: 'EXTERNAL',
      readiness: 'READY',
      search: 'MSKU1234565',
      page: 1,
      limit: 25,
    });
  });

  test('rejects reversed dates, oversized pages, invalid enums, and unknown money inputs', () => {
    const hostileInputs = [
      { from: '2026-08-01', to: '2026-07-01' },
      { from: '2026-07-01', to: '2026-07-31', limit: 101 },
      { from: '2026-07-01', to: '2026-07-31', ownership: 'VENDOR' },
      { from: '2026-07-01', to: '2026-07-31', readiness: 'POST_NOW' },
      { from: '2026-07-01', to: '2026-07-31', revenue: '999999999' },
    ];
    for (const input of hostileInputs) {
      assert.equal(accountingTransportRegisterQuerySchema.safeParse(input).success, false);
    }
  });

  test('response contract requires financial posting provenance and bounded metadata', () => {
    const result = accountingTransportRegisterResponseSchema.safeParse({
      asOf: '2026-08-01T06:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      filterFingerprint: 'a'.repeat(64),
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
      items: [],
    });
    assert.equal(result.success, true);
  });
});
