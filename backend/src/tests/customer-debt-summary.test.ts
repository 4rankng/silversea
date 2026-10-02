// Card 20260928_177 — the customers-screen debt projection carries own-vs-
// external per shipment/trip and recomputes the freight figures SERVER-SIDE
// under the "Bỏ xe công ty" filter. These cases pin the arithmetic the CSV
// export shows: ON = OFF minus exactly the own-vehicle portion, OFF restores
// the original number, and a customer with no own-vehicle shipment is unchanged
// by both states.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import {
  buildCustomerDebtSummary,
  getCustomerDebtSummary,
  type CustomerFreightFact,
} from '../services/customer-debt-summary.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Rows the fixtures create, so the suite leaves the dev DB exactly as it found
// it. Deleted child-first in `after`.
const created = {
  customers: [] as number[],
  trucks: [] as number[],
  shipments: [] as number[],
  routes: [] as number[],
  trips: [] as number[],
  carrierInfo: [] as number[],
  snapshots: [] as number[],
};

function fact(overrides: Partial<CustomerFreightFact> & { customerId: number }): CustomerFreightFact {
  return {
    shipmentId: 1,
    tripId: 1,
    shipmentCode: 'S1',
    carrierKey: 'CUST:9',
    ownership: 'EXTERNAL',
    freightRevenue: 0,
    freightPayable: 0,
    ...overrides,
  };
}

const CUSTOMERS = [
  { id: 1, name: 'Khách A', shortName: 'A' },
  { id: 2, name: 'Khách B', shortName: 'B' },
];

describe('card 20260928_177 — own-vehicle ("Bỏ xe công ty") projection', () => {
  test('ticking ON reduces the total by exactly the own-vehicle portion, OFF restores it', () => {
    const lines = [
      fact({ customerId: 1, shipmentId: 11, tripId: 101, carrierKey: 'OWN', ownership: 'OWN', freightRevenue: 2_000_000, freightPayable: 0 }),
      fact({ customerId: 1, shipmentId: 12, tripId: 102, carrierKey: 'CUST:9', ownership: 'EXTERNAL', freightRevenue: 3_000_000, freightPayable: 1_200_000 }),
      fact({ customerId: 2, shipmentId: 13, tripId: 103, carrierKey: 'PLATE:AB-12-X9', ownership: 'EXTERNAL', freightRevenue: 5_000_000, freightPayable: 2_500_000 }),
    ];

    const off = buildCustomerDebtSummary({ lines, customers: CUSTOMERS, excludeOwnFleet: false });
    const on = buildCustomerDebtSummary({ lines, customers: CUSTOMERS, excludeOwnFleet: true });

    assert.equal(off.totals.freightRevenue, 10_000_000);
    assert.equal(off.totals.tripCount, 3);
    assert.equal(off.totals.ownFleetFreightRevenue, 2_000_000);
    assert.equal(off.totals.ownFleetTripCount, 1);

    // ON = OFF − own portion, exactly, for every figure the screen shows.
    assert.equal(on.totals.freightRevenue, off.totals.freightRevenue - off.totals.ownFleetFreightRevenue);
    assert.equal(on.totals.freightPayable, off.totals.freightPayable - off.totals.ownFleetFreightPayable);
    assert.equal(on.totals.tripCount, off.totals.tripCount - off.totals.ownFleetTripCount);
    assert.equal(on.totals.freightRevenue, 8_000_000);
    assert.equal(on.totals.freightPayable, 3_700_000);

    // The own-vehicle portion stays reported under the filter, so the tick's
    // effect is auditable instead of silently lost.
    assert.equal(on.totals.ownFleetFreightRevenue, 2_000_000);
  });

  test('a customer with no own-vehicle shipment is unchanged by both states', () => {
    const lines = [
      fact({ customerId: 1, shipmentId: 11, tripId: 101, ownership: 'OWN', freightRevenue: 2_000_000 }),
      fact({ customerId: 2, shipmentId: 13, tripId: 103, carrierKey: 'CUST:9', freightRevenue: 5_000_000, freightPayable: 2_500_000 }),
    ];

    const off = buildCustomerDebtSummary({ lines, customers: CUSTOMERS, excludeOwnFleet: false });
    const on = buildCustomerDebtSummary({ lines, customers: CUSTOMERS, excludeOwnFleet: true });

    assert.deepEqual(
      on.items.find((row) => row.customerId === 2),
      off.items.find((row) => row.customerId === 2),
    );
  });

  test('every line carries its own-vs-external identity, filtered or not', () => {
    const lines = [
      fact({ customerId: 1, shipmentId: 11, tripId: 101, ownership: 'OWN', carrierKey: 'OWN' }),
      fact({ customerId: 1, shipmentId: 12, tripId: 102, ownership: 'EXTERNAL', carrierKey: 'CUST:9' }),
    ];

    const on = buildCustomerDebtSummary({ lines, customers: CUSTOMERS, excludeOwnFleet: true });
    assert.deepEqual(
      on.items[0]!.lines.map((line) => [line.tripId, line.ownership, line.carrierKey]),
      [[101, 'OWN', 'OWN'], [102, 'EXTERNAL', 'CUST:9']],
    );
    assert.equal(on.items[0]!.tripCount, 1, 'figures honor the filter');
    assert.equal(on.items[0]!.ownFleetTripCount, 1, 'the own portion is still reported');
    // The ownership column is the authority, so the carrier key never
    // contradicts it: 'OWN' iff the trip ran on a company vehicle.
    for (const line of on.items[0]!.lines) {
      assert.equal(line.carrierKey === 'OWN', line.ownership === 'OWN');
    }
  });
});

