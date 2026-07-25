/**
 * Wave 3 M5.3 — credit-limit + threshold service tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { checkCreditLimit, assertCreditLimit } from '../services/credit-limit.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdLedgerIds: number[] = [];

async function mkCustomer(opts: { creditLimit?: string; warningThreshold?: string }) {
  const [c] = await db.insert(s.customers).values({
    name: `M53 customer ${suffix}-${createdCustomerIds.length}`,
    creditLimit: opts.creditLimit,
    creditWarningThreshold: opts.warningThreshold,
  }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkLedger(customerId: number, debit: number, credit: number = 0) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'TRIP_REVENUE',
    txnId: 0,
    debit: String(debit),
    credit: String(credit),
    balance: String(debit - credit),
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

after(async () => {
  try {
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) { console.warn('[m53] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M5.3 — checkCreditLimit', () => {
  test('no credit limit set → never exceeds', async () => {
    const c = await mkCustomer({});
    const result = await checkCreditLimit(c.id);
    assert.equal(result.creditLimit, null);
    assert.equal(result.exceedsLimit, false);
    assert.equal(result.exceedsWarning, false);
  });

  test('outstanding below limit → not exceeded', async () => {
    const c = await mkCustomer({ creditLimit: '10000000', warningThreshold: '0.8' });
    await mkLedger(c.id, 3_000_000);
    const result = await checkCreditLimit(c.id);
    assert.equal(result.exceedsLimit, false);
    assert.equal(result.exceedsWarning, false);
  });

  test('outstanding above warning threshold → warning, not blocked', async () => {
    const c = await mkCustomer({ creditLimit: '10000000', warningThreshold: '0.8' });
    await mkLedger(c.id, 8_500_000);
    const result = await checkCreditLimit(c.id);
    assert.equal(result.exceedsLimit, false);
    assert.equal(result.exceedsWarning, true);
    assert.ok((result.utilization ?? 0) >= 0.8);
  });

  test('outstanding at or above limit → exceeds', async () => {
    const c = await mkCustomer({ creditLimit: '5000000' });
    await mkLedger(c.id, 6_000_000);
    const result = await checkCreditLimit(c.id);
    assert.equal(result.exceedsLimit, true);
  });

  test('approver override → overridden = true', async () => {
    const c = await mkCustomer({ creditLimit: '5000000' });
    await mkLedger(c.id, 6_000_000);
    const result = await checkCreditLimit(c.id, true);
    assert.equal(result.exceedsLimit, true);
    assert.equal(result.overridden, true);
  });

  test('default warning threshold = 0.8 when null', async () => {
    const c = await mkCustomer({ creditLimit: '10000000' });
    await mkLedger(c.id, 8_000_000);
    const result = await checkCreditLimit(c.id);
    // 8M / 10M = 0.8 → exactly at threshold → exceedsWarning = true.
    assert.equal(result.exceedsWarning, true);
  });
});

describe('M5.3 — assertCreditLimit', () => {
  test('does not throw when below limit', async () => {
    const c = await mkCustomer({ creditLimit: '10000000' });
    await mkLedger(c.id, 3_000_000);
    const result = await assertCreditLimit(c.id);
    assert.equal(result.exceedsLimit, false);
  });

  test('throws when exceeded without override', async () => {
    const c = await mkCustomer({ creditLimit: '5000000' });
    await mkLedger(c.id, 6_000_000);
    await assert.rejects(
      () => assertCreditLimit(c.id),
      (err: unknown) => err instanceof Error && /vượt hạn mức tín dụng/i.test(err.message),
    );
  });

  test('does not throw with approver override', async () => {
    const c = await mkCustomer({ creditLimit: '5000000' });
    await mkLedger(c.id, 6_000_000);
    const result = await assertCreditLimit(c.id, true);
    assert.equal(result.overridden, true);
  });

  test('does not throw when no limit set', async () => {
    const c = await mkCustomer({});
    await mkLedger(c.id, 100_000_000);
    const result = await assertCreditLimit(c.id);
    assert.equal(result.creditLimit, null);
  });
});
