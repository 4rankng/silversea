/**
 * Driver task-note format v2 contract (ticket 851e8f7d, TODO/20260911_3
 * BUG4): tags + free text ride shipments.operationalNotes as TWO parts —
 * line 1 = tag labels '; '-joined, remainder = free text (shared
 * composeDriverTaskNote/parseDriverTaskNote). This pins the backend side:
 * the driver read surfaces carry the note VERBATIM (no composition, no
 * mangling) and embed the knownTagLabels pool so the driver app can render
 * line 1 as chips and the rest as text. Legacy v1 single-line notes pass
 * through unchanged and still parse via the shared helpers.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { composeDriverTaskNote, parseDriverTaskNote } from '@tingting/shared';
import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { getDriverFulfillmentDetail } from '../services/driver.service';
import { updateShipment } from '../services/shipment-update.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const V2_NOTE = composeDriverTaskNote(['HẾT HẠN', 'ĐẢO VỎ'], 'xuất container trước 17h');
const LEGACY_V1_NOTE = 'HẾT HẠN; ĐẢO VỎ; xuất container trước 17h';

const createdTripIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdSiteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];

async function mkNotesTrip(args: { notes: string | null }) {
  const [user] = await db.insert(s.users).values({
    username: `note-fmt-${suffix}-${createdUserIds.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  createdUserIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `NoteFmt driver ${suffix}-${createdDriverIds.length}`, userId: user.id,
  }).returning();
  createdDriverIds.push(driver.id);
  const [customer] = await db.insert(s.customers).values({
    name: `NoteFmt customer ${suffix}-${createdCustomerIds.length}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `NoteFmt route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `NoteFmt cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `NF${suffix.slice(-6)}${createdContainerTypeIds.length}`.slice(0, 20),
    name: `NoteFmt container ${suffix}-${createdContainerTypeIds.length}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `NFS-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name: `NoteFmt site ${suffix}-${createdSiteIds.length}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${suffix}-${createdSiteIds.length}`,
  }).returning();
  createdSiteIds.push(site.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    operationalNotes: args.notes,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `NF${String(500000 + shipment.id).slice(-6)}`,
    operationalSiteId: site.id,
  }).returning();
  createdContainerIds.push(container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    dispatchClassification: 'SINGLE',
    sourceShipmentVersion: shipment.version,
    shipmentContainerId: container.id,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `NF-${suffix}-${createdTripIds.length}`.slice(0, 50),
    driverId: driver.id,
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'CREATED',
    departureDate: new Date().toISOString().slice(0, 10),
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).returning();
  createdTripIds.push(trip.id);
  return { driver, shipment, fulfillment, trip };
}

describe('driver task-note format v2 — backend passthrough contract', () => {
  test('journey board carries the v2 and legacy notes verbatim + the tag pool', async () => {
    const v2 = await mkNotesTrip({ notes: V2_NOTE });
    const legacy = await mkNotesTrip({ notes: LEGACY_V1_NOTE });

    const boardA = await getDriverJourneyBoard(v2.driver.id);
    const cardA = boardA.items.find((c) => c.fulfillmentId === v2.fulfillment.id);
    assert.ok(cardA, 'v2 trip card must be on the driver board');
    assert.equal(cardA.operationalNotes, V2_NOTE);
    assert.ok(boardA.knownTagLabels.includes('HẾT HẠN') && boardA.knownTagLabels.includes('ĐẢO VỎ'),
      'canonical seeds must ride the board response so the app can render line 1 as chips');

    const boardB = await getDriverJourneyBoard(legacy.driver.id);
    const cardB = boardB.items.find((c) => c.fulfillmentId === legacy.fulfillment.id);
    assert.ok(cardB);
    assert.equal(cardB.operationalNotes, LEGACY_V1_NOTE);

    // The two-line split is recoverable from what the board carries alone.
    const parsed = parseDriverTaskNote(cardA.operationalNotes, boardA.knownTagLabels);
    assert.deepEqual(parsed, {
      selectedLabels: ['HẾT HẠN', 'ĐẢO VỎ'],
      manualText: 'xuất container trước 17h',
    });
    // A legacy note parses to the same chips + text — identical to v1 behavior.
    assert.deepEqual(
      parseDriverTaskNote(cardB.operationalNotes, boardB.knownTagLabels),
      parsed,
    );
  });

  test('DRV-R01 CUS note save reaches board and detail as the same task/manual text without customer-note leakage', async () => {
    const fixture = await mkNotesTrip({ notes: 'Ghi chú trước đó' });
    const note = composeDriverTaskNote(['HẾT HẠN', 'ĐẢO VỎ'], 'Gọi chị An trước khi đến\nKiểm tra seal trước khi rời kho');
    // CUS route maps its driverNotes alias onto operationalNotes before this
    // service. Keep customer-only text distinct from the driver authority.
    await updateShipment(fixture.shipment.id, {
      expectedVersion: fixture.shipment.version,
      operationalNotes: note,
      customerNotes: 'Ghi chú nội bộ cho khách\nKhông phải ghi chú lái xe',
    });
    const board = await getDriverJourneyBoard(fixture.driver.id);
    const card = board.items.find((item) => item.tripId === fixture.trip.id)!;
    const detail = await getDriverFulfillmentDetail(fixture.driver.id, fixture.fulfillment.id);
    assert.equal(card.operationalNotes, note);
    assert.equal(detail.driverNotes, note);
    const expected = { selectedLabels: ['HẾT HẠN', 'ĐẢO VỎ'], manualText: 'Gọi chị An trước khi đến\nKiểm tra seal trước khi rời kho' };
    assert.deepEqual(parseDriverTaskNote(card.operationalNotes, board.knownTagLabels), expected);
    assert.deepEqual(parseDriverTaskNote(detail.driverNotes, detail.knownTagLabels), expected);
  });

  test('driver fulfillment detail carries driverNotes verbatim + the tag pool', async () => {
    const v2 = await mkNotesTrip({ notes: V2_NOTE });
    const detail = await getDriverFulfillmentDetail(v2.driver.id, v2.fulfillment.id);
    assert.equal(detail.driverNotes, V2_NOTE);
    assert.ok(detail.knownTagLabels.includes('HẾT HẠN') && detail.knownTagLabels.includes('ĐẢO VỎ'));
    const parsed = parseDriverTaskNote(detail.driverNotes, detail.knownTagLabels);
    assert.deepEqual(parsed, {
      selectedLabels: ['HẾT HẠN', 'ĐẢO VỎ'],
      manualText: 'xuất container trước 17h',
    });
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdFulfillmentIds.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
    if (createdContainerIds.length > 0) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdContainerIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } finally {
    await client.end();
  }
});
