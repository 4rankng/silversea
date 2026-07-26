/**
 * Wave 2 M3.4 — delivery confirmation + free-time tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createShipment, batchUpsertShipmentContainers } from '../services/shipment.service';
import { confirmDelivery, calculateFreeTime } from '../services/delivery-confirm.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M34 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

after(async () => {
  try {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[m34-delivery-confirm.test] cleanup partial:', (err as Error).message);
  }
});

describe('M3.4 — confirmDelivery', () => {
  test('records DRIVER confirmation', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const result = await confirmDelivery({
      shipmentId: shipment.id, party: 'DRIVER', confirmedBy: 1,
    });
    assert.equal(result.party, 'DRIVER');
    assert.equal(result.totalContainerCount, 0);
    assert.equal(result.allPartiesConfirmed, false);
  });

  test('all three parties → allPartiesConfirmed = true', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    await confirmDelivery({ shipmentId: shipment.id, party: 'DRIVER', confirmedBy: 1 });
    await confirmDelivery({ shipmentId: shipment.id, party: 'CUS', confirmedBy: 2 });
    const result = await confirmDelivery({ shipmentId: shipment.id, party: 'CUSTOMER', confirmedBy: 3 });

    assert.ok(result.allPartiesConfirmed, 'all three parties confirmed');
  });

  test('idempotent — re-confirming DRIVER is a no-op', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    await confirmDelivery({ shipmentId: shipment.id, party: 'DRIVER', confirmedBy: 1 });
    const result = await confirmDelivery({ shipmentId: shipment.id, party: 'DRIVER', confirmedBy: 1 });

    assert.equal(result.allPartiesConfirmed, false, 'still not all confirmed');
  });

  test('partial delivery per container', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const [c1] = await batchUpsertShipmentContainers(shipment.id, null, [
      { containerNumber: 'MSKU1234565' },
      { containerNumber: 'TCNU7425363' },
    ]);

    const result = await confirmDelivery({
      shipmentId: shipment.id, party: 'DRIVER', confirmedBy: 1,
      containerIds: [c1.id],
    });
    assert.equal(result.confirmedContainerCount, 1);
    assert.equal(result.totalContainerCount, 2);
  });

  test('throws 404 on missing shipment', async () => {
    await assert.rejects(
      () => confirmDelivery({ shipmentId: 99_999_999, party: 'DRIVER', confirmedBy: 1 }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404,
    );
  });
});

describe('M3.4 — calculateFreeTime', () => {
  test('within free time → no overrun', () => {
    const result = calculateFreeTime('2026-07-20', 7, 50000, new Date('2026-07-23'));
    assert.equal(result.isOverrun, false);
    assert.equal(result.estimatedFee, 0);
    assert.ok(result.daysRemaining > 0);
  });

  test('exactly on the last free day → no overrun', () => {
    const result = calculateFreeTime('2026-07-20', 7, 50000, new Date('2026-07-27'));
    assert.equal(result.isOverrun, false);
    assert.equal(result.daysRemaining, 0);
  });

  test('overrun → fee calculated', () => {
    const result = calculateFreeTime('2026-07-20', 7, 50000, new Date('2026-07-30'));
    assert.equal(result.isOverrun, true);
    assert.ok(result.daysRemaining < 0);
    assert.equal(result.estimatedFee, 3 * 50000); // 3 days overrun × 50000
  });

  test('custom freeDays parameter', () => {
    const result = calculateFreeTime('2026-07-20', 14, 50000, new Date('2026-07-25'));
    assert.equal(result.isOverrun, false);
    assert.ok(result.daysRemaining > 7); // well within 14 days
  });

  test('endDate = startDate + freeDays', () => {
    const result = calculateFreeTime('2026-07-20', 7);
    assert.equal(result.startDate, '2026-07-20');
    assert.equal(result.endDate, '2026-07-27');
  });
});
