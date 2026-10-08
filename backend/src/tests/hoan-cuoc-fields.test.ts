/**
 * Card 051026231522 — spec 5.10 Table 1.1.3 (P2): the "Theo dõi hoàn cược"
 * add-dialog fields (Ngày cược / Ngày dự kiến hoàn cược / Trạng thái) and the
 * intake auto-record shape. Service-level suite; fixtures `hoancuoc-*`, local
 * DB :5441.
 *
 * Coverage:
 *   (a) old 6-field create is unchanged — depositDate null, status CHUA.
 *   (b) create with depositDate (+ dd/mm/yy normalization) and status CHUA.
 *   (c) create with status DA_HOAN_CUOC posts the treasury movement exactly
 *       once through the standing engine; re-tick is rejected with no
 *       duplicate posting.
 *   (d) isCvOverdue anchors on depositDate when present, createdAt otherwise.
 *   (e) auto-record: hasDeposit=true lands exactly one row with the intake
 *       shape (bill = Số Bill/Số Booking/shipment code chain, customer, amount,
 *       depositDate = VN creation day, carrier from the intake shipping line);
 *       hasDeposit false/absent lands nothing.
 *   (f) expectedRefundDate auto = CV + 14 when omitted.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import {
  createDepositTracker, markDepositRefunded, isCvOverdue, vnCalendarDate,
} from '../services/deposit-refund-tracker.service';
import { createShipment } from '../services/shipment-create.service';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

let actorId = 0;

async function mkActor() {
  const [u] = await db.insert(s.users).values({
    username: `hoancuoc-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  actorId = u.id;
  return u;
}

async function mkCustomer(name: string) {
  const [c] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, c.id)); });
  return c;
}

async function mkCompanyAccount(opening: string) {
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `HOANCUOC-${suffix}-${cleanup.length}`,
    name: `hoancuoc company ${suffix}-${cleanup.length}`,
    type: 'CASH',
    fundCode: 'COMPANY',
    status: 'ACTIVE',
    openingBalance: opening,
    createdBy: actorId,
    updatedBy: actorId,
  }).returning();
  track(async () => { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); });
  return account;
}

function trackTracker(id: number) {
  track(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, id)); });
}

function trackShipment(id: number) {
  track(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.shipmentId, id)); });
  track(async () => { await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, id)); });
  track(async () => { await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, id)); });
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, id)); });
}

describe('card 051026231522 — hoàn-cược fields', () => {
  after(async () => { for (const fn of cleanup) await fn(); });

  test('(a)+(f) old 6-field create unchanged — depositDate null, status CHUA, CV+14 default', async () => {
    await mkActor();
    const created = await createDepositTracker({ userId: actorId, role: Role.ACCOUNTANT }, {
      billNumber: `YML-A-${suffix.slice(0, 6)}`,
      customerName: `hoancuoc old ${suffix}`,
      carrierName: 'YML',
      depositAmount: 4000000,
      cvSubmittedDate: '28/09/26',
    });
    trackTracker(created.id);
    assert.equal(created.depositDate, null, 'the old create shape leaves Ngày cược empty');
    assert.equal(created.status, 'CHUA_HOAN_CUOC');
    assert.equal(created.cvSubmittedDate, '2026-09-28');
    assert.equal(created.expectedRefundDate, '2026-10-12', '(f) expected refund = CV + 14 when omitted');
  });

  test('(b) create with depositDate + status CHUA — normalized, nothing posted', async () => {
    await mkActor();
    const created = await createDepositTracker({ userId: actorId, role: Role.ACCOUNTANT }, {
      billNumber: `YML-B-${suffix.slice(0, 6)}`,
      customerName: `hoancuoc dated ${suffix}`,
      carrierName: 'YML',
      depositAmount: 5000000,
      depositDate: '05/10/26',
      cvSubmittedDate: '01/10/26',
      status: 'CHUA_HOAN_CUOC',
    });
    trackTracker(created.id);
    assert.equal(created.depositDate, '2026-10-05', 'Ngày cược accepts the dd/mm/yy typing pattern');
    assert.equal(created.status, 'CHUA_HOAN_CUOC');
    assert.equal(created.expectedRefundDate, '2026-10-15', '(f) expected refund = CV + 14 when omitted');
    assert.equal(created.refundPostedMovementId, null, 'CHUA never posts money');
    const isoDate = await createDepositTracker({ userId: actorId, role: Role.ACCOUNTANT }, {
      billNumber: `YML-C-${suffix.slice(0, 6)}`,
      customerName: `hoancuoc iso ${suffix}`,
      carrierName: 'YML',
      depositAmount: 1000000,
      depositDate: '2026-10-06',
    });
    trackTracker(isoDate.id);
    assert.equal(isoDate.depositDate, '2026-10-06', 'ISO passes straight through');
  });

  test('(c) status DA_HOAN_CUOC at create posts ONE engine movement; retry never duplicates', async () => {
    await mkActor();
    await mkCompanyAccount('1000000');
    const [resolvedAccount] = await db.select().from(s.treasuryAccounts)
      .where(and(eq(s.treasuryAccounts.fundCode, 'COMPANY'), eq(s.treasuryAccounts.status, 'ACTIVE')))
      .orderBy(asc(s.treasuryAccounts.id)).limit(1);
    assert.ok(resolvedAccount, 'a COMPANY account must resolve');
    const bill = `REF-${suffix.slice(0, 6)}`;
    const created = await createDepositTracker({ userId: actorId, role: Role.ACCOUNTANT }, {
      billNumber: bill,
      customerName: `hoancuoc refund ${suffix}`,
      carrierName: 'YML',
      depositAmount: 3000000,
      depositDate: '2026-10-01',
      cvSubmittedDate: '02/10/26',
      status: 'DA_HOAN_CUOC',
    });
    trackTracker(created.id);
    assert.equal(created.status, 'DA_HOAN_CUOC');
    assert.ok(created.refundPostedMovementId, 'the composition stamps the posted movement');
    assert.ok(created.refundPostedAt);
    const [movement] = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.id, created.refundPostedMovementId!));
    assert.equal(movement.direction, 'IN');
    assert.equal(movement.amount, '3000000');
    assert.equal(movement.status, 'POSTED');
    assert.equal(movement.treasuryAccountId, resolvedAccount.id);
    assert.ok(movement.ledgerEntryId, 'the posting rides the standing ledger+treasury engine');
    track(async () => {
      await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
      if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
    });
    const posted = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.physicalReference, `HOAN-CUOC-${created.id}-${bill}`));
    assert.equal(posted.length, 1, 'exactly one movement for the row');
    // Retry: the standing tick refuses a re-post and the movement count holds.
    await assert.rejects(
      () => markDepositRefunded({ userId: actorId, role: Role.ACCOUNTANT }, created.id),
      (err: unknown) => err instanceof ApiError && (err as ApiError).statusCode === 409,
    );
    const afterRetry = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.physicalReference, `HOAN-CUOC-${created.id}-${bill}`));
    assert.equal(afterRetry.length, 1, 'retry never duplicates the posting');
  });

  test('(d) isCvOverdue anchors on depositDate when present, createdAt otherwise', () => {
    const base = { status: 'CHUA_HOAN_CUOC', cvSubmittedDate: null };
    // No depositDate — the legacy createdAt anchor, byte-for-byte old math.
    const legacy = { ...base, createdAt: new Date('2026-09-17T20:00:00Z') };
    assert.equal(isCvOverdue(legacy, new Date('2026-09-25T01:30:00Z')), false, 'VN day-diff 7 stays quiet');
    assert.equal(isCvOverdue(legacy, new Date('2026-09-26T01:30:00Z')), true, 'VN day-diff 8 flags');
    assert.equal(
      isCvOverdue({ ...base, depositDate: null, createdAt: new Date('2026-09-17T20:00:00Z') }, new Date('2026-09-26T01:30:00Z')),
      true,
      'explicit null depositDate also falls back to createdAt',
    );
    // depositDate present — the deposit day anchors, whatever createdAt says.
    const anchored = { ...base, createdAt: new Date('2026-09-25T00:00:00Z'), depositDate: '2026-09-17' };
    assert.equal(isCvOverdue(anchored, new Date('2026-09-25T01:30:00Z')), true, 'day-diff 8 vs Ngày cược flags even though the row landed later');
    assert.equal(
      isCvOverdue({ ...base, createdAt: new Date('2026-09-01T00:00:00Z'), depositDate: '2026-09-20' }, new Date('2026-09-25T01:30:00Z')),
      false,
      'day-diff 5 from Ngày cược stays quiet even though createdAt is old',
    );
    // A CV date or a refunded row still never flags, anchor or not.
    assert.equal(
      isCvOverdue({ status: 'CHUA_HOAN_CUOC', cvSubmittedDate: '2026-09-24', createdAt: new Date(), depositDate: '2026-09-01' }, new Date('2026-10-05T00:00:00Z')),
      false,
    );
    assert.equal(
      isCvOverdue({ status: 'DA_HOAN_CUOC', cvSubmittedDate: null, createdAt: new Date(), depositDate: '2026-09-01' }, new Date('2026-10-05T00:00:00Z')),
      false,
    );
  });

  test('(e) auto-record: hasDeposit=true lands exactly one row with the intake shape', async () => {
    await mkActor();
    const customer = await mkCustomer('Công ty hoàn cược E');
    const bill = `HOAN-BILL-${suffix.slice(0, 6)}`;
    const beforeDay = vnCalendarDate(new Date());
    const shipment = await createShipment({
      customerId: customer.id,
      blNumber: bill,
      shippingLineName: 'Hãng tàu hoàn cược E',
      hasDeposit: true,
      depositAmount: 7_000_000,
      createdBy: actorId,
    });
    trackShipment(shipment.id);
    const afterDay = vnCalendarDate(new Date());
    const rows = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, shipment.id));
    assert.equal(rows.length, 1, 'exactly one tracker row per ticked create');
    const row = rows[0]!;
    assert.equal(row.billNumber, bill, 'the intake Số Bill survives the tick — no hand-typed bill is lost');
    assert.equal(row.customerName, customer.name);
    assert.equal(Number(row.depositAmount), 7_000_000);
    assert.ok([beforeDay, afterDay].includes(row.depositDate!), 'Ngày cược = the VN calendar day of creation');
    assert.equal(row.status, 'CHUA_HOAN_CUOC');
    assert.equal(row.carrierName, 'Hãng tàu hoàn cược E', 'Hãng tàu rides the intake shipping line');
    assert.equal(row.cvSubmittedDate, null);
    assert.equal(row.expectedRefundDate, null);
    assert.equal(row.refundPostedMovementId, null);
  });

  test('(e) auto-record bill fallback chain + unticked create lands nothing', async () => {
    await mkActor();
    const customer = await mkCustomer('Công ty hoàn cược F');
    // EXPORT shape: the Số Booking reference is the display bill.
    const booking = `HOAN-BK-${suffix.slice(0, 6)}`;
    const viaBooking = await createShipment({
      customerId: customer.id,
      bookingRef: booking,
      hasDeposit: true,
      depositAmount: 2_000_000,
      createdBy: actorId,
    });
    trackShipment(viaBooking.id);
    const [bookingRow] = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, viaBooking.id));
    assert.equal(bookingRow!.billNumber, booking, 'Số Booking falls in the same Số Bill field');

    // No document reference at all → the shipment code.
    const refless = await createShipment({
      customerId: customer.id,
      hasDeposit: true,
      depositAmount: 1_000_000,
      createdBy: actorId,
    });
    trackShipment(refless.id);
    const [reflessRow] = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, refless.id));
    assert.equal(reflessRow!.billNumber, refless.shipmentCode, 'no reference → the shipment code');

    // Unticked → nothing at all.
    const unticked = await createShipment({
      customerId: customer.id,
      blNumber: `HOAN-NONE-${suffix.slice(0, 6)}`,
      createdBy: actorId,
    });
    trackShipment(unticked.id);
    const none = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, unticked.id));
    assert.equal(none.length, 0, 'hasDeposit false/absent creates nothing');
  });
});
