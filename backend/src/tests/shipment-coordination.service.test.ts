import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import {
  acknowledgeCustomerVisibleEvent,
  createCustomerVisibleEvent,
  listCustomerVisibleEvents,
} from '../services/shipment-coordination.service';

describe('customer-visible shipment coordination', () => {
  test('persists customer acknowledgement and reconstructs it after reload', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [customer] = await db.insert(s.customers).values({ name: `Coordination ${suffix}` }).returning();
    const [user] = await db.insert(s.users).values({
      username: `coordination-${suffix}`,
      passwordHash: 'not-used-by-service-test',
      role: Role.CUSTOMER,
      customerId: customer!.id,
    }).returning();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer!.id,
      shipmentCode: `SHP-${suffix}`,
      createdBy: user!.id,
    }).returning();
    const actor = {
      userId: user!.id,
      username: user!.username,
      email: null,
      fullName: null,
      role: Role.CUSTOMER,
      customerId: customer!.id,
      customerIds: [customer!.id],
    };

    try {
      const event = await createCustomerVisibleEvent({
        shipmentId: shipment!.id,
        eventKey: `delivery-plan-${suffix}`,
        eventType: 'DELIVERY_PLAN',
        title: 'Kế hoạch giao hàng',
        message: 'Dự kiến giao hàng lúc 09:00.',
        createdBy: user!.id,
      });
      const before = await listCustomerVisibleEvents({
        shipmentId: shipment!.id,
        actor,
        expectedCustomerId: customer!.id,
      });
      assert.equal(before[0]?.acknowledged, false);
      assert.equal(before[0]?.acknowledgedAt, null);
      assert.ok(!('shipmentCode' in (before[0] ?? {})), 'customer-visible event DTO must omit internal shipment codes');

      await acknowledgeCustomerVisibleEvent({
        shipmentId: shipment!.id,
        eventId: event.id,
        expectedVersion: event.version,
        kind: 'ACKNOWLEDGED',
        idempotencyKey: `ack-${suffix}`,
        actor,
        expectedCustomerId: customer!.id,
      });

      const afterReload = await listCustomerVisibleEvents({
        shipmentId: shipment!.id,
        actor,
        expectedCustomerId: customer!.id,
      });
      assert.equal(afterReload[0]?.acknowledged, true);
      assert.match(afterReload[0]?.acknowledgedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment!.id));
      await db.delete(s.shipments).where(eq(s.shipments.id, shipment!.id));
      await db.delete(s.users).where(eq(s.users.id, user!.id));
      await db.delete(s.customers).where(eq(s.customers.id, customer!.id));
    }
  });

  test('suppresses legacy multi-trip milestone duplicates to shipment status-history cardinality', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [customer] = await db.insert(s.customers).values({ name: `Coordination dup ${suffix}` }).returning();
    const [user] = await db.insert(s.users).values({
      username: `coordination-dup-${suffix}`,
      passwordHash: 'not-used-by-service-test',
      role: Role.CUSTOMER,
      customerId: customer!.id,
    }).returning();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer!.id,
      shipmentCode: `SHP-DUP-${suffix}`,
      createdBy: user!.id,
    }).returning();
    const actor = {
      userId: user!.id,
      username: user!.username,
      email: null,
      fullName: null,
      role: Role.CUSTOMER,
      customerId: customer!.id,
      customerIds: [customer!.id],
    };

    try {
      await db.insert(s.shipmentStatusHistory).values([
        {
          shipmentId: shipment!.id,
          fromStatus: 'NEW',
          toStatus: 'DISPATCHED',
          changedBy: user!.id,
          changedAt: new Date('2026-08-03T08:00:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          fromStatus: 'DISPATCHED',
          toStatus: 'IN_TRANSIT',
          changedBy: user!.id,
          changedAt: new Date('2026-08-03T09:00:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          fromStatus: 'IN_TRANSIT',
          toStatus: 'DISPATCHED',
          changedBy: user!.id,
          changedAt: new Date('2026-08-03T10:00:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          fromStatus: 'DISPATCHED',
          toStatus: 'IN_TRANSIT',
          changedBy: user!.id,
          changedAt: new Date('2026-08-03T11:00:00.000Z'),
        },
      ]);

      const insertedEvents = await db.insert(s.customerVisibleEvents).values([
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:7001:milestone:IN_TRANSIT',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Lô hàng đang được vận chuyển.',
            occurredAt: '2026-08-03T09:00:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T09:00:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:7002:milestone:IN_TRANSIT',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Lô hàng đang được vận chuyển.',
            occurredAt: '2026-08-03T09:01:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T09:01:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:7003:milestone:IN_TRANSIT',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Lô hàng đang được vận chuyển.',
            occurredAt: '2026-08-03T11:00:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T11:00:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:7004:milestone:IN_TRANSIT',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Lô hàng đang được vận chuyển.',
            occurredAt: '2026-08-03T11:01:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T11:01:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:manual-note',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Ghi chú thủ công cho khách hàng.',
            occurredAt: '2026-08-03T11:02:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T11:02:00.000Z'),
        },
      ]).returning();
      const manualEvent = insertedEvents.find((event) => event.eventKey === 'trip:manual-note');

      const listed = await listCustomerVisibleEvents({
        shipmentId: shipment!.id,
        actor,
        expectedCustomerId: customer!.id,
      });

      assert.equal(listed.filter((event) => event.title === 'Đang vận chuyển').length, 3);
      assert.deepEqual(
        listed
          .filter((event) => event.title === 'Đang vận chuyển')
          .map((event) => event.occurredAt),
        ['2026-08-03T11:02:00.000Z', '2026-08-03T11:01:00.000Z', '2026-08-03T09:01:00.000Z'],
      );
      assert.equal(listed.some((event) => event.id === manualEvent?.id), true);
    } finally {
      await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment!.id));
      await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, shipment!.id));
      await db.delete(s.shipments).where(eq(s.shipments.id, shipment!.id));
      await db.delete(s.users).where(eq(s.users.id, user!.id));
      await db.delete(s.customers).where(eq(s.customers.id, customer!.id));
    }
  });

  test('keeps acknowledgement state when reconciliation would otherwise discard the acknowledged duplicate', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [customer] = await db.insert(s.customers).values({ name: `Coordination ack ${suffix}` }).returning();
    const [user] = await db.insert(s.users).values({
      username: `coordination-ack-${suffix}`,
      passwordHash: 'not-used-by-service-test',
      role: Role.CUSTOMER,
      customerId: customer!.id,
    }).returning();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer!.id,
      shipmentCode: `SHP-ACK-${suffix}`,
      createdBy: user!.id,
    }).returning();
    const actor = {
      userId: user!.id,
      username: user!.username,
      email: null,
      fullName: null,
      role: Role.CUSTOMER,
      customerId: customer!.id,
      customerIds: [customer!.id],
    };

    try {
      await db.insert(s.shipmentStatusHistory).values({
        shipmentId: shipment!.id,
        fromStatus: 'DISPATCHED',
        toStatus: 'IN_TRANSIT',
        changedBy: user!.id,
        changedAt: new Date('2026-08-03T09:00:00.000Z'),
      });
      const [olderLegacy, newerLegacy] = await db.insert(s.customerVisibleEvents).values([
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:8001:milestone:IN_TRANSIT',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Lô hàng đang được vận chuyển.',
            occurredAt: '2026-08-03T09:00:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T09:00:00.000Z'),
        },
        {
          shipmentId: shipment!.id,
          customerId: customer!.id,
          eventKey: 'trip:8002:milestone:IN_TRANSIT',
          contentVersion: 1,
          eventType: 'MILESTONE',
          classification: 'CUSTOMER_VISIBLE',
          contentSnapshot: {
            title: 'Đang vận chuyển',
            message: 'Lô hàng đang được vận chuyển.',
            occurredAt: '2026-08-03T09:01:00.000Z',
            shipmentCode: shipment!.shipmentCode ?? undefined,
          },
          createdBy: user!.id,
          occurredAt: new Date('2026-08-03T09:01:00.000Z'),
        },
      ]).returning();

      await acknowledgeCustomerVisibleEvent({
        shipmentId: shipment!.id,
        eventId: olderLegacy.id,
        expectedVersion: olderLegacy.contentVersion,
        kind: 'ACKNOWLEDGED',
        idempotencyKey: `ack-legacy-${suffix}`,
        actor,
        expectedCustomerId: customer!.id,
      });

      const listed = await listCustomerVisibleEvents({
        shipmentId: shipment!.id,
        actor,
        expectedCustomerId: customer!.id,
      });

      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, olderLegacy.id);
      assert.equal(listed[0]?.occurredAt, '2026-08-03T09:00:00.000Z');
      assert.equal(listed[0]?.acknowledged, true);
      assert.match(listed[0]?.acknowledgedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.notEqual(listed[0]?.id, newerLegacy.id);
    } finally {
      await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment!.id));
      await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, shipment!.id));
      await db.delete(s.shipments).where(eq(s.shipments.id, shipment!.id));
      await db.delete(s.users).where(eq(s.users.id, user!.id));
      await db.delete(s.customers).where(eq(s.customers.id, customer!.id));
    }
  });
});

after(async () => {
  await disconnectRedis();
  await client.end();
});
