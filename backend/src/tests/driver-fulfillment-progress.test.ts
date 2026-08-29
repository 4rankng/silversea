import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  DRIVER_FULFILLMENT_PROGRESS_SEQUENCE,
  DriverProgressEventType,
  Role,
  TripPodFileType,
  TripStatus,
} from '@tingting/shared';
import {
  DURABLE_EFFECT_KIND,
  STORAGE_DELETE_MODE,
} from '../services/durable-effect.service';

import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { config } from '../config';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  completeOwnedFulfillmentTrip,
  getCompletionEvidenceStatus,
  getDriverFulfillmentDetail,
  getDriverTrips,
  recordDriverFulfillmentProgress,
  syncDriverFulfillmentStartSideEffects,
} from '../services/driver.service';
import {
  attachPodFile,
  createPodSubmission,
  submitPod,
} from '../services/trip-pod.service';
import { storageService } from '../services/storage.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { driverWorkInbox } from '../services/work-inbox.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const originalStorageUpload = storageService.upload.bind(storageService);

const createdPodStorageKeys: string[] = [];
const createdDurableEffectJobIds: number[] = [];
const createdPodFileIds: number[] = [];
const createdPodSubmissionIds: number[] = [];
const createdTripPhotoIds: number[] = [];
const createdProgressEventIds: number[] = [];
const createdTripIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdShipmentContainerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTruckIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdPortIds: number[] = [];
const createdOperationalSiteIds: number[] = [];
const usedIdempotencyKeys: string[] = [];

