import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { getTrips } from '../services/trip-queries.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];

function tripIdentity(item: unknown): { id: number | null; tripCode: string | null } {
  const record = item as Record<string, unknown>;
  return {
    id: typeof record.id === 'number' ? record.id : null,
    tripCode: typeof record.tripCode === 'string' ? record.tripCode : null,
  };
}

async function mkCustomer() {
  const [row] = await db.insert(s.customers).values({
    name: `Q20 customer ${suffix}-${createdCustomerIds.length}`,
  }).returning({ id: s.customers.id });
  createdCustomerIds.push(row.id);
  return row;
}

async function mkRoute() {
  const [row] = await db.insert(s.routes).values({
    name: `Q20 route ${suffix}-${createdRouteIds.length}`,
  }).returning({ id: s.routes.id });
  createdRouteIds.push(row.id);
  return row;
}

async function mkCargoType() {
  const [row] = await db.insert(s.cargoTypes).values({
    name: `Q20 cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning({ id: s.cargoTypes.id });
  createdCargoTypeIds.push(row.id);
  return row;
}

async function mkTrip(input: {
  departureDate: string;
  completedAt: Date | null;
  status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED';
}) {
  const customer = await mkCustomer();
  const route = await mkRoute();
  const cargoType = await mkCargoType();
  const row = await insertTripComposite(db, {
    tripCode: `Q20-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: input.status ?? 'COMPLETED',
    departureDate: input.departureDate,
    completedAt: input.completedAt,
    carrierType: 'OWN',
    revenue: '1000000',
    grossProfit: '250000',
  });
  createdTripIds.push(row.id);
  return row;
}

describe('Q20 start-date operational trip queries', () => {
  test('date filters stay anchored to departureDate even when completion crosses into the next month', async () => {
    const julyTrip = await mkTrip({
      departureDate: '2026-07-31',
      completedAt: new Date('2026-08-02T08:00:00.000Z'),
    });
    await mkTrip({
      departureDate: '2026-08-01',
      completedAt: new Date('2026-08-01T11:00:00.000Z'),
    });

    const julyList = await getTrips({
      page: 1,
      limit: 20,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    assert.ok(
      julyList.items.some((trip) => {
        const identity = tripIdentity(trip);
        return identity.id === julyTrip.id && identity.tripCode === julyTrip.tripCode;
      }),
      'dispatch/search range must keep the trip in July because the start date is July 31',
    );
  });

  test('trip-code search still resolves the trip even when the topbar date chip is outside the departure month', async () => {
    const julyTrip = await mkTrip({
      departureDate: '2026-07-15',
      completedAt: new Date('2026-08-01T03:00:00.000Z'),
    });
    assert.ok(julyTrip.tripCode);

    const result = await getTrips({
      page: 1,
      limit: 20,
      search: julyTrip.tripCode,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    });
    assert.equal(result.items.length, 1);
    assert.equal(tripIdentity(result.items[0]).id, julyTrip.id);
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
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
