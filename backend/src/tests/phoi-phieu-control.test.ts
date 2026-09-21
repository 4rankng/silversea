import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TxnType } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { listPhoiPhieuRows, createPhoiPhieuVoucher } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}
let accountantId = 0;

async function mkBoardFixture(opts: { charge?: number } = {}) {
  const [user] = await db.insert(s.users).values({
    username: `c12-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  if (accountantId === 0) accountantId = user.id;
  const [customer] = await db.insert(s.customers).values({ name: `C12 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C12 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `CSQU30543${cleanup.length % 10}`.slice(0, 11),
  }).returning({ id: s.shipmentContainers.id, containerNumber: s.shipmentContainers.containerNumber });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-C12-${cleanup.length}-${suffix}`, departureDate: '2026-09-22', status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id, tripCode: s.trips.tripCode });
  track(s.trips, trip.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
    amount: '250000', customerChargeAmount: String(opts.charge ?? 100000),
    paidById: user.id, paidAt: '2026-09-22',
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
    confirmedAt: new Date(), version: 1,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return { trip, shipment, entry, source, container };
}

describe('card 20260921_12 — phoi phieu control board', () => {
  test('rows carry chi-ho sums, road money, and open sources', async () => {
    await mkBoardFixture();
    const rows = await listPhoiPhieuRows({ search: suffix });
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.chiHoTra, 250000, 'Phai tra = the entry amount to the dong');
    assert.equal(row.chiHoThu, 100000, 'Phai thu = the customer charge to the dong');
    assert.equal(row.openSources.length, 1);
    assert.equal(row.openSources[0]!.remaining, 250000);
    assert.equal(row.confirmable, true);
  });

  test('consolidated voucher posts one IN movement against the STK', async () => {
    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    const fixtureA = await mkBoardFixture({ charge: 100000 });
    const fixtureB = await mkBoardFixture({ charge: 100000 });
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK-${suffix}`, name: 'STK quỹ', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);

    const result = await createPhoiPhieuVoucher({
      tripIds: [fixtureA.trip.id, fixtureB.trip.id], direction: 'IN',
      treasuryAccountId: account.id, actor,
    });
    assert.equal(result.entries, 2, 'one phiếu per customer (engine is one-counterparty)');
    assert.equal(result.total, 200000, 'two trips x 100000 thu khách — totals to the dong');

    const movements = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.treasuryAccountId, account.id));
    assert.equal(movements.length, 2, 'one movement per phiếu — each POSTED against the STK');
    assert.ok(movements.every((movement) => movement.direction === 'IN'));
    assert.ok(movements.every((movement) => movement.status === 'POSTED'));
    void TxnType;
  });

  test('chi direction without a hoan-ung reconciliation is refused (existing gate)', async () => {
    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    const fixture = await mkBoardFixture();
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK2-${suffix}`, name: 'STK quỹ 2', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);
    await assert.rejects(
      () => createPhoiPhieuVoucher({
        tripIds: [fixture.trip.id], direction: 'OUT',
        treasuryAccountId: account.id, actor,
      }),
      /hoàn ứng/,
    );
  });

  after(async () => {
    try {
      for (const { table, id } of cleanup) {
        await db.delete(table).where(eq(table.id, id));
      }
    } catch {
      // tolerance
    }
    await disconnectRedis();
  });
});
