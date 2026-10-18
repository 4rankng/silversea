/** FB-061 (card 141026012010) — the Kiểm soát phơi phiếu board must not list
 *  the QA-fixture data class, whatever a QA lane wrote between purges.
 *
 *  Round 16 stopped the demo SEEDERS from authoring the class and gave the
 *  purge a registry, but the READ stayed unguarded: a fixture row written
 *  after a purge rendered on the production-facing board until someone
 *  remembered to run `make qapurge` again — which is why the card kept
 *  verifying as FAIL. `listPhoiPhieuRows` now excludes any row whose
 *  shipment / factory / vehicle / driver / party carries a marker signature
 *  owned in `services/qa-fixture-markers.ts`.
 *
 *  Every negative case is paired with a positive control: an unmarked lot in
 *  the same window stays listed. A filter that over-reaches is as much a bug
 *  as one that under-reaches, and the board carries live revenue.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { listPhoiPhieuRows } from '../services/phoi-phieu-control.service';

// Reserved window: no other lane writes 2033-04 (card173 owns 2033-02, the
// soft-delete-leak file owns 2033-03), so "this subject's rows" means exactly
// this file's rows.
const DAY = '2033-04-11';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Plates are varchar(20) — the plate fixtures use a short tag, never the
// 20-char `suffix`, so a marker case can be built on a realistic plate.
const tag = Math.random().toString(36).slice(2, 7);
/** Every tracked table is a schema table with a single-column `id`. */
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

