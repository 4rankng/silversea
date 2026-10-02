import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import {
  createDebtOffset,
  cancelDebtOffset,
  listDebtOffsets,
} from '../services/debtOffset.service';
import { LedgerService } from '../services/ledger.service';
import { upsertPartnerFromTaxCode } from '../services/legal-partner.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdOffsetIds: number[] = [];
const userIds: number[] = [];

// Stable test actor IDs — created once.
let adminUserId: number;
let managerUserId: number;
let driverUserId: number;

async function mkUser(role: 'ADMIN' | 'MANAGER' | 'DRIVER', tag: string) {
  const [u] = await db.insert(s.users).values({
    username: `m64-${role}-${suffix}-${tag}-${userIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  userIds.push(u.id);
  return u;
}

/** Build a customer linked to a supplier (the dual-role partner). */
async function mkLinkedPair() {
  const taxCode = `0312${String(createdCustomerIds.length + 1).padStart(6, '0')}`;
  const partnerId = await upsertPartnerFromTaxCode(taxCode);
  const [cust] = await db.insert(s.customers).values({
    name: `M64 customer ${suffix}-${createdCustomerIds.length}`,
    taxCode,
    partnerId,
  }).returning();
  createdCustomerIds.push(cust.id);

  const [sup] = await db.insert(s.suppliers).values({
    name: `M64 supplier ${suffix}-${createdSupplierIds.length}`,
    taxCode,
    partnerId,
    linkedCustomerId: cust.id,
  }).returning();
  createdSupplierIds.push(sup.id);

  // Mirror the link on the customer too.
  await db.update(s.customers)
    .set({ linkedSupplierId: sup.id })
    .where(eq(s.customers.id, cust.id));

  return { cust, sup };
}

async function mkDriftedPair() {
  const pair = await mkLinkedPair();
  const otherTaxCode = `0999${String(createdSupplierIds.length + 1).padStart(6, '0')}`;
  const otherPartnerId = await upsertPartnerFromTaxCode(otherTaxCode);
  await db.update(s.suppliers)
    .set({ taxCode: otherTaxCode, partnerId: otherPartnerId, updatedAt: new Date() })
    .where(eq(s.suppliers.id, pair.sup.id));
  return {
    cust: { ...pair.cust, partnerId: pair.cust.partnerId },
    sup: { ...pair.sup, partnerId: otherPartnerId },
  };
}

/** Post an AR debit on the customer (creates a receivable). */
async function postAr(customerId: number, amount: number) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: TxnType.TRIP_REVENUE,
    txnId: 0,
    debit: String(amount),
    credit: '0',
    balance: String(amount),
    note: 'm64 test AR',
  }).returning();
  createdLedgerIds.push(e.id);
}

/** Post an AP credit on the supplier (creates a payable).
 *  VENDOR convention (per LedgerService.postEntry): balance = credit − debit,
 *  so a credit-only posting produces a positive payable balance. */
async function postAp(supplierId: number, amount: number) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'VENDOR' as const,
    entityId: supplierId,
    txnType: TxnType.VENDOR_EXPENSE,
    txnId: 0,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    note: 'm64 test AP',
  }).returning();
  createdLedgerIds.push(e.id);
}

async function balance(entityType: 'CUSTOMER' | 'VENDOR', entityId: number): Promise<number> {
  return LedgerService.getBalance(entityType, entityId);
}

function offsetDraft(
  customerId: number,
  supplierId: number,
  createdBy: number,
  overrides: Partial<{
    currency: 'VND';
    offsetDate: string;
    note: string;
    minutesReference: string;
    minutesDocumentHash: string | null;
  }> = {},
) {
  return {
    customerId,
    supplierId,
    currency: 'VND' as const,
    offsetDate: '2026-07-15',
    note: 'Biên bản đối trừ công nợ thử nghiệm',
    minutesReference: `BB-M64-${suffix}-${customerId}-${supplierId}`,
    minutesDocumentHash: 'm64-hash',
    createdBy,
    actorRole: 'ADMIN',
    ...overrides,
  };
}

// Node test runner runs `describe` blocks in order; the first describe
// block creates the actor users.

describe('M6.4 setup', () => {
  test('creates actor users', async () => {
    adminUserId = (await mkUser('ADMIN', 'admin')).id;
    managerUserId = (await mkUser('MANAGER', 'manager')).id;
    driverUserId = (await mkUser('DRIVER', 'driver')).id;
    assert.ok(adminUserId > 0);
    assert.ok(managerUserId > 0);
    assert.ok(driverUserId > 0);
  });
});

after(async () => {
  const custPattern = `M64 customer ${suffix}%`;
  const supPattern = `M64 supplier ${suffix}%`;
  try {
    if (createdOffsetIds.length > 0) await db.delete(s.debtOffsets).where(inArray(s.debtOffsets.id, createdOffsetIds));
    // Scope cleanup to this suite's counterparties, never unrelated ledger rows.
    await db.delete(s.ledger).where(or(
      and(eq(s.ledger.entityType, 'CUSTOMER'), inArray(s.ledger.entityId, createdCustomerIds)),
      and(eq(s.ledger.entityType, 'VENDOR'), inArray(s.ledger.entityId, createdSupplierIds)),
    ));
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${custPattern}`);
    await db.delete(s.suppliers).where(sql`${s.suppliers.name} LIKE ${supPattern}`);
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch (err) { console.warn('[m64] cleanup:', (err as Error).message); }
  await client.end();
});