// ─── DB-backed: the SQL derivation behind the facts ─────────────────────────

async function mkCustomer(name: string) {
  const [row] = await db.insert(s.customers).values({ name }).returning();
  created.customers.push(row.id);
  return row;
}
async function mkTruck(licensePlate: string, carrierId: number | null) {
  const [row] = await db.insert(s.trucks).values({ licensePlate, carrierId }).returning();
  created.trucks.push(row.id);
  return row;
}
async function mkLot(customerId: number, edd: string) {
  const [row] = await db.insert(s.shipments).values({
    customerId, expectedDeliveryDate: edd, cargoMode: 'FCL', status: 'COMPLETED',
  }).returning();
  created.shipments.push(row.id);
  return row;
}
async function mkRoute(name: string) {
  const [row] = await db.insert(s.routes).values({ name }).returning();
  created.routes.push(row.id);
  return row;
}
async function mkTrip(shipmentId: number, customerId: number, routeId: number, truckId: number | null) {
  const [row] = await db.insert(s.trips).values({
    shipmentId, customerId, routeId, truckId, status: 'COMPLETED', departureDate: '2026-09-20',
  }).returning();
  created.trips.push(row.id);
  return row;
}
async function mkCarrierInfo(tripId: number, values: Partial<typeof s.tripCarrierInfo.$inferInsert>) {
  const [row] = await db.insert(s.tripCarrierInfo).values({ tripId, carrierType: 'OWN', ...values }).returning();
  created.carrierInfo.push(row.id);
  return row;
}
async function mkSnapshot(shipmentId: number, tripId: number | null, freight: string) {
  const [row] = await db.insert(s.freightRateSnapshots).values({
    shipmentId, tripId,
    freightAmount: freight, surchargeAmount: '0', totalAmount: freight,
    rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
    billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
  }).returning();
  created.snapshots.push(row.id);
  return row;
}

