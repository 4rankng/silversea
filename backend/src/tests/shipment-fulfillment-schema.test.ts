import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newEnforcer } from 'casbin';
import { eq, inArray } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import {
  createShipmentFulfillments,
  isFulfillmentRequired,
} from '../services/shipment-fulfillment.service';
import { assertDispatchableDriverPrincipal } from '../services/driver.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const userIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const driverIds: number[] = [];
const operationalSiteIds: number[] = [];
const masterImportBatchIds: number[] = [];

async function createActor(role: Role = Role.ADMIN, status = 'ACTIVE') {
  const [user] = await db.insert(s.users).values({
    username: `fulfillment-admin-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role,
    status,
  }).returning();
  userIds.push(user.id);
  return user;
}

async function createCustomer() {
  const [customer] = await db.insert(s.customers).values({
    name: `Fulfillment customer ${suffix}-${customerIds.length}`,
  }).returning();
  customerIds.push(customer.id);
  return customer;
}

async function createShipmentFixture(
  cargoMode: 'FCL' | 'LCL',
  actorId: number,
  customerId: number,
  containerCount = cargoMode === 'FCL' ? 1 : 0,
) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    cargoMode,
    shipmentCode: `FUL-${suffix}-${shipmentIds.length}`,
    createdBy: actorId,
  }).returning();
  shipmentIds.push(shipment.id);
  const containers = containerCount > 0
    ? await db.insert(s.shipmentContainers).values(
      Array.from({ length: containerCount }, (_, index) => ({
        shipmentId: shipment.id,
        containerNumber: `TEST-${shipment.id}-${index + 1}`,
        createdBy: actorId,
      })),
    ).returning()
    : [];
  return { shipment, containers };
}

function expectApiConflict(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 409;
}

function expectDatabaseConstraint(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code
    ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23505' || code === '23503' || code === '23514';
}

describe('shipment fulfillment decomposition authority', () => {
  test('rejects non-dispatch roles before creating or replaying fulfillments', async () => {
    const driver = await createActor(Role.DRIVER);
    const customer = await createCustomer();
    const { shipment } = await createShipmentFixture('FCL', driver.id, customer.id, 1);

    await assert.rejects(
      createShipmentFulfillments({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: `driver-decompose-${suffix}`,
        actorId: driver.id,
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 403,
    );
    const rows = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    assert.equal(rows.length, 0);
  });

  test('FCL creates exactly one fulfillment per container and same-key replay is stable', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const { shipment, containers } = await createShipmentFixture('FCL', actor.id, customer.id, 2);

    const first = await createShipmentFulfillments({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: `fcl-${suffix}`,
      actorId: actor.id,
    });
    const replay = await createShipmentFulfillments({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: `fcl-${suffix}`,
      actorId: actor.id,
    });

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, first.result);
    assert.deepEqual(
      first.result.map((row) => row.shipmentContainerId).sort((a, b) => (a ?? 0) - (b ?? 0)),
      containers.map((row) => row.id).sort((a, b) => a - b),
    );
  });

  test('different concurrent keys still converge on one FCL decomposition', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const { shipment } = await createShipmentFixture('FCL', actor.id, customer.id, 3);

    const [left, right] = await Promise.all([
      createShipmentFulfillments({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: `race-left-${suffix}`,
        actorId: actor.id,
      }),
      createShipmentFulfillments({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: `race-right-${suffix}`,
        actorId: actor.id,
      }),
    ]);
    const rows = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));

    assert.equal(rows.length, 3);
    assert.deepEqual(left.result.map((row) => row.id), right.result.map((row) => row.id));
  });

  test('same-key concurrent calls execute once and replay the same decomposition', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const { shipment } = await createShipmentFixture('FCL', actor.id, customer.id, 2);
    const command = {
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: `same-key-race-${suffix}`,
      actorId: actor.id,
    };

    const [left, right] = await Promise.all([
      createShipmentFulfillments(command),
      createShipmentFulfillments(command),
    ]);
    assert.deepEqual(left.result, right.result);
    assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
  });

  test('LCL creates one shipment-level fulfillment and rejects stale or conflicting commands', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const { shipment } = await createShipmentFixture('LCL', actor.id, customer.id);
    const idempotencyKey = `lcl-${suffix}`;

    const first = await createShipmentFulfillments({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey,
      actorId: actor.id,
    });
    assert.equal(first.result.length, 1);
    assert.equal(first.result[0]?.fulfillmentType, 'LCL_SHIPMENT');
    assert.equal(first.result[0]?.shipmentContainerId, null);

    await assert.rejects(
      createShipmentFulfillments({
        shipmentId: shipment.id,
        expectedVersion: shipment.version + 1,
        idempotencyKey,
        actorId: actor.id,
      }),
      expectApiConflict,
    );
    await assert.rejects(
      createShipmentFulfillments({
        shipmentId: shipment.id,
        expectedVersion: shipment.version + 1,
        idempotencyKey: `${idempotencyKey}-stale`,
        actorId: actor.id,
      }),
      expectApiConflict,
    );
  });
});

describe('database cardinality and scope constraints', () => {
  test('keeps sensitive site contacts and billing identity out of the default fulfillment DTO', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const [site] = await db.insert(s.operationalSites).values({
      customerId: customer.id,
      code: `PRIVATE-${suffix}`,
      name: `Private site ${suffix}`,
      siteType: 'FACTORY',
      address: 'Khu công nghiệp thử nghiệm',
      contactName: 'Private Contact',
      contactPhone: '0900000000',
      liftFeeInvoiceName: 'Private Billing Entity',
      liftFeeTaxCode: '0100000000',
      strictRules: 'Gọi trước khi vào kho',
      createdBy: actor.id,
    }).returning();
    operationalSiteIds.push(site.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      cargoMode: 'LCL',
      shipmentCode: `PRIVATE-SITE-${suffix}`,
      operationalSiteId: site.id,
      createdBy: actor.id,
    }).returning();
    shipmentIds.push(shipment.id);

    const result = await createShipmentFulfillments({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: `private-site-${suffix}`,
      actorId: actor.id,
    });
    const serialized = JSON.stringify(result.result[0]?.siteSnapshot);
    assert.match(serialized, /Gọi trước khi vào kho/);
    assert.doesNotMatch(serialized, /Private Contact|0900000000|Private Billing Entity|0100000000/);

    const [stored] = await db.select({ siteSnapshot: s.shipmentFulfillments.siteSnapshot })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, result.result[0]!.id));
    assert.match(JSON.stringify(stored.siteSnapshot), /Private Contact|Private Billing Entity/);
  });

  test('rejects an operational site owned by another customer', async () => {
    const actor = await createActor();
    const shipmentCustomer = await createCustomer();
    const otherCustomer = await createCustomer();
    const [site] = await db.insert(s.operationalSites).values({
      customerId: otherCustomer.id,
      code: `SITE-${suffix}`,
      name: `Other customer site ${suffix}`,
      siteType: 'FACTORY',
      address: 'Khu công nghiệp thử nghiệm',
      createdBy: actor.id,
    }).returning();
    operationalSiteIds.push(site.id);

    await assert.rejects(
      db.insert(s.shipments).values({
        customerId: shipmentCustomer.id,
        cargoMode: 'LCL',
        shipmentCode: `SITE-SCOPE-${suffix}`,
        operationalSiteId: site.id,
        createdBy: actor.id,
      }),
      expectDatabaseConstraint,
    );
  });

  test('rejects duplicate active FCL/LCL fulfillments and cross-shipment container links', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const first = await createShipmentFixture('FCL', actor.id, customer.id, 1);
    const second = await createShipmentFixture('FCL', actor.id, customer.id, 1);
    const lcl = await createShipmentFixture('LCL', actor.id, customer.id);
    await createShipmentFulfillments({
      shipmentId: first.shipment.id,
      expectedVersion: first.shipment.version,
      idempotencyKey: `constraint-fcl-${suffix}`,
      actorId: actor.id,
    });
    await createShipmentFulfillments({
      shipmentId: lcl.shipment.id,
      expectedVersion: lcl.shipment.version,
      idempotencyKey: `constraint-lcl-${suffix}`,
      actorId: actor.id,
    });

    await assert.rejects(
      db.insert(s.shipmentFulfillments).values({
        shipmentId: first.shipment.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: first.containers[0]!.id,
        sourceShipmentVersion: first.shipment.version,
        createdBy: actor.id,
      }),
      expectDatabaseConstraint,
    );
    await assert.rejects(
      db.insert(s.shipmentFulfillments).values({
        shipmentId: lcl.shipment.id,
        fulfillmentType: 'LCL_SHIPMENT',
        cargoMode: 'LCL',
        sourceShipmentVersion: lcl.shipment.version,
        createdBy: actor.id,
      }),
      expectDatabaseConstraint,
    );
    await assert.rejects(
      db.insert(s.shipmentFulfillments).values({
        shipmentId: first.shipment.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: second.containers[0]!.id,
        sourceShipmentVersion: first.shipment.version,
        createdBy: actor.id,
      }),
      expectDatabaseConstraint,
    );
  });

  test('enforces shipment cargo mode at the database boundary and blocks mode drift', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const fcl = await createShipmentFixture('FCL', actor.id, customer.id, 1);
    const lcl = await createShipmentFixture('LCL', actor.id, customer.id);

    await assert.rejects(
      db.insert(s.shipmentFulfillments).values({
        shipmentId: fcl.shipment.id,
        cargoMode: 'LCL',
        fulfillmentType: 'LCL_SHIPMENT',
        sourceShipmentVersion: fcl.shipment.version,
        createdBy: actor.id,
      }),
      expectDatabaseConstraint,
    );
    await assert.rejects(
      db.insert(s.shipmentFulfillments).values({
        shipmentId: lcl.shipment.id,
        cargoMode: 'FCL',
        fulfillmentType: 'FCL_CONTAINER',
        shipmentContainerId: fcl.containers[0]!.id,
        sourceShipmentVersion: lcl.shipment.version,
        createdBy: actor.id,
      }),
      expectDatabaseConstraint,
    );

    await createShipmentFulfillments({
      shipmentId: fcl.shipment.id,
      expectedVersion: fcl.shipment.version,
      idempotencyKey: `mode-drift-${suffix}`,
      actorId: actor.id,
    });
    await assert.rejects(
      db.update(s.shipments).set({ cargoMode: 'LCL' }).where(eq(s.shipments.id, fcl.shipment.id)),
      expectDatabaseConstraint,
    );
  });

  test('allows distinct live trips in one shipment but rejects a second live trip for one fulfillment', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const { shipment } = await createShipmentFixture('FCL', actor.id, customer.id, 2);
    const decomposition = await createShipmentFulfillments({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: `trip-links-${suffix}`,
      actorId: actor.id,
    });
    const [route] = await db.insert(s.routes).values({ name: `Fulfillment route ${suffix}` }).returning();
    routeIds.push(route.id);
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Fulfillment cargo ${suffix}` }).returning();
    cargoTypeIds.push(cargoType.id);
    const base = {
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-08-01',
      shipmentId: shipment.id,
      createdBy: actor.id,
    };

    const trips = await db.insert(s.trips).values([
      { ...base, fulfillmentId: decomposition.result[0]!.id },
      { ...base, fulfillmentId: decomposition.result[1]!.id },
    ]).returning();
    assert.equal(trips.length, 2);
    await assert.rejects(
      db.insert(s.trips).values({ ...base, fulfillmentId: decomposition.result[0]!.id }),
      expectDatabaseConstraint,
    );
  });

  test('rejects duplicate active driver account bindings', async () => {
    const actor = await createActor(Role.DRIVER);
    const [driver] = await db.insert(s.drivers).values({ userId: actor.id, name: `Driver ${suffix}` }).returning();
    driverIds.push(driver.id);
    await assert.rejects(
      db.insert(s.drivers).values({ userId: actor.id, name: `Duplicate driver ${suffix}` }),
      expectDatabaseConstraint,
    );
    assert.equal((await assertDispatchableDriverPrincipal(driver.id)).id, driver.id);
  });

  test('rejects non-DRIVER and inactive principals at the dispatch boundary', async () => {
    const admin = await createActor(Role.ADMIN);
    const inactiveDriver = await createActor(Role.DRIVER, 'INACTIVE');
    const [adminProfile, inactiveProfile] = await db.insert(s.drivers).values([
      { userId: admin.id, name: `Admin profile ${suffix}` },
      { userId: inactiveDriver.id, name: `Inactive driver ${suffix}` },
    ]).returning();
    driverIds.push(adminProfile.id, inactiveProfile.id);

    await assert.rejects(assertDispatchableDriverPrincipal(adminProfile.id), expectApiConflict);
    await assert.rejects(assertDispatchableDriverPrincipal(inactiveProfile.id), expectApiConflict);
  });

  test('canceled fulfillment stays required until replacement or approved waiver is complete', () => {
    const base = {
      id: 41,
      shipmentId: 10,
      fulfillmentType: 'LCL_SHIPMENT',
      cargoMode: 'LCL',
      shipmentContainerId: null,
      canceledAt: new Date(),
      cancellationDisposition: null,
      replacementFulfillmentId: null,
      notRequiredApprovedBy: null,
      notRequiredApprovedAt: null,
      notRequiredReason: null,
    } as typeof s.shipmentFulfillments.$inferSelect;
    assert.equal(isFulfillmentRequired(base), true);
    const replaced = {
      ...base,
      cancellationDisposition: 'REPLACED',
      replacementFulfillmentId: 42,
    } as typeof s.shipmentFulfillments.$inferSelect;
    assert.equal(isFulfillmentRequired(replaced), true);
    assert.equal(isFulfillmentRequired(replaced, {
      ...base,
      id: 42,
      shipmentId: replaced.shipmentId,
      fulfillmentType: replaced.fulfillmentType,
      shipmentContainerId: replaced.shipmentContainerId,
      canceledAt: null,
    }), false);
    assert.equal(isFulfillmentRequired(replaced, {
      ...base,
      id: 42,
      shipmentId: replaced.shipmentId,
      fulfillmentType: replaced.fulfillmentType,
      shipmentContainerId: replaced.shipmentContainerId,
      canceledAt: new Date(),
    }), true);
    assert.equal(isFulfillmentRequired({
      ...base,
      cancellationDisposition: 'NOT_REQUIRED',
      notRequiredApprovedBy: 7,
      notRequiredApprovedAt: new Date(),
      notRequiredReason: 'Khách hàng xác nhận không cần giao.',
    }), false);
  });

  test('rejects a replacement fulfillment from another shipment', async () => {
    const actor = await createActor();
    const customer = await createCustomer();
    const first = await createShipmentFixture('LCL', actor.id, customer.id);
    const second = await createShipmentFixture('LCL', actor.id, customer.id);
    const firstResult = await createShipmentFulfillments({
      shipmentId: first.shipment.id,
      expectedVersion: first.shipment.version,
      idempotencyKey: `replacement-first-${suffix}`,
      actorId: actor.id,
    });
    const secondResult = await createShipmentFulfillments({
      shipmentId: second.shipment.id,
      expectedVersion: second.shipment.version,
      idempotencyKey: `replacement-second-${suffix}`,
      actorId: actor.id,
    });

    await assert.rejects(
      db.update(s.shipmentFulfillments).set({
        canceledAt: new Date(),
        canceledBy: actor.id,
        cancellationReason: 'Thay thế tác vụ thử nghiệm',
        cancellationDisposition: 'REPLACED',
        replacementFulfillmentId: secondResult.result[0]!.id,
      }).where(eq(s.shipmentFulfillments.id, firstResult.result[0]!.id)),
      expectDatabaseConstraint,
    );
  });
});

