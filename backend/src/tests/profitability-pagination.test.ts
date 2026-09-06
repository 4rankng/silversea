import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { disconnectRedis } from '../lib/redis';
import { getProfitabilityReport } from '../services/profitability.service';

const customerIds: number[] = [];
const tripIds: number[] = [];
const postingIds: number[] = [];
const snapshotIds: number[] = [];
const policyIds: number[] = [];
const shipmentIds: number[] = [];
let routeId = 0;
let cargoTypeId = 0;
let firstCustomerShortName = '';
let sourceBillPrefix = '';

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [route] = await db.insert(s.routes).values({ name: `Profit page route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `Profit page cargo ${suffix}` }).returning();
  routeId = route.id;
  cargoTypeId = cargo.id;

  const [policy] = await db.insert(s.financialReportingPolicyVersions).values({
    effectiveFrom: '2039-01-01',
    depreciationMethod: 'STRAIGHT_LINE',
    allocationBasis: 'COMPLETED_TRIP_REVENUE_SHARE',
    lowMarginThresholdRatio: '0.6500',
    governanceActionId: 2_000_000_000 + Math.floor(Math.random() * 100_000_000),
    createdBy: 2_000_000_000,
  }).returning({ id: s.financialReportingPolicyVersions.id });
  policyIds.push(policy.id);

  const customers = await db.insert(s.customers).values(Array.from({ length: 51 }, (_, index) => ({
    name: `Profit page customer ${String(index + 1).padStart(2, '0')} ${suffix}`,
    shortName: `KH-${String(index + 1).padStart(2, '0')}`,
  }))).returning({ id: s.customers.id, name: s.customers.name, shortName: s.customers.shortName });
  customerIds.push(...customers.map((customer) => customer.id));
  firstCustomerShortName = customers[0].shortName;
  sourceBillPrefix = `BL-PROFIT-${suffix}`;
  const [sourceShipment] = await db.insert(s.shipments).values({
    customerId: customers[0].id,
    routeId,
    cargoTypeId,
    blNumber: sourceBillPrefix.slice(0, 100),
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
  }).returning({ id: s.shipments.id });
  shipmentIds.push(sourceShipment.id);

  const trips = await Promise.all(customers.map((customer, index) => insertTripComposite(db, {
    tripCode: `PAG-${suffix}-${index}`.slice(0, 50),
    shipmentId: index === 0 ? sourceShipment.id : null,
    customerId: customer.id,
    routeId,
    cargoTypeId,
    status: 'COMPLETED' as const,
    departureDate: '2040-01-15',
    completedAt: new Date('2040-01-15T00:00:00Z'),
    revenue: '1000000',
    totalCost: '400000',
    grossProfit: '600000',
  })));
  tripIds.push(...trips.map((trip) => trip.id));

  const postings = await db.insert(s.tripFinancialPostings).values(trips.map((trip) => ({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: new Date('2040-01-15T00:00:00Z'),
  }))).returning({ id: s.tripFinancialPostings.id, tripId: s.tripFinancialPostings.tripId });
  postingIds.push(...postings.map((posting) => posting.id));

  const postingByTrip = new Map(postings.map((posting) => [posting.tripId, posting.id]));
  const snapshots = await db.insert(s.profitabilitySnapshots).values(trips.map((trip) => ({
    financialPostingId: postingByTrip.get(trip.id)!,
    tripId: trip.id,
    completedBusinessDate: '2040-01-15',
    revenue: '1000000',
    directCost: '400000',
    sharedOverhead: '0',
    profit: '600000',
    attributionStatus: 'COMPLETE',
  }))).returning({ id: s.profitabilitySnapshots.id, tripId: s.profitabilitySnapshots.tripId });
  snapshotIds.push(...snapshots.map((snapshot) => snapshot.id));

  const customerByTrip = new Map(trips.map((trip) => [trip.id, trip.customerId]));
  const customerNameById = new Map(customers.map((customer) => [customer.id, customer.name]));
  await db.insert(s.profitabilitySnapshotDimensions).values(snapshots.map((snapshot) => {
    const customerId = customerByTrip.get(snapshot.tripId)!;
    return {
      snapshotId: snapshot.id,
      dimension: 'CUSTOMER',
      dimensionKey: String(customerId),
      dimensionLabel: customerNameById.get(customerId)!,
      attributionStatus: 'ATTRIBUTED',
    };
  }));

  const historicalTrip = await insertTripComposite(db, {
    tripCode: `PAG-HIST-${suffix}`.slice(0, 50),
    customerId: customers[0].id,
    routeId,
    cargoTypeId,
    status: 'COMPLETED',
    departureDate: '2040-01-16',
    completedAt: new Date('2040-01-16T00:00:00Z'),
    revenue: '1000000',
    totalCost: '400000',
    grossProfit: '600000',
  });
  tripIds.push(historicalTrip.id);
  const [historicalPosting] = await db.insert(s.tripFinancialPostings).values({
    tripId: historicalTrip.id,
    version: 1,
    tripVersion: historicalTrip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: new Date('2040-01-16T00:00:00Z'),
  }).returning({ id: s.tripFinancialPostings.id });
  postingIds.push(historicalPosting.id);
  const [historicalSnapshot] = await db.insert(s.profitabilitySnapshots).values({
    financialPostingId: historicalPosting.id,
    tripId: historicalTrip.id,
    completedBusinessDate: '2040-01-16',
    revenue: '1000000',
    directCost: '400000',
    sharedOverhead: '0',
    profit: '600000',
    attributionStatus: 'COMPLETE',
  }).returning({ id: s.profitabilitySnapshots.id });
  snapshotIds.push(historicalSnapshot.id);
  await db.insert(s.profitabilitySnapshotDimensions).values({
    snapshotId: historicalSnapshot.id,
    dimension: 'CUSTOMER',
    dimensionKey: String(customers[0].id),
    dimensionLabel: `${customers[0].name} - tên lịch sử`,
    attributionStatus: 'ATTRIBUTED',
  });
});

after(async () => {
  try {
    if (snapshotIds.length) await db.delete(s.profitabilitySnapshotDimensions).where(inArray(s.profitabilitySnapshotDimensions.snapshotId, snapshotIds));
    if (snapshotIds.length) await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.id, snapshotIds));
    if (postingIds.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
    if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (policyIds.length) await db.delete(s.financialReportingPolicyVersions).where(inArray(s.financialReportingPolicyVersions.id, policyIds));
    if (routeId) await db.delete(s.routes).where(inArray(s.routes.id, [routeId]));
    if (cargoTypeId) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, [cargoTypeId]));
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('profitability pagination authority', () => {
  test('keeps full-period totals and coverage stable across more than 50 groups', async () => {
    const first = await getProfitabilityReport({ month: 1, year: 2040, dimension: 'CUSTOMER', page: 1, limit: 50 });
    const second = await getProfitabilityReport({ month: 1, year: 2040, dimension: 'CUSTOMER', page: 2, limit: 50 });

    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 1);
    assert.equal(first.totalGroups, 51);
    assert.equal(first.totalPages, 2);
    assert.deepEqual(second.totals, first.totals);
    assert.deepEqual(second.sourceCoverage, first.sourceCoverage);
    assert.deepEqual(second.reconciliation, first.reconciliation);
    assert.equal(first.timezone, 'Asia/Ho_Chi_Minh');
    assert.equal(first.definitionVersion, 'profitability-v4');
    assert.equal(first.consistency, 'BEST_EFFORT');
    assert.match(first.checksum, /^[a-f0-9]{64}$/);
    assert.equal(first.sourceCoverage.snapshottedTrips, 52);
    assert.equal(first.totals.revenue, 52_000_000);
    assert.equal(first.totals.profit, 31_200_000);
    assert.equal(first.lowMarginPolicy.status, 'CONFIGURED');
    assert.equal(first.lowMarginPolicy.thresholdRatio, 0.65);
    assert.ok(first.items.every((item) => item.alertState === 'LOW_MARGIN'));
    const firstCustomer = [...first.items, ...second.items].find(item => item.key === String(customerIds[0]));
    assert.equal(firstCustomer?.label, firstCustomerShortName);
    assert.ok(firstCustomer?.sourceTripReferences.some((source) => source.reference === sourceBillPrefix));
    assert.ok(firstCustomer?.sourceTripReferences.every((source) => !source.reference.includes(`#${source.tripId}`)));
  });

  test('applies the same configured low-margin filter across bounded pages', async () => {
    const first = await getProfitabilityReport({
      month: 1, year: 2040, dimension: 'CUSTOMER', page: 1, limit: 50, lowMarginOnly: true,
    });
    const second = await getProfitabilityReport({
      month: 1, year: 2040, dimension: 'CUSTOMER', page: 2, limit: 50, lowMarginOnly: true,
    });
    assert.equal(first.totalGroups, 51);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 1);
    assert.ok([...first.items, ...second.items].every((item) => item.alertState === 'LOW_MARGIN'));
  });

  test('keeps the filtered count authoritative on an empty out-of-range page', async () => {
    const report = await getProfitabilityReport({
      month: 1, year: 2040, dimension: 'CUSTOMER', page: 3, limit: 50, lowMarginOnly: true,
    });
    assert.equal(report.items.length, 0);
    assert.equal(report.totalGroups, 51);
    assert.equal(report.totalPages, 2);
  });
});
