import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { getTrips } from '../services/trip-queries.service';

// Server-side sort coverage for GET /api/trips (TRIP_LIST_SORT_SQL). All rows
// are scoped to one unique customer so shared-database neighbours can never
// leak into the assertions.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];

async function mkCustomer() {
  const [row] = await db.insert(s.customers).values({
    name: `Sort customer ${suffix}-${createdCustomerIds.length}`,
  }).returning({ id: s.customers.id });
  createdCustomerIds.push(row.id);
  return row;
}

async function mkRoute(name: string) {
  const [row] = await db.insert(s.routes).values({ name }).returning({ id: s.routes.id });
  createdRouteIds.push(row.id);
  return row;
}

async function mkCargoType() {
  const [row] = await db.insert(s.cargoTypes).values({
    name: `Sort cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning({ id: s.cargoTypes.id });
  createdCargoTypeIds.push(row.id);
  return row;
}

async function mkTrip(input: {
  customerId: number;
  departureDate: string;
  revenue?: string | null;
  routeName?: string;
}) {
  const route = await mkRoute(input.routeName ?? `Sort route ${suffix}-${createdRouteIds.length}`);
  const cargoType = await mkCargoType();
  const row = await insertTripComposite(db, {
    tripCode: `SORT-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: input.customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'COMPLETED',
    departureDate: input.departureDate,
    completedAt: null,
    carrierType: 'OWN',
    revenue: input.revenue ?? null,
    grossProfit: '250000',
  });
  createdTripIds.push(row.id);
  return row.id;
}

function listedIds(result: Awaited<ReturnType<typeof getTrips>>): number[] {
  return result.items.map((item) => (item as unknown as { id: number }).id);
}

describe('trips list server-side sort', () => {
  test('absent sort params keep the default departureDate-desc, id-desc order', async () => {
    const customer = await mkCustomer();
    const oldest = await mkTrip({ customerId: customer.id, departureDate: '2026-08-01', revenue: '100' });
    const newest = await mkTrip({ customerId: customer.id, departureDate: '2026-08-03', revenue: '300' });
    const middle = await mkTrip({ customerId: customer.id, departureDate: '2026-08-02', revenue: '200' });

    const result = await getTrips({ page: 1, limit: 20, customerId: customer.id });
    assert.deepEqual(listedIds(result).slice(0, 3), [newest, middle, oldest]);
  });

  test('revenue sorts asc and desc with NULLs last in both directions', async () => {
    const customer = await mkCustomer();
    const low = await mkTrip({ customerId: customer.id, departureDate: '2026-08-10', revenue: '100' });
    const mid = await mkTrip({ customerId: customer.id, departureDate: '2026-08-11', revenue: '200' });
    const high = await mkTrip({ customerId: customer.id, departureDate: '2026-08-12', revenue: '300' });
    const unpriced = await mkTrip({ customerId: customer.id, departureDate: '2026-08-13', revenue: null });

    const asc = await getTrips({ page: 1, limit: 20, customerId: customer.id, sortBy: 'revenue', sortDir: 'asc' });
    assert.deepEqual(listedIds(asc).slice(0, 4), [low, mid, high, unpriced]);

    const desc = await getTrips({ page: 1, limit: 20, customerId: customer.id, sortBy: 'revenue', sortDir: 'desc' });
    assert.deepEqual(listedIds(desc).slice(0, 4), [high, mid, low, unpriced]);
  });

  test('route sorts by the joined operational name', async () => {
    const customer = await mkCustomer();
    const haiPhong = await mkTrip({ customerId: customer.id, departureDate: '2026-08-20', revenue: '100', routeName: 'AA Sort HP' });
    const haNoi = await mkTrip({ customerId: customer.id, departureDate: '2026-08-21', revenue: '100', routeName: 'BB Sort HN' });

    const asc = await getTrips({ page: 1, limit: 20, customerId: customer.id, sortBy: 'route', sortDir: 'asc' });
    assert.deepEqual(listedIds(asc).slice(0, 2), [haiPhong, haNoi]);

    const desc = await getTrips({ page: 1, limit: 20, customerId: customer.id, sortBy: 'route', sortDir: 'desc' });
    assert.deepEqual(listedIds(desc).slice(0, 2), [haNoi, haiPhong]);
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } finally {
    await client.end();
  }
});
