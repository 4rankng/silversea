import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { insertTripComposite } from '../services/trip-composite.service';
import { listFuelEvidenceReviewsForOffice, listFuelEvidenceReviewsForTrip } from '../services/fuel-evidence-review.service';
import { listAccountingTransportRows } from '../services/accounting-transport-register.service';
import { getPenalties } from '../services/penalty-reads.service';

const runKey = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const tripIds: number[] = [], shipmentIds: number[] = [], postingIds: number[] = [], penaltyIds: number[] = [], evidenceIds: number[] = [];
const refs = new Map<number, string>();
let beforeRows: unknown;
const period = { from: '2043-06-01', to: '2043-06-30', page: 1, limit: 25 } as const;
async function persistedRows() {
  return {
    trips: await db.select().from(s.trips).where(inArray(s.trips.id, tripIds)).orderBy(s.trips.id),
    financial: await db.select().from(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds)).orderBy(s.tripFinancialState.tripId),
    postings: await db.select().from(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds)).orderBy(s.tripFinancialPostings.id),
    snapshots: await db.select().from(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.financialPostingId, postingIds)).orderBy(s.profitabilitySnapshots.id),
    penalties: await db.select().from(s.penalties).where(inArray(s.penalties.id, penaltyIds)).orderBy(s.penalties.id),
    evidence: await db.select().from(s.fuelEvidenceReviews).where(inArray(s.fuelEvidenceReviews.id, evidenceIds)).orderBy(s.fuelEvidenceReviews.id),
  };
}

before(async () => {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [driver] = await db.select({ id: s.drivers.id, userId: s.drivers.userId }).from(s.drivers).where(isNotNull(s.drivers.userId)).limit(1);
  assert.ok(customer); assert.ok(route); assert.ok(driver?.userId);
  // A real existing non-pump PNG supplies metadata only; no generated image,
  // fake OCR response, photo fetch or approval decision is involved.
  const image = await readFile(new URL('../../assets/Nepo.png', import.meta.url));
  const imageHash = createHash('sha256').update(image).digest('hex');
  const cases = [
    { internal: 'A', direction: 'IMPORT' as const, bill: `  Z-ID03-${runKey}  `, booking: null, expected: `Z-ID03-${runKey}` },
    { internal: 'Z', direction: 'EXPORT' as const, bill: null, booking: `A-ID03-${runKey}`, expected: `A-ID03-${runKey}` },
    { internal: 'Y', direction: 'IMPORT' as const, bill: null, booking: null, expected: 'Chưa có số Bill/Booking' },
    { internal: 'X', direction: 'IMPORT' as const, bill: null, booking: null, expected: 'Chưa có số Bill/Booking', legacy: true },
  ];
  for (const item of cases) {
    let shipmentId: number | undefined;
    if (!item.legacy) {
      const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, routeId: route.id, cargoMode: 'FCL', tradeDirection: item.direction, blNumber: item.bill, bookingRef: item.booking }).returning({ id: s.shipments.id });
      shipmentIds.push(shipment.id); shipmentId = shipment.id;
    }
    const trip = await insertTripComposite(db, { customerId: customer.id, routeId: route.id, shipmentId, tripCode: `${item.internal}-ID03-INTERNAL-${runKey}`, departureDate: '2043-06-15', status: 'COMPLETED', completedAt: new Date('2043-06-15T04:00:00Z') });
    tripIds.push(trip.id); refs.set(trip.id, item.expected);
    const [posting] = await db.insert(s.tripFinancialPostings).values({ tripId: trip.id, version: 1, tripVersion: trip.version, reason: 'COMPLETION', effectiveAt: new Date('2043-06-15T04:00:00Z') }).returning({ id: s.tripFinancialPostings.id }); postingIds.push(posting.id);
    await db.insert(s.profitabilitySnapshots).values({ financialPostingId: posting.id, tripId: trip.id, shipmentId, completedBusinessDate: '2043-06-15', revenue: '1000000', directCost: '400000', profit: '600000', attributionStatus: 'COMPLETE' });
    const [penalty] = await db.insert(s.penalties).values({ driverId: driver.id, tripId: trip.id, customReason: `ID03-${runKey}`, date: '2043-06-15', amount: '50000' }).returning({ id: s.penalties.id }); penaltyIds.push(penalty.id);
    const [evidence] = await db.insert(s.fuelEvidenceReviews).values({ tripId: trip.id, ownerDriverId: driver.id, ownerUserId: driver.userId, createdBy: driver.userId, storageKey: 'Nepo.png', storageHash: imageHash, mimeType: 'image/png', sizeBytes: image.byteLength, ocrOutcome: 'NON_PUMP' }).returning({ id: s.fuelEvidenceReviews.id }); evidenceIds.push(evidence.id);
  }
  beforeRows = await persistedRows();
});

