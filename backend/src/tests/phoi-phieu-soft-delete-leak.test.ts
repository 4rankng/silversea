/** FB-061 (2026-10-16) — soft-deleted masters must never surface by name on
 *  the phơi phiếu board or the monthly money report.
 *
 *  Defect (staging evidence, W5+W4 verify): `listPhoiPhieuRows` joined
 *  `trip_carrier_info.external_entity_id` → customers/suppliers without the
 *  `deleted_at IS NULL` predicate, so a tombstoned QA carrier printed its name
 *  on a REAL lot (EBKG18452303 → `STG VERIFY NHA XE 09`); the money report's
 *  THU attribution joined `trips.customer_id` → customers unfiltered and
 *  printed `QA0915 QA-138 Credit Customer` as a party row.
 *
 *  Law after the fix: deleted carrier masters render the designed fallback
 *  `Đơn vị vận chuyển không còn trong danh mục`; a deleted trip customer's
 *  money keeps reporting (never silently dropped) but buckets under
 *  `Chưa xác định` — the same law the NULL-trip branch follows. Live masters
 *  keep resolving by name (positive controls against over-filtering).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { listPhoiPhieuRows, getPhoiPhieuReport } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}

// Reserved windows for this file: the monthly report takes no `search`
// parameter, so a date window nobody else writes to is the only way to make
// "this subject's rows" mean exactly this fixture's rows (card173 owns
// 2033-02). Board fixtures and money fixtures live in SEPARATE windows so the
// TRA fallback bucket contains only the trip the LEAK-4 test points at.
const boardDay = '2033-03-17';
const moneyDay = '2033-03-18';
const FALLBACK = 'Đơn vị vận chuyển không còn trong danh mục';

let ordinal = 0;
let actorRow: Promise<{ id: number }> | null = null;
function actor() {
  actorRow ??= db.insert(s.users).values({
    username: `fb61-${suffix}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id }).then(([row]) => {
    track(s.users, row.id);
    return row;
  });
  return actorRow;
}

/** One trip inside a reserved window; `customerDeleted` decides the THU
 *  attribution path under test. Returns the unique tripCode to search for. */