function samplePdfBuffer(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% phase4 ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`, 'utf8');
}

function isoHour(hour: number, minute: number): string {
  return `2026-08-01T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

async function assertApiError(
  expectedStatus: number,
  fn: () => Promise<unknown>,
  messagePattern?: RegExp,
): Promise<ApiError> {
  try {
    await fn();
    throw new Error(`expected ApiError(${expectedStatus}) but call succeeded`);
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${(error as Error).name}`);
    assert.equal(error.statusCode, expectedStatus);
    if (messagePattern) {
      assert.match(error.message, messagePattern);
    }
    return error;
  }
}

async function createDriverPrincipal(tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `phase4-driver-${tag}-${suffix}`,
    passwordHash: 'x',
    role: 'DRIVER',
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `Phase4 Driver ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  return { user, driver };
}

async function createTruck(tag: string) {
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `QA-${tag}-${suffix}`.slice(0, 20),
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);
  return truck;
}

async function createOwnedFulfillmentTrip(
  driverId: number,
  tripStatus: TripStatus = TripStatus.IN_TRANSIT,
) {
  const [customer] = await db.insert(s.customers).values({
    name: `Phase4 customer ${suffix}-${createdCustomerIds.length + 1}`,
  }).returning();
  createdCustomerIds.push(customer.id);

  const [route] = await db.insert(s.routes).values({
    name: `Phase4 route ${suffix}-${createdRouteIds.length + 1}`,
  }).returning();
  createdRouteIds.push(route.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Phase4 cargo ${suffix}-${createdCargoTypeIds.length + 1}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    cargoMode: 'LCL',
    status: 'DISPATCHED',
    bookingRef: `BOOK-${suffix}-${createdShipmentIds.length + 1}`,
    factoryName: 'Kho VSIP',
    contactName: 'Điều phối kho',
    contactPhone: '0909000111',
  }).returning();
  createdShipmentIds.push(shipment.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {
      deliverySite: {
        id: 1,
        code: 'DEL-01',
        name: 'Bãi giao hàng',
        siteType: 'DELIVERY_SITE',
        strictRules: 'Mặc áo phản quang',
      },
    },
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `P4-${suffix}-${createdTripIds.length + 1}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    driverId,
    status: tripStatus,
    departureDate: '2026-08-01',
    revenue: '1800000',
    driverSalary: '250000',
    totalFuelCost: '0',
    carrierType: 'OWN',
    paperOrderCollectedAt: new Date('2026-08-01T07:30:00.000Z'),
    paperOrderCollectedBy: 900001,
  }).returning();
  createdTripIds.push(trip.id);
  await db.insert(s.tripExpenseCompletionScopes).values({
    tripId: trip.id,
    tripContainerId: null,
    status: 'COMPLETED',
    completedAt: new Date(),
  });

  return { customer, shipment, fulfillment, trip };
}

async function rememberPodFileStorageKeys(submissionId: number) {
  const rows = await db.select({
    id: s.tripPodFiles.id,
    storageKey: s.tripPodFiles.storageKey,
  }).from(s.tripPodFiles)
    .where(eq(s.tripPodFiles.submissionId, submissionId));
  for (const row of rows) {
    if (!createdPodFileIds.includes(row.id)) createdPodFileIds.push(row.id);
    if (!createdPodStorageKeys.includes(row.storageKey)) createdPodStorageKeys.push(row.storageKey);
  }
}

async function buildSubmittedPod(args: {
  driverId: number;
  actorUserId: number;
  fulfillmentId: number;
  expectedTripVersion: number;
  prefix: string;
}) {
  const createKey = `pod-create-${args.prefix}-${suffix}`;
  usedIdempotencyKeys.push(createKey);
  const created = await createPodSubmission({
    driverId: args.driverId,
    actorUserId: args.actorUserId,
    fulfillmentId: args.fulfillmentId,
    expectedVersion: args.expectedTripVersion,
    idempotencyKey: createKey,
  });
  createdPodSubmissionIds.push(created.submission.id);

  const firstAttachKey = `pod-attach-yard-${args.prefix}-${suffix}`;
  usedIdempotencyKeys.push(firstAttachKey);
  const firstAttach = await attachPodFile({
    driverId: args.driverId,
    actorUserId: args.actorUserId,
    fulfillmentId: args.fulfillmentId,
    submissionId: created.submission.id,
    expectedVersion: created.submission.version,
    idempotencyKey: firstAttachKey,
    fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
    file: {
      buffer: samplePdfBuffer(`yard-${args.prefix}`),
      mimetype: 'application/pdf',
      originalname: `yard-${args.prefix}.pdf`,
      size: 128,
    },
  });
  await rememberPodFileStorageKeys(firstAttach.submission.id);

  const secondAttachKey = `pod-attach-delivery-${args.prefix}-${suffix}`;
  usedIdempotencyKeys.push(secondAttachKey);
  const secondAttach = await attachPodFile({
    driverId: args.driverId,
    actorUserId: args.actorUserId,
    fulfillmentId: args.fulfillmentId,
    submissionId: created.submission.id,
    expectedVersion: firstAttach.submission.version,
    idempotencyKey: secondAttachKey,
    fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
    file: {
      buffer: samplePdfBuffer(`delivery-${args.prefix}`),
      mimetype: 'application/pdf',
      originalname: `delivery-${args.prefix}.pdf`,
      size: 128,
    },
  });
  await rememberPodFileStorageKeys(secondAttach.submission.id);

  const submitKey = `pod-submit-${args.prefix}-${suffix}`;
  usedIdempotencyKeys.push(submitKey);
  const submitted = await submitPod({
    driverId: args.driverId,
    actorUserId: args.actorUserId,
    fulfillmentId: args.fulfillmentId,
    submissionId: created.submission.id,
    expectedVersion: secondAttach.submission.version,
    idempotencyKey: submitKey,
  });

  return submitted.submission;
}

describe('Phase 4 driver fulfillment execution', () => {
  test('other driver cannot open or complete another owned fulfillment task', async () => {
    const owner = await createDriverPrincipal('owner');
    const intruder = await createDriverPrincipal('intruder');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(owner.driver.id);

    await assertApiError(404, () => getDriverFulfillmentDetail(intruder.driver.id, fulfillment.id));
    await assertApiError(404, () => completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: intruder.driver.id,
      actorUserId: intruder.user.id,
      expectedVersion: trip.version,
      idempotencyKey: `complete-other-${suffix}`,
    }));
  });

  test('driver trip list excludes canceled trips and canceled fulfillments from actionable work', async () => {
    const actor = await createDriverPrincipal('list-filters');
    const active = await createOwnedFulfillmentTrip(actor.driver.id);
    const canceledTrip = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.CANCELED);
    const canceledFulfillment = await createOwnedFulfillmentTrip(actor.driver.id);

    await db.update(s.shipmentFulfillments).set({
      canceledAt: new Date('2026-08-01T09:00:00.000Z'),
      canceledBy: actor.user.id,
      cancellationReason: 'Điều phối hủy tác vụ cũ',
    }).where(eq(s.shipmentFulfillments.id, canceledFulfillment.fulfillment.id));

    const items = await getDriverTrips(actor.driver.id);
    assert.deepEqual(items.map((item) => item.id), [active.trip.id]);

    const actionableItems = items.filter((item) => item.fulfillmentId != null);
    assert.equal(actionableItems.length, 1);

    const detail = await getDriverFulfillmentDetail(actor.driver.id, actionableItems[0]!.fulfillmentId!);
    assert.equal(detail.fulfillmentId, active.fulfillment.id);
    assert.equal(detail.tripId, active.trip.id);

    await assertApiError(404, () => getDriverFulfillmentDetail(actor.driver.id, canceledTrip.fulfillment.id));
    await assertApiError(404, () => getDriverFulfillmentDetail(actor.driver.id, canceledFulfillment.fulfillment.id));
  });

  test('driver fulfillment detail falls back to the container ports and factory when text columns and snapshot are empty', async () => {
    const actor = await createDriverPrincipal('ports-fallback');
    const [customer] = await db.insert(s.customers).values({
      name: `Phase4 ports customer ${suffix}`,
    }).returning();
    createdCustomerIds.push(customer.id);

    const [pickupPort] = await db.insert(s.ports).values({
      code: `PKP${suffix.replace(/[^A-Z0-9]/gi, '').slice(-8)}`,
      name: 'Cảng Nam Hải Đình Vũ',
    }).returning();
    const [dropoffPort] = await db.insert(s.ports).values({
      code: `DRP${suffix.replace(/[^A-Z0-9]/gi, '').slice(-8)}`,
      name: 'Bãi SITC Tân Vũ',
    }).returning();
    createdPortIds.push(pickupPort.id, dropoffPort.id);

    const [factory] = await db.insert(s.operationalSites).values({
      customerId: customer.id,
      code: `FAC${suffix.replace(/[^A-Z0-9]/gi, '').slice(-8)}`,
      name: 'Biển Bạc Hà Nam',
      siteType: 'FACTORY',
      address: 'KCN Phú Hà, Hà Nam',
      isActive: true,
    }).returning();
    createdOperationalSiteIds.push(factory.id);

    const [route] = await db.insert(s.routes).values({
      name: `Phase4 ports route ${suffix}`,
    }).returning();
    createdRouteIds.push(route.id);

    // No factoryName / pickupLocation / deliveryLocation on the shipment and
    // an empty site snapshot: the driver facts must come from the fulfillment's
    // own container (the columns CUS maintains), not stay blank.
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      status: 'DISPATCHED',
      bookingRef: `BOOK-${suffix}-pf`,
    }).returning();
    createdShipmentIds.push(shipment.id);

    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      pickupPortId: pickupPort.id,
      dropoffPortId: dropoffPort.id,
      operationalSiteId: factory.id,
    }).returning();
    createdShipmentContainerIds.push(container.id);

    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      shipmentContainerId: container.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      dispatchClassification: 'SINGLE',
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
    }).returning();
    createdFulfillmentIds.push(fulfillment.id);

    const [trip] = await db.insert(s.trips).values({
      tripCode: `P4P-${suffix}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      status: TripStatus.IN_TRANSIT,
      departureDate: '2026-08-01',
      revenue: '1800000',
      driverSalary: '250000',
      totalFuelCost: '0',
      carrierType: 'OWN',
    }).returning();
    createdTripIds.push(trip.id);

    const detail = await getDriverFulfillmentDetail(actor.driver.id, fulfillment.id);
    assert.equal(detail.pickupLocation, 'Cảng Nam Hải Đình Vũ');
    assert.equal(detail.deliveryLocation, 'Bãi SITC Tân Vũ');
    assert.equal(detail.factoryName, 'Biển Bạc Hà Nam');
  });

  test('driver fulfillment detail surfaces the factory invoice info block and container/seal photos', async () => {
    const actor = await createDriverPrincipal('invoice-photos');
    const [customer] = await db.insert(s.customers).values({
      name: `Phase4 invoice customer ${suffix}`,
    }).returning();
    createdCustomerIds.push(customer.id);

    const [factory] = await db.insert(s.operationalSites).values({
      customerId: customer.id,
      code: `INV${suffix.replace(/[^A-Z0-9]/gi, '').slice(-8)}`,
      name: 'Nhà máy Đông Anh',
      siteType: 'FACTORY',
      address: 'KCN Đông Anh, Hà Nội',
      isActive: true,
      liftFeeInvoiceName: 'Công ty Nâng Hạ Đông Anh',
      liftFeeTaxCode: '0102030405',
      dropFeeInvoiceName: 'Công ty Hạ Container Đông Anh',
      dropFeeTaxCode: '0102030406',
      cleaningInvoiceName: 'Công ty Vệ Sinh Cont Đông Anh',
      cleaningTaxCode: '0102030407',
    }).returning();
    createdOperationalSiteIds.push(factory.id);

    const [route] = await db.insert(s.routes).values({
      name: `Phase4 invoice route ${suffix}`,
    }).returning();
    createdRouteIds.push(route.id);

    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      status: 'DISPATCHED',
      bookingRef: `BOOK-${suffix}-inv`,
    }).returning();
    createdShipmentIds.push(shipment.id);

    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      operationalSiteId: factory.id,
    }).returning();
    createdShipmentContainerIds.push(container.id);

    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      shipmentContainerId: container.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      dispatchClassification: 'SINGLE',
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
    }).returning();
    createdFulfillmentIds.push(fulfillment.id);

    const [trip] = await db.insert(s.trips).values({
      tripCode: `P4I-${suffix}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      status: TripStatus.IN_TRANSIT,
      departureDate: '2026-08-01',
      revenue: '1800000',
      driverSalary: '250000',
      totalFuelCost: '0',
      carrierType: 'OWN',
    }).returning();
    createdTripIds.push(trip.id);

    const [containerPhoto] = await db.insert(s.tripPhotos).values({
      tripId: trip.id,
      type: 'CONTAINER',
      storageKey: `invoice-container-${suffix}.jpg`,
      uploadedBy: actor.user.id,
    }).returning();
    createdTripPhotoIds.push(containerPhoto.id);
    const [sealPhoto] = await db.insert(s.tripPhotos).values({
      tripId: trip.id,
      type: 'SEAL',
      storageKey: `invoice-seal-${suffix}.jpg`,
      uploadedBy: actor.user.id,
    }).returning();
    createdTripPhotoIds.push(sealPhoto.id);

    const detail = await getDriverFulfillmentDetail(actor.driver.id, fulfillment.id);
    assert.deepEqual(detail.invoiceInfo, {
      liftFeeInvoiceName: 'Công ty Nâng Hạ Đông Anh',
      liftFeeInvoiceAddress: null,
      liftFeeTaxCode: '0102030405',
      dropFeeInvoiceName: 'Công ty Hạ Container Đông Anh',
      dropFeeInvoiceAddress: null,
      dropFeeTaxCode: '0102030406',
      cleaningInvoiceName: 'Công ty Vệ Sinh Cont Đông Anh',
      cleaningInvoiceAddress: null,
      cleaningTaxCode: '0102030407',
    });
    assert.equal(detail.containerSealPhotos.length, 2);
    assert.ok(detail.containerSealPhotos.some((photo) => photo.type === 'CONTAINER' && photo.storageKey === containerPhoto.storageKey));
    assert.ok(detail.containerSealPhotos.some((photo) => photo.type === 'SEAL' && photo.storageKey === sealPhoto.storageKey));
  });

  test('driver journey board buckets an unlinked fulfillment by trip status, passing its own classification through', async () => {
    const actor = await createDriverPrincipal('journey-single');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.CREATED);

    const board = await getDriverJourneyBoard(actor.driver.id);
    const card = board.find((item) => item.fulfillmentId === fulfillment.id);
    assert.ok(card, 'expected a journey card for the created fulfillment');
    // createOwnedFulfillmentTrip seeds an LCL fulfillment — the board passes
    // the fulfillment's own label through; "single" here means unlinked.
    assert.equal(card!.classification, 'LCL');
    assert.equal(card!.linked, false);
    assert.equal(card!.bucket, 'NEW');
    assert.equal(card!.tripId, trip.id);
  });

  test('driver journey board links sibling fulfillments of a combined shipment, keeping their own classification', async () => {
    const actor = await createDriverPrincipal('journey-clamp');
    const [customer] = await db.insert(s.customers).values({
      name: `Phase4 clamp customer ${suffix}`,
    }).returning();
    createdCustomerIds.push(customer.id);

    const [route] = await db.insert(s.routes).values({
      name: `Phase4 clamp route ${suffix}`,
    }).returning();
    createdRouteIds.push(route.id);

    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      status: 'DISPATCHED',
      bookingRef: `BOOK-${suffix}-clamp`,
      isCombined: true,
    }).returning();
    createdShipmentIds.push(shipment.id);

    const fulfillmentIds: number[] = [];
    const tripIds: number[] = [];
    for (let i = 0; i < 2; i++) {
      const [container] = await db.insert(s.shipmentContainers).values({
        shipmentId: shipment.id,
        containerNumber: `CLAMPU${i}${suffix.replace(/[^0-9]/g, '').slice(-6)}`,
      }).returning();
      createdShipmentContainerIds.push(container.id);

      const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
        shipmentId: shipment.id,
        shipmentContainerId: container.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        dispatchClassification: 'COMBINED',
        sourceShipmentVersion: shipment.version,
        siteSnapshot: {},
      }).returning();
      createdFulfillmentIds.push(fulfillment.id);
      fulfillmentIds.push(fulfillment.id);

      const [trip] = await db.insert(s.trips).values({
        tripCode: `P4CL${i}-${suffix}`.slice(0, 50),
        customerId: customer.id,
        routeId: route.id,
        shipmentId: shipment.id,
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        status: i === 0 ? TripStatus.IN_TRANSIT : TripStatus.CREATED,
        departureDate: '2026-08-01',
        revenue: '1800000',
        driverSalary: '250000',
        totalFuelCost: '0',
        carrierType: 'OWN',
      }).returning();
      createdTripIds.push(trip.id);
      tripIds.push(trip.id);
    }

    const board = await getDriverJourneyBoard(actor.driver.id);
    const cards = board.filter((item) => fulfillmentIds.includes(item.fulfillmentId));
    assert.equal(cards.length, 2);
    // linked is the pairing signal; classification stays the fulfillment's own
    // label (spec tag KẾT HỢP is derived on the frontend from COMBINED).
    assert.ok(cards.every((card) => card.linked === true));
    assert.ok(cards.every((card) => card.classification === 'COMBINED'));
    assert.ok(cards.every((card) => card.shipmentId === shipment.id));
    const buckets = cards.map((card) => card.bucket).sort();
    assert.deepEqual(buckets, ['NEW', 'RUNNING']);
  });

  test('driver journey board moves a driver-completed trip to HISTORY even though trip.status stays IN_TRANSIT', async () => {
    // completeOwnedFulfillmentTrip is an operational handoff, not the governed
    // financial completion (see the O2C test below) — trips.status never
    // becomes COMPLETED from this action alone. The journey board must still
    // bucket it as HISTORY once the driver's evidence is submitted, or a
    // driver who finished their whole job would see the card stuck in
    // "Đã nhận" forever.
    const actor = await createDriverPrincipal('journey-driver-completed');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `journey-history-milestone-${index}-${suffix}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(index + 8, 30),
          expectedVersion: index === 0 ? trip.version : undefined,
        },
      });
      createdProgressEventIds.push(result.event.id);
    }

    await buildSubmittedPod({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedTripVersion: trip.version,
      prefix: 'journey-history',
    });

    const [currentTrip] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    const completeKey = `journey-history-complete-${suffix}`;
    usedIdempotencyKeys.push(completeKey);
    const completed = await completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: currentTrip!.version,
      idempotencyKey: completeKey,
    });
    assert.equal(completed.trip.status, TripStatus.COMPLETED);

    const board = await getDriverJourneyBoard(actor.driver.id);
    const card = board.find((item) => item.fulfillmentId === fulfillment.id);
    assert.ok(card, 'expected a journey card for the completed fulfillment');
    assert.equal(card!.bucket, 'HISTORY');
  });

  test('driver can accept the next order on the same truck once the previous trip evidence is complete', async () => {
    // Spec Phần 3: "Bỏ qua toàn bộ các bước xác nhận của Ops. Lái xe có thể
    // bấm Nhận lệnh vận chuyển ngay khi có lệnh đến." Driver completion is an
    // operational handoff (trip stays IN_TRANSIT until financial close), so
    // the truck-busy guard must only block on trips still genuinely running —
    // not on one whose driver already delivered milestones + submitted e-POD.
    const actor = await createDriverPrincipal('truck-free-after-evidence');
    const truck = await createTruck('free');
    const first = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.CREATED);
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, first.trip.id));

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `truck-free-milestone-${index}-${suffix}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: first.fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(index + 8, 30),
          expectedVersion: index === 0 ? first.trip.version : undefined,
        },
      });
      createdProgressEventIds.push(result.event.id);
    }
    // ORDER_RECEIVED starts the CREATED trip, bumping its version — read the
    // current version before the POD handoff.
    const [beforePod] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, first.trip.id)).limit(1);
    await buildSubmittedPod({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: first.fulfillment.id,
      expectedTripVersion: beforePod!.version,
      prefix: 'truck-free',
    });
    const [completedFirst] = await db.select({ version: s.trips.version, status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, first.trip.id)).limit(1);
    // The driver has only submitted the e-POD at this point — the trip is
    // still IN_TRANSIT. The next call to completeOwnedFulfillmentTrip flips
    // it to COMPLETED (full-close path).
    assert.equal(completedFirst!.status, TripStatus.IN_TRANSIT);
    const completeKey = `truck-free-complete-${suffix}`;
    usedIdempotencyKeys.push(completeKey);
    await completeOwnedFulfillmentTrip({
      fulfillmentId: first.fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: completedFirst!.version,
      idempotencyKey: completeKey,
    });

    // Next order on the SAME truck: acceptance must go through.
    const second = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.CREATED);
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, second.trip.id));
    const acceptKey = `truck-free-accept-${suffix}`;
    usedIdempotencyKeys.push(acceptKey);
    const accepted = await recordDriverFulfillmentProgress({
      fulfillmentId: second.fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: acceptKey,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: isoHour(19, 0),
        expectedVersion: second.trip.version,
      },
    });
    createdProgressEventIds.push(accepted.event.id);
    await syncDriverFulfillmentStartSideEffects({
      fulfillmentId: second.fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
    });
    const [startedSecond] = await db.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, second.trip.id)).limit(1);
    assert.equal(startedSecond!.status, TripStatus.IN_TRANSIT);
  });

  test('a still-running trip on the same truck keeps blocking the next departure', async () => {
    const actor = await createDriverPrincipal('truck-busy-guard');
    const truck = await createTruck('busy');
    const running = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.IN_TRANSIT);
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, running.trip.id));
    const next = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.CREATED);
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, next.trip.id));

    const acceptKey = `truck-busy-accept-${suffix}`;
    usedIdempotencyKeys.push(acceptKey);
    await assertApiError(409, () => recordDriverFulfillmentProgress({
      fulfillmentId: next.fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: acceptKey,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: isoHour(20, 0),
        expectedVersion: next.trip.version,
      },
    }), /Xe đang chạy chuyến/);
    // The rejected attempt must not have started the trip.
    const [stillCreated] = await db.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, next.trip.id)).limit(1);
    assert.equal(stillCreated!.status, TripStatus.CREATED);
  });

  test('driver fulfillment detail surfaces the site contact from the snapshot and the CUS driver notes', async () => {
    // Khối 3 (spec): tên người phụ trách kho bãi + SĐT. Khối 5: quy định tại
    // điểm làm hàng lấy từ note dành cho lái xe. The fixture shipment carries
    // its own contact, so clear it and put the contact on the site snapshot —
    // the driver payload must fall back and also expose the driver notes.
    const actor = await createDriverPrincipal('detail-contact-notes');
    const { shipment, fulfillment } = await createOwnedFulfillmentTrip(actor.driver.id);
    await db.update(s.shipments)
      .set({ contactName: null, contactPhone: null, operationalNotes: 'QA e2e: cân tại cầu 3 trước khi ra cổng' })
      .where(eq(s.shipments.id, shipment.id));
    await db.update(s.shipmentFulfillments)
      .set({
        siteSnapshot: {
          deliverySite: {
            id: 1,
            code: 'DEL-01',
            name: 'Bãi giao hàng',
            siteType: 'DELIVERY_SITE',
            strictRules: 'Mặc áo phản quang',
            contactName: 'Ms. Vân',
            contactPhone: '0909123456',
          },
        },
      })
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));

    const detail = await getDriverFulfillmentDetail(actor.driver.id, fulfillment.id);
    assert.equal(detail.contactName, 'Ms. Vân');
    assert.equal(detail.contactPhone, '0909123456');
    assert.equal(detail.driverNotes, 'QA e2e: cân tại cầu 3 trước khi ra cổng');
  });

  test('milestones are ordered and replay-safe', async () => {
    const actor = await createDriverPrincipal('ordered');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    await assertApiError(409, () => recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: `skip-delivered-${suffix}`,
      input: {
        eventType: DriverProgressEventType.DELIVERED,
        occurredAt: '2026-08-01T08:00:00.000Z',
        expectedVersion: trip.version,
      },
    }), /Mốc tiếp theo phải là/);

    const replayKey = `order-received-${suffix}`;
    usedIdempotencyKeys.push(replayKey);
    const first = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: replayKey,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: '2026-08-01T08:05:00.000Z',
        expectedVersion: trip.version,
      },
    });
    createdProgressEventIds.push(first.event.id);
    assert.equal(first.replayed, false);

    const replay = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: replayKey,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: '2026-08-01T08:05:00.000Z',
        expectedVersion: trip.version,
      },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.event.id, first.event.id);

    await assertApiError(409, () => recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: `repeat-order-received-${suffix}`,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: '2026-08-01T08:10:00.000Z',
        expectedVersion: undefined,
      },
    }), /Mốc tiếp theo phải là/);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(s.driverProgressEvents)
      .where(eq(s.driverProgressEvents.tripId, trip.id));
    assert.equal(Number(total ?? 0), 1);
  });

  test('publishes only safe driver milestones and creates replay-safe LCL/FCL delivery attempts', async () => {
    for (const scope of ['LCL', 'FCL'] as const) {
      const actor = await createDriverPrincipal(`safe-delivery-${scope.toLowerCase()}`);
      const fixture = await createOwnedFulfillmentTrip(actor.driver.id);

      let expectedContainerId: number | null = null;
      if (scope === 'FCL') {
        const [container] = await db.insert(s.shipmentContainers).values({
          shipmentId: fixture.shipment.id,
          containerNumber: `SAFE-${suffix}`.slice(0, 50),
          routeId: fixture.shipment.routeId,
          createdBy: actor.user.id,
        }).returning();
        createdShipmentContainerIds.push(container.id);
        expectedContainerId = container.id;
        await db.update(s.shipments).set({ cargoMode: 'FCL' })
          .where(eq(s.shipments.id, fixture.shipment.id));
        await db.update(s.shipmentFulfillments).set({
          cargoMode: 'FCL',
          fulfillmentType: 'FCL_CONTAINER',
          shipmentContainerId: container.id,
        }).where(eq(s.shipmentFulfillments.id, fixture.fulfillment.id));
      }

      const occurredAt = [
        '2026-08-01T08:00:00.000Z',
        '2026-08-01T09:00:00.000Z',
        '2026-08-01T10:00:00.000Z',
        '2026-08-01T11:00:00.000Z',
      ];
      let deliveredKey = '';
      let deliveredEventId = 0;
      for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
        const key = `safe-${scope}-${eventType}-${suffix}`;
        usedIdempotencyKeys.push(key);
        const result = await recordDriverFulfillmentProgress({
          fulfillmentId: fixture.fulfillment.id,
          driverId: actor.driver.id,
          recordedBy: actor.user.id,
          idempotencyKey: key,
          input: {
            eventType,
            occurredAt: occurredAt[index]!,
            note: 'PRIVATE incident expense storage://must-never-publish',
            expectedVersion: index === 0 ? fixture.trip.version : undefined,
          },
        });
        createdProgressEventIds.push(result.event.id);
        if (eventType === DriverProgressEventType.DELIVERED) {
          deliveredKey = key;
          deliveredEventId = result.event.id;
        }
      }

      const portalEvents = await db.select().from(s.customerVisibleEvents)
        .where(eq(s.customerVisibleEvents.shipmentId, fixture.shipment.id));
      assert.equal(portalEvents.length, 3, 'only pickup/loading/delivery are portal safe');
      const serialized = JSON.stringify(portalEvents.map((event) => event.contentSnapshot));
      assert.doesNotMatch(serialized, /PRIVATE|incident|expense|storage:\/\//i);
      assert.match(serialized, /Tài xế báo đã giao hàng/);
      assert.match(serialized, /chưa phải xác nhận chấp nhận giao hàng cuối cùng/);

      const [attempt] = await db.select().from(s.deliveryAttempts)
        .where(eq(s.deliveryAttempts.driverProgressEventId, deliveredEventId));
      assert.ok(attempt);
      assert.equal(attempt.shipmentContainerId, expectedContainerId);
      assert.equal(attempt.fulfillmentId, fixture.fulfillment.id);

      const inboxAfterDelivery = await driverWorkInbox(actor.driver.id, { page: 1, limit: 100 });
      const inboxItem = inboxAfterDelivery.items.find((item) => item.tripId === fixture.trip.id);
      assert.equal(inboxItem?.nextAction?.label, 'Nộp POD');
      assert.equal(inboxItem?.milestone, 'Nộp POD giao hàng');

      const replay = await recordDriverFulfillmentProgress({
        fulfillmentId: fixture.fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: deliveredKey,
        input: {
          eventType: DriverProgressEventType.DELIVERED,
          occurredAt: occurredAt[3]!,
          note: 'PRIVATE incident expense storage://must-never-publish',
          expectedVersion: undefined,
        },
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.event.id, deliveredEventId);
      const [{ attempts }] = await db.select({ attempts: sql<number>`count(*)::int` })
        .from(s.deliveryAttempts)
        .where(eq(s.deliveryAttempts.driverProgressEventId, deliveredEventId));
      assert.equal(Number(attempts), 1);

      await assertApiError(409, () => recordDriverFulfillmentProgress({
        fulfillmentId: fixture.fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: deliveredKey,
        input: {
          eventType: DriverProgressEventType.DELIVERED,
          occurredAt: '2026-08-01T11:05:00.000Z',
          note: 'different payload',
          expectedVersion: undefined,
        },
      }), /Khóa giao dịch trùng nhưng nội dung khác/);
    }
  });

  test('driver can confirm order receipt without Ops handoff while the paper-order gate is bypassed (default)', async () => {
    const actor = await createDriverPrincipal('paper-order-gate-bypassed');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    await db.update(s.trips)
      .set({
        paperOrderCollectedAt: null,
        paperOrderCollectedBy: null,
      })
      .where(eq(s.trips.id, trip.id));

    assert.equal(config.driverOpsPaperOrderGateEnabled, false);
    const { event } = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: `paper-order-gate-bypassed-${suffix}`,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: '2026-08-01T08:05:00.000Z',
        expectedVersion: trip.version,
      },
    });
    assert.equal(event.eventType, DriverProgressEventType.ORDER_RECEIVED);
  });

  test('driver cannot confirm order receipt before Ops hands over the paper order once the gate is re-enabled', async () => {
    const actor = await createDriverPrincipal('paper-order-gate-enabled');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    await db.update(s.trips)
      .set({
        paperOrderCollectedAt: null,
        paperOrderCollectedBy: null,
      })
      .where(eq(s.trips.id, trip.id));

    config.driverOpsPaperOrderGateEnabled = true;
    try {
      await assertApiError(409, () => recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: `paper-order-gate-enabled-${suffix}`,
        input: {
          eventType: DriverProgressEventType.ORDER_RECEIVED,
          occurredAt: '2026-08-01T08:05:00.000Z',
          expectedVersion: trip.version,
        },
      }), /Ops chưa xác nhận giao lệnh gốc/);
    } finally {
      config.driverOpsPaperOrderGateEnabled = false;
    }
  });

  test('Driver inbox follows order acknowledgement and waits truthfully while POD is under review', async () => {
    const actor = await createDriverPrincipal('inbox-sequence');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);
    const initial = await driverWorkInbox(actor.driver.id, { page: 1, limit: 100 });
    const initialItem = initial.items.find((item) => item.tripId === trip.id);
    assert.equal(initialItem?.nextAction?.label, 'Xác nhận đã nhận lệnh');
    assert.equal(initialItem?.milestone, 'Xác nhận đã nhận lệnh gốc');

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `inbox-sequence-${eventType}-${suffix}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: { eventType, occurredAt: isoHour(8 + index, 0), expectedVersion: index === 0 ? trip.version : undefined },
      });
      createdProgressEventIds.push(result.event.id);
    }
    const delivered = await driverWorkInbox(actor.driver.id, { page: 1, limit: 100 });
    assert.equal(delivered.items.find((item) => item.tripId === trip.id)?.nextAction?.label, 'Nộp POD');

    const [submission] = await db.insert(s.tripPodSubmissions).values({
      tripId: trip.id,
      fulfillmentId: fulfillment.id,
      submissionVersion: 1,
      sourceTripVersion: trip.version,
      status: 'SUBMITTED',
      submittedBy: actor.user.id,
      submittedAt: new Date(),
    }).returning();
    createdPodSubmissionIds.push(submission.id);
    const waiting = await driverWorkInbox(actor.driver.id, { page: 1, limit: 100 });
    const waitingItem = waiting.items.find((item) => item.tripId === trip.id);
    assert.equal(waitingItem?.state, 'WAITING');
    assert.equal(waitingItem?.milestone, 'Chờ duyệt POD');
    assert.equal(waitingItem?.nextAction, null);
  });

  test('receiving an assigned order starts the driver-owned fulfillment', async () => {
    const actor = await createDriverPrincipal('starts-owned-trip');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(
      actor.driver.id,
      TripStatus.CREATED,
    );
    const idempotencyKey = `start-owned-trip-${suffix}`;
    usedIdempotencyKeys.push(idempotencyKey);

    const result = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey,
      input: {
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        occurredAt: '2026-08-01T08:05:00.000Z',
        expectedVersion: trip.version,
      },
    });
    createdProgressEventIds.push(result.event.id);
    await syncDriverFulfillmentStartSideEffects({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
    }, async () => {});

    const [startedTrip] = await db.select({ status: s.trips.status })
      .from(s.trips)
      .where(eq(s.trips.id, trip.id))
      .limit(1);
    assert.equal(startedTrip?.status, TripStatus.IN_TRANSIT);

    const [tripDay] = await db.select({ status: s.driverWorkDays.status })
      .from(s.driverWorkDays)
      .where(and(
        eq(s.driverWorkDays.driverId, actor.driver.id),
        eq(s.driverWorkDays.tripId, trip.id),
      ))
      .limit(1);
    assert.equal(tripDay?.status, 'TRIP_DAY');
  });

  test('driver-owned start capability cannot reopen a completed trip', async () => {
    const actor = await createDriverPrincipal('cannot-reopen');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(
      actor.driver.id,
      TripStatus.COMPLETED,
    );

    await assertApiError(403, () => transitionTripStatus(
      trip.id,
      TripStatus.IN_TRANSIT,
      actor.user.id,
      Role.DRIVER,
      false,
      false,
      {
        expectedVersion: trip.version,
        driverOwnedFulfillmentStart: {
          driverId: actor.driver.id,
          fulfillmentId: fulfillment.id,
        },
      },
    ));
  });

  test('generic trip photos and incomplete POD do not satisfy completion readiness', async () => {
    const actor = await createDriverPrincipal('incomplete');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `milestone-${eventType}-${suffix}-${trip.id}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(12 + index, 0),
          expectedVersion: index === 0 ? trip.version : undefined,
        },
      });
      createdProgressEventIds.push(result.event.id);
    }

    const [photo] = await db.insert(s.tripPhotos).values({
      tripId: trip.id,
      type: 'CONTAINER',
      storageKey: `generic-photo-${suffix}-${trip.id}.jpg`,
      uploadedBy: actor.user.id,
    }).returning();
    createdTripPhotoIds.push(photo.id);

    const createKey = `incomplete-create-${suffix}`;
    usedIdempotencyKeys.push(createKey);
    const pod = await createPodSubmission({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedVersion: trip.version,
      idempotencyKey: createKey,
    });
    createdPodSubmissionIds.push(pod.submission.id);

    const attachKey = `incomplete-attach-${suffix}`;
    usedIdempotencyKeys.push(attachKey);
    const attached = await attachPodFile({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      submissionId: pod.submission.id,
      expectedVersion: pod.submission.version,
      idempotencyKey: attachKey,
      fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
      file: {
        buffer: samplePdfBuffer('only-yard'),
        mimetype: 'application/pdf',
        originalname: 'only-yard.pdf',
        size: 128,
      },
    });
    await rememberPodFileStorageKeys(attached.submission.id);

    await assertApiError(409, () => submitPod({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      submissionId: pod.submission.id,
      expectedVersion: attached.submission.version,
      idempotencyKey: `incomplete-submit-${suffix}`,
    }), /chưa đủ hồ sơ bắt buộc/);

    const evidence = await getCompletionEvidenceStatus(trip.id);
    assert.equal(evidence.ready, false);
    assert.equal(evidence.hasDeliveredMilestone, true);
    assert.equal(evidence.hasSubmittedPod, false);
    assert.ok(evidence.missing.includes('Biên bản giao nhận đã ký'));

    await assertApiError(409, () => completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: trip.version,
      idempotencyKey: `complete-before-pod-${suffix}`,
    }), /Còn thiếu/);
  });

  test('driver pod history uses driver download URLs and rollback cleanup preserves prior required evidence', async () => {
    const actor = await createDriverPrincipal('pod-history');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    const createKey = `history-create-${suffix}`;
    usedIdempotencyKeys.push(createKey);
    const created = await createPodSubmission({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedVersion: trip.version,
      idempotencyKey: createKey,
    });
    createdPodSubmissionIds.push(created.submission.id);

    const attachKey = `history-attach-${suffix}`;
    usedIdempotencyKeys.push(attachKey);
    const attached = await attachPodFile({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      submissionId: created.submission.id,
      expectedVersion: created.submission.version,
      idempotencyKey: attachKey,
      fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
      file: {
        buffer: samplePdfBuffer('history-original'),
        mimetype: 'application/pdf',
        originalname: 'history-original.pdf',
        size: 128,
      },
    });
    await rememberPodFileStorageKeys(attached.submission.id);

    const detail = await getDriverFulfillmentDetail(actor.driver.id, fulfillment.id);
    assert.ok(detail.podSubmissions.length > 0);
    assert.ok(
      detail.podSubmissions[0]?.files.every((file) =>
        file.downloadUrl.startsWith(`/api/driver/me/fulfillments/${fulfillment.id}/pod-files/`),
      ),
    );

    const [storedFile] = await db.select({
      id: s.tripPodFiles.id,
      storageKey: s.tripPodFiles.storageKey,
    }).from(s.tripPodFiles)
      .where(and(
        eq(s.tripPodFiles.submissionId, created.submission.id),
        eq(s.tripPodFiles.fileType, TripPodFileType.YARD_OR_DROP_RECEIPT),
      ))
      .limit(1);
    assert.ok(storedFile);
    const originalBuffer = await storageService.read(storedFile.storageKey);
    assert.ok(originalBuffer);

    storageService.upload = async (buffer: Buffer, key: string) => {
      await originalStorageUpload(buffer, key);
      throw new Error('forced upload failure after persistence');
    };
    try {
      await assert.rejects(
        () => attachPodFile({
          driverId: actor.driver.id,
          actorUserId: actor.user.id,
          fulfillmentId: fulfillment.id,
          submissionId: created.submission.id,
          expectedVersion: attached.submission.version,
          idempotencyKey: `history-replace-fail-${suffix}`,
          fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
          file: {
            buffer: samplePdfBuffer('history-replacement'),
            mimetype: 'application/pdf',
            originalname: 'history-replacement.pdf',
            size: 128,
          },
        }),
        /forced upload failure after persistence/,
      );
    } finally {
      storageService.upload = originalStorageUpload;
    }

    const [fileAfterFailure] = await db.select({
      id: s.tripPodFiles.id,
      storageKey: s.tripPodFiles.storageKey,
    }).from(s.tripPodFiles)
      .where(eq(s.tripPodFiles.id, storedFile.id))
      .limit(1);
    assert.equal(fileAfterFailure?.storageKey, storedFile.storageKey);

    const preservedBuffer = await storageService.read(storedFile.storageKey);
    assert.deepEqual(preservedBuffer, originalBuffer);

    const replaceSuccessKey = `history-replace-success-${suffix}`;
    usedIdempotencyKeys.push(replaceSuccessKey);
    const replaced = await attachPodFile({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      submissionId: created.submission.id,
      expectedVersion: attached.submission.version,
      idempotencyKey: replaceSuccessKey,
      fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
      file: {
        buffer: samplePdfBuffer('history-success'),
        mimetype: 'application/pdf',
        originalname: 'history-success.pdf',
        size: 128,
      },
    });
    await rememberPodFileStorageKeys(replaced.submission.id);

    const [replacedFile] = await db.select({
      storageKey: s.tripPodFiles.storageKey,
    }).from(s.tripPodFiles)
      .where(eq(s.tripPodFiles.id, storedFile.id))
      .limit(1);
    assert.ok(replacedFile);
    assert.notEqual(replacedFile.storageKey, storedFile.storageKey);

    const finalDeleteJobs = (await db.select({
      id: s.durableEffectJobs.id,
      payload: s.durableEffectJobs.payload,
    }).from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE)))
      .filter((row) => {
        const payload = row.payload as Record<string, unknown>;
        return payload.storageKey === storedFile.storageKey
          && payload.mode === STORAGE_DELETE_MODE.FINAL_DELETE;
      });
    assert.equal(finalDeleteJobs.length, 1);
    createdDurableEffectJobIds.push(...finalDeleteJobs.map((row) => row.id));
  });

  test('rejects pod uploads when a declared PDF does not match the file signature', async () => {
    const actor = await createDriverPrincipal('bad-pdf');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    const createKey = `bad-pdf-create-${suffix}`;
    usedIdempotencyKeys.push(createKey);
    const created = await createPodSubmission({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedVersion: trip.version,
      idempotencyKey: createKey,
    });
    createdPodSubmissionIds.push(created.submission.id);

    await assertApiError(400, () => attachPodFile({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      submissionId: created.submission.id,
      expectedVersion: created.submission.version,
      idempotencyKey: `bad-pdf-attach-${suffix}`,
      fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
      file: {
        buffer: Buffer.from('not a real pdf payload', 'utf8'),
        mimetype: 'application/pdf',
        originalname: 'fake.pdf',
        size: 22,
      },
    }), /không hợp lệ|không khớp định dạng/i);

    await assertApiError(400, () => attachPodFile({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      submissionId: created.submission.id,
      expectedVersion: created.submission.version,
      idempotencyKey: `bad-pdf-truncated-${suffix}`,
      fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
      file: {
        buffer: Buffer.from('%PDF-1.4\nmissing eof trailer', 'utf8'),
        mimetype: 'application/pdf',
        originalname: 'truncated.pdf',
        size: 28,
      },
    }), /không hợp lệ|không khớp định dạng/i);
  });

  test('O2C: driver completion flips the trip + shipment straight to COMPLETED (skip kế toán for now)', async () => {
    const actor = await createDriverPrincipal('valid');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `valid-milestone-${index}-${suffix}-${trip.id}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(index + 8, 30),
          expectedVersion: index === 0 ? trip.version : undefined,
        },
      });
      createdProgressEventIds.push(result.event.id);
    }

    await buildSubmittedPod({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedTripVersion: trip.version,
      prefix: 'valid',
    });

    // Driver completion is an operational handoff, not the governed financial
    // completion. The trip remains in transit while the shipment waits for
    // Accounting/CUS and the separate maker/checker approval.
    const completeKey = `complete-valid-${suffix}`;
    usedIdempotencyKeys.push(completeKey);
    const [currentTrip] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    const completed = await completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: currentTrip!.version,
      idempotencyKey: completeKey,
    });
    assert.equal(completed.trip.status, TripStatus.COMPLETED);
    const [shipment] = await db.select({ status: s.shipments.status })
      .from(s.shipments).where(eq(s.shipments.id, fulfillment.shipmentId)).limit(1);
    assert.equal(shipment?.status, 'COMPLETED');
  });

  test('driver full-close path: transitionTripStatus with driverOwnedFulfillmentClose flips an IN_TRANSIT trip to COMPLETED for the owning driver', async () => {
    // The full-close path lets the driver bypass the standard
    // podRecoveredAt / governance gates — the e-POD submission is the
    // evidence handoff. Verify the trip flips straight to COMPLETED, the
    // accounting-lock aggregate is released, and the post-update block
    // posts revenue/AP just like the Accountant/CUS path would.
    const actor = await createDriverPrincipal('driver-full-close-allow');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.IN_TRANSIT);

    // Snapshot the pre-state to assert the financial posting side-effects.
    const [preTrip] = await db.select({
      revenue: s.trips.revenue,
      driverSalary: s.trips.driverSalary,
      completedAt: s.trips.completedAt,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);

    const updated = await transitionTripStatus(
      trip.id,
      TripStatus.COMPLETED,
      actor.user.id,
      Role.DRIVER,
      true,
      true,
      {
        expectedVersion: preTrip ? trip.version : trip.version,
        driverOwnedFulfillmentClose: {
          driverId: actor.driver.id,
          fulfillmentId: fulfillment.id,
        },
      },
    );

    assert.equal(updated.status, TripStatus.COMPLETED);
    assert.ok(updated.completedAt, 'completedAt should be stamped');
    // The standard close path's financial posting still fires — revenue +
    // driver salary are persisted as before. The e-POD gate replaces the
    // podRecoveredAt + expense-scope + governance gates, not the
    // bookkeeping itself.
    const [postTrip] = await db.select({
      revenue: s.trips.revenue,
      driverSalary: s.trips.driverSalary,
      completedAt: s.trips.completedAt,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(String(postTrip!.revenue), String(preTrip!.revenue));
    assert.equal(String(postTrip!.driverSalary), String(preTrip!.driverSalary));
  });

  test('driver full-close path: rejects when the caller is not a DRIVER role', async () => {
    // The driverOwnedFulfillmentClose option is the ONLY path that grants
    // DRIVER the close permission. ADMIN/MANAGER still need
    // routineShipmentClose + governance, CUS/ACCOUNTANT need
    // routineShipmentClose. Anyone else (e.g. DISPATCHER) must hit 403.
    const actor = await createDriverPrincipal('driver-full-close-non-driver-role');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.IN_TRANSIT);

    await assertApiError(
      403,
      () => transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        actor.user.id,
        'DISPATCHER',
        true,
        true,
        {
          driverOwnedFulfillmentClose: {
            driverId: actor.driver.id,
            fulfillmentId: fulfillment.id,
          },
        },
      ),
      /chỉ lái xe/i,
    );
  });

  test('driver full-close path: rejects when the driver does not own the trip', async () => {
    // Even with the DRIVER role + driverOwnedFulfillmentClose, the trip
    // must actually belong to this driver. A driver handing in another
    // driver's fulfillmentId must be 403'd — the ownership check
    // mirrors the existing driverOwnedFulfillmentStart discipline.
    const owner = await createDriverPrincipal('driver-full-close-owner');
    const intruder = await createDriverPrincipal('driver-full-close-intruder');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(owner.driver.id, TripStatus.IN_TRANSIT);

    await assertApiError(
      403,
      () => transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        intruder.user.id,
        Role.DRIVER,
        true,
        true,
        {
          driverOwnedFulfillmentClose: {
            driverId: intruder.driver.id,
            fulfillmentId: fulfillment.id,
          },
        },
      ),
      /không sở hữu/i,
    );

    // Owner's trip status should be untouched.
    const [after] = await db.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(after!.status, TripStatus.IN_TRANSIT);
  });

  test('driver full-close path: rejects when the trip is not IN_TRANSIT (CREATED trip)', async () => {
    // The trip must already be in flight — a CREATED trip must be
    // dispatched first. This matches the existing Q18 (terminal) +
    // IN_TRANSIT precondition.
    const actor = await createDriverPrincipal('driver-full-close-created');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.CREATED);

    await assertApiError(
      409,
      () => transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        actor.user.id,
        Role.DRIVER,
        true,
        true,
        {
          driverOwnedFulfillmentClose: {
            driverId: actor.driver.id,
            fulfillmentId: fulfillment.id,
          },
        },
      ),
      /đang chạy/i,
    );
  });

  test('driver full-close path: completeOwnedFulfillmentTrip advances the shipment to COMPLETED (skip expense-scope gate)', async () => {
    // End-to-end: driver records milestones + submits e-POD, then taps
    // "HOÀN THÀNH CHUYẾN". The shipment must flip to COMPLETED even
    // though no expense-scope rows were ever touched (the user chose
    // "skip kế toán for now, we build later" — the strict
    // allCompletedAndAccepted path is bypassed).
    const actor = await createDriverPrincipal('driver-full-close-e2e');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.IN_TRANSIT);

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `full-close-e2e-milestone-${index}-${suffix}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(index + 8, 30),
          expectedVersion: index === 0 ? trip.version : undefined,
        },
      });
      createdProgressEventIds.push(result.event.id);
    }

    const [beforePod] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    await buildSubmittedPod({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedTripVersion: beforePod!.version,
      prefix: 'full-close-e2e',
    });

    // Deliberately no trip_expense_completion_scopes rows beyond the seed
    // (the createOwnedFulfillmentTrip helper pre-creates a general COMPLETED
    // scope, so we explicitly clear it to prove the driver path bypasses
    // the expense-scope check).
    await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, trip.id));

    const [beforeComplete] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    const completeKey = `full-close-e2e-complete-${suffix}`;
    usedIdempotencyKeys.push(completeKey);
    const completed = await completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: beforeComplete!.version,
      idempotencyKey: completeKey,
    });
    assert.equal(completed.trip.status, TripStatus.COMPLETED);

    const [shipment] = await db.select({ status: s.shipments.status })
      .from(s.shipments).where(eq(s.shipments.id, fulfillment.shipmentId)).limit(1);
    assert.equal(shipment?.status, 'COMPLETED');
  });

  test('driver full-close path: multi-fulfillment partial close advances shipment to PENDING_EXPENSE_APPROVAL (not stuck at DISPATCHED)', async () => {
    // Field-reported regression 2026-08-29: when a shipment has multiple
    // required fulfillments but only the driver-owned one has a trip, the
    // original `allCompletedViaDriverClose` branch required EVERY
    // required fulfillment to have a COMPLETED trip — so the shipment
    // stayed at DISPATCHED (and the CUS badge read "Đang chạy") even
    // though this trip was actually done. The fix adds an
    // `anyFulfillmentCompletedViaDriver` branch that lifts the shipment
    // to PENDING_EXPENSE_APPROVAL when at least one driver-closed trip
    // is complete; the remaining planned carriers stay on the container
    // badge as PLANNED.
    const actor = await createDriverPrincipal('driver-full-close-multi-fulfillment');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.IN_TRANSIT);

    // Add a second FCL_CONTAINER fulfillment for the same shipment —
    // mirrors the field scenario (shipment 77 had 3 fulfillments, only
    // 1 had a trip). The second fulfillment stays un-tripped (planned
    // carrier allocation only) and must NOT block the close.
    const [secondContainer] = await db.insert(s.shipmentContainers).values({
      shipmentId: fulfillment.shipmentId,
      containerTypeId: 1,
      containerNumber: `MULTI-${suffix}`,
      routeId: 1,
      customerAppointmentAt: new Date('2026-09-05T08:00:00.000Z'),
    }).returning();
    createdShipmentContainerIds.push(secondContainer.id);
    const [secondFulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: fulfillment.shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: secondContainer.id,
      sourceShipmentVersion: 1,
      plannedCarrierType: 'OWN',
    }).returning();
    createdFulfillmentIds.push(secondFulfillment.id);

    for (const [index, eventType] of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.entries()) {
      const key = `multi-close-milestone-${index}-${suffix}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(index + 8, 30),
          expectedVersion: index === 0 ? trip.version : undefined,
        },
      });
      createdProgressEventIds.push(result.event.id);
    }

    const [beforePod] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    await buildSubmittedPod({
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      fulfillmentId: fulfillment.id,
      expectedTripVersion: beforePod!.version,
      prefix: 'multi-close',
    });

    // Delete the expense-scope row so the path is unambiguously bypassing
    // the strict gates (matches the e2e helper's intent).
    await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, trip.id));

    const [beforeComplete] = await db.select({ version: s.trips.version })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    const completeKey = `multi-close-complete-${suffix}`;
    usedIdempotencyKeys.push(completeKey);
    const completed = await completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: beforeComplete!.version,
      idempotencyKey: completeKey,
    });
    assert.equal(completed.trip.status, TripStatus.COMPLETED);

    // The shipment must advance to PENDING_EXPENSE_APPROVAL (not stay at
    // DISPATCHED, not jump to COMPLETED) — the second planned carrier
    // has no trip yet, so the full COMPLETED gate is still pending.
    const [shipment] = await db.select({ status: s.shipments.status })
      .from(s.shipments).where(eq(s.shipments.id, fulfillment.shipmentId)).limit(1);
    assert.equal(shipment?.status, 'PENDING_EXPENSE_APPROVAL');
  });

  test('recompute: every required fulfillment\'s trip is CANCELED, current IN_TRANSIT rewinds to DISPATCHED (27.8 trial regression 2026-08-29)', async () => {
    // Field-reported symptom: shipment 263800 sat at IN_TRANSIT forever
    // because its only required fulfillment's trip was CANCELED and the
    // recompute branches (allCompletedViaDriverClose, allCompletedAndAccepted,
    // allAwaitingApproval, anyFulfillmentCompletedViaDriver, anyInTransit)
    // all missed — no transition fired. CUS/Dispatcher kept reading
    // "Đang chạy" indefinitely. The fix adds a rewind-to-DISPATCHED branch
    // when current=IN_TRANSIT and no progress branch can fire, so the
    // planner's queue surfaces the lot for re-allocation.
    const actor = await createDriverPrincipal('all-canceled-rewind');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id, TripStatus.IN_TRANSIT);

    // Force the recompute path that produced the field symptom: a CANCELED
    // trip on the only required fulfillment, while the shipment is at
    // IN_TRANSIT (the lifecycle was advanced when the trip first departed).
    await db.update(s.trips).set({ status: TripStatus.CANCELED, deletedAt: null })
      .where(eq(s.trips.id, trip.id));
    await db.update(s.shipmentFulfillments).set({ canceledAt: null })
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    // Drive the recompute by touching the trip's update timestamp so the
    // recompute is invoked; in production this is called on every trip
    // status transition via `transitionTripStatus`.
    const { recomputeShipmentCompletion } = await import('../services/shipment.service.js');
    await recomputeShipmentCompletion(fulfillment.shipmentId, { changedBy: actor.user.id });

    const [shipment] = await db.select({ status: s.shipments.status })
      .from(s.shipments).where(eq(s.shipments.id, fulfillment.shipmentId)).limit(1);
    assert.equal(shipment?.status, 'DISPATCHED',
      'IN_TRANSIT with every required trip CANCELED must rewind to DISPATCHED so the planner queue surfaces the lot');
  });

  test('driver fulfillment detail falls back to site snapshot for pickup / drop / factory when top-level columns are null', async () => {
    // The driver portal renders Điểm lấy / Điểm trả / Nhà máy in the trip
    // detail header. Top-level `pickupLocation` / `deliveryLocation` /
    // `factoryName` columns are not always populated for every LCL fulfillment,
    // but the siteSnapshot always carries the human-readable site names that
    // CUS selected. The projection must fall back to the snapshot so the
    // driver never sees an em-dash for a real, known location.
    const actor = await createDriverPrincipal('site-fallback');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    // Wipe the top-level columns so the fallback path is the only source.
    await db.update(s.shipments).set({
      pickupLocation: null,
      deliveryLocation: null,
      factoryName: null,
    }).where(eq(s.shipments.id, fulfillment.shipmentId));

    // Augment the snapshot with a pickup warehouse so we can assert the
    // pickup-side fallback as well.
    const [currentFulfillment] = await db.select({
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
    }).from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)).limit(1);
    await db.update(s.shipmentFulfillments).set({
      siteSnapshot: {
        ...((currentFulfillment?.siteSnapshot as Record<string, unknown> | null) ?? {}),
        pickupWarehouse: {
          id: 99,
          code: 'PWH-99',
          name: 'Kho lấy hàng Hà Nội',
          siteType: 'WAREHOUSE',
          strictRules: 'Gọi trước khi vào',
        },
      },
    }).where(eq(s.shipmentFulfillments.id, fulfillment.id));

    const detail = await getDriverFulfillmentDetail(actor.driver.id, fulfillment.id);

    assert.equal(detail.pickupLocation, 'Kho lấy hàng Hà Nội',
      'pickupLocation must fall back to siteSnapshot.pickupWarehouse.name');
    assert.equal(detail.deliveryLocation, 'Bãi giao hàng',
      'deliveryLocation must fall back to siteSnapshot.deliverySite.name');
    assert.equal(detail.factoryName, 'Bãi giao hàng',
      'factoryName must fall back to siteSnapshot.deliverySite.name when top-level is null');

    // Sanity: the snapshot projection still works for the UI.
    const deliverySite = detail.siteSnapshot.deliverySite as { name?: string } | null;
    const pickupWarehouse = detail.siteSnapshot.pickupWarehouse as { name?: string } | null;
    assert.equal(deliverySite?.name, 'Bãi giao hàng');
    assert.equal(pickupWarehouse?.name, 'Kho lấy hàng Hà Nội');

    // Touch trip.version so the linter doesn't complain about an unused value.
    assert.ok(trip.version >= 0);
  });
});

