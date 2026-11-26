// SIL-1012 — sửa số tiền cược: the audit WRITE was always correct (QA Round
// 26 forensics: audit_logs holds the DEPOSIT_TRACKER_UPDATED row with
// before/after + user_id), but the READ path dropped it from
// GET /api/audit-logs: `deposit_refund_tracker` (the service row) and
// `accounting` + `/api/accounting` (the request-level row) matched NO domain
// arm, and the accountant feed is scoped to shipment-domain ∪ assigned
// finance — so hoapt (ACCOUNTANT) saw a 7.243-event subset and searched
// 'DEPOSIT_TRACKER_UPDATED' into 0 matches. The old→new also died in the
// mapper: the accountant payload redaction stripped payload.before/after.
//
// Fix under test: the deposit-tracker domain joins the finance domain
// (feed + 'Tài chính' tab + search), the search payload arm reads the whole
// stored JSON (the bill number lives in payload.body.billNumber) and gains a
// tracker-join arm for bill numbers that live ONLY on the tracker row, and
// the accountant keeps the full payload on these rows (SIL-851's lot-domain
// exception shape). actor_name is snapshotted at WRITE time from the actor's
// display name (the request's AuthUser); AUDIT_USER_NAME_SQL still coalesces
// actor_name → users.full_name → username for legacy rows.
//
// Real dev DB, tracked cleanup (house convention of phoi-phieu-party-lots).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { updateDepositTrackerDates } from '../services/deposit-refund-tracker.service';
import { queryAuditLogs } from '../services/audit-query.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BILL = `FES${suffix.slice(0, 10).toUpperCase()}`;
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

async function mkAccountant(): Promise<{ id: number; fullName: string }> {
  const fullName = `S12 kế toán ${suffix}-${cleanup.length}`;
  const [user] = await db.insert(s.users).values({
    username: `s12-${suffix}-${cleanup.length}`, passwordHash: 't', fullName, role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id, fullName: s.users.fullName });
  track(() => db.delete(s.users).where(eq(s.users.id, user.id)));
  return { id: user.id, fullName: user.fullName ?? '' };
}

async function mkTracker(bill = BILL): Promise<{ id: number }> {
  const [row] = await db.insert(s.depositRefundTrackers).values({
    billNumber: bill, customerName: `S12 khách ${suffix}`, carrierName: `S12 nhà xe ${suffix}`,
    depositAmount: '4500000',
  }).returning({ id: s.depositRefundTrackers.id });
  track(() => db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id)));
  return row;
}

