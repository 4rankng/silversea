/**
 * Wave 2 — cross-customer isolation integration tests.
 *
 * Verifies that the scopedByCustomer + canAccessCustomer helpers correctly
 * prevent customer A from seeing/accessing customer B's data. These are the
 * security primitives the customer portal will use; testing them here proves
 * the isolation contract holds before the portal UI ships.
 *
 * Test matrix:
 *   - scopedByCustomer: CUSTOMER A scoped to customer 1 cannot see customer 2's shipments.
 *   - scopedByCustomer: operator (ADMIN) can see all customers' shipments.
 *   - scopedByCustomer: deny-all sentinel for unmapped CUSTOMER returns zero rows.
 *   - canAccessCustomer: CUSTOMER A can access their own customer id.
 *   - canAccessCustomer: CUSTOMER A cannot access customer B's id.
 *   - canAccessCustomer: ADMIN can access any customer id.
 *   - scopedByCustomer: caller-supplied customerId is overridden (impersonation guard).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createShipment, listShipments } from '../services/shipment.service';
import { scopedByCustomer, canAccessCustomer, isCustomerScoped, DENY_ALL_CUSTOMER_ID } from '../lib/scoped-by-customer';
import { Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer(name: string) {
  const [c] = await db.insert(s.customers).values({ name }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

after(async () => {
  try {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[cross-customer-isolation.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

describe('Cross-customer isolation — scopedByCustomer', () => {
  test('CUSTOMER A scoped to customer 1 sees only customer 1 shipments', async () => {
    const c1 = await mkCustomer(`ISO-c1-${suffix}`);
    const c2 = await mkCustomer(`ISO-c2-${suffix}`);
    const s1 = await createShipment({ customerId: c1.id });
    const s2 = await createShipment({ customerId: c2.id });
    createdShipmentIds.push(s1.id, s2.id);

    // Customer A (scoped to c1) queries shipments.
    const rows = await listShipments(scopedByCustomer(
      { role: Role.CUSTOMER, customerId: c1.id },
      {},
    ));
    assert.ok(rows.some(r => r.id === s1.id), 'sees own shipment');
    assert.ok(!rows.some(r => r.id === s2.id), 'does NOT see customer B shipment');
  });

  test('impersonation guard: caller-supplied customerId is overridden', async () => {
    const c1 = await mkCustomer(`ISO-impersonate-c1-${suffix}`);
    const c2 = await mkCustomer(`ISO-impersonate-c2-${suffix}`);
    const s1 = await createShipment({ customerId: c1.id });
    const s2 = await createShipment({ customerId: c2.id });
    createdShipmentIds.push(s1.id, s2.id);

    // Customer A tries to inject customer B's id — the helper overrides it.
    const rows = await listShipments(scopedByCustomer(
      { role: Role.CUSTOMER, customerId: c1.id },
      { customerId: c2.id }, // impersonation attempt
    ));
    assert.ok(!rows.some(r => r.id === s2.id), 'no leakage to customer B');
  });

  test('ADMIN sees all customers (passthrough)', async () => {
    const c1 = await mkCustomer(`ISO-admin-c1-${suffix}`);
    const c2 = await mkCustomer(`ISO-admin-c2-${suffix}`);
    const s1 = await createShipment({ customerId: c1.id });
    const s2 = await createShipment({ customerId: c2.id });
    createdShipmentIds.push(s1.id, s2.id);

    const rows = await listShipments(scopedByCustomer(
      { role: Role.ADMIN, customerId: undefined },
      {},
    ));
    assert.ok(rows.some(r => r.id === s1.id));
    assert.ok(rows.some(r => r.id === s2.id));
  });

  test('unmapped CUSTOMER (deny-all sentinel) sees zero rows', async () => {
    const c1 = await mkCustomer(`ISO-denyall-c1-${suffix}`);
    const s1 = await createShipment({ customerId: c1.id });
    createdShipmentIds.push(s1.id);

    const rows = await listShipments(scopedByCustomer(
      { role: Role.CUSTOMER, customerId: null },
      {},
    ));
    assert.equal(rows.length, 0, 'deny-all sentinel returns zero rows');
  });
});

describe('Cross-customer isolation — canAccessCustomer', () => {
  test('CUSTOMER can access their own customer id', () => {
    assert.ok(canAccessCustomer({ role: Role.CUSTOMER, customerId: 7 }, 7));
  });

  test('CUSTOMER cannot access another customer id', () => {
    assert.ok(!canAccessCustomer({ role: Role.CUSTOMER, customerId: 7 }, 8));
  });

  test('ADMIN can access any customer id', () => {
    assert.ok(canAccessCustomer({ role: Role.ADMIN, customerId: undefined }, 42));
  });

  test('MANAGER can access any customer id', () => {
    assert.ok(canAccessCustomer({ role: Role.MANAGER, customerId: undefined }, 42));
  });

  test('CUSTOMER with null customerId cannot access anything', () => {
    assert.ok(!canAccessCustomer({ role: Role.CUSTOMER, customerId: null }, 7));
  });
});

describe('Cross-customer isolation — isCustomerScoped', () => {
  test('CUSTOMER role is scoped', () => {
    assert.ok(isCustomerScoped({ role: Role.CUSTOMER }));
  });
  test('ADMIN role is not scoped', () => {
    assert.ok(!isCustomerScoped({ role: Role.ADMIN }));
  });
  test('DENY_ALL_CUSTOMER_ID is negative', () => {
    assert.ok(DENY_ALL_CUSTOMER_ID < 0, 'sentinel must never match a real customer id');
  });
});
