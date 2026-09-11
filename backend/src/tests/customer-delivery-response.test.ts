import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { submitCustomerDeliveryResponse } from '../services/customer-delivery-response.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const userIds: number[] = [];
const shipmentIds: number[] = [];
const eventIds: number[] = [];
const attemptIds: number[] = [];
const responseIds: number[] = [];
const idempotencyKeys: string[] = [];

let ownCustomerId = 0;
let foreignCustomerId = 0;
let ownUserId = 0;
let ownShipmentId = 0;

function actor(userId: number, customerId: number) {
  return {
    userId,
    username: `delivery-customer-${userId}`,
    email: null,
    fullName: null,
    role: Role.CUSTOMER,
    customerId,
    customerIds: [customerId],
  };
}

async function expectApiError(statusCode: number, action: () => Promise<unknown>, pattern?: RegExp) {
  try {
    await action();
    assert.fail(`Expected ApiError(${statusCode})`);
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, statusCode);
    if (pattern) assert.match(error.message, pattern);
  }
}

async function createDeliveryEvent(version = 1) {
  const [event] = await db.insert(s.customerVisibleEvents).values({
    shipmentId: ownShipmentId,
    customerId: ownCustomerId,
    eventKey: `delivery-response-${version}-${eventIds.length}-${suffix}`,
    contentVersion: version,
    eventType: 'MILESTONE',
    classification: 'CUSTOMER_VISIBLE',
    contentSnapshot: {
      title: 'Tài xế báo đã giao hàng',
      message: 'Đây chưa phải xác nhận chấp nhận giao hàng cuối cùng.',
      occurredAt: '2026-08-22T08:00:00.000Z',
    },
    createdBy: ownUserId,
    occurredAt: new Date('2026-08-22T08:00:00.000Z'),
  }).returning();
  eventIds.push(event.id);
  const [attempt] = await db.insert(s.deliveryAttempts).values({
    shipmentId: ownShipmentId,
    fulfillmentId: 900_000 + event.id,
    tripId: 800_000 + event.id,
    shipmentContainerId: null,
    driverProgressEventId: 700_000 + event.id,
    customerVisibleEventId: event.id,
    result: 'DELIVERED',
    occurredAt: event.occurredAt,
    recordedBy: ownUserId,
  }).returning();
  attemptIds.push(attempt.id);
  return { event, attempt };
}

before(async () => {
  const insertedCustomers = await db.insert(s.customers).values([
    { name: `Delivery own ${suffix}` },
    { name: `Delivery foreign ${suffix}` },
  ]).returning();
  ownCustomerId = insertedCustomers[0]!.id;
  foreignCustomerId = insertedCustomers[1]!.id;
  customerIds.push(ownCustomerId, foreignCustomerId);

  const [user] = await db.insert(s.users).values({
    username: `delivery-own-${suffix}`,
    passwordHash: 'x',
    role: Role.CUSTOMER,
    customerId: ownCustomerId,
    status: 'ACTIVE',
  }).returning();
  ownUserId = user.id;
  userIds.push(user.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: ownCustomerId,
    shipmentCode: `DEL-${suffix}`.slice(0, 50),
    status: 'COMPLETED',
  }).returning();
  ownShipmentId = shipment.id;
  shipmentIds.push(shipment.id);
});

describe('customer delivery response authority', () => {
  test('confirmation is immutable and replays only the same idempotency key and payload', async () => {
    const { event } = await createDeliveryEvent();
    const key = `confirm-${suffix}`;
    idempotencyKeys.push(key);
    const input = { expectedVersion: event.contentVersion, decision: 'CONFIRMED' as const };
    const first = await submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: ownCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input,
      idempotencyKey: key,
    });
    responseIds.push(first.response.id);
    assert.equal(first.replayed, false);
    assert.equal(first.response.decision, 'CONFIRMED');

    const replay = await submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: ownCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input,
      idempotencyKey: key,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.response.id, first.response.id);

    const secondKey = `confirm-second-${suffix}`;
    idempotencyKeys.push(secondKey);
    await expectApiError(409, () => submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: ownCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input,
      idempotencyKey: secondKey,
    }), /đã có phản hồi/);

    const [shipmentAfter] = await db.select({ status: s.shipments.status })
      .from(s.shipments).where(eq(s.shipments.id, ownShipmentId));
    assert.equal(shipmentAfter?.status, 'COMPLETED', 'advisory response must not mutate accounting/shipment readiness');
  });

  test('dispute is recorded with evidence but cannot cross customer or stale event version', async () => {
    const { event } = await createDeliveryEvent(2);
    const disputeKey = `dispute-${suffix}`;
    idempotencyKeys.push(disputeKey);

    await expectApiError(404, () => submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: foreignCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input: { expectedVersion: 2, decision: 'DISPUTED', reason: 'Sai số lượng' },
      idempotencyKey: disputeKey,
    }));

    const staleKey = `stale-${suffix}`;
    idempotencyKeys.push(staleKey);
    await expectApiError(409, () => submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: ownCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input: { expectedVersion: 1, decision: 'DISPUTED', reason: 'Sai số lượng' },
      idempotencyKey: staleKey,
    }), /phiên bản mới/);

    const outcome = await submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: ownCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input: {
        expectedVersion: 2,
        decision: 'DISPUTED',
        reason: 'Sai số lượng',
        evidenceRefs: ['portal-evidence:photo-1'],
      },
      idempotencyKey: disputeKey,
    });
    responseIds.push(outcome.response.id);
    assert.equal(outcome.response.reason, 'Sai số lượng');
    assert.deepEqual(outcome.response.evidenceRefs, ['portal-evidence:photo-1']);
  });

  test('superseded delivery events reject a response even when their own version still matches', async () => {
    const { event } = await createDeliveryEvent(3);
    const [replacement] = await db.insert(s.customerVisibleEvents).values({
      shipmentId: ownShipmentId,
      customerId: ownCustomerId,
      eventKey: `delivery-response-replacement-${suffix}`,
      contentVersion: 4,
      eventType: 'MILESTONE',
      classification: 'CUSTOMER_VISIBLE',
      contentSnapshot: { title: 'Điều chỉnh báo giao hàng', message: 'Nội dung đã được điều chỉnh.', occurredAt: '2026-08-22T09:00:00.000Z' },
      supersedesEventId: event.id,
      createdBy: ownUserId,
      occurredAt: new Date('2026-08-22T09:00:00.000Z'),
    }).returning();
    eventIds.push(replacement.id);
    const key = `superseded-${suffix}`;
    idempotencyKeys.push(key);
    await expectApiError(409, () => submitCustomerDeliveryResponse({
      shipmentId: ownShipmentId,
      eventId: event.id,
      selectedCustomerId: ownCustomerId,
      actor: actor(ownUserId, ownCustomerId),
      input: { expectedVersion: event.contentVersion, decision: 'CONFIRMED' },
      idempotencyKey: key,
    }), /được thay thế/);
  });
});

after(async () => {
  if (responseIds.length) await db.delete(s.customerDeliveryResponses).where(inArray(s.customerDeliveryResponses.id, responseIds));
  if (idempotencyKeys.length) await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  if (attemptIds.length) await db.delete(s.deliveryAttempts).where(inArray(s.deliveryAttempts.id, attemptIds));
  if (eventIds.length) await db.delete(s.customerVisibleEvents).where(inArray(s.customerVisibleEvents.id, eventIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  try { await client.end(); } catch { /* ignore */ }
});