describe('SIL-1012 — the KT amount edit reaches the audit feed with actor + time + old→new', () => {
  test('PATCH-shaped service write is visible to its ACCOUNTANT with before/after intact', async () => {
    const actor = await mkAccountant();
    const tracker = await mkTracker();
    await updateDepositTrackerDates({ userId: actor.id, role: Role.ACCOUNTANT, fullName: actor.fullName, username: null }, tracker.id, {
      depositAmount: 4_600_000,
    });
    const feed = await queryAuditLogs({ page: 1, limit: 100, viewer: { userId: actor.id, role: Role.ACCOUNTANT } });
    const entry = feed.items.find((item) => item.message === 'DEPOSIT_TRACKER_UPDATED');
    assert.ok(entry, 'the deposit edit entry must be in the accountant feed');
    assert.equal(entry.userName, actor.fullName, 'actor resolves at read (actor_name snapshotted at write)');
    assert.equal(entry.billNumber, BILL, 'the row carries the bill code so the drawer can name it');
    assert.equal(entry.payload?.['before'], '4500000');
    assert.equal(entry.payload?.['after'], '4600000');
    assert.equal(entry.category, 'finance');
    assert.ok(entry.timestamp, 'the entry carries its own timestamp');
    // actor_name is persisted at write time — the read path must not NEED the
    // users join to name WHO changed the amount.
    const [raw] = await db.select({ actorName: s.auditLogs.actorName })
      .from(s.auditLogs).where(eq(s.auditLogs.id, entry.id));
    assert.equal(raw.actorName, actor.fullName, 'actor_name is persisted at write time');
  });

  test('the finance tab keeps the entry (the category partition must not drop it)', async () => {
    const actor = await mkAccountant();
    const tracker = await mkTracker();
    await updateDepositTrackerDates({ userId: actor.id, role: Role.ACCOUNTANT, fullName: actor.fullName, username: null }, tracker.id, {
      depositAmount: 4_700_000,
    });
    const feed = await queryAuditLogs({
      page: 1, limit: 100, category: 'finance', viewer: { userId: actor.id, role: Role.ACCOUNTANT },
    });
    assert.ok(feed.items.some((item) => item.message === 'DEPOSIT_TRACKER_UPDATED'),
      'the finance tab must list the deposit edit');
  });

  test('searching the message and the bill number finds the rows (QA probe 0-match repro)', async () => {
    const actor = await mkAccountant();
    const tracker = await mkTracker();
    await updateDepositTrackerDates({ userId: actor.id, role: Role.ACCOUNTANT, fullName: actor.fullName, username: null }, tracker.id, {
      depositAmount: 4_800_000,
    });
    // The request-level row the audit middleware writes for the deposits
    // create: entity 'accounting', path /api/accounting/deposits, body with
    // the bill number.
    const [requestRow] = await db.insert(s.auditLogs).values({
      userId: actor.id, actorName: actor.fullName,
      message: `Kế toán ${actor.fullName} tạo dòng cược ${BILL}`,
      entityType: 'accounting', entityId: tracker.id,
      payload: { path: '/api/accounting/deposits/', method: 'POST', body: { billNumber: BILL } },
    }).returning({ id: s.auditLogs.id });
    track(() => db.delete(s.auditLogs).where(eq(s.auditLogs.id, requestRow.id)));

    for (const search of ['DEPOSIT_TRACKER_UPDATED', BILL]) {
      const feed = await queryAuditLogs({
        page: 1, limit: 100, search, viewer: { userId: actor.id, role: Role.ACCOUNTANT },
      });
      assert.ok(feed.total > 0, `search "${search}" must not come back empty`);
    }
  });

  test('bill-number search returns exactly that bill\'s edit rows (QA repro: %FES…% was 0)', async () => {
    const actor = await mkAccountant();
    // A bill of this test's own: the earlier tests in this file share BILL and
    // their rows stay until the after() cleanup — a shared term would count
    // theirs in.
    const bill = `${BILL}-EDIT`;
    const tracker = await mkTracker(bill);
    // The repro shape: one bill edited twice lands exactly two audit rows.
    await updateDepositTrackerDates({ userId: actor.id, role: Role.ACCOUNTANT, fullName: actor.fullName, username: null }, tracker.id, {
      depositAmount: 4_000_000,
    });
    await updateDepositTrackerDates({ userId: actor.id, role: Role.ACCOUNTANT, fullName: actor.fullName, username: null }, tracker.id, {
      depositAmount: 4_500_000,
    });
    // A different bill edited once must never ride along ("đúng").
    const other = await mkTracker(`${BILL}-OTHER`);
    await updateDepositTrackerDates({ userId: actor.id, role: Role.ACCOUNTANT, fullName: actor.fullName, username: null }, other.id, {
      depositAmount: 1_000_000,
    });

    const byBill = await queryAuditLogs({ page: 1, limit: 100, search: bill, viewer: { userId: actor.id, role: Role.ACCOUNTANT } });
    assert.equal(byBill.items.length, 2, 'exactly the two edit rows of the searched bill');
    assert.deepEqual(byBill.items.map((item) => item.payload?.['after']).sort(), ['4000000', '4500000']);
    assert.ok(byBill.items.every((item) => item.message === 'DEPOSIT_TRACKER_UPDATED'), 'the rows are the amount-edit audit rows');
    assert.ok(byBill.items.every((item) => item.billNumber === bill), 'every hit carries the searched bill code');

    const byAction = await queryAuditLogs({ page: 1, limit: 100, search: 'DEPOSIT_TRACKER_UPDATED', viewer: { userId: actor.id, role: Role.ACCOUNTANT } });
    for (const id of byBill.items.map((item) => item.id)) {
      assert.ok(byAction.items.some((item) => item.id === id), 'the action-code search finds the same edit rows');
    }
  });

  test('the customer-assignment law survives: an unbound payments row stays hidden', async () => {
    const actor = await mkAccountant();
    const [customer] = await db.insert(s.customers).values({ name: `S12 không gán ${suffix}` })
      .returning({ id: s.customers.id });
    track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
    const [bound] = await db.insert(s.auditLogs).values({
      userId: actor.id, message: 'PAYMENT_RECEIVED', entityType: 'payments', entityId: 1,
      payload: { event: 'PAYMENT_RECEIVED', body: { customerId: customer.id } },
    }).returning({ id: s.auditLogs.id });
    track(() => db.delete(s.auditLogs).where(eq(s.auditLogs.id, bound.id)));
    const feed = await queryAuditLogs({ page: 1, limit: 100, viewer: { userId: actor.id, role: Role.ACCOUNTANT } });
    assert.equal(feed.items.some((item) => item.id === bound.id), false,
      'finance rows bound to an unassigned customer keep their scoping');
  });
});

after(async () => {
  for (const run of cleanup) {
    await run();
  }
  await disconnectRedis();
});
