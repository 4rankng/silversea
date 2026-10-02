import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { createDepositTracker, updateDepositTrackerDates, markDepositRefunded, recordDepositFromIntake } from '../services/deposit-refund-tracker.service';
import { disconnectRedis } from '../lib/redis';

const prefix = `deposit-correction-${Date.now()}`;
let actor: { userId: number; role: Role };
const ids: number[] = [];
before(async () => {
  const [user] = await db.insert(s.users).values({ username: prefix, passwordHash: 'test', role: Role.ACCOUNTANT }).returning();
  actor = { userId: user.id, role: Role.ACCOUNTANT };
});
after(async () => {
  if (ids.length) await db.delete(s.depositRefundTrackers).where(inArray(s.depositRefundTrackers.id, ids));
  if (actor) await db.delete(s.users).where(eq(s.users.id, actor.userId));
  await disconnectRedis(); await client.end();
});
async function tracker(amount = '0') {
  const [row] = await db.insert(s.depositRefundTrackers).values({ billNumber: prefix, customerName: prefix, carrierName: 'Local QA', depositAmount: amount }).returning();
  ids.push(row.id); return row;
}

describe('deposit correction invariants', () => {
  test('accountant fills a zero intake amount and note; invalid amounts never persist', async () => {
    const row = await tracker();
    const updated = await updateDepositTrackerDates(actor, row.id, { depositAmount: 4000000, note: 'Actual deposit' });
    assert.equal(updated.depositAmount, '4000000'); assert.equal(updated.note, 'Actual deposit');
    for (const amount of [0, -1, 1.5, 1_000_000_000_000_000, Number.MAX_SAFE_INTEGER + 1, 'invalid']) {
      await assert.rejects(() => updateDepositTrackerDates(actor, row.id, { depositAmount: amount }));
    }
    const [saved] = await db.select().from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id));
    assert.equal(saved.depositAmount, '4000000');
    await assert.rejects(() => updateDepositTrackerDates({ ...actor, role: Role.DRIVER }, row.id, { depositAmount: 1 }));
  });
  test('CV clear, +14 default, and explicit override remain distinct', async () => {
    const row = await tracker('4000000');
    let updated = await updateDepositTrackerDates(actor, row.id, { cvSubmittedDate: '2026-12-25', expectedRefundDate: null });
    assert.equal(updated.expectedRefundDate, '2027-01-08');
    updated = await updateDepositTrackerDates(actor, row.id, { expectedRefundDate: '2027-02-01' });
    assert.equal(updated.expectedRefundDate, '2027-02-01');
    updated = await updateDepositTrackerDates(actor, row.id, { cvSubmittedDate: null, expectedRefundDate: null });
    assert.equal(updated.cvSubmittedDate, null); assert.equal(updated.expectedRefundDate, null);
  });
  test('refunded rows reject amount and date changes', async () => {
    const row = await tracker('4000000');
    await db.update(s.depositRefundTrackers).set({ status: 'DA_HOAN_CUOC' }).where(eq(s.depositRefundTrackers.id, row.id));
    await assert.rejects(() => updateDepositTrackerDates(actor, row.id, { depositAmount: 5000000 }), /đã hoàn cược/);
    await assert.rejects(() => updateDepositTrackerDates(actor, row.id, { cvSubmittedDate: '2026-09-22' }), /đã hoàn cược/);
  });
  test('optional null CV is accepted by creation without inventing a date', async () => {
    const row = await createDepositTracker(actor, { billNumber: prefix, customerName: prefix, carrierName: 'Local QA', depositAmount: 4000000, cvSubmittedDate: null });
    ids.push(row.id); assert.equal(row.cvSubmittedDate, null); assert.equal(row.expectedRefundDate, null);
    await assert.rejects(() => createDepositTracker(actor, { billNumber: prefix, customerName: prefix, carrierName: 'Local QA', depositAmount: 1_000_000_000_000_000 }), { statusCode: 400 });
    const maximum = await createDepositTracker(actor, { billNumber: prefix, customerName: prefix, carrierName: 'Local QA', depositAmount: 999_999_999_999_999 });
    ids.push(maximum.id); assert.equal(maximum.depositAmount, '999999999999999');
    await assert.rejects(() => recordDepositFromIntake({ shipmentId: 1, billNumber: prefix, customerName: prefix, carrierName: 'Local QA', expectedAmount: 1_000_000_000_000_000 }), { statusCode: 400 });
  });
  test('edit versus refund serializes on the same row and preserves the posted amount', async () => {
    const row = await tracker('4000000');
    const [account] = await db.insert(s.treasuryAccounts).values({ code: prefix, name: prefix, type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: actor.userId, updatedBy: actor.userId }).returning();
    try {
      const outcomes = await Promise.allSettled([
        updateDepositTrackerDates(actor, row.id, { depositAmount: 5000000 }), markDepositRefunded(actor, row.id),
      ]);
      assert.equal(outcomes[1].status, 'fulfilled');
      const [saved] = await db.select().from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id));
      assert.equal(saved.status, 'DA_HOAN_CUOC');
      const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.id, saved.refundPostedMovementId!));
      assert.equal(movement.amount, saved.depositAmount);
      await assert.rejects(() => markDepositRefunded(actor, row.id), /đã ghi nhận hoàn cược/);
      await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id));
      await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
      if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
    } finally { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); }
  });
});