describe('card 20260928_177 — projection reads the real ownership column', () => {
  test('OWN comes from trip_carrier_info.carrier_type + the own-fleet truck; external from the carrier + cost', async () => {
    const khachA = await mkCustomer(`Debt own ${suffix}`);
    const khachB = await mkCustomer(`Debt ext ${suffix}`);
    const carrier = await mkCustomer(`Nha xe ${suffix}`);
    const route = await mkRoute(`Tuyen ${suffix}`);
    const ownTruck = await mkTruck(`OWN${suffix}`.slice(0, 20), null);
    const subTruck = await mkTruck(`SUB${suffix}`.slice(0, 20), carrier.id);

    // Customer A: one leg on the company's own vehicle, one subcontracted.
    const lotOwn = await mkLot(khachA.id, '2026-09-20');
    const tripOwn = await mkTrip(lotOwn.id, khachA.id, route.id, ownTruck.id);
    await mkCarrierInfo(tripOwn.id, { carrierType: 'OWN' });
    await mkSnapshot(lotOwn.id, tripOwn.id, '2000000');

    const lotExternal = await mkLot(khachA.id, '2026-09-21');
    const tripExternal = await mkTrip(lotExternal.id, khachA.id, route.id, subTruck.id);
    await mkCarrierInfo(tripExternal.id, {
      carrierType: 'EXTERNAL',
      externalEntityType: 'CUSTOMER',
      externalEntityId: carrier.id,
      externalPlateNumber: 'AB-12-X9',
      externalFreightCost: '1200000',
    });
    await mkSnapshot(lotExternal.id, tripExternal.id, '3000000');

    // Customer B never ran on a company vehicle, and its freeze is shipment-level.
    const lotB = await mkLot(khachB.id, '2026-09-22');
    const tripB = await mkTrip(lotB.id, khachB.id, route.id, subTruck.id);
    await mkCarrierInfo(tripB.id, {
      carrierType: 'EXTERNAL',
      externalEntityType: 'CUSTOMER',
      externalEntityId: carrier.id,
      externalFreightCost: '2500000',
    });
    await mkSnapshot(lotB.id, null, '5000000');

    const ids = [khachA.id, khachB.id];
    const off = await getCustomerDebtSummary({ customerIds: ids, excludeOwnFleet: false });
    const on = await getCustomerDebtSummary({ customerIds: ids, excludeOwnFleet: true });
    const offA = off.items.find((row) => row.customerId === khachA.id)!;
    const onA = on.items.find((row) => row.customerId === khachA.id)!;
    const offB = off.items.find((row) => row.customerId === khachB.id)!;
    const onB = on.items.find((row) => row.customerId === khachB.id)!;

    // Per-trip identity is carried, unfiltered: the own-fleet leg reads 'OWN',
    // the subcontracted leg reads as the carrier-customer key.
    assert.deepEqual(offA.lines.map((line) => line.carrierKey).sort(), [`CUST:${carrier.id}`, 'OWN']);
    assert.equal(offA.lines.find((line) => line.ownership === 'OWN')!.freightRevenue, 2_000_000);
    assert.equal(offA.lines.find((line) => line.ownership === 'EXTERNAL')!.freightRevenue, 3_000_000);

    // AC: ON = OFF − exactly the own-vehicle portion.
    assert.equal(off.totals.freightRevenue, 10_000_000);
    assert.equal(off.totals.ownFleetFreightRevenue, 2_000_000);
    assert.equal(off.totals.freightPayable, 3_700_000);
    assert.equal(on.totals.freightRevenue, 8_000_000);
    assert.equal(on.totals.freightRevenue, off.totals.freightRevenue - off.totals.ownFleetFreightRevenue);
    assert.equal(on.totals.tripCount, off.totals.tripCount - off.totals.ownFleetTripCount);
    // Cước trả is the external carrier cost either way — the own leg has none.
    assert.equal(on.totals.freightPayable, off.totals.freightPayable);
    assert.equal(offA.freightRevenue, 5_000_000);
    assert.equal(onA.freightRevenue, 3_000_000);
    assert.equal(onA.tripCount, 1);

    // A customer with no own-vehicle shipment is unchanged by both states, and
    // its shipment-level freeze lands once on its first (only) active trip.
    assert.deepEqual(onB, offB);
    assert.equal(offB.freightRevenue, 5_000_000);
    assert.equal(offB.lines.length, 1);
    assert.equal(on.totals.ownFleetTripCount, 1);
  });
});

after(async () => {
  if (created.snapshots.length) await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.id, created.snapshots));
  if (created.carrierInfo.length) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.id, created.carrierInfo));
  if (created.trips.length) await db.delete(s.trips).where(inArray(s.trips.id, created.trips));
  if (created.shipments.length) await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipments));
  if (created.trucks.length) await db.delete(s.trucks).where(inArray(s.trucks.id, created.trucks));
  if (created.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routes));
  if (created.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customers));
  await client.end();
});
