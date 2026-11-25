// SIL-1015 (CR-011 Task 3.2) — the payables report's Xe nhà / Vendor split key
// is a WIRE FACT, never the party display string. `getPhoiPhieuReport` marks
// every TRA row with `isOwnFleet`: true only for the own-fleet bucket
// ('XE NHÀ — SILVER SEA' — the trip runs on a plated company truck), false for
// external carrier/vendor rows and for the 'Thiếu nhà xe' missing-datum label.
// The FE renders the two tables (each with its own TỔNG CỘNG) off this field.
//
// Real dev DB, tracked cleanup, isolated date window (the house convention of
// phoi-phieu-unattached-trips-window.test.ts).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { getPhoiPhieuReport } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// An isolated window: no other suite writes 2026-08-27 departures.
const DAY = '2026-08-27';
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

async function mkLot(label: string): Promise<{ shipmentId: number; customerId: number; routeId: number }> {
  const [customer] = await db.insert(s.customers).values({
    name: `S15 ${label} ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [route] = await db.insert(s.routes).values({ name: `S15 route ${suffix}` }).returning({ id: s.routes.id });
  track(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY, blNumber: `S15BL${label}${cleanup.length}${suffix.slice(0, 4).toUpperCase()}`,
    tradeDirection: 'IMPORT',
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  return { shipmentId: shipment.id, customerId: customer.id, routeId: route.id };
}

async function mkTrip(lot: { shipmentId: number; customerId: number; routeId: number }, label: string): Promise<{ tripId: number }> {
  const [trip] = await db.insert(s.trips).values({
    shipmentId: lot.shipmentId, customerId: lot.customerId, routeId: lot.routeId,
    tripCode: `TRP-S15-${label}-${cleanup.length}-${suffix}`,
    departureDate: DAY, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  return { tripId: trip.id };
}

/** One OPS money source on the trip (the report's only money spine). */
async function mkOpsMoney(shipmentId: number, tripId: number, label: string): Promise<void> {
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId, expenseTypeCode: 'S15-FEE', feeName: `Phí ${label}`,
    amount: '100000', paidAt: DAY,
  }).returning({ id: s.opsExpenseEntries.id });
  track(() => db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, entry.id)));
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId, tripId, status: 'RECORDED',
  }).returning({ id: s.expenseAccountingSources.id });
  track(() => db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)));
}

describe('SIL-1015 — báo cáo TRA phân loại xe nhà / vendor bằng trường wire isOwnFleet', () => {
  test('the plated own-fleet trip reports isOwnFleet; external carrier and missing carrier do not', async () => {
    // (1) Xe nhà: a plated company truck, no external carrier fact.
    const ownLot = await mkLot('OWN');
    const ownTrip = await mkTrip(ownLot, 'OWN');
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `S15-${cleanup.length}-${suffix.slice(0, 6)}`.slice(0, 20),
    }).returning({ id: s.trucks.id });
    track(() => db.delete(s.trucks).where(eq(s.trucks.id, truck.id)));
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, ownTrip.tripId));
    await mkOpsMoney(ownLot.shipmentId, ownTrip.tripId, 'xe nhà');

    // (2) Vendor: an EXTERNAL carrier master (customers branch).
    const carrierName = `S15 nhà xe ${suffix}-${cleanup.length}`;
    const [carrier] = await db.insert(s.customers).values({
      name: carrierName, isCarrier: true,
    }).returning({ id: s.customers.id });
    track(() => db.delete(s.customers).where(eq(s.customers.id, carrier.id)));
    const extLot = await mkLot('EXT');
    const extTrip = await mkTrip(extLot, 'EXT');
    const [carrierInfo] = await db.insert(s.tripCarrierInfo).values({
      tripId: extTrip.tripId, carrierType: 'EXTERNAL',
      externalEntityId: carrier.id, externalEntityType: 'CUSTOMER',
    }).returning({ id: s.tripCarrierInfo.id });
    track(() => db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.id, carrierInfo.id)));
    await mkOpsMoney(extLot.shipmentId, extTrip.tripId, 'vendor');

    // (3) 'Thiếu nhà xe': no truck, no carrier fact.
    const missLot = await mkLot('MISS');
    const missTrip = await mkTrip(missLot, 'MISS');
    await mkOpsMoney(missLot.shipmentId, missTrip.tripId, 'thiếu nhà xe');

    const { rows, grand } = await getPhoiPhieuReport({ kind: 'TRA', dateFrom: DAY, dateTo: DAY });

    const ownRow = rows.find((row) => row.party === 'XE NHÀ — SILVER SEA');
    assert.ok(ownRow, 'the own-fleet bucket must be on the report');
    assert.equal(ownRow.isOwnFleet, true, 'the plated company truck is the xe-nhà fact');

    const extRow = rows.find((row) => row.party === carrierName);
    assert.ok(extRow, 'the external carrier bucket must be on the report');
    assert.equal(extRow.isOwnFleet, false, 'an EXTERNAL carrier is never own fleet');

    const missRow = rows.find((row) => row.party === 'Thiếu nhà xe');
    assert.ok(missRow, 'the missing-datum label must be on the report');
    assert.equal(missRow.isOwnFleet, false, 'missing data names what is missing — never xe nhà');

    assert.equal(grand.isOwnFleet, false, 'TỔNG CỘNG is never an own-fleet row');
  });
});

after(async () => {
  for (const run of cleanup) {
    await run();
  }
  await disconnectRedis();
});
