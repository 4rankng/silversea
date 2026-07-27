/**
 * Wave 3 M6.4 — debt_offsets verification against M06-04 rules.
 *
 * Covers the full M06-04 acceptance criteria:
 *   M06-04-01 happy path        → approve posts paired entries
 *   M06-04-02 missing/invalid   → createDebtOffset clamps + rejects min=0
 *   M06-04-03 exception path    → rejection writes nothing; cancel-after-
 *                                  approve posts reversing entries
 *   M06-04-04 role guard        → non-FINANCIAL roles rejected
 *   M06-04-05 duplicate/concurrent → second approve throws (status check)
 *
 * Plus the canonical M6.4 invariants:
 *   - offset ≤ min(AR, AP) (re-checked at approval)
 *   - booked only after approval
 *   - cancel-after-approve uses reversal (entries restore pre-approval balances)
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import {
  createDebtOffset,
  approveDebtOffset,
  cancelDebtOffset,
  listDebtOffsets,
} from '../services/debtOffset.service';
import { transitionApproval } from '../services/approval.service';
import { LedgerService } from '../services/ledger.service';

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
  const [cust] = await db.insert(s.customers).values({
    name: `M64 customer ${suffix}-${createdCustomerIds.length}`,
  }).returning();
  createdCustomerIds.push(cust.id);

  const [sup] = await db.insert(s.suppliers).values({
    name: `M64 supplier ${suffix}-${createdSupplierIds.length}`,
    linkedCustomerId: cust.id,
  }).returning();
  createdSupplierIds.push(sup.id);

  // Mirror the link on the customer too.
  await db.update(s.customers)
    .set({ linkedSupplierId: sup.id })
    .where(eq(s.customers.id, cust.id));

  return { cust, sup };
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
  const userPattern = `m64-%-${suffix}-%`;
  try {
    if (createdOffsetIds.length > 0) await db.delete(s.debtOffsets).where(inArray(s.debtOffsets.id, createdOffsetIds));
    // Sweep ALL m64-related ledger rows (approval + cancel entries we may not
    // have tracked individually) by note prefix.
    await db.delete(s.ledger).where(sql`${s.ledger.note} LIKE 'm64 test%' OR ${s.ledger.note} LIKE 'Đối trừ công nợ #%' OR ${s.ledger.note} LIKE 'Hoàn tác đối trừ công nợ #%'`);
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${custPattern}`);
    await db.delete(s.suppliers).where(sql`${s.suppliers.name} LIKE ${supPattern}`);
    await db.delete(s.users).where(sql`${s.users.username} LIKE ${userPattern}`);
  } catch (err) { console.warn('[m64] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M6.4 — M06-04-02 createDebtOffset validation', () => {
  test('clamps amount to min(AR, AP) — offset ≤ smaller side', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 5_000_000);
    await postAp(sup.id, 3_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);
    assert.equal(Number(offset.amount), 3_000_000, 'clamped to smaller side');
    assert.equal(offset.approvalStatus, 'PENDING');
  });

  test('rejects when min(AR, AP) = 0 (no balance to offset)', async () => {
    const { cust, sup } = await mkLinkedPair();
    // No ledger entries → both balances zero.
    await assert.rejects(
      () => createDebtOffset({
        customerId: cust.id, supplierId: sup.id,
        offsetDate: '2026-07-15', createdBy: adminUserId,
      }),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });
});

describe('M6.4 — M06-04-01 approve posts paired entries', () => {
  test('approve reduces AR and AP by the offset amount', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 4_000_000);
    await postAp(sup.id, 4_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    const arBefore = await balance('CUSTOMER', cust.id);
    const apBefore = await balance('VENDOR', sup.id);
    assert.equal(arBefore, 4_000_000);
    assert.equal(apBefore, 4_000_000);

    await approveDebtOffset(offset.id, managerUserId, 'MANAGER');

    const arAfter = await balance('CUSTOMER', cust.id);
    const apAfter = await balance('VENDOR', sup.id);
    assert.equal(arAfter, 0, 'AR reduced to 0');
    assert.equal(apAfter, 0, 'AP reduced to 0');

    // Status flipped to APPROVED.
    const rows = await listDebtOffsets({ approvalStatus: 'APPROVED' });
    const match = rows.find(r => r.id === offset.id);
    assert.ok(match);
    assert.equal(match!.approvalStatus, 'APPROVED');
  });

  test('approve re-validates under lock — rejects when balance dropped', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);
    assert.equal(Number(offset.amount), 1_000_000);

    // Drain the customer's AR manually after creation (1M credit on a 1M
    // debit balance → 0). CUSTOMER convention: balance = debit − credit.
    const [drainRow] = await db.insert(s.ledger).values({
      entityType: 'CUSTOMER' as const, entityId: cust.id,
      txnType: TxnType.PAYMENT_RECEIVED, txnId: 0,
      debit: '0', credit: '1000000', balance: '0',
      note: 'm64 test drain',
    }).returning();
    createdLedgerIds.push(drainRow.id);

    // Approval should refuse — amount > current AR.
    await assert.rejects(
      () => approveDebtOffset(offset.id, managerUserId, 'MANAGER'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /Số dư hiện tại không đủ/.test(err.message),
    );
  });
});

describe('M6.4 — M06-04-03 rejection writes nothing', () => {
  test('REJECTED transition posts no ledger entries', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 2_000_000);
    await postAp(sup.id, 1_500_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    const arBefore = await balance('CUSTOMER', cust.id);
    const apBefore = await balance('VENDOR', sup.id);

    await db.transaction(async (tx) => {
      await transitionApproval(tx, {
        table: 'debt_offsets', id: offset.id, toStatus: 'REJECTED',
        actorId: adminUserId, actorRole: 'ADMIN',
      });
    });

    const arAfter = await balance('CUSTOMER', cust.id);
    const apAfter = await balance('VENDOR', sup.id);
    assert.equal(arAfter, arBefore, 'rejection did not change AR');
    assert.equal(apAfter, apBefore, 'rejection did not change AP');
  });
});

describe('M6.4 — M06-04-03 cancel-after-approve uses reversal', () => {
  test('cancel posts reversing entries and restores balances', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 6_000_000);
    await postAp(sup.id, 6_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    await approveDebtOffset(offset.id, managerUserId, 'MANAGER');
    const arMid = await balance('CUSTOMER', cust.id);
    const apMid = await balance('VENDOR', sup.id);
    assert.equal(arMid, 0);
    assert.equal(apMid, 0);

    await cancelDebtOffset(offset.id, adminUserId, 'ADMIN');

    const arFinal = await balance('CUSTOMER', cust.id);
    const apFinal = await balance('VENDOR', sup.id);
    assert.equal(arFinal, 6_000_000, 'AR restored to pre-approval value');
    assert.equal(apFinal, 6_000_000, 'AP restored to pre-approval value');

    // Status flipped to CANCELED.
    const rows = await listDebtOffsets({ approvalStatus: 'CANCELED' });
    const match = rows.find(r => r.id === offset.id);
    assert.ok(match);
    assert.equal(match!.approvalStatus, 'CANCELED');
  });

  test('cancel on PENDING offset → 400 (must use rejection)', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    await assert.rejects(
      () => cancelDebtOffset(offset.id, adminUserId, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /PENDING/.test(err.message),
    );
  });

  test('cancel on CANCELED offset → 409 (already canceled)', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);
    await approveDebtOffset(offset.id, managerUserId, 'MANAGER');
    await cancelDebtOffset(offset.id, adminUserId, 'ADMIN');

    await assert.rejects(
      () => cancelDebtOffset(offset.id, adminUserId, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /đã hủy/.test(err.message),
    );
  });

  test('cancel on missing offset → 404', async () => {
    await assert.rejects(
      () => cancelDebtOffset(99_999_999, adminUserId, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 404,
    );
  });

  test('concurrent cancels: exactly one reversal wins and the loser does not double-post', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 6_000_000);
    await postAp(sup.id, 6_000_000);

    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);
    await approveDebtOffset(offset.id, managerUserId, 'MANAGER');

    let releaseEntityLocks!: () => void;
    let markEntityLocksAcquired!: () => void;
    const entityLocksAcquired = new Promise<void>((resolve) => {
      markEntityLocksAcquired = resolve;
    });
    const releaseLocks = new Promise<void>((resolve) => {
      releaseEntityLocks = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await LedgerService.lockEntities(tx, [
        { entityType: 'CUSTOMER', entityId: cust.id },
        { entityType: 'VENDOR', entityId: sup.id },
      ]);
      markEntityLocksAcquired();
      await releaseLocks;
    });
    await entityLocksAcquired;

    let raceSettled = false;
    const race = Promise.allSettled([
      cancelDebtOffset(offset.id, adminUserId, 'ADMIN'),
      cancelDebtOffset(offset.id, adminUserId, 'ADMIN'),
    ]).finally(() => {
      raceSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(
      raceSettled,
      false,
      'both cancels must be waiting behind the shared entity locks after reading APPROVED',
    );

    releaseEntityLocks();
    await blocker;
    const results = await race;
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];

    assert.equal(fulfilled.length, 1, `expected exactly 1 cancel winner, got ${fulfilled.length}`);
    assert.equal(rejected.length, 1, `expected exactly 1 cancel loser, got ${rejected.length}`);
    assert.equal((rejected[0].reason as Error & { statusCode?: number }).statusCode, 409);

    const arFinal = await balance('CUSTOMER', cust.id);
    const apFinal = await balance('VENDOR', sup.id);
    assert.equal(arFinal, 6_000_000, 'AR restored exactly once');
    assert.equal(apFinal, 6_000_000, 'AP restored exactly once');

    const reversalRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(sql`${s.ledger.txnType} = 'ADJUSTMENT' AND ${s.ledger.txnId} = ${offset.id} AND ${s.ledger.note} LIKE ${`Hoàn tác đối trừ công nợ #${offset.id}%`}`);
    createdLedgerIds.push(...reversalRows.map(row => row.id));
    assert.equal(reversalRows.length, 2, 'exactly one reversing customer/vendor pair posts');
  });
});

describe('M6.4 — M06-04-04 role guard', () => {
  test('cancel by DRIVER → 403', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);
    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);
    await approveDebtOffset(offset.id, managerUserId, 'MANAGER');

    await assert.rejects(
      () => cancelDebtOffset(offset.id, driverUserId, 'DRIVER'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403,
    );
  });

  test('approve by DRIVER → 403 (transitionApproval guard)', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);
    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    await assert.rejects(
      () => approveDebtOffset(offset.id, driverUserId, 'DRIVER'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403,
    );
  });

  test('creator cannot approve their own debt offset', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);
    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    await assert.rejects(
      () => approveDebtOffset(offset.id, adminUserId, 'ADMIN'),
      (err: Error & { statusCode?: number }) =>
        err.statusCode === 403 && /Không thể duyệt phiếu đối trừ công nợ do chính mình tạo/.test(err.message),
    );
  });
});

describe('M6.4 — M06-04-05 duplicate / concurrent approve', () => {
  test('second approve on the same offset throws (status no longer PENDING)', async () => {
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 1_000_000);
    await postAp(sup.id, 1_000_000);
    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    await approveDebtOffset(offset.id, managerUserId, 'MANAGER');

    // Second approve — already APPROVED, no longer PENDING.
    await assert.rejects(
      () => approveDebtOffset(offset.id, managerUserId, 'MANAGER'),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /APPROVED/.test(err.message),
    );
  });

  test('concurrent approves: exactly one wins, only one pair of ledger entries posts', async () => {
    // Reproduces the D1 race from the 2026-07-27 regression audit: two parallel
    // POST /approve calls on the same PENDING offset both returned 200 and
    // posted 4 ADJUSTMENT entries (2 expected), halving AR/AP. Root cause:
    // transitionApproval's status SELECT did not take a row lock, so both
    // txns read PENDING before either committed.
    const { cust, sup } = await mkLinkedPair();
    await postAr(cust.id, 4_000_000);
    await postAp(sup.id, 4_000_000);
    const offset = await createDebtOffset({
      customerId: cust.id, supplierId: sup.id,
      offsetDate: '2026-07-15', createdBy: adminUserId,
    });
    createdOffsetIds.push(offset.id);

    // Fire both approvals concurrently. Resolve into a settled-result array
    // so neither reject propagates to abort the test before assertions run.
    const results = await Promise.allSettled([
      approveDebtOffset(offset.id, managerUserId, 'MANAGER'),
      approveDebtOffset(offset.id, managerUserId, 'MANAGER'),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

    // Invariant 1: exactly one approve wins; the other is rejected.
    assert.equal(fulfilled.length, 1,
      `expected exactly 1 approve to succeed, got ${fulfilled.length}. results=${JSON.stringify(results.map(r => r.status))}`);
    assert.equal(rejected.length, 1,
      `expected exactly 1 approve to be rejected, got ${rejected.length}`);
    const rejectErr = rejected[0].reason as Error & { statusCode?: number };
    assert.equal(rejectErr.statusCode, 409,
      `expected 409 on losing approve, got ${rejectErr.statusCode} ${rejectErr.message}`);

    // Invariant 2: status is APPROVED (not something weird from a torn write).
    const rows = await listDebtOffsets({ approvalStatus: 'APPROVED' });
    const match = rows.find(r => r.id === offset.id);
    assert.ok(match, 'offset is APPROVED');
    assert.equal(match!.approvalStatus, 'APPROVED');

    // Invariant 3 (the actual money): exactly ONE debit+credit pair was
    // posted to each ledger — i.e. AR and AP were each reduced by `amount`
    // exactly once, not twice.
    const arAfter = await balance('CUSTOMER', cust.id);
    const apAfter = await balance('VENDOR', sup.id);
    assert.equal(arAfter, 0,
      `AR should be 0 after one approval (4M − 4M); got ${arAfter}. Double-post likely.`);
    assert.equal(apAfter, 0,
      `AP should be 0 after one approval (4M − 4M); got ${apAfter}. Double-post likely.`);

    // Cross-check: count ADJUSTMENT rows linked to this offset. Must be 2
    // (one CUSTOMER credit + one VENDOR debit), not 4.
    const adjRows = await db.select({ id: s.ledger.id, entityType: s.ledger.entityType })
      .from(s.ledger)
      .where(sql`${s.ledger.txnType} = 'ADJUSTMENT' AND ${s.ledger.txnId} = ${offset.id} AND ${s.ledger.note} LIKE ${`Đối trừ công nợ #${offset.id}%`}`);
    createdLedgerIds.push(...adjRows.map(r => r.id));
    assert.equal(adjRows.length, 2,
      `expected exactly 2 ADJUSTMENT rows for offset ${offset.id}, got ${adjRows.length}. Race D1.`);
  });
});