after(async () => {
  storageService.upload = originalStorageUpload;
  try {
    for (const storageKey of createdPodStorageKeys) {
      await storageService.delete(storageKey).catch(() => undefined);
    }
    if (usedIdempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, usedIdempotencyKeys));
    }
    if (createdDurableEffectJobIds.length > 0) {
      await db.delete(s.durableEffectJobs).where(inArray(s.durableEffectJobs.id, createdDurableEffectJobIds));
    }
    if (createdTripPhotoIds.length > 0) {
      await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.id, createdTripPhotoIds));
    }
    if (createdPodFileIds.length > 0) {
      await db.delete(s.tripPodFiles).where(inArray(s.tripPodFiles.id, createdPodFileIds));
    }
    if (createdPodSubmissionIds.length > 0) {
      await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, createdPodSubmissionIds));
    }
    if (createdProgressEventIds.length > 0) {
      await db.delete(s.deliveryAttempts).where(inArray(s.deliveryAttempts.driverProgressEventId, createdProgressEventIds));
      await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, createdProgressEventIds));
    }
    if (createdTripIds.length > 0) {
      if (createdShipmentIds.length > 0) {
        await db.delete(s.customerVisibleEvents).where(inArray(s.customerVisibleEvents.shipmentId, createdShipmentIds));
      }
      await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.tripId, createdTripIds));
      await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdTripIds));
      await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, createdTripIds));
      await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, createdTripIds));
      await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, createdTripIds));
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdTruckIds.length > 0) {
      await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    }
    if (createdFulfillmentIds.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
    }
    if (createdShipmentContainerIds.length > 0) {
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdShipmentContainerIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdOperationalSiteIds.length > 0) {
      await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdOperationalSiteIds));
    }
    if (createdPortIds.length > 0) {
      await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (error) {
    console.warn('[driver-fulfillment-progress.test] cleanup partial:', (error as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  // Same convention as trip-pod-workflow.test.ts: the notification/durable-
  // effect machinery touched by the accept-and-complete flows keeps a lazy
  // handle alive, so exit explicitly once cleanup is done.
  process.exit(0);
});