async function mkTrip(opts: { customerName: string; customerDeleted?: boolean; day: string }) {
  const me = await actor();
  const key = ordinal++;
  const [customer] = await db.insert(s.customers).values({
    name: opts.customerName,
    ...(opts.customerDeleted ? { deletedAt: new Date() } : {}),
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `FB61 route ${suffix}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `FB61${String(key).padStart(6, '0')}`,
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const tripCode = `TRP-FB61-${suffix}-${key}`;
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode, departureDate: opts.day, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
    amount: '150000', customerChargeAmount: '60000',
    costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: me.id, paidAt: opts.day,
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
    confirmedAt: new Date(), version: 1,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return { tripId: trip.id, tripCode, customerId: customer.id, sourceId: source.id };
}

/** Attach an EXTERNAL carrier to a trip; the master row's deletedAt decides
 *  the board path under test. Mirrors the staging chain exactly:
 *  trip_carrier_info.external_entity_{id,type} → customers/suppliers. */
async function attachCarrier(tripId: number, kind: 'CUSTOMER' | 'SUPPLIER', name: string, deleted?: boolean) {
  const tombstone = deleted ? { deletedAt: new Date() } : {};
  const plate = `51K-FB61${String(ordinal++).padStart(3, '0')}`;
  if (kind === 'CUSTOMER') {
    const [carrier] = await db.insert(s.customers).values({ name, ...tombstone }).returning({ id: s.customers.id });
    track(s.customers, carrier.id);
    const [info] = await db.insert(s.tripCarrierInfo).values({
      tripId, carrierType: 'EXTERNAL', externalEntityId: carrier.id, externalEntityType: 'CUSTOMER',
      externalPlateNumber: plate,
    }).returning({ id: s.tripCarrierInfo.id });
    track(s.tripCarrierInfo, info.id);
    return { plate };
  }
  const [supplier] = await db.insert(s.suppliers).values({ name, ...tombstone }).returning({ id: s.suppliers.id });
  track(s.suppliers, supplier.id);
  const [info] = await db.insert(s.tripCarrierInfo).values({
    tripId, carrierType: 'EXTERNAL', externalEntityId: supplier.id, externalEntityType: 'SUPPLIER',
    externalPlateNumber: plate,
  }).returning({ id: s.tripCarrierInfo.id });
  track(s.tripCarrierInfo, info.id);
  return { plate };
}

describe('FB-061 — board carrier column never prints a soft-deleted master', () => {
  test('LEAK-1: deleted CUSTOMER carrier falls back, live carrier stays named', async () => {
    const deadName = `FB61 dead nhà xe ${suffix}`;
    const liveName = `FB61 live nhà xe ${suffix}`;
    const deadTrip = await mkTrip({ customerName: `FB61 khách A ${suffix}`, day: boardDay });
    const liveTrip = await mkTrip({ customerName: `FB61 khách B ${suffix}`, day: boardDay });
    const deadAttach = await attachCarrier(deadTrip.tripId, 'CUSTOMER', deadName, true);
    await attachCarrier(liveTrip.tripId, 'CUSTOMER', liveName, false);

    const deadRow = (await listPhoiPhieuRows({ search: deadTrip.tripCode }))[0];
    const liveRow = (await listPhoiPhieuRows({ search: liveTrip.tripCode }))[0];
    assert.ok(deadRow && liveRow, 'fixture sanity: both trips on the board');
    assert.equal(deadRow.carrierName, FALLBACK, 'a soft-deleted carrier customer renders the designed fallback, never its name');
    assert.equal(deadRow.plateNumber, deadAttach.plate, 'the external plate (real operational data) survives the name scrub');
    assert.equal(liveRow.carrierName, liveName, 'positive control: a live carrier keeps resolving by name');
  });

  test('LEAK-2: deleted SUPPLIER carrier falls back, live supplier stays named', async () => {
    const deadName = `FB61 dead NCC ${suffix}`;
    const liveName = `FB61 live NCC ${suffix}`;
    const deadTrip = await mkTrip({ customerName: `FB61 khách C ${suffix}`, day: boardDay });
    const liveTrip = await mkTrip({ customerName: `FB61 khách D ${suffix}`, day: boardDay });
    await attachCarrier(deadTrip.tripId, 'SUPPLIER', deadName, true);
    await attachCarrier(liveTrip.tripId, 'SUPPLIER', liveName, false);

    const deadRow = (await listPhoiPhieuRows({ search: deadTrip.tripCode }))[0];
    const liveRow = (await listPhoiPhieuRows({ search: liveTrip.tripCode }))[0];
    assert.ok(deadRow && liveRow, 'fixture sanity: both trips on the board');
    assert.equal(deadRow.carrierName, FALLBACK, 'a soft-deleted carrier supplier renders the designed fallback, never its name');
    assert.equal(liveRow.carrierName, liveName, 'positive control: a live supplier keeps resolving by name');
  });
});

describe('FB-061 — monthly money report never prints a soft-deleted master', () => {
  test('LEAK-3 THU: deleted trip customer buckets under Chưa xác định, money kept', async () => {
    const deadName = `FB61 dead khách thu ${suffix}`;
    const liveName = `FB61 live khách thu ${suffix}`;
    await mkTrip({ customerName: deadName, customerDeleted: true, day: moneyDay });
    await mkTrip({ customerName: liveName, day: moneyDay });

    const { rows } = await getPhoiPhieuReport({ kind: 'THU', dateFrom: moneyDay, dateTo: moneyDay });
    const parties = rows.map((row) => row.party);
    assert.ok(!parties.includes(deadName), `the deleted customer must not surface as a party — got ${parties.join(' | ')}`);
    const unknown = rows.find((row) => row.party === 'Chưa xác định');
    assert.ok(unknown, 'the deleted customer\'s money keeps reporting under the unknown-party bucket (never silently dropped)');
    assert.equal(unknown!.tongPhaiThuTra, 150000, 'the deleted customer\'s money is intact under the bucket');
    assert.equal(unknown!.soLuong, 1);
    const liveRow = rows.find((row) => row.party === liveName);
    assert.ok(liveRow, 'positive control: the live customer reports by name');
    assert.equal(liveRow!.tongPhaiThuTra, 150000);
  });

  test('LEAK-4 TRA: deleted carrier buckets under the fallback, live carrier stays named', async () => {
    const deadName = `FB61 dead nhà xe TRA ${suffix}`;
    const liveName = `FB61 live nhà xe TRA ${suffix}`;
    const deadTrip = await mkTrip({ customerName: `FB61 khách E ${suffix}`, day: moneyDay });
    const liveTrip = await mkTrip({ customerName: `FB61 khách F ${suffix}`, day: moneyDay });
    await attachCarrier(deadTrip.tripId, 'CUSTOMER', deadName, true);
    await attachCarrier(liveTrip.tripId, 'CUSTOMER', liveName, false);

    const { rows } = await getPhoiPhieuReport({ kind: 'TRA', dateFrom: moneyDay, dateTo: moneyDay });
    const parties = rows.map((row) => row.party);
    assert.ok(!parties.includes(deadName), `the deleted carrier must not surface as a party — got ${parties.join(' | ')}`);
    const fallbackRow = rows.find((row) => row.party === FALLBACK);
    assert.ok(fallbackRow, 'the deleted carrier\'s payable money keeps reporting under the fallback bucket');
    assert.equal(fallbackRow!.tongPhaiThuTra, 150000, 'the deleted carrier\'s payable money is intact under the bucket');
    const liveRow = rows.find((row) => row.party === liveName);
    assert.ok(liveRow, 'positive control: the live carrier reports by name');
    assert.equal(liveRow!.tongPhaiThuTra, 150000);
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
