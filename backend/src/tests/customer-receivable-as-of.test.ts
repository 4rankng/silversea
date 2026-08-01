import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getReceivablesSummary } from '../services/aging.service';
import { getCustomerReceivableSnapshot } from '../services/customer-receivable-authority.service';

let customerId = 0;
const ledgerIds: number[] = [];

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers).values({ name: `As-of customer ${suffix}` }).returning();
  customerId = customer.id;

  const rows = await db.insert(s.ledger).values([
    {
      entityType: 'CUSTOMER', entityId: customerId, txnType: 'TRIP_REVENUE', txnId: 9_100_001,
      debit: '100', credit: '0', balance: '100', timestamp: new Date('2042-01-01T16:59:59.999Z'),
    },
    {
      entityType: 'CUSTOMER', entityId: customerId, txnType: 'TRIP_REVENUE', txnId: 9_100_002,
      debit: '200', credit: '0', balance: '300', timestamp: new Date('2042-01-01T10:00:00.000Z'),
    },
    {
      entityType: 'CUSTOMER', entityId: customerId, txnType: 'TRIP_REVENUE', txnId: 9_100_003,
      debit: '400', credit: '0', balance: '700', timestamp: new Date('2042-01-01T17:00:00.000Z'),
    },
  ]).returning({ id: s.ledger.id });
  ledgerIds.push(...rows.map(row => row.id));
});

after(async () => {
  try {
    if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
  } finally {
    await client.end();
  }
});

describe('customer receivable historical authority', () => {
  test('applies the Vietnam end-exclusive cutoff to authoritative ledger sources', async () => {
    const snapshot = await getCustomerReceivableSnapshot(customerId, { asOfDate: '2042-01-01' });

    assert.equal(snapshot.totalOutstanding, 300);
    assert.deepEqual(snapshot.obligations.map(item => item.authorityId).sort(), [9_100_001, 9_100_002]);
  });

  test('returns deterministic historical evidence metadata', async () => {
    const report = await getReceivablesSummary({ asOfDate: '2042-01-01' });

    assert.equal(report.asOf, '2042-01-01');
    assert.equal(report.asOfExclusive, '2042-01-01T17:00:00.000Z');
    assert.equal(report.timezone, 'Asia/Ho_Chi_Minh');
    assert.equal(report.definitionVersion, 'receivables-summary-v2');
    assert.equal(report.consistency, 'BEST_EFFORT');
    assert.match(report.checksum, /^[a-f0-9]{64}$/);
  });
});
