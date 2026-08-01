import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  DRIVER_FULFILLMENT_PROGRESS_SEQUENCE,
  DriverProgressEventType,
  TripPodFileType,
  TxnType,
} from '@tingting/shared';
import {
  DURABLE_EFFECT_KIND,
  STORAGE_DELETE_MODE,
} from '../services/durable-effect.service';

import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  completeOwnedFulfillmentTrip,
  getCompletionEvidenceStatus,
  getDriverFulfillmentDetail,
  recordDriverFulfillmentProgress,
} from '../services/driver.service';
import {
  attachPodFile,
  createPodSubmission,
  submitPod,
} from '../services/trip-pod.service';
import { storageService } from '../services/storage.service';

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
const createdShipmentIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
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

async function createOwnedFulfillmentTrip(driverId: number) {
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
    status: 'IN_PROGRESS',
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
    status: 'IN_TRANSIT',
    departureDate: '2026-08-01',
    revenue: '1800000',
    driverSalary: '250000',
    totalFuelCost: '0',
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);

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

    const replayKey = `picked-up-${suffix}`;
    usedIdempotencyKeys.push(replayKey);
    const first = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      recordedBy: actor.user.id,
      idempotencyKey: replayKey,
      input: {
        eventType: DriverProgressEventType.PICKED_UP,
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
        eventType: DriverProgressEventType.PICKED_UP,
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
      idempotencyKey: `repeat-picked-up-${suffix}`,
      input: {
        eventType: DriverProgressEventType.PICKED_UP,
        occurredAt: '2026-08-01T08:10:00.000Z',
        expectedVersion: trip.version,
      },
    }), /Mốc tiếp theo phải là/);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(s.driverProgressEvents)
      .where(eq(s.driverProgressEvents.tripId, trip.id));
    assert.equal(Number(total ?? 0), 1);
  });

  test('generic trip photos and incomplete POD do not satisfy completion readiness', async () => {
    const actor = await createDriverPrincipal('incomplete');
    const { fulfillment, trip } = await createOwnedFulfillmentTrip(actor.driver.id);

    for (const eventType of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE) {
      const key = `milestone-${eventType}-${suffix}-${trip.id}`;
      usedIdempotencyKeys.push(key);
      const result = await recordDriverFulfillmentProgress({
        fulfillmentId: fulfillment.id,
        driverId: actor.driver.id,
        recordedBy: actor.user.id,
        idempotencyKey: key,
        input: {
          eventType,
          occurredAt: isoHour(createdProgressEventIds.length + 8, 0),
          expectedVersion: trip.version,
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

  test('valid owned fulfillment completes once and posts one financial version', async () => {
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
          expectedVersion: trip.version,
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

    const completeKey = `complete-valid-${suffix}`;
    usedIdempotencyKeys.push(completeKey);
    const firstCompletion = await completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: trip.version,
      idempotencyKey: completeKey,
    });
    assert.equal(firstCompletion.replayed, false);
    assert.equal(firstCompletion.trip.status, 'COMPLETED');

    const replayCompletion = await completeOwnedFulfillmentTrip({
      fulfillmentId: fulfillment.id,
      driverId: actor.driver.id,
      actorUserId: actor.user.id,
      expectedVersion: trip.version,
      idempotencyKey: completeKey,
    });
    assert.equal(replayCompletion.replayed, true);
    assert.equal(replayCompletion.trip.tripId, firstCompletion.trip.tripId);

    const [{ postingCount }] = await db.select({
      postingCount: sql<number>`count(*)::int`,
    }).from(s.tripFinancialPostings)
      .where(eq(s.tripFinancialPostings.tripId, trip.id));
    assert.equal(Number(postingCount ?? 0), 1);

    const revenueRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnId, trip.id),
        eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
      ));
    assert.equal(revenueRows.length, 1);
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
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdFulfillmentIds.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
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
  process.exit(0);
});