test('ID03 fuel evidence exposes persisted Bill/Booking, missing reference and compatible business search', async () => {
  for (const id of tripIds) {
    const rows = await listFuelEvidenceReviewsForTrip(id);
    assert.equal(rows.length, 1); assert.equal(rows[0]!.tripId, id); assert.equal(rows[0]!.tripCode, refs.get(id));
    assert.equal(rows[0]!.ocrOutcome, 'NON_PUMP'); assert.equal(rows[0]!.version, 1); assert.equal(rows[0]!.totalAmount, null);
  }
  for (const id of tripIds.slice(0, 2)) {
    const rows = await listFuelEvidenceReviewsForOffice({ search: refs.get(id), limit: 100 });
    assert.equal(rows.total, 1); assert.equal(rows.items[0]!.tripId, id);
  }
  const compatibility = await listFuelEvidenceReviewsForOffice({ search: `ID03-INTERNAL-${runKey}`, limit: 100 });
  assert.equal(compatibility.total, 4); assert.equal(compatibility.items.length, 4);
  assert.deepEqual(await persistedRows(), beforeRows);
});

test('ID03 accounting register preserves shape/money and sorts visible references with missing last', async () => {
  const rows = await listAccountingTransportRows(period);
  assert.equal(rows.total, 4); assert.equal(rows.items.length, 4);
  for (const row of rows.items) {
    assert.equal(row.tripCode, refs.get(row.tripId));
    assert.equal(row.revenue, '1000000'); assert.equal(row.directCost, '400000'); assert.equal(row.profit, '600000');
    assert.equal(row.carrierPayable, '0'); assert.equal(row.readiness.status, 'MISSING_ACCEPTED_POD');
    assert.equal(row.financialPostingVersion, 1);
    assert.ok(!('blNumber' in row) && !('bookingRef' in row), 'existing strict DTO shape remains unchanged');
  }
  const ascending = await listAccountingTransportRows({ ...period, sortBy: 'tripCode', sortDir: 'asc' });
  const descending = await listAccountingTransportRows({ ...period, sortBy: 'tripCode', sortDir: 'desc' });
  assert.deepEqual(ascending.items.map(row => row.tripId), [tripIds[1], tripIds[0], tripIds[3], tripIds[2]]);
  assert.deepEqual(descending.items.map(row => row.tripId), [tripIds[0], tripIds[1], tripIds[3], tripIds[2]]);
  for (const id of tripIds.slice(0, 2)) assert.equal((await listAccountingTransportRows({ ...period, search: refs.get(id) })).items[0]!.tripId, id);
  assert.equal((await listAccountingTransportRows({ ...period, search: `ID03-INTERNAL-${runKey}` })).total, 4);
  assert.deepEqual(await persistedRows(), beforeRows);
});

test('ID03 penalties preserve link IDs/status/amount and search/count/sort visible references', async () => {
  const filters = { dateFrom: period.from, dateTo: period.to, search: `ID03-${runKey}`, limit: 100 };
  const rows = await getPenalties(filters);
  assert.equal(rows.total, 4); assert.equal(rows.statusCounts.ACTIVE, 4); assert.equal(rows.statusCounts.all, 4);
  for (const row of rows.items) {
    assert.equal(row.tripCode, refs.get(row.tripId!)); assert.equal(row.amount, '50000'); assert.equal(row.status, 'ACTIVE');
    assert.equal(row.id, penaltyIds[tripIds.indexOf(row.tripId!)]);
  }
  const asc = await getPenalties({ ...filters, sortBy: 'tripCode', sortDir: 'asc' });
  const desc = await getPenalties({ ...filters, sortBy: 'tripCode', sortDir: 'desc' });
  assert.deepEqual(asc.items.map(row => row.tripId), [tripIds[1], tripIds[0], tripIds[2], tripIds[3]]);
  assert.deepEqual(desc.items.map(row => row.tripId), [tripIds[0], tripIds[1], tripIds[2], tripIds[3]]);
  for (const id of tripIds.slice(0, 2)) {
    const found = await getPenalties({ dateFrom: period.from, dateTo: period.to, search: refs.get(id) });
    assert.equal(found.total, 1); assert.equal(found.items[0]!.tripId, id);
  }
  assert.equal((await getPenalties({ ...filters, search: `ID03-INTERNAL-${runKey}` })).total, 4);
  assert.deepEqual(await persistedRows(), beforeRows);
});

after(async () => {
  try {
    if (evidenceIds.length) await db.delete(s.fuelEvidenceReviews).where(inArray(s.fuelEvidenceReviews.id, evidenceIds));
    if (penaltyIds.length) await db.delete(s.penalties).where(inArray(s.penalties.id, penaltyIds));
    if (postingIds.length) await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.financialPostingId, postingIds));
    if (postingIds.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
    for (const id of tripIds) {
      await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, id));
      await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, id));
      await db.delete(s.trips).where(eq(s.trips.id, id));
    }
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  } finally { await disconnectRedis(); await client.end(); }
});