let ordinal = 0;
let actorRow: Promise<{ id: number }> | null = null;
function actor() {
  actorRow ??= db.insert(s.users).values({
    username: `fb061f-${suffix}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id }).then(([row]) => {
    track(s.users, row.id);
    return row;
  });
  return actorRow;
}

type LotSpec = {
  /** What the QA lane wrote onto the lot, i.e. which marker is under test. */
  blNumber?: string;
  bookingRef?: string;
  factoryName?: string;
  customerName?: string;
  /** IMPORT forbids a booking ref and EXPORT forbids a Bill (DB check). */
  tradeDirection?: 'IMPORT' | 'EXPORT';
  tripFactorySiteName?: string;
  external?: { plate?: string; driver?: string; carrierName?: string };
  ownFleet?: { plate: string; driver: string };
};

/** One trip in the reserved window; returns the tripCode the board is searched by. */
async function mkLot(spec: LotSpec) {
  const me = await actor();
  const key = ordinal++;
  const [customer] = await db.insert(s.customers).values({
    name: spec.customerName ?? `FB061F khách ${suffix}-${key}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `FB061F route ${suffix}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    tradeDirection: spec.tradeDirection ?? 'IMPORT', blNumber: spec.blNumber ?? null, bookingRef: spec.bookingRef ?? null,
    factoryName: spec.factoryName ?? null,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `FB061F${String(key).padStart(6, '0')}`,
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const tripCode = `TRP-FB061F-${suffix}-${key}`;
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode, departureDate: DAY, status: 'IN_TRANSIT',
    factorySiteName: spec.tripFactorySiteName ?? null,
    ...(spec.ownFleet ? { truckId: await mkTruck(spec.ownFleet.plate), driverId: await mkDriver(spec.ownFleet.driver) } : {}),
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  if (spec.external) {
    const [info] = await db.insert(s.tripCarrierInfo).values({
      tripId: trip.id, carrierType: 'EXTERNAL',
      externalPlateNumber: spec.external.plate ?? null,
      externalDriverName: spec.external.driver ?? null,
    }).returning({ id: s.tripCarrierInfo.id });
    track(s.tripCarrierInfo, info.id);
    if (spec.external.carrierName) {
      const [carrier] = await db.insert(s.customers).values({ name: spec.external.carrierName }).returning({ id: s.customers.id });
      track(s.customers, carrier.id);
      await db.update(s.tripCarrierInfo).set({ externalEntityId: carrier.id, externalEntityType: 'CUSTOMER' })
        .where(eq(s.tripCarrierInfo.id, info.id));
    }
  }
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
    amount: '150000', customerChargeAmount: '60000',
    costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: me.id, paidAt: DAY,
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
    confirmedAt: new Date(), version: 1,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return tripCode;
}

async function mkTruck(plate: string) {
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plate }).returning({ id: s.trucks.id });
  track(s.trucks, truck.id);
  return truck.id;
}
async function mkDriver(name: string) {
  const [driver] = await db.insert(s.drivers).values({ name }).returning({ id: s.drivers.id });
  track(s.drivers, driver.id);
  return driver.id;
}

/** The board rows whose trip is exactly this lot — a hit means it surfaced. */
async function boardRowsFor(tripCode: string) {
  return (await listPhoiPhieuRows({ search: tripCode })).filter((row) => row.tripCode === tripCode);
}

async function assertHidden(label: string, spec: LotSpec) {
  const tripCode = await mkLot(spec);
  const rows = await boardRowsFor(tripCode);
  assert.equal(rows.length, 0, `${label}: the fixture lot must not be listed on the board`);
}

describe('FB-061 — the board never lists a QA-fixture row', () => {
  test('MARK-1 bill/booking families (BL-QAKE, E2E) are hidden', async () => {
    await assertHidden('BL-QAKE bill', { blNumber: `BL-QAKE-${Date.now()}` });
    await assertHidden('E2E bill', { blNumber: `E2E-${suffix.toUpperCase()}` });
    await assertHidden('BL-QAKE booking', { tradeDirection: 'EXPORT', bookingRef: `BL-QAKE-${Date.now()}` });
  });

  test('MARK-2 the card\'s probe plates and drivers are hidden', async () => {
    await assertHidden('probe plate 99T-99999', { external: { plate: '99T-99999' } });
    await assertHidden('probe plate 51K-PROBE', { external: { plate: `51K-PROBE-${tag}` } });
    await assertHidden('Test Driver R15', { external: { driver: 'Test Driver R15' } });
    await assertHidden('own-fleet probe truck', { ownFleet: { plate: `51K-PROBE-${tag}`, driver: `Tài xế thật ${suffix}` } });
    await assertHidden('own-fleet Test Driver', { ownFleet: { plate: `51K-${tag}`, driver: `Test Driver R${suffix}` } });
  });

  test('MARK-3 the card\'s factory and carrier families are hidden', async () => {
    await assertHidden('shipment factory KHO-SEAM', { factoryName: 'KHO-SEAM-1789702634486' });
    await assertHidden('trip factory snapshot KHO-SEAM', { tripFactorySiteName: 'KHO-SEAM-1789702634486' });
    await assertHidden('carrier STG VERIFY NHA XE 09', { external: { carrierName: 'STG VERIFY NHA XE 09', plate: `51K-${tag}` } });
    await assertHidden('customer QA0915', { customerName: 'QA0915 QA-138 Credit Customer' });
  });
});

describe('FB-061 — the board keeps every unmarked lot (no over-filter)', () => {
  test('MARK-4 a clean lot in the same window stays listed', async () => {
    const tripCode = await mkLot({
      blNumber: `HDG-${suffix}`,
      factoryName: 'Nhà máy YuanFang',
      external: { plate: `51K-${tag}`, driver: `Nguyễn Văn An ${suffix}`, carrierName: `CÔNG TY TNHH VẬN TẢI NHA XE BIEN BAC ${suffix}-${tag}` },
    });
    const rows = await boardRowsFor(tripCode);
    assert.equal(rows.length, 1, 'an unmarked lot must stay on the board — the filter must not swallow live rows');
    assert.equal(rows[0].factoryName, 'Nhà máy YuanFang');
    assert.equal(rows[0].billOrBooking, `HDG-${suffix}`);
  });

  test('MARK-5 a REAL carrier whose name contains "NHA XE" stays listed', async () => {
    // The card text asked for an unaccented `NHA XE` marker. Taken literally
    // that hides this lot: `… VẬN TẢI NHA XE BIEN BAC` is a real carrier. The
    // marker is the whole `STG VERIFY%` fixture family instead.
    const tripCode = await mkLot({
      external: { plate: `51K-${tag}`, carrierName: `CÔNG TY TNHH VẬN TẢI NHA XE BIEN BAC số ${Math.random().toString(36).slice(2, 7)}` },
    });
    assert.equal((await boardRowsFor(tripCode)).length, 1, 'a real carrier named "… NHA XE …" must keep its board row');
  });
});

after(async () => {
  for (const { table, id } of cleanup) {
    try {
      await db.delete(table).where(eq(table.id, id));
    } catch {
      /* best-effort: a referenced row must not fail this file's teardown */
    }
  }
  try { await disconnectRedis(); } catch { /* already closed */ }
  process.exit(0);
});