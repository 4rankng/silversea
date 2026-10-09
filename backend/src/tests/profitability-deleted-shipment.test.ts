import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { getProfitabilityReport } from '../services/profitability.service';
import { getPnlReport } from '../services/pnl.service';
import { disconnectRedis } from '../lib/redis';

// Card 20261010_2: financial reports must not surface postings of a
// soft-deleted (tombstoned) lot. In normal operation the state cannot arise
// (a lot with live trips cannot be deleted), so the only tombstoned lots with
// financials are QA-purge artifacts — excluding them changes no legitimate
// number. Ad-hoc trips (null shipmentId) stay included.
const customerIds: number[] = [];
const tripIds: number[] = [];
const postingIds: number[] = [];
const snapshotIds: number[] = [];
const shipmentIds: number[] = [];
let routeId = 0;
let cargoTypeId = 0;

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [route] = await db.insert(s.routes).values({ name: `Del lot route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `Del lot cargo ${suffix}` }).returning();
  routeId = route.id;
  cargoTypeId = cargo.id;
  const customers = await db.insert(s.customers).values([
    { name: `Del lot live ${suffix}`, shortName: 'DL-LIVE' },
    { name: `Del lot dead ${suffix}`, shortName: 'DL-DEAD' },
  ]).returning({ id: s.customers.id, name: s.customers.name });
  customerIds.push(...customers.map((c) => c.id));

  const [liveShipment] = await db.insert(s.shipments).values({
    customerId: customers[0].id, routeId, cargoTypeId,
    blNumber: `BL-LIVE-${suffix}`.slice(0, 100), tradeDirection: 'IMPORT', cargoMode: 'FCL',
  }).returning({ id: s.shipments.id });
  shipmentIds.push(liveShipment.id);
  const [deadShipment] = await db.insert(s.shipments).values({
    customerId: customers[1].id, routeId, cargoTypeId,
    blNumber: `BL-DEAD-${suffix}`.slice(0, 100), tradeDirection: 'IMPORT', cargoMode: 'FCL',
  }).returning({ id: s.shipments.id });
  shipmentIds.push(deadShipment.id);

  const mkTrip = (customerId: number, shipmentId: number | null, code: string) => insertTripComposite(db, {
    tripCode: code, shipmentId, customerId, routeId, cargoTypeId,
    status: 'COMPLETED' as const,
    departureDate: '2041-03-10',
    completedAt: new Date('2041-03-10T00:00:00Z'),
    revenue: '1000000', totalCost: '400000', grossProfit: '600000',
  });
  const liveTrip = await mkTrip(customers[0].id, liveShipment.id, `DLV-${suffix}`.slice(0, 50));
  const deadTrip = await mkTrip(customers[1].id, deadShipment.id, `DLD-${suffix}`.slice(0, 50));
  const adhocTrip = await mkTrip(customers[0].id, null, `DLA-${suffix}`.slice(0, 50));
  tripIds.push(liveTrip.id, deadTrip.id, adhocTrip.id);

  // Tombstone the dead lot only after its trip exists — mirroring the purge order.
  await db.update(s.shipments).set({ deletedAt: new Date() }).where(eq(s.shipments.id, deadShipment.id));

  const rows: { tripId: number; shipmentId: number | null }[] = [
    { tripId: liveTrip.id, shipmentId: liveShipment.id },
    { tripId: deadTrip.id, shipmentId: deadShipment.id },
    { tripId: adhocTrip.id, shipmentId: null },
  ];
  const postings = await db.insert(s.tripFinancialPostings).values(rows.map((row) => ({
    tripId: row.tripId, version: 1, tripVersion: 1, status: 'ACTIVE',
    reason: 'COMPLETION', effectiveAt: new Date('2041-03-10T00:00:00Z'),
  }))).returning({ id: s.tripFinancialPostings.id, tripId: s.tripFinancialPostings.tripId });
  postingIds.push(...postings.map((p) => p.id));
  const postingByTrip = new Map(postings.map((p) => [p.tripId, p.id]));

  const customerByTrip = new Map<number, number>([
    [liveTrip.id, customers[0].id], [deadTrip.id, customers[1].id], [adhocTrip.id, customers[0].id],
  ]);
  const snapshots = await db.insert(s.profitabilitySnapshots).values(rows.map((row) => ({
    financialPostingId: postingByTrip.get(row.tripId)!,
    tripId: row.tripId,
    shipmentId: row.shipmentId,
    completedBusinessDate: '2041-03-10',
    revenue: '1000000', directCost: '400000', sharedOverhead: '0', profit: '600000',
    attributionStatus: 'COMPLETE',
  }))).returning({ id: s.profitabilitySnapshots.id });
  snapshotIds.push(...snapshots.map((sn) => sn.id));
  await db.insert(s.profitabilitySnapshotDimensions).values(rows.map((row, i) => ({
    snapshotId: snapshots[i].id,
    dimension: 'CUSTOMER',
    dimensionKey: String(customerByTrip.get(row.tripId)),
    dimensionLabel: `DL group ${row.tripId}`,
    attributionStatus: 'ATTRIBUTED',
  })));
});

after(async () => {
  try {
    if (snapshotIds.length) await db.delete(s.profitabilitySnapshotDimensions).where(inArray(s.profitabilitySnapshotDimensions.snapshotId, snapshotIds));
    if (snapshotIds.length) await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.id, snapshotIds));
    if (postingIds.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
    if (tripIds.length) {
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    }
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (routeId) await db.delete(s.routes).where(eq(s.routes.id, routeId));
    if (cargoTypeId) await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('financial reports exclude tombstoned lots (card 20261010_2)', () => {
  test('T1: CUSTOMER profitability report drops the tombstoned lot, keeps live + ad-hoc', async () => {
    const report = await getProfitabilityReport({ month: 3, year: 2041, dimension: 'CUSTOMER' });
    const keys = report.items.map((row) => row.key);
    assert.ok(!keys.includes(String(customerIds[1])), 'tombstoned lot customer must be absent from report rows');
    assert.ok(keys.includes(String(customerIds[0])), 'live lot customer must remain');
    // live + adhoc = 2M revenue; the dead lot's 1M must not leak into totals.
    assert.equal(Number(report.totals.revenue), 2_000_000);
    assert.equal(Number(report.totals.profit), 1_200_000);
  });

  test('T2: sourceTripReferences never cites the tombstoned lot', async () => {
    const report = await getProfitabilityReport({ month: 3, year: 2041, dimension: 'CUSTOMER' });
    const refs = report.items.flatMap((row) => row.sourceTripReferences.map((ref) => ref.reference));
    assert.ok(refs.some((r) => r.startsWith('BL-LIVE-')), 'live bill must appear in Nguồn');
    assert.ok(!refs.some((r) => r.startsWith('BL-DEAD-')), 'tombstoned bill must not appear in Nguồn');
  });

  test('T3: PnL excludes the tombstoned lot trip (sibling sweep)', async () => {
    const pnl = await getPnlReport(3, 2041);
    assert.equal(pnl.tripCount, 2, 'PnL counts live + ad-hoc only, not the tombstoned lot');
  });
});
