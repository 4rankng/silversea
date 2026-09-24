/**
 * Card 20260921_19 — the container deposit refund tracker (BE).
 * Service-level suite; fixtures `card19-*`/`CARD19-*`, local DB :5441.
 *
 * Coverage:
 *   dd/mm/yy normalization + CV+14 default and manual override.
 *   List: CHUA-first oldest-due ordering, status/date filters, filtered
 *       tổng, and the two standing warnings (7-day CV-overdue count,
 *       unrefunded total).
 *   markRefunded: exactly ONE POSTED IN movement on the COMPANY (ACB)
 *       account, status flip, idempotent re-tick rejection; the movement is
 *       visible through the card-9 fund-book spine.
 *   recordDepositFromIntake: auto-row from the intake tick, amount optional,
 *       idempotent per shipment.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import {
  listDepositTrackers, createDepositTracker, updateDepositTrackerDates, markDepositRefunded,
  recordDepositFromIntake, normalizeDepositDate,
  isCvOverdue, vnCalendarDate, CV_OVERDUE_DAYS,
} from '../services/deposit-refund-tracker.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

let actorId = 0;

async function mkActor() {
  const [u] = await db.insert(s.users).values({
    username: `card19-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  actorId = u.id;
  return u;
}

async function mkCompanyAccount(opening: string) {
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `CARD19-${suffix}-${cleanup.length}`,
    name: `card19 company ${suffix}-${cleanup.length}`,
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

async function mkTracker(overrides: Partial<{
  billNumber: string; customerName: string; carrierName: string; depositAmount: string;
  cvSubmittedDate: string | null; expectedRefundDate: string | null; status: 'CHUA_HOAN_CUOC' | 'DA_HOAN_CUOC';
  createdAt: Date;
}> = {}) {
  const [row] = await db.insert(s.depositRefundTrackers).values({
    billNumber: overrides.billNumber ?? `CARD19-${suffix}-${cleanup.length}`,
    customerName: overrides.customerName ?? `card19 cust ${suffix}`,
    carrierName: overrides.carrierName ?? 'YML',
    depositAmount: overrides.depositAmount ?? '4000000',
    cvSubmittedDate: overrides.cvSubmittedDate ?? null,
    expectedRefundDate: overrides.expectedRefundDate ?? null,
    status: overrides.status ?? 'CHUA_HOAN_CUOC',
    createdAt: overrides.createdAt ?? new Date(),
  }).returning();
  track(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id)); });
  return row;
}

describe('card 20260921_19 - deposit refund tracker', () => {
  test('dd/mm/yy accepted, CV+14 default, manual override sticks', async () => {
    await mkActor();
    assert.equal(normalizeDepositDate('28/09/26'), '2026-09-28');
    assert.equal(normalizeDepositDate('05/10/26'), '2026-10-05');
    const created = await createDepositTracker({ userId: actorId, role: Role.ACCOUNTANT }, {
      billNumber: `YML${suffix.slice(0, 6)}`,
      customerName: `card19 customer ${suffix}`,
      carrierName: 'YML',
      depositAmount: 4000000,
      cvSubmittedDate: '28/09/26',
    });
    assert.equal(created.cvSubmittedDate, '2026-09-28');
    assert.equal(created.expectedRefundDate, '2026-10-12');
    const edited = await updateDepositTrackerDates({ userId: actorId, role: Role.ACCOUNTANT }, created.id, {
      expectedRefundDate: '30/10/26',
    });
    assert.equal(edited.expectedRefundDate, '2026-10-30', 'manual override sticks');
  });

  test('list: CHUA first oldest-due, filters, filtered tổng, warnings', async () => {
    await mkActor();
    await mkTracker({ billNumber: 'OLD1', createdAt: new Date(Date.now() - 10 * 86400000) });
    await mkTracker({ billNumber: 'DUE1', expectedRefundDate: '2026-09-01', depositAmount: '1000000' });
    await mkTracker({ billNumber: 'DUE2', expectedRefundDate: '2026-09-15', depositAmount: '2000000' });
    await mkTracker({ billNumber: 'DONE1', status: 'DA_HOAN_CUOC', depositAmount: '500000' });
    const actor = { userId: actorId, role: Role.ACCOUNTANT };
    const all = await listDepositTrackers(actor, {});
    const bills = all.items.map((row) => row.billNumber);
    assert.ok(bills.indexOf('OLD1') > -1);
    assert.ok(bills.indexOf('DUE1') < bills.indexOf('DUE2'), 'oldest due first within CHUA');
    assert.ok(bills.indexOf('DONE1') > bills.indexOf('DUE2'), 'CHUA block before DA block');
    const filtered = await listDepositTrackers(actor, { status: 'CHUA_HOAN_CUOC' });
    assert.ok(filtered.items.every((row) => row.status === 'CHUA_HOAN_CUOC'));
    assert.equal(filtered.total, filtered.items.reduce((sum, row) => sum + Number(row.depositAmount), 0));
    assert.ok(filtered.warnings.cvOverdueCount >= 1, 'OLD1 (10d, no CV) counts in the warning');
    assert.ok(filtered.warnings.unrefundedTotal >= 7000000, 'unrefunded total covers the CHUA set');
  });

  test('markRefunded posts ONE COMPANY IN movement; re-tick rejected; fund-book sees it', async () => {
    await mkActor();
    const account = await mkCompanyAccount('1000000');
    const [resolvedAccount] = await db.select().from(s.treasuryAccounts)
      .where(and(eq(s.treasuryAccounts.fundCode, 'COMPANY'), eq(s.treasuryAccounts.status, 'ACTIVE')))
      .orderBy(asc(s.treasuryAccounts.id)).limit(1);
    assert.ok(resolvedAccount, 'a COMPANY account must resolve');
    const created = await createDepositTracker({ userId: actorId, role: Role.ACCOUNTANT }, {
      billNumber: `REF${suffix}`,
      customerName: `card19 refund ${suffix}`,
      carrierName: 'YML',
      depositAmount: 4000000,
      cvSubmittedDate: '28/09/26',
    });
    const ticked = await markDepositRefunded({ userId: actorId, role: Role.ACCOUNTANT }, created.id);
    assert.equal(ticked.status, 'DA_HOAN_CUOC');
    assert.ok(ticked.refundPostedMovementId);
    const [movement] = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.id, ticked.refundPostedMovementId!));
    assert.equal(movement.direction, 'IN');
    assert.equal(movement.amount, '4000000');
    assert.equal(movement.treasuryAccountId, resolvedAccount.id);
    assert.equal(movement.status, 'POSTED');
    await assert.rejects(
      () => markDepositRefunded({ userId: actorId, role: Role.ACCOUNTANT }, created.id),
      (err: unknown) => err instanceof ApiError && (err as ApiError).statusCode === 409,
    );
    const book = await listFundBook('COMPANY');
    const bookRow = book.accounts.find((account2) => account2.accountId === resolvedAccount.id);
    assert.ok(bookRow, 'COMPANY book includes the account');
    assert.ok(bookRow.movements.some((m) => m.id === movement.id), 'movement visible in the fund book');
  });

  test('recordDepositFromIntake: auto-row, optional amount, idempotent per shipment', async () => {
    await mkActor();
    const [customer] = await db.insert(s.customers).values({ name: `card19 cust ${suffix}` }).returning();
    track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
    const [route] = await db.insert(s.routes).values({ name: `card19 route ${suffix}` }).returning();
    track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
    }).returning();
    track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
    await recordDepositFromIntake({
      shipmentId: shipment.id, customerName: customer.name, carrierName: 'YML',
      billNumber: 'YML123', expectedAmount: 4000000,
    });
    await recordDepositFromIntake({
      shipmentId: shipment.id, customerName: customer.name, carrierName: 'YML',
      billNumber: 'YML123', expectedAmount: 4000000,
    });
    const rows = await db.select().from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.shipmentId, shipment.id));
    assert.equal(rows.length, 1, 'one tracker row per shipment');
    assert.equal(rows[0]!.depositAmount, '4000000');
    await recordDepositFromIntake({
      shipmentId: shipment.id + 1000000, customerName: 'x', carrierName: 'y', billNumber: 'z',
    });
    const none = await db.select().from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.shipmentId, shipment.id + 1000000));
    assert.equal(none.length, 1);
    assert.equal(none[0]!.depositAmount, '0');
    track(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.shipmentId, shipment.id + 1000000)); });
  });
});

describe('card 20260923_14 — VN-calendar CV-overdue predicate', () => {
  const overdueBase = { status: 'CHUA_HOAN_CUOC', cvSubmittedDate: null };

  test('quiet through VN day 7, flags on VN day 8 — the old UTC-rolling window flags day 7', () => {
    // 2026-09-17T20:00:00Z = 2026-09-18 03:00 VN. On VN day 09-25 (08:30 VN =
    // 01:30Z): calendar day-diff 7 → quiet. The previous rolling-window math
    // (createdAt + 7*24h < now) already flagged this instant.
    const row = { ...overdueBase, createdAt: new Date('2026-09-17T20:00:00Z') };
    assert.equal(isCvOverdue(row, new Date('2026-09-25T01:30:00Z')), false, 'VN day-diff 7 stays quiet');
    assert.equal(isCvOverdue(row, new Date('2026-09-26T01:30:00Z')), true, 'VN day-diff 8 flags');
    assert.equal(CV_OVERDUE_DAYS, 7);
  });

  test('the +07 day shift decides at the VN midnight boundary (staging containers run UTC)', () => {
    // 16:59:59Z on 09-17 is still VN day 09-17; 17:00:00Z is already VN 09-18.
    const lateSep17 = { ...overdueBase, createdAt: new Date('2026-09-17T16:59:59Z') };
    const sep18 = { ...overdueBase, createdAt: new Date('2026-09-17T17:00:00Z') };
    assert.equal(vnCalendarDate(new Date('2026-09-17T16:59:59Z')), '2026-09-17');
    assert.equal(vnCalendarDate(new Date('2026-09-17T17:00:00Z')), '2026-09-18');
    // On VN day 09-25: day-diff 8 vs 7.
    assert.equal(isCvOverdue(lateSep17, new Date('2026-09-25T01:30:00Z')), true, 'row from VN 09-17 flags on VN 09-25');
    assert.equal(isCvOverdue(sep18, new Date('2026-09-25T01:30:00Z')), false, 'row from VN 09-18 stays quiet on VN 09-25');
  });

  test('CV date set or refunded rows never flag', () => {
    const created = new Date('2026-09-01T00:00:00Z');
    assert.equal(
      isCvOverdue({ status: 'CHUA_HOAN_CUOC', cvSubmittedDate: '2026-09-20', createdAt: created }, new Date('2026-10-05T00:00:00Z')),
      false,
    );
    assert.equal(
      isCvOverdue({ status: 'DA_HOAN_CUOC', cvSubmittedDate: null, createdAt: created }, new Date('2026-10-05T00:00:00Z')),
      false,
    );
  });

  test('list warnings count by the current filter, VN-calendar based (endpoint rung)', async () => {
    await mkActor();
    // 9 rolling days back spans VN calendar day-diff 8–10 — overdue under the
    // pinned contract under any current time of day.
    await mkTracker({ billNumber: 'OLD2', createdAt: new Date(Date.now() - 9 * 86400000) });
    const actor = { userId: actorId, role: Role.ACCOUNTANT };
    const all = await listDepositTrackers(actor, {});
    assert.ok(all.warnings.cvOverdueCount >= 1, 'OLD2 counts when unfiltered');
    const refundedOnly = await listDepositTrackers(actor, { status: 'DA_HOAN_CUOC' });
    assert.equal(refundedOnly.warnings.cvOverdueCount, 0, 'counts follow the current filter');
  });
});
