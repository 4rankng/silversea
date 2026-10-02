import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { getTrips, getTripById, getTripsSummary } from '../services/trip-queries.service';

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
  status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';
  fuelLiters?: string | null;
  routeName?: string;
  tripCode?: string;
  customerReference?: string | null;
  carrierType?: 'OWN' | 'EXTERNAL';
  externalFreightCost?: string | null;
  vatRate?: string;
  customerCommission?: string;
  reconciledExtraCost?: string;
}) {
  const route = await mkRoute(input.routeName ?? `Sort route ${suffix}-${createdRouteIds.length}`);
  const cargoType = await mkCargoType();
  const row = await insertTripComposite(db, {
    tripCode: input.tripCode ?? `SORT-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerReference: input.customerReference ?? null,
    customerId: input.customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: input.status ?? 'COMPLETED',
    fuelLiters: input.fuelLiters,
    departureDate: input.departureDate,
    completedAt: null,
    carrierType: input.carrierType ?? 'OWN',
    externalFreightCost: input.externalFreightCost,
    vatRate: input.vatRate,
    customerCommission: input.customerCommission,
    reconciledExtraCost: input.reconciledExtraCost,
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
  test('missing-fuel summary matches OWN running/completed row applicability (QA-AUDIT-FIN-01)', async () => {
    const customer = await mkCustomer();
    const departureDate = '2097-04-21';
    const baseline = await getTripsSummary(departureDate, departureDate);
    const common = { customerId: customer.id, departureDate };
    await mkTrip({ ...common, status: 'IN_TRANSIT', fuelLiters: null });
    await mkTrip({ ...common, status: 'COMPLETED', fuelLiters: '0' });
    await mkTrip({ ...common, status: 'COMPLETED', fuelLiters: '5' });
    await mkTrip({ ...common, status: 'CREATED', fuelLiters: null });
    await mkTrip({ ...common, status: 'CANCELED', fuelLiters: null });
    await mkTrip({ ...common, carrierType: 'EXTERNAL', status: 'IN_TRANSIT', fuelLiters: null });
    await mkTrip({ ...common, carrierType: 'EXTERNAL', status: 'COMPLETED', fuelLiters: null });
    const summary = await getTripsSummary(departureDate, departureDate);
    assert.equal(summary.missingFuel - baseline.missingFuel, 2);
    assert.equal(summary.statusCounts.all - baseline.statusCounts.all, 7);
    assert.equal(summary.statusCounts.CREATED - baseline.statusCounts.CREATED, 1);
    assert.equal(summary.statusCounts.CANCELED - baseline.statusCounts.CANCELED, 1);
    assert.equal(summary.statusCounts.IN_TRANSIT - baseline.statusCounts.IN_TRANSIT, 2);
    assert.equal(summary.statusCounts.COMPLETED - baseline.statusCounts.COMPLETED, 3);
    assert.equal(summary.totalFuel - baseline.totalFuel, 5);
  });

  test('external profit sort preserves inclusive hire cost, commission, extras and blank hire (QA-AUDIT-FIN-01)', async () => {
    const customer = await mkCustomer();
    const common = { customerId: customer.id, departureDate: '2026-10-01', carrierType: 'EXTERNAL' as const, revenue: '10800000', vatRate: '0.08' };
    const commission = await mkTrip({ ...common, externalFreightCost: '5400000', customerCommission: '600000' });
    const noCommission = await mkTrip({ ...common, externalFreightCost: '5832000' });
    const extras = await mkTrip({ ...common, externalFreightCost: '5400000', reconciledExtraCost: '1000000' });
    const blankHire = await mkTrip({ ...common, externalFreightCost: null });
    await db.update(s.tripFinancialState).set({ reconciledExtraCost: null }).where(eq(s.tripFinancialState.tripId, blankHire));
    await db.update(s.tripFinancialState).set({ reconciledTollCost: '42000', tollDeduction: '55000' }).where(eq(s.tripFinancialState.tripId, extras));
    const asc = await getTrips({ customerId: customer.id, sortBy: 'grossProfit', sortDir: 'asc' });
    assert.deepEqual(listedIds(asc), [extras, commission, noCommission, blankHire]);
    const desc = await getTrips({ customerId: customer.id, sortBy: 'grossProfit', sortDir: 'desc' });
    assert.deepEqual(listedIds(desc), [blankHire, noCommission, commission, extras]);
    const listedExtra = asc.items.find(row => 'id' in row && row.id === extras);
    assert.ok(listedExtra);
    assert.equal('reconciledExtraCost' in listedExtra ? listedExtra.reconciledExtraCost : undefined, '1000000');
    const detail = await getTripById(extras);
    assert.equal('reconciledExtraCost' in detail ? detail.reconciledExtraCost : undefined, '1000000');
    assert.equal('tollDeduction' in detail ? detail.tollDeduction : undefined, '55000');
    assert.equal('reconciledTollCost' in detail ? detail.reconciledTollCost : undefined, '42000');
    const blank = await getTripById(blankHire);
    assert.equal('reconciledExtraCost' in blank ? blank.reconciledExtraCost : undefined, null);
    assert.equal('reconciledTollCost' in blank ? blank.reconciledTollCost : undefined, null);
  });
  test('business-reference sorting uses displayed references with missing values last while tripCode retains its API meaning', async () => {
    const customer = await mkCustomer();
    const laterReference = await mkTrip({ customerId: customer.id, departureDate: '2026-10-01', tripCode: `A-${suffix}`, customerReference: ' QA-WF04-114144 ' });
    const earlierReference = await mkTrip({ customerId: customer.id, departureDate: '2026-10-01', tripCode: `Z-${suffix}`, customerReference: 'BOOK-001' });
    const tiedReference = await mkTrip({ customerId: customer.id, departureDate: '2026-10-01', tripCode: `Y-${suffix}`, customerReference: 'BOOK-001' });
    const blank = await mkTrip({ customerId: customer.id, departureDate: '2026-10-01', tripCode: `M-${suffix}`, customerReference: '  ' });
    const missing = await mkTrip({ customerId: customer.id, departureDate: '2026-10-01', tripCode: `N-${suffix}`, customerReference: null });

    const asc = await getTrips({ customerId: customer.id, sortBy: 'customerReference', sortDir: 'asc' });
    assert.deepEqual(listedIds(asc), [tiedReference, earlierReference, laterReference, missing, blank]);
    const desc = await getTrips({ customerId: customer.id, sortBy: 'customerReference', sortDir: 'desc' });
    assert.deepEqual(listedIds(desc), [laterReference, tiedReference, earlierReference, missing, blank]);
    const legacy = await getTrips({ customerId: customer.id, sortBy: 'tripCode', sortDir: 'asc' });
    assert.deepEqual(listedIds(legacy), [laterReference, blank, missing, tiedReference, earlierReference]);
  });

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
