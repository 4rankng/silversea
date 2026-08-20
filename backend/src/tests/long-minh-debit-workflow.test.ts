import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import type { SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { generateDraft, saveDocument } from '../services/billing-document.service';

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const postingIds: number[] = [];
const declarationIds: number[] = [];
const podSubmissionIds: number[] = [];

let actorId = 0;

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `long-minh-debit-${Date.now()}`,
    passwordHash: 'x',
    role: 'ADMIN',
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;
  actorIds.push(actor.id);
});

after(async () => {
  if (podSubmissionIds.length > 0) {
    await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
  }
  if (declarationIds.length > 0) {
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.id, declarationIds));
  }
  if (postingIds.length > 0) {
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (fulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  }
  if (shipmentIds.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  if (cargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }
  await client.end();
});

async function createBaseCustomerScope(label: string) {
  const [customer] = await db.insert(s.customers).values({
    name: `Long Minh ${label} ${Date.now()}`,
    status: 'ACTIVE',
    debitNoteMode: 'MONTHLY',
  }).returning();
  const [route] = await db.insert(s.routes).values({
    name: `Tuyến Long Minh ${label} ${Date.now()}`,
  }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Cargo Long Minh ${label} ${Date.now()}`,
  }).returning();
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(cargoType.id);
  return { customer, route, cargoType };
}

async function createTripFixture(input: {
  customerId: number;
  routeId: number;
  cargoTypeId: number;
  tripStatus: 'COMPLETED';
  podStatus: 'ACCEPTED' | 'SUBMITTED';
  withFulfillment?: boolean;
  tradeDirection?: 'IMPORT' | 'EXPORT';
  tripCode: string;
}) {
  let shipmentId: number | null = null;
  let fulfillmentId: number | null = null;

  if (input.withFulfillment !== false) {
    const [shipment] = await db.insert(s.shipments).values({
      shipmentCode: `${input.tripCode}-SHP`,
      customerId: input.customerId,
      routeId: input.routeId,
      cargoTypeId: input.cargoTypeId,
      status: 'NEW',
      cargoMode: 'LCL',
      tradeDirection: input.tradeDirection ?? 'IMPORT',
      blNumber: `BL-${input.tripCode}`,
      factoryName: 'Nhà máy Long Minh',
      expectedDeliveryDate: '2026-07-15',
      cargoVolumeCbm: '68.000',
      packageCount: 1,
      packageType: 'cont',
      createdBy: actorId,
      updatedBy: actorId,
    }).returning();
    shipmentIds.push(shipment.id);
    shipmentId = shipment.id;

    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'LCL_SHIPMENT',
      cargoMode: 'LCL',
      dispatchClassification: 'LCL',
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      createdBy: actorId,
    }).returning();
    fulfillmentIds.push(fulfillment.id);
    fulfillmentId = fulfillment.id;

    const [declaration] = await db.insert(s.shipmentDeclarations).values({
      shipmentId: shipment.id,
      declarationNumber: `TK-${input.tripCode}`,
      issuedAt: new Date('2026-07-14T08:00:00.000Z'),
      scope: 'SINGLE',
      createdBy: actorId,
    }).returning({ id: s.shipmentDeclarations.id });
    declarationIds.push(declaration.id);
  }

  const [trip] = await db.insert(s.trips).values({
    tripCode: input.tripCode,
    customerId: input.customerId,
    routeId: input.routeId,
    cargoTypeId: input.cargoTypeId,
    shipmentId,
    fulfillmentId,
    departureDate: '2026-07-12',
    completedAt: new Date('2026-07-15T10:00:00.000Z'),
    status: input.tripStatus,
    revenue: '2000000',
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);

  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: trip.completedAt!,
  }).returning({ id: s.tripFinancialPostings.id });
  postingIds.push(posting.id);

  if (shipmentId && fulfillmentId) {
    const [submission] = await db.insert(s.tripPodSubmissions).values({
      tripId: trip.id,
      fulfillmentId,
      submissionVersion: 1,
      sourceTripVersion: trip.version,
      status: input.podStatus,
      submittedBy: actorId,
      submittedAt: new Date('2026-07-15T12:00:00.000Z'),
      reviewedBy: input.podStatus === 'ACCEPTED' ? actorId : null,
      reviewedAt: input.podStatus === 'ACCEPTED' ? new Date('2026-07-15T13:00:00.000Z') : null,
      rejectionReason: null,
    }).returning({ id: s.tripPodSubmissions.id });
    podSubmissionIds.push(submission.id);
  }

  return trip;
}

function toSaveInput(draft: Awaited<ReturnType<typeof generateDraft>>): SaveBillingDocumentInput {
  return {
    ...draft,
    note: null,
    lines: draft.lines.map((line) => ({
      ...line,
      renderData: line.renderData ? { ...line.renderData } : null,
    })),
  };
}

test('generateDraft only includes Long Minh trips that are COMPLETED and e-POD accepted, with blocked summary', async () => {
  const { customer, route, cargoType } = await createBaseCustomerScope('draft');
  const eligibleTrip = await createTripFixture({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    tripStatus: 'COMPLETED',
    podStatus: 'ACCEPTED',
    tripCode: `LM-OK-${Date.now()}`.slice(0, 50),
  });
  await createTripFixture({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    tripStatus: 'COMPLETED',
    podStatus: 'SUBMITTED',
    tripCode: `LM-POD-${Date.now()}`.slice(0, 50),
  });
  // O2C: COMPLETED is the single billable state. A COMPLETED trip with no
  // fulfillment linkage has no e-POD authority and stays blocked.
  await createTripFixture({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    tripStatus: 'COMPLETED',
    podStatus: 'ACCEPTED',
    withFulfillment: false,
    tripCode: `LM-NOFUL-${Date.now()}`.slice(0, 50),
  });

  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });

  assert.equal(draft.eligibilitySummary?.includedTripCount, 1);
  assert.equal(draft.eligibilitySummary?.blockedTrips.length, 2);
  assert.equal(draft.lines.filter((line) => line.sourceType === 'TRIP').length, 1);
  assert.equal(draft.lines[0]?.sourceId, eligibleTrip.id);
  assert.equal(draft.lines[0]?.renderData?.factoryName, 'Nhà máy Long Minh');
  assert.equal(draft.lines[0]?.renderData?.declarationNumber, `TK-${eligibleTrip.tripCode}`);
  assert.ok(draft.eligibilitySummary?.blockedTrips.some((trip) => /e-POD|chưa gắn fulfillment/i.test(trip.reason)));
  assert.ok(draft.eligibilitySummary?.blockedTrips.some((trip) => trip.reason.includes('đang chờ duyệt')));
});

test('saveDocument rejects when a drafted Long Minh trip loses accepted e-POD eligibility before save', async () => {
  const { customer, route, cargoType } = await createBaseCustomerScope('save');
  const trip = await createTripFixture({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    tripStatus: 'COMPLETED',
    podStatus: 'ACCEPTED',
    tripCode: `LM-SAVE-${Date.now()}`.slice(0, 50),
  });

  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });

  const [acceptedSubmission] = await db.select({
    id: s.tripPodSubmissions.id,
  }).from(s.tripPodSubmissions)
    .where(inArray(s.tripPodSubmissions.tripId, [trip.id]))
    .limit(1);
  const [rejectedSubmission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: trip.fulfillmentId!,
    submissionVersion: 2,
    sourceTripVersion: trip.version,
    status: 'REJECTED',
    supersedesSubmissionId: acceptedSubmission.id,
    submittedBy: actorId,
    submittedAt: new Date('2026-07-15T14:00:00.000Z'),
    reviewedBy: actorId,
    reviewedAt: new Date('2026-07-15T15:00:00.000Z'),
    rejectionReason: 'Thiếu chữ ký bên nhận',
  }).returning({ id: s.tripPodSubmissions.id });
  podSubmissionIds.push(rejectedSubmission.id);

  await assert.rejects(
    () => saveDocument(toSaveInput(draft), actorId),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /e-POD bị từ chối/);
      return true;
    },
  );
});