async function fundedPair(ar = 1_000_000, ap = ar) {
  const pair = await mkLinkedPair();
  await postAr(pair.cust.id, ar);
  await postAp(pair.sup.id, ap);
  return pair;
}

async function recordPair(pair: Awaited<ReturnType<typeof fundedPair>>, actorRole = 'ADMIN', createdBy = adminUserId) {
  const row = await createDebtOffset({ ...offsetDraft(pair.cust.id, pair.sup.id, createdBy), actorRole });
  createdOffsetIds.push(row.id);
  return row;
}

async function offsetEntries(id: number) {
  const [offset] = await db.select().from(s.debtOffsets).where(eq(s.debtOffsets.id, id));
  assert.ok(offset);
  return db.select().from(s.ledger).where(and(
    eq(s.ledger.txnType, TxnType.ADJUSTMENT),
    eq(s.ledger.txnId, id),
    or(
      and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, offset.customerId)),
      and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, offset.supplierId)),
    ),
  ));
}

describe('M6.4 — direct debt offset recording', () => {
  test('records min(AR, AP), paired entries and actor together without approval', async () => {
    const pair = await fundedPair(5_000_000, 3_000_000);
    const row = await recordPair(pair);
    assert.equal(Number(row.amount), 3_000_000);
    assert.equal(row.approvalStatus, 'APPROVED', 'legacy code means recorded');
    assert.equal(row.createdBy, adminUserId);
    assert.equal(row.approvedBy, adminUserId, 'the acting user, no separate approver');
    assert.ok(row.approvedAt);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 2_000_000);
    assert.equal(await balance('VENDOR', pair.sup.id), 0);
    assert.equal((await offsetEntries(row.id)).length, 2);
  });

  test('rejects zero remaining balance without a pending row', async () => {
    const pair = await mkLinkedPair();
    await assert.rejects(() => recordPair(pair), { statusCode: 400 });
    assert.equal((await listDebtOffsets({ customerId: pair.cust.id })).length, 0);
  });

  test('rejects counterparties without the same canonical legal partner', async () => {
    const pair = await mkDriftedPair();
    await postAr(pair.cust.id, 1_500_000);
    await postAp(pair.sup.id, 1_500_000);
    await assert.rejects(() => recordPair(pair), /không cùng pháp nhân/i);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 1_500_000);
    assert.equal(await balance('VENDOR', pair.sup.id), 1_500_000);
  });

  test('requires reason, supporting minutes and VND currency', async () => {
    const pair = await fundedPair();
    for (const overrides of [{ note: ' ' }, { minutesReference: ' ' }, { currency: 'USD' as 'VND' }]) {
      await assert.rejects(() => createDebtOffset(offsetDraft(pair.cust.id, pair.sup.id, adminUserId, overrides)), { statusCode: 400 });
    }
    assert.equal((await listDebtOffsets({ customerId: pair.cust.id })).length, 0);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 1_000_000);
  });

  test('ACCOUNTANT records directly with no second actor', async () => {
    const actor = await db.insert(s.users).values({ username: `m64-ACCOUNTANT-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE' }).returning();
    userIds.push(actor[0].id);
    const pair = await fundedPair();
    const row = await recordPair(pair, 'ACCOUNTANT', actor[0].id);
    assert.equal(row.approvedBy, actor[0].id);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 0);
  });

  test('DRIVER cannot record an offset and no money or row changes', async () => {
    const pair = await fundedPair();
    await assert.rejects(() => recordPair(pair, 'DRIVER', driverUserId), { statusCode: 403 });
    assert.equal((await listDebtOffsets({ customerId: pair.cust.id })).length, 0);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 1_000_000);
    assert.equal(await balance('VENDOR', pair.sup.id), 1_000_000);
  });

  test('transaction failure rolls back the offset and both entries together', async () => {
    const pair = await fundedPair();
    await assert.rejects(() => db.transaction(async tx => {
      await createDebtOffset({ ...offsetDraft(pair.cust.id, pair.sup.id, adminUserId), transaction: tx });
      throw new Error('force rollback');
    }), /force rollback/);
    assert.equal((await listDebtOffsets({ customerId: pair.cust.id })).length, 0);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 1_000_000);
    assert.equal(await balance('VENDOR', pair.sup.id), 1_000_000);
  });

  test('concurrent submissions serialize against current balances and post once', async () => {
    const pair = await fundedPair(4_000_000);
    const results = await Promise.allSettled([recordPair(pair), recordPair(pair)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.statusCode, 400);
    const rows = await listDebtOffsets({ customerId: pair.cust.id });
    assert.equal(rows.length, 1);
    assert.equal((await offsetEntries(rows[0].id)).length, 2);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 0);
    assert.equal(await balance('VENDOR', pair.sup.id), 0);
  });

  test('a repeated submission after balances are consumed makes no extra entries', async () => {
    const pair = await fundedPair();
    const row = await recordPair(pair);
    await assert.rejects(() => recordPair(pair), { statusCode: 400 });
    assert.equal((await offsetEntries(row.id)).length, 2);
    assert.equal((await listDebtOffsets({ customerId: pair.cust.id })).length, 1);
  });
});

describe('M6.4 — direct reversal preserves history', () => {
  test('reversal restores AR/AP with compensating entries', async () => {
    const pair = await fundedPair(6_000_000);
    const row = await recordPair(pair);
    const originalEntries = await offsetEntries(row.id);
    const reversed = await cancelDebtOffset(row.id, managerUserId, 'MANAGER');
    assert.equal(reversed.approvalStatus, 'CANCELED');
    assert.equal(await balance('CUSTOMER', pair.cust.id), 6_000_000);
    assert.equal(await balance('VENDOR', pair.sup.id), 6_000_000);
    const entries = await offsetEntries(row.id);
    assert.equal(entries.length, 4);
    for (const entry of originalEntries) assert.deepEqual(entries.find(e => e.id === entry.id), entry);
  });

  test('DRIVER cannot reverse a recorded offset', async () => {
    const pair = await fundedPair();
    const row = await recordPair(pair);
    await assert.rejects(() => cancelDebtOffset(row.id, driverUserId, 'DRIVER'), { statusCode: 403 });
    assert.equal((await offsetEntries(row.id)).length, 2);
  });

  test('legacy unposted rows cannot be reversed into fake debt', async () => {
    const pair = await fundedPair();
    const [legacy] = await db.insert(s.debtOffsets).values({
      customerId: pair.cust.id, supplierId: pair.sup.id, partnerId: pair.cust.partnerId,
      amount: '1000000', offsetDate: '2026-07-15', currency: 'VND',
      minutesReference: 'LEGACY', note: 'Historical unposted row', createdBy: adminUserId,
      approvalStatus: 'PENDING',
    }).returning();
    createdOffsetIds.push(legacy.id);
    await assert.rejects(() => cancelDebtOffset(legacy.id, adminUserId, 'ADMIN'), { statusCode: 400 });
    assert.equal((await offsetEntries(legacy.id)).length, 0);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 1_000_000);
  });

  test('unknown offset returns 404', async () => {
    await assert.rejects(() => cancelDebtOffset(2_147_483_647, adminUserId, 'ADMIN'), { statusCode: 404 });
  });

  test('concurrent reversals restore the balance exactly once', async () => {
    const pair = await fundedPair(6_000_000);
    const row = await recordPair(pair);
    const results = await Promise.allSettled([
      cancelDebtOffset(row.id, adminUserId, 'ADMIN'),
      cancelDebtOffset(row.id, adminUserId, 'ADMIN'),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.statusCode, 409);
    assert.equal((await offsetEntries(row.id)).length, 4);
    assert.equal(await balance('CUSTOMER', pair.cust.id), 6_000_000);
    assert.equal(await balance('VENDOR', pair.sup.id), 6_000_000);
    await assert.rejects(() => cancelDebtOffset(row.id, adminUserId, 'ADMIN'), { statusCode: 409 });
  });
});