describe('dispatch workflow role matrix', () => {
  test('keeps dispatch, e-POD review, driver execution, and accounting read access separate', async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const enforcer = await newEnforcer(
      path.resolve(directory, '../casbin/model.conf'),
      path.resolve(directory, '../casbin/policy.csv'),
    );

    assert.equal(await enforcer.enforce('MANAGER', 'shipment_fulfillments', 'write'), true);
    assert.equal(await enforcer.enforce('CLERK', 'shipment_fulfillments', 'write'), false);
    assert.equal(await enforcer.enforce('CLERK', 'epod_review', 'write'), true);
    assert.equal(await enforcer.enforce('ACCOUNTANT', 'epod_review', 'read'), true);
    assert.equal(await enforcer.enforce('ACCOUNTANT', 'epod_review', 'write'), false);
    assert.equal(await enforcer.enforce('DRIVER', 'driver_fulfillments', 'write'), true);
    assert.equal(await enforcer.enforce('DRIVER', 'shipment_fulfillments', 'read'), false);
  });
});

describe('e-POD and master import authority constraints', () => {
  test('keeps one open POD, binds it to the trip fulfillment, and protects required evidence slots', async () => {
    const actor = await createActor(Role.ADMIN);
    const customer = await createCustomer();
    const { shipment } = await createShipmentFixture('FCL', actor.id, customer.id, 2);
    const decomposition = await createShipmentFulfillments({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: `pod-${suffix}`,
      actorId: actor.id,
    });
    const [route] = await db.insert(s.routes).values({ name: `POD route ${suffix}` }).returning();
    routeIds.push(route.id);
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `POD cargo ${suffix}` }).returning();
    cargoTypeIds.push(cargoType.id);
    const [trip] = await db.insert(s.trips).values({
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-08-01',
      shipmentId: shipment.id,
      fulfillmentId: decomposition.result[0]!.id,
      createdBy: actor.id,
    }).returning();
    const [submission] = await db.insert(s.tripPodSubmissions).values({
      tripId: trip.id,
      fulfillmentId: decomposition.result[0]!.id,
      submissionVersion: 1,
      sourceTripVersion: trip.version,
    }).returning();

    const [secondTrip] = await db.insert(s.trips).values({
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-08-01',
      shipmentId: shipment.id,
      fulfillmentId: decomposition.result[1]!.id,
      createdBy: actor.id,
    }).returning();
    await assert.rejects(
      db.insert(s.tripPodSubmissions).values({
        tripId: secondTrip.id,
        fulfillmentId: decomposition.result[1]!.id,
        submissionVersion: 2,
        sourceTripVersion: secondTrip.version,
        supersedesSubmissionId: submission.id,
      }),
      expectDatabaseConstraint,
    );

    await assert.rejects(
      db.insert(s.tripPodSubmissions).values({
        tripId: trip.id,
        fulfillmentId: decomposition.result[0]!.id,
        submissionVersion: 2,
        sourceTripVersion: trip.version,
        supersedesSubmissionId: submission.id,
      }),
      expectDatabaseConstraint,
    );
    await assert.rejects(
      db.insert(s.tripPodSubmissions).values({
        tripId: trip.id,
        fulfillmentId: decomposition.result[1]!.id,
        submissionVersion: 2,
        sourceTripVersion: trip.version,
        supersedesSubmissionId: submission.id,
        status: 'REJECTED',
        submittedBy: actor.id,
        submittedAt: new Date(),
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        rejectionReason: 'Sai tác vụ',
      }),
      expectDatabaseConstraint,
    );
    const file = {
      submissionId: submission.id,
      fileType: 'SIGNED_DELIVERY_NOTE' as const,
      storageKey: `pod/${suffix}/signed-1.jpg`,
      originalFileName: 'bien-ban-giao-nhan.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      sha256: 'a'.repeat(64),
      uploadedBy: actor.id,
    };
    await db.insert(s.tripPodFiles).values(file);
    await assert.rejects(
      db.insert(s.tripPodFiles).values({
        ...file,
        storageKey: `pod/${suffix}/signed-2.jpg`,
        sha256: 'b'.repeat(64),
      }),
      expectDatabaseConstraint,
    );
  });

  test('deduplicates import sources and persists only redacted blocked-row reasons', async () => {
    const actor = await createActor();
    const sourceFileHash = 'c'.repeat(64);
    const [batch] = await db.insert(s.masterImportBatches).values({
      sourceFileName: 'master-data.xlsx',
      sourceFileHash,
      parserVersion: 'v1',
      analyzedBy: actor.id,
    }).returning();
    masterImportBatchIds.push(batch.id);

    await assert.rejects(
      db.insert(s.masterImportBatches).values({
        sourceFileName: 'renamed.xlsx',
        sourceFileHash,
        parserVersion: 'v1',
        analyzedBy: actor.id,
      }),
      expectDatabaseConstraint,
    );
    await assert.rejects(
      db.insert(s.masterImportRowResults).values({
        batchId: batch.id,
        sheetName: 'Drivers',
        rowNumber: 2,
        entityType: 'driver',
        classification: 'BLOCKED',
      }),
      expectDatabaseConstraint,
    );
    const [blocked] = await db.insert(s.masterImportRowResults).values({
      batchId: batch.id,
      sheetName: 'Drivers',
      rowNumber: 2,
      entityType: 'driver',
      classification: 'BLOCKED',
      reasonCode: 'INVALID_PHONE',
      redactedReason: 'Số điện thoại không hợp lệ',
    }).returning();
    assert.equal(blocked.redactedReason, 'Số điện thoại không hợp lệ');
    assert.equal('rawPayload' in blocked, false);
  });
});

after(async () => {
  try {
    if (shipmentIds.length > 0) {
      const fulfillmentRows = await db.select({ id: s.shipmentFulfillments.id })
        .from(s.shipmentFulfillments)
        .where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      const fulfillmentIds = fulfillmentRows.map((row) => row.id);
      if (fulfillmentIds.length > 0) {
        await db.delete(s.trips).where(inArray(s.trips.fulfillmentId, fulfillmentIds));
      }
      await db.delete(s.idempotencyKeys)
        .where(inArray(s.idempotencyKeys.createdBy, userIds));
      await db.delete(s.shipmentFulfillments)
        .where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers)
        .where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
    if (driverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
    if (operationalSiteIds.length > 0) {
      await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, operationalSiteIds));
    }
    if (masterImportBatchIds.length > 0) {
      await db.delete(s.masterImportBatches).where(inArray(s.masterImportBatches.id, masterImportBatchIds));
    }
    if (routeIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (cargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
    if (customerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  } finally {
    await disconnectRedis();
    await client.end();
  }
});
