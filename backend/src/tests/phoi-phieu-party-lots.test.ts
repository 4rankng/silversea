// Card 191026160000 — the BÁO CÁO THU / TRẢ PHƠI drill-down: one clicked
// party's not-yet-paid lots, with the same nâng / hạ / PS-khác split the
// summary prints and per-source remainders the batch phiếu consumes.
// Fixture shape mirrors phoi-phieu-control.test.ts (real dev DB, tracked
// cleanup, an isolated date window so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { getPhoiPhieuPartyLots, getPhoiPhieuReport } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// An isolated window: no other suite writes 2026-08-19 departures.
const DAY = '2026-08-19';
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}

async function mkLotFixture(opts: {
  /** Reuse an existing customer (party names are UNIQUE among active rows). */
  customerId?: number;
  customerName?: string;
  /** The TRA party: internal fleet or an external supplier carrier. */
  carrier?: { kind: 'INTERNAL' } | { kind: 'EXTERNAL_SUPPLIER'; name: string };
  /** [amount, customerCharge, category] per OPS source on the lot's trip. */
  fees?: Array<{ amount: number; charge: number; category: 'LIFT' | 'DROP' | null }>;
  cashIn?: number;
  cashOut?: number;
}) {
  const [user] = await db.insert(s.users).values({
    username: `p19-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  let customerId = opts.customerId;
  if (customerId == null) {
    const [customer] = await db.insert(s.customers).values({
      name: opts.customerName ?? `P19 customer ${suffix}-${cleanup.length}`,
    }).returning({ id: s.customers.id });
    track(s.customers, customer.id);
    customerId = customer.id;
  }
  const [route] = await db.insert(s.routes).values({ name: 'P19 route' }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: DAY,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `P19U30543${cleanup.length % 10}`.slice(0, 11),
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId, routeId: route.id,
    tripCode: `TRP-P19-${cleanup.length}-${suffix}`, departureDate: DAY, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  if (opts.carrier?.kind === 'INTERNAL') {
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `P19-${cleanup.length}-${suffix.slice(0, 4)}`, status: 'ACTIVE',
    }).returning({ id: s.trucks.id });
    track(s.trucks, truck.id);
    await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, carrierType: 'OWN' });
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, trip.id));
  } else if (opts.carrier?.kind === 'EXTERNAL_SUPPLIER') {
    const [supplier] = await db.insert(s.suppliers).values({
      name: opts.carrier.name, status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    track(s.suppliers, supplier.id);
    await db.insert(s.tripCarrierInfo).values({
      tripId: trip.id, carrierType: 'EXTERNAL', externalEntityId: supplier.id, externalEntityType: 'SUPPLIER',
    });
  }
  const entries: Array<{ sourceId: number; nativeId: number }> = [];
  for (const fee of opts.fees ?? []) {
    const code = fee.category ? `P19_${fee.category}_${suffix}_${cleanup.length}` : `P19_OTHER_${suffix}_${cleanup.length}`;
    const [type] = await db.insert(s.forwarderExpenseTypes).values({
      code, name: `P19 loại phí ${cleanup.length}`, status: 'ACTIVE', category: fee.category, requiresInvoice: false,
    }).returning({ id: s.forwarderExpenseTypes.id });
    track(s.forwarderExpenseTypes, type.id);
    const [entry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: code,
      amount: String(fee.amount), customerChargeAmount: String(fee.charge),
      costGroup: 'OPS_REGULAR', payerKind: 'USER', paidById: user.id, paidAt: DAY,
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, entry.id);
    const [source] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
      confirmedAt: new Date(), version: 3,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, source.id);
    entries.push({ sourceId: source.id, nativeId: entry.id });
  }
  // Recorded cash rides the REAL chain the engine posts: treasury movement →
  // expense_cash_vouchers (RECORDED) → expense_cash_allocations per source.
  if ((opts.cashIn ?? 0) > 0 || (opts.cashOut ?? 0) > 0) {
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `P19-STK-${suffix}-${cleanup.length}`, name: 'STK quỹ', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: user.id, updatedBy: user.id,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);
    for (const [direction, amount] of [['IN', opts.cashIn ?? 0], ['OUT', opts.cashOut ?? 0]] as const) {
      if (amount <= 0) continue;
      const [movement] = await db.insert(s.treasuryMovements).values({
        treasuryAccountId: account.id, direction, amount: String(amount), valueDate: DAY,
        sourceVersion: 1, paymentContractVersion: 1,
        physicalReference: `P19-MOV-${suffix}-${cleanup.length}-${direction}`, createdBy: user.id,
      }).returning({ id: s.treasuryMovements.id });
      track(s.treasuryMovements, movement.id);
      const [voucher] = await db.insert(s.expenseCashVouchers).values({
        code: `P19-VC-${suffix}-${cleanup.length}-${direction}`, counterpartyType: 'CUSTOMER',
        counterpartyId: customerId, treasuryMovementId: movement.id, status: 'RECORDED', createdById: user.id,
      }).returning({ id: s.expenseCashVouchers.id });
      track(s.expenseCashVouchers, voucher.id);
      for (const item of entries) {
        const [allocation] = await db.insert(s.expenseCashAllocations).values({
          voucherId: voucher.id, expenseAccountingSourceId: item.sourceId,
          sourceVersion: 1, amount: String(amount),
        }).returning({ id: s.expenseCashAllocations.id });
        track(s.expenseCashAllocations, allocation.id);
      }
    }
  }
  return { customer: { id: customerId }, shipment, trip, entries };
}

describe('card 191026160000 — phoi phieu report party drill-down', () => {
  test('returns the party lots with the nâng / hạ / PS khác split and open remainders', async () => {
    const lift = await mkLotFixture({
      customerName: `P19 KH nâng hạ ${suffix}`,
      fees: [
        { amount: 2_000_000, charge: 2_500_000, category: 'LIFT' },
        { amount: 1_500_000, charge: 1_800_000, category: 'DROP' },
        { amount: 300_000, charge: 300_000, category: null },
      ],
    });
    const report = await getPhoiPhieuReport({ kind: 'THU', dateFrom: DAY, dateTo: DAY });
    const party = report.rows.find((row) => row.party.startsWith('P19 KH nâng hạ'));
    assert.ok(party, 'the fixture party appears in the summary');
    const lots = await getPhoiPhieuPartyLots({
      kind: 'THU', party: party!.party, dateFrom: DAY, dateTo: DAY,
    });
    assert.equal(lots.items.length, 1);
    const lot = lots.items[0]!;
    assert.equal(lot.tripId, lift.trip.id);
    assert.equal(lot.tienNang, 2_000_000);
    assert.equal(lot.tienHa, 1_500_000);
    assert.equal(lot.psKhac, 300_000);
    assert.equal(lot.total, 3_800_000);
    assert.equal(lot.daThuTra, 0, 'no cash recorded yet');
    assert.equal(lot.conLai, 3_800_000);
    assert.equal(lot.entries.length, 3);
    assert.ok(lot.entries.every((entry) => entry.expectedVersion === 3));
    assert.ok(lot.entries.every((entry) => entry.amount > 0));
    // THU remainder rides the customer-charge side (the voucher engine's own rule).
    const nang = lot.entries.find((entry) => entry.bucket === 'nang')!;
    assert.equal(nang.amount, 2_500_000);
    assert.equal(nang.sourceId, lift.entries[0]!.nativeId, 'entries key on the OPS entry id space');
  });

  test('a lot with recorded cash reports only the unpaid remainder; a settled lot drops out', async () => {
    const first = await mkLotFixture({
      customerName: `P19 KH một phần ${suffix}`,
      fees: [{ amount: 1_000_000, charge: 800_000, category: 'LIFT' }],
      cashIn: 300_000,
    });
    await mkLotFixture({
      customerId: first.customer.id,
      fees: [{ amount: 500_000, charge: 400_000, category: null }],
      cashIn: 400_000,
    });
    const lots = await getPhoiPhieuPartyLots({
      kind: 'THU', party: `P19 KH một phần ${suffix}`, dateFrom: DAY, dateTo: DAY,
    });
    assert.equal(lots.items.length, 1, 'the fully-collected lot is not "chưa thanh toán"');
    const lot = lots.items[0]!;
    assert.equal(lot.daThuTra, 300_000);
    assert.equal(lot.total, 1_000_000);
    assert.equal(lot.conLai, 700_000);
    assert.equal(lot.entries[0]!.amount, 500_000, 'THU remainder = charge − recorded IN');
  });

  test('TRA rides the cost side and only the clicked party comes back', async () => {
    const theirs = await mkLotFixture({
      customerName: `P19 KH trả ${suffix}`,
      carrier: { kind: 'EXTERNAL_SUPPLIER', name: `P19 NCC trả ${suffix}` },
      fees: [{ amount: 900_000, charge: 0, category: 'DROP' }],
    });
    await mkLotFixture({
      customerName: `P19 KH khác ${suffix}`,
      carrier: { kind: 'EXTERNAL_SUPPLIER', name: `P19 NCC khác ${suffix}` },
      fees: [{ amount: 777_000, charge: 0, category: null }],
    });
    const lots = await getPhoiPhieuPartyLots({
      kind: 'TRA', party: `P19 NCC trả ${suffix}`, dateFrom: DAY, dateTo: DAY,
    });
    assert.equal(lots.items.length, 1);
    const lot = lots.items[0]!;
    assert.equal(lot.tripId, theirs.trip.id);
    assert.equal(lot.total, 900_000);
    assert.equal(lot.conLai, 900_000, 'TRA remainder = cost − recorded OUT');
    assert.equal(lot.entries[0]!.bucket, 'ha');
    assert.equal(lot.entries[0]!.amount, 900_000);
    assert.equal(lots.items.some((item) => item.total === 777_000), false, 'the other party never leaks in');
  });

  test('an unknown party name returns no rows instead of everything', async () => {
    await mkLotFixture({ fees: [{ amount: 100_000, charge: 100_000, category: null }] });
    const lots = await getPhoiPhieuPartyLots({
      kind: 'THU', party: `P19 không tồn tại ${suffix}`, dateFrom: DAY, dateTo: DAY,
    });
    assert.deepEqual(lots.items, []);
  });
});

after(async () => {
  for (const { table, id } of cleanup) {
    await db.delete(table).where(eq(table.id, id));
  }
  await disconnectRedis();
});
