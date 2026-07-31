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
});

after(async () => {
  await disconnectRedis();
  await client.end();
});
