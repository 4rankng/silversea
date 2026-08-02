/**
 * Wave 4 M8.4 slice 4 — advisory evidence-readiness before completion.
 *
 * Creates trips with/without photos + progress events, exercises
 * getCompletionEvidenceStatus, tears down.
 *
 * Coverage (PRD M08-04-03 §3 resolved as advisory):
 *   - No milestones / no POD → not ready, required items missing.
 *   - Submitted POD without DELIVERED sequence → still blocked.
 *   - Full milestone sequence + submitted POD → ready.
 *   - Missing field lists correct Vietnamese labels.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getCompletionEvidenceStatus } from '../services/driver.service';
import { DriverProgressEventType, TripPodFileType, TripPodStatus } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdPodFileIds: number[] = [];
const createdPodSubmissionIds: number[] = [];
const createdEventIds: number[] = [];
const createdTripIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

let setupCounter = 0;
async function setup() {
  setupCounter += 1;
  const tag = `${suffix}-${setupCounter}`;
  const [u] = await db.insert(s.users).values({
    username: `m84ev-${tag}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  createdUserIds.push(u.id);
  const [d] = await db.insert(s.drivers).values({ name: `M84EV ${tag}`, userId: u.id }).returning();
  createdDriverIds.push(d.id);
  const [cust] = await db.insert(s.customers).values({ name: `M84EV cust ${tag}` }).returning();
  createdCustomerIds.push(cust.id);
  const [rt] = await db.insert(s.routes).values({ name: `M84EV route ${tag}` }).returning();
  createdRouteIds.push(rt.id);
  const [ct] = await db.insert(s.cargoTypes).values({ name: `M84EV cargo ${tag}` }).returning();
  createdCargoTypeIds.push(ct.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: cust.id,
    routeId: rt.id,
    cargoTypeId: ct.id,
    cargoMode: 'LCL',
    status: 'DISPATCHED',
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M84EV-${tag}`.slice(0, 50), driverId: d.id, customerId: cust.id,
    routeId: rt.id, cargoTypeId: ct.id, status: 'IN_TRANSIT',
    departureDate: new Date().toISOString().slice(0, 10),
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).returning();
  createdTripIds.push(trip.id);
  return { user: u, driver: d, trip, fulfillment };
}

let tc = 0;

describe('M8.4 slice 4 — advisory evidence-readiness', () => {
  test('No evidence → not ready, milestone and e-POD requirements are missing', async () => {
    const { trip } = await setup();
    tc++;
    const st = await getCompletionEvidenceStatus(trip.id);
    assert.equal(st.ready, false);
    assert.ok(st.missing.includes('Đã lấy vỏ / Lấy hàng'));
    assert.ok(st.missing.includes('Đang đóng / Trả hàng'));
    assert.ok(st.missing.includes('Đã hạ bãi / Giao hàng xong'));
    assert.ok(st.missing.includes('Phiếu hạ bãi / trả hàng'));
    assert.ok(st.missing.includes('Biên bản giao nhận đã ký'));
    assert.ok(st.missing.includes('e-POD đã gửi'));
  });

  test('Submitted POD without delivered sequence → still blocked', async () => {
    const { trip, driver, user, fulfillment } = await setup();
    tc++;
    for (const eventType of [
      DriverProgressEventType.ORDER_RECEIVED,
      DriverProgressEventType.PICKED_UP,
      DriverProgressEventType.LOADING_OR_RETURNING,
    ] as const) {
      const [ev] = await db.insert(s.driverProgressEvents).values({
        tripId: trip.id,
        driverId: driver.id,
        eventType,
        occurredAt: new Date(),
        recordedBy: user.id,
      }).returning();
      createdEventIds.push(ev.id);
    }
    const [submission] = await db.insert(s.tripPodSubmissions).values({
      tripId: trip.id,
      fulfillmentId: fulfillment.id,
      submissionVersion: 1,
      sourceTripVersion: trip.version,
      status: TripPodStatus.SUBMITTED,
      submittedBy: user.id,
      submittedAt: new Date(),
    }).returning();
    createdPodSubmissionIds.push(submission.id);
    const files = await db.insert(s.tripPodFiles).values([
      {
        submissionId: submission.id,
        fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
        storageKey: `test/evidence-${suffix}-1.jpg`,
        originalFileName: 'yard.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        sha256: '1'.repeat(64),
        uploadedBy: user.id,
      },
      {
        submissionId: submission.id,
        fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
        storageKey: `test/evidence-${suffix}-2.jpg`,
        originalFileName: 'delivery.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        sha256: '2'.repeat(64),
        uploadedBy: user.id,
      },
    ]).returning();
    createdPodFileIds.push(...files.map((file) => file.id));
    const st = await getCompletionEvidenceStatus(trip.id);
    assert.equal(st.ready, false);
    assert.equal(st.hasSubmittedPod, true);
    assert.equal(st.hasRequiredPodFiles, true);
    assert.equal(st.hasDeliveredMilestone, false);
    assert.ok(st.missing.includes('Đã hạ bãi / Giao hàng xong'));
  });

  test('Full milestone sequence + submitted POD → ready', async () => {
    const { trip, driver, user, fulfillment } = await setup();
    tc++;
    for (const eventType of [
      DriverProgressEventType.ORDER_RECEIVED,
      DriverProgressEventType.PICKED_UP,
      DriverProgressEventType.LOADING_OR_RETURNING,
      DriverProgressEventType.DELIVERED,
    ] as const) {
      const [ev] = await db.insert(s.driverProgressEvents).values({
        tripId: trip.id, driverId: driver.id, eventType,
        occurredAt: new Date(), recordedBy: user.id,
      }).returning();
      createdEventIds.push(ev.id);
    }
    const [submission] = await db.insert(s.tripPodSubmissions).values({
      tripId: trip.id,
      fulfillmentId: fulfillment.id,
      submissionVersion: 1,
      sourceTripVersion: trip.version,
      status: TripPodStatus.SUBMITTED,
      submittedBy: user.id,
      submittedAt: new Date(),
    }).returning();
    createdPodSubmissionIds.push(submission.id);
    const files = await db.insert(s.tripPodFiles).values([
      {
        submissionId: submission.id,
        fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
        storageKey: `test/ready-${suffix}-1.jpg`,
        originalFileName: 'yard.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        sha256: '3'.repeat(64),
        uploadedBy: user.id,
      },
      {
        submissionId: submission.id,
        fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
        storageKey: `test/ready-${suffix}-2.jpg`,
        originalFileName: 'delivery.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        sha256: '4'.repeat(64),
        uploadedBy: user.id,
      },
    ]).returning();
    createdPodFileIds.push(...files.map((file) => file.id));
    const st = await getCompletionEvidenceStatus(trip.id);
    assert.equal(st.ready, true, JSON.stringify(st));
    assert.deepEqual(st.missing, []);
    assert.equal(st.hasSubmittedPod, true);
    assert.equal(st.hasRequiredPodFiles, true);
    assert.equal(st.hasDeliveredMilestone, true);
  });

  test('Missing field lists correct Vietnamese labels', async () => {
    const { trip } = await setup();
    tc++;
    const st = await getCompletionEvidenceStatus(trip.id);
    for (const label of st.missing) {
      assert.ok(label.length > 0 && /[à-ỹÀ-Ỹ]/.test(label), `Vietnamese label: ${label}`);
    }
  });
});

after(async () => {
  try {
    if (createdPodFileIds.length > 0) await db.delete(s.tripPodFiles).where(inArray(s.tripPodFiles.id, createdPodFileIds));
    if (createdPodSubmissionIds.length > 0) await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, createdPodSubmissionIds));
    if (createdEventIds.length > 0) await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, createdEventIds));
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdFulfillmentIds.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) {
    console.warn('[m84-evidence-status.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
