import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import {
  DriverProgressEventType,
  NotificationType,
  Role,
  TripPodFileType,
  TripPodStatus,
  TripStatus,
} from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import { ApiError } from '../errors';
import { recordDriverFulfillmentProgress } from '../services/driver.service';
import {
  attachPodFile,
  createPodSubmission,
  submitPod,
} from '../services/trip-pod.service';
import {
  getShipmentDetail,
  reviewTripPodSubmission,
  updateFulfillmentCancellationDisposition,
  updateShipment,
} from '../services/shipment.service';
import { notificationUrlForRole } from '../services/notification.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdPodStorageKeys: string[] = [];
const createdPodFileIds: number[] = [];
const createdPodSubmissionIds: number[] = [];
const createdProgressEventIds: number[] = [];
const createdTripIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdShipmentContainerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];

function samplePdfBuffer(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% phase5 ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`, 'utf8');
}

function actorFromUser(user: typeof s.users.$inferSelect): AuthUser {
  return {
    userId: user.id,
    username: user.username,
    email: null,
    fullName: null,
    role: user.role as Role,
  };
}

async function createUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `phase5-${role.toLowerCase()}-${tag}-${suffix}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function createDriverPrincipal(tag: string) {
  const user = await createUser(Role.DRIVER, tag);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id,
    name: `Phase5 Driver ${tag} ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  return { user, driver };
}

async function createBusinessUnit(tag: string) {
  const [unit] = await db.insert(s.businessUnits).values({
    code: `P5-${tag}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: `Phase5 Unit ${tag} ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdBusinessUnitIds.push(unit.id);
  return unit;
}

async function createCatalogs(tag: string) {
  const [customer] = await db.insert(s.customers).values({
    name: `Phase5 Customer ${tag} ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer.id);

  const [route] = await db.insert(s.routes).values({
    name: `Phase5 Route ${tag} ${suffix}`,
  }).returning();
  createdRouteIds.push(route.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Phase5 Cargo ${tag} ${suffix}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);

  const [containerType] = await db.insert(s.containerTypes).values({
    code: `P5${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    name: `P5 Container ${tag}`.slice(0, 50),
  }).returning();
  createdContainerTypeIds.push(containerType.id);

  return { customer, route, cargoType, containerType };
}

async function assignClerkScope(userId: number, customerId: number, businessUnitId: number) {
  await db.insert(s.userCustomerLinks).values({ userId, customerId });
  await db.insert(s.userBusinessUnitLinks).values({ userId, businessUnitId });
}

async function createShipmentFixture(args: {
  tag: string;
  cargoMode: 'LCL' | 'FCL';
  status?: typeof s.shipments.$inferSelect.status;
  responsibleUnitId?: number | null;
  containerCount?: number;
  fulfillmentCount?: number;
  canceledFulfillmentIndexes?: number[];
  canceledByUserId?: number | null;
}) {
  const catalogs = await createCatalogs(args.tag);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: catalogs.customer.id,
    routeId: catalogs.route.id,
    cargoTypeId: catalogs.cargoType.id,
    responsibleUnitId: args.responsibleUnitId ?? null,
    cargoMode: args.cargoMode,
    status: args.status ?? 'IN_PROGRESS',
    bookingRef: `P5-${args.tag}-${suffix}`,
  }).returning();
  createdShipmentIds.push(shipment.id);

  const containers: Array<typeof s.shipmentContainers.$inferSelect> = [];
  if (args.cargoMode === 'FCL') {
    const total = args.containerCount ?? Math.max(args.fulfillmentCount ?? 1, 1);
    for (let index = 0; index < total; index += 1) {
      const [container] = await db.insert(s.shipmentContainers).values({
        shipmentId: shipment.id,
        containerTypeId: catalogs.containerType.id,
        containerNumber: `MSKU${String(123456 + createdShipmentContainerIds.length).padStart(6, '0')}5`,
      }).returning();
      createdShipmentContainerIds.push(container.id);
      containers.push(container);
    }
  }

  const fulfillments: Array<typeof s.shipmentFulfillments.$inferSelect> = [];
  const totalFulfillments = args.fulfillmentCount ?? 0;
  const canceledSet = new Set(args.canceledFulfillmentIndexes ?? []);
  for (let index = 0; index < totalFulfillments; index += 1) {
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: args.cargoMode === 'FCL' ? 'FCL_CONTAINER' : 'LCL_SHIPMENT',
      cargoMode: args.cargoMode,
      shipmentContainerId: args.cargoMode === 'FCL' ? containers[index]?.id ?? null : null,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      canceledAt: canceledSet.has(index) ? new Date() : null,
      canceledBy: canceledSet.has(index) ? args.canceledByUserId ?? null : null,
      cancellationReason: canceledSet.has(index) ? 'Khách đổi phương án giao hàng' : null,
    }).returning();
    createdFulfillmentIds.push(fulfillment.id);
    fulfillments.push(fulfillment);
  }

  return {
    ...catalogs,
    shipment,
    containers,
    fulfillments,
  };
}

async function createCompletedTrip(args: {
  tag: string;
  shipmentId: number;
  fulfillmentId: number;
  customerId: number;
  routeId: number;
  cargoTypeId: number;
  driverId: number;
  status?: typeof s.trips.$inferSelect.status;
}) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `P5-${args.tag}-${createdTripIds.length + 1}`.slice(0, 50),
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    shipmentId: args.shipmentId,
    fulfillmentId: args.fulfillmentId,
    driverId: args.driverId,
    status: args.status ?? TripStatus.COMPLETED,
    departureDate: '2026-08-01',
    revenue: '1800000',
    driverSalary: '250000',
    totalFuelCost: '0',
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function rememberPodFiles(submissionId: number) {
  const rows = await db.select({
    id: s.tripPodFiles.id,
    storageKey: s.tripPodFiles.storageKey,
  }).from(s.tripPodFiles)
    .where(inArray(s.tripPodFiles.submissionId, [submissionId]));
  for (const row of rows) {
    if (!createdPodFileIds.includes(row.id)) createdPodFileIds.push(row.id);
    if (!createdPodStorageKeys.includes(row.storageKey)) createdPodStorageKeys.push(row.storageKey);
  }
}

async function createSubmittedPod(args: {
  tag: string;
  driverId: number;
  driverUserId: number;
  fulfillmentId: number;
  tripVersion: number;
}) {
  const created = await createPodSubmission({
    driverId: args.driverId,
    actorUserId: args.driverUserId,
    fulfillmentId: args.fulfillmentId,
    expectedVersion: args.tripVersion,
    idempotencyKey: `phase5-pod-create-${args.tag}-${suffix}`,
  });
  createdPodSubmissionIds.push(created.submission.id);

  const firstAttach = await attachPodFile({
    driverId: args.driverId,
    actorUserId: args.driverUserId,
    fulfillmentId: args.fulfillmentId,
    submissionId: created.submission.id,
    expectedVersion: created.submission.version,
    idempotencyKey: `phase5-pod-yard-${args.tag}-${suffix}`,
    fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
    file: {
      buffer: samplePdfBuffer(`yard-${args.tag}`),
      mimetype: 'application/pdf',
      originalname: `yard-${args.tag}.pdf`,
      size: 128,
    },
  });

  const secondAttach = await attachPodFile({
    driverId: args.driverId,
    actorUserId: args.driverUserId,
    fulfillmentId: args.fulfillmentId,
    submissionId: created.submission.id,
    expectedVersion: firstAttach.submission.version,
    idempotencyKey: `phase5-pod-note-${args.tag}-${suffix}`,
    fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
    file: {
      buffer: samplePdfBuffer(`note-${args.tag}`),
      mimetype: 'application/pdf',
      originalname: `note-${args.tag}.pdf`,
      size: 128,
    },
  });
  await rememberPodFiles(secondAttach.submission.id);

  const submitted = await submitPod({
    driverId: args.driverId,
    actorUserId: args.driverUserId,
    fulfillmentId: args.fulfillmentId,
    submissionId: created.submission.id,
    expectedVersion: secondAttach.submission.version,
    idempotencyKey: `phase5-pod-submit-${args.tag}-${suffix}`,
  });

  return submitted.submission;
}

describe('trip pod review workflow', () => {
  test('scoped clerk approval locks the trip and closes the shipment when the required fulfillment is satisfied', async () => {
    const clerkUser = await createUser(Role.CLERK, 'approve');
    const businessUnit = await createBusinessUnit('approve');
    const { user: driverUser, driver } = await createDriverPrincipal('approve');
    const fixture = await createShipmentFixture({
      tag: 'approve',
      cargoMode: 'LCL',
      responsibleUnitId: businessUnit.id,
      fulfillmentCount: 1,
    });
    await assignClerkScope(clerkUser.id, fixture.customer.id, businessUnit.id);
    const trip = await createCompletedTrip({
      tag: 'approve',
      shipmentId: fixture.shipment.id,
      fulfillmentId: fixture.fulfillments[0]!.id,
      customerId: fixture.customer.id,
      routeId: fixture.route.id,
      cargoTypeId: fixture.cargoType.id,
      driverId: driver.id,
    });
    const submitted = await createSubmittedPod({
      tag: 'approve',
      driverId: driver.id,
      driverUserId: driverUser.id,
      fulfillmentId: fixture.fulfillments[0]!.id,
      tripVersion: trip.version,
    });
    const reviewed = await reviewTripPodSubmission({
      shipmentId: fixture.shipment.id,
      submissionId: submitted.id,
      expectedVersion: submitted.version,
      resolution: 'ACCEPT',
      idempotencyKey: `phase5-review-approve-${suffix}`,
      actor: actorFromUser(clerkUser),
    });

    assert.equal(reviewed.replayed, false);
    assert.equal(reviewed.submissionStatus, TripPodStatus.ACCEPTED);
    assert.equal(reviewed.tripStatus, TripStatus.LOCKED);
    assert.equal(reviewed.shipment.status, 'CLOSED');

    const detail = await getShipmentDetail(fixture.shipment.id, actorFromUser(clerkUser));
    assert.equal(detail.podReviews.length, 1);
    assert.equal(detail.podReviews[0]?.currentSubmission?.status, TripPodStatus.ACCEPTED);
    assert.equal(detail.podReviews[0]?.tripStatus, TripStatus.LOCKED);

    const notificationRows = await db.select({
      userId: s.notifications.userId,
      relatedEntityType: s.notifications.relatedEntityType,
      relatedEntityId: s.notifications.relatedEntityId,
    }).from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_LOCKED'),
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, fixture.fulfillments[0]!.id),
    ));
    assert.deepEqual(notificationRows.map((row) => row.userId), [driverUser.id]);
    assert.equal(
      notificationUrlForRole({
        type: NotificationType.TRIP_LOCKED,
        title: 'POD đã được duyệt',
        message: 'Tài xế có thể xem lại chuyến đã khóa.',
        relatedEntityType: 'shipment_fulfillments',
        relatedEntityId: fixture.fulfillments[0]!.id,
        targetDriverId: driver.id,
      }, Role.DRIVER),
      `/my-trips/${fixture.fulfillments[0]!.id}`,
    );
  });

  test('an unresolved canceled fulfillment blocks closure until a manager marks it not required', async () => {
    const managerUser = await createUser(Role.MANAGER, 'cancel');
    const { user: driverUser, driver } = await createDriverPrincipal('cancel');
    const fixture = await createShipmentFixture({
      tag: 'cancel',
      cargoMode: 'LCL',
      fulfillmentCount: 2,
      canceledFulfillmentIndexes: [1],
      canceledByUserId: managerUser.id,
    });
    const trip = await createCompletedTrip({
      tag: 'cancel',
      shipmentId: fixture.shipment.id,
      fulfillmentId: fixture.fulfillments[0]!.id,
      customerId: fixture.customer.id,
      routeId: fixture.route.id,
      cargoTypeId: fixture.cargoType.id,
      driverId: driver.id,
    });
    const submitted = await createSubmittedPod({
      tag: 'cancel',
      driverId: driver.id,
      driverUserId: driverUser.id,
      fulfillmentId: fixture.fulfillments[0]!.id,
      tripVersion: trip.version,
    });

    const accepted = await reviewTripPodSubmission({
      shipmentId: fixture.shipment.id,
      submissionId: submitted.id,
      expectedVersion: submitted.version,
      resolution: 'ACCEPT',
      idempotencyKey: `phase5-review-cancel-${suffix}`,
      actor: actorFromUser(managerUser),
    });
    assert.equal(accepted.shipment.status, 'IN_PROGRESS');

    const disposition = await updateFulfillmentCancellationDisposition({
      shipmentId: fixture.shipment.id,
      fulfillmentId: fixture.fulfillments[1]!.id,
      expectedVersion: fixture.fulfillments[1]!.version,
      disposition: 'NOT_REQUIRED',
      reason: 'Khách hủy đầu việc, không cần thay thế.',
      actor: actorFromUser(managerUser),
      idempotencyKey: `phase5-disposition-${suffix}`,
    });

    assert.equal(disposition.replayed, false);
    assert.equal(disposition.shipment.status, 'CLOSED');

    const [updatedCanceled] = await db.select().from(s.shipmentFulfillments)
      .where(inArray(s.shipmentFulfillments.id, [fixture.fulfillments[1]!.id]));
    assert.equal(updatedCanceled?.cancellationDisposition, 'NOT_REQUIRED');
    assert.equal(updatedCanceled?.notRequiredApprovedBy, managerUser.id);
  });

  test('switching FCL to LCL clears stranded containers when no fulfillment exists', async () => {
    const fixture = await createShipmentFixture({
      tag: 'reconcile',
      cargoMode: 'FCL',
      status: 'DRAFT',
      containerCount: 2,
    });
    assert.equal(fixture.containers.length, 2);

    const updated = await updateShipment(fixture.shipment.id, {
      expectedVersion: fixture.shipment.version,
      cargoMode: 'LCL',
    });

    assert.equal(updated.cargoMode, 'LCL');

    const remaining = await db.select().from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, [fixture.shipment.id]));
    assert.equal(remaining.length, 0);
  });

  test('switching FCL to LCL is rejected after fulfillments already exist', async () => {
    const fixture = await createShipmentFixture({
      tag: 'reconcile-blocked',
      cargoMode: 'FCL',
      status: 'DRAFT',
      containerCount: 1,
      fulfillmentCount: 1,
    });

    await assert.rejects(
      () => updateShipment(fixture.shipment.id, {
        expectedVersion: fixture.shipment.version,
        cargoMode: 'LCL',
      }),
      (error: unknown) => error instanceof ApiError
        && error.statusCode === 409
        && /đã phát sinh tác vụ điều phối/i.test(error.message),
    );
  });

  test('driver progress still records the fulfillment timeline in order for submitted-pod fixtures', async () => {
    const { user: driverUser, driver } = await createDriverPrincipal('progress');
    const fixture = await createShipmentFixture({
      tag: 'progress',
      cargoMode: 'LCL',
      fulfillmentCount: 1,
    });
    const trip = await createCompletedTrip({
      tag: 'progress',
      shipmentId: fixture.shipment.id,
      fulfillmentId: fixture.fulfillments[0]!.id,
      customerId: fixture.customer.id,
      routeId: fixture.route.id,
      cargoTypeId: fixture.cargoType.id,
      driverId: driver.id,
      status: TripStatus.IN_TRANSIT,
    });

    for (const [index, eventType] of [
      DriverProgressEventType.PICKED_UP,
      DriverProgressEventType.LOADING_OR_RETURNING,
      DriverProgressEventType.DELIVERED,
    ].entries()) {
      const hour = 8 + index;
      const recorded = await recordDriverFulfillmentProgress({
        fulfillmentId: fixture.fulfillments[0]!.id,
        driverId: driver.id,
        recordedBy: driverUser.id,
        idempotencyKey: `phase5-progress-${index}-${suffix}`,
        input: {
          eventType,
          occurredAt: `2026-08-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
          expectedVersion: trip.version,
        },
      });
      createdProgressEventIds.push(recorded.event.id);
      assert.equal(recorded.replayed, false);
    }
  });
});

after(async () => {
  try {
    for (const storageKey of createdPodStorageKeys) {
      await storageService.delete(storageKey).catch(() => undefined);
    }
    if (createdPodFileIds.length > 0) {
      await db.delete(s.tripPodFiles).where(inArray(s.tripPodFiles.id, createdPodFileIds));
    }
    if (createdPodSubmissionIds.length > 0) {
      await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, createdPodSubmissionIds));
    }
    if (createdProgressEventIds.length > 0) {
      await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, createdProgressEventIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdFulfillmentIds.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
    }
    if (createdShipmentContainerIds.length > 0) {
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdShipmentContainerIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
      await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
      await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdUserIds));
      await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
    }
    if (createdBusinessUnitIds.length > 0) {
      await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
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
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (error) {
    console.warn('[trip-pod-workflow.test] cleanup partial:', (error as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
