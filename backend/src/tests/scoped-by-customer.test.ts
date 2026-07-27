/**
 * Wave 0 — `scopedByCustomer` + `isCustomerScoped` + `canAccessCustomer`
 * unit + integration tests.
 *
 * The helpers are pure functions; the unit tests cover all four branches of
 * the scope matrix:
 *
 *   - CUSTOMER with customerId       → overrides caller's customerId
 *   - CUSTOMER without customerId    → deny-all sentinel (-1)
 *   - non-CUSTOMER                   → passthrough
 *   - non-mutation of the input
 *
 * The integration test verifies the helper against the real `listShipments`
 * query: a CUSTOMER scoped to customer A sees only A's shipments, even when
 * the caller tries to inject `customerId: B` (impersonation guard).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import {
  scopedByCustomer,
  scopedByCustomerIds,
  isCustomerScoped,
  canAccessCustomer,
  customerScopeIds,
  DENY_ALL_CUSTOMER_ID,
} from '../lib/scoped-by-customer';
import { createShipment, listShipments } from '../services/shipment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `ScopeCust customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

after(async () => {
  try {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentDocuments).where(inArray(s.shipmentDocuments.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[scoped-by-customer.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

// ─── Pure-function unit tests ─────────────────────────────────────────────

describe('isCustomerScoped', () => {
  test('true for CUSTOMER role', () => {
    assert.equal(isCustomerScoped({ role: Role.CUSTOMER }), true);
  });
  test('false for ADMIN role', () => {
    assert.equal(isCustomerScoped({ role: Role.ADMIN }), false);
  });
  test('false for MANAGER role', () => {
    assert.equal(isCustomerScoped({ role: Role.MANAGER }), false);
  });
  test('false for DRIVER role', () => {
    assert.equal(isCustomerScoped({ role: Role.DRIVER }), false);
  });
});

describe('scopedByCustomer — pure branches', () => {
  test('CUSTOMER with customerId overrides any caller-supplied customerId (impersonation guard)', () => {
    const result = scopedByCustomer(
      { role: Role.CUSTOMER, customerId: 7 },
      { customerId: 99 },
    );
    assert.equal(result.customerId, 7);
  });

  test('CUSTOMER without customerId applies deny-all sentinel', () => {
    const result: { customerId?: number } = scopedByCustomer(
      { role: Role.CUSTOMER, customerId: null },
      {},
    );
    assert.equal(result.customerId, DENY_ALL_CUSTOMER_ID);
  });

  test('CUSTOMER with undefined customerId also applies deny-all sentinel', () => {
    const result: { customerId?: number } = scopedByCustomer(
      { role: Role.CUSTOMER, customerId: undefined },
      {},
    );
    assert.equal(result.customerId, DENY_ALL_CUSTOMER_ID);
  });

  test('non-CUSTOMER (ADMIN) passes the query through unchanged', () => {
    const query = { customerId: 42 };
    const result = scopedByCustomer({ role: Role.ADMIN, customerId: undefined }, query);
    assert.deepEqual(result, query);
  });

  test('non-CUSTOMER (MANAGER) preserves a caller-supplied customerId', () => {
    const result = scopedByCustomer(
      { role: Role.MANAGER, customerId: undefined },
      { customerId: 42 },
    );
    assert.equal(result.customerId, 42);
  });

  test('does NOT mutate the input query object', () => {
    const query = { customerId: 99 };
    const snapshot = { ...query };
    scopedByCustomer({ role: Role.CUSTOMER, customerId: 7 }, query);
    assert.deepEqual(query, snapshot, 'input query was not mutated');
  });

  test('DENY_ALL_CUSTOMER_ID is negative (cannot collide with real serials)', () => {
    assert.ok(DENY_ALL_CUSTOMER_ID < 0, 'sentinel must be negative to never match a real customer id');
  });
});

describe('canAccessCustomer — single-row gate', () => {
  test('operator (ADMIN) can access any customer', () => {
    assert.equal(canAccessCustomer({ role: Role.ADMIN, customerId: undefined }, 42), true);
  });
  test('CUSTOMER can access their own customer', () => {
    assert.equal(canAccessCustomer({ role: Role.CUSTOMER, customerId: 7 }, 7), true);
  });
  test('CUSTOMER cannot access another customer', () => {
    assert.equal(canAccessCustomer({ role: Role.CUSTOMER, customerId: 7 }, 8), false);
  });
  test('CUSTOMER without link cannot access anything', () => {
    assert.equal(canAccessCustomer({ role: Role.CUSTOMER, customerId: null }, 7), false);
  });
  test('CUSTOMER can access any linked customer id', () => {
    assert.equal(canAccessCustomer({ role: Role.CUSTOMER, customerId: 7, customerIds: [7, 9] }, 9), true);
  });
});

describe('customerScopeIds — full link set', () => {
  test('returns sorted unique ids for CUSTOMER roles', () => {
    assert.deepEqual(customerScopeIds({ role: Role.CUSTOMER, customerId: 9, customerIds: [3, 9, 3, 7] }), [3, 7, 9]);
  });
  test('returns empty array for non-CUSTOMER roles', () => {
    assert.deepEqual(customerScopeIds({ role: Role.ADMIN, customerId: 1, customerIds: [1, 2] }), []);
  });
});

describe('scopedByCustomerIds — list scoping', () => {
  test('CUSTOMER with links receives the full set', () => {
    const result: { customerIds?: number[] } = scopedByCustomerIds(
      { role: Role.CUSTOMER, customerId: 9, customerIds: [3, 9, 7] },
      {},
    );
    assert.deepEqual(result.customerIds, [3, 7, 9]);
  });
  test('CUSTOMER without links receives the deny-all sentinel set', () => {
    const result: { customerIds?: number[] } = scopedByCustomerIds(
      { role: Role.CUSTOMER, customerId: null, customerIds: [] },
      {},
    );
    assert.deepEqual(result.customerIds, [DENY_ALL_CUSTOMER_ID]);
  });
  test('non-CUSTOMER passthrough preserves caller filters', () => {
    const result = scopedByCustomerIds(
      { role: Role.ADMIN, customerId: undefined, customerIds: [] },
      { customerIds: [42] },
    );
    assert.deepEqual(result.customerIds, [42]);
  });
});

// ─── Integration: the helper against the real listShipments query ──────────

describe('scopedByCustomer — integration with listShipments', () => {
  before(async () => {
    // Seed two customers + shipments for each.
    const c1 = await mkCustomer();
    const c2 = await mkCustomer();
    const s1 = await createShipment({ customerId: c1.id });
    const s2 = await createShipment({ customerId: c1.id });
    const s3 = await createShipment({ customerId: c2.id });
    createdShipmentIds.push(s1.id, s2.id, s3.id);
  });

  test('a CUSTOMER scoped to customer 1 sees only customer 1 shipments', async () => {
    const [c1] = await db.select().from(s.customers).where(eq(s.customers.id, createdCustomerIds[0])).limit(1);
    const rows = await listShipments(scopedByCustomer(
      { role: Role.CUSTOMER, customerId: c1.id },
      {},
    ));
    // Every returned row must belong to c1.
    assert.ok(rows.every((r) => r.customerId === c1.id), 'all rows belong to the scoped customer');
    // And the customer-1 shipments we seeded are present.
    for (const id of createdShipmentIds.slice(0, 2)) {
      assert.ok(rows.some((r) => r.id === id), `shipment ${id} visible`);
    }
  });

  test('the impersonation guard holds — caller-supplied customerId is overridden', async () => {
    const [c1, c2] = await db.select().from(s.customers)
      .where(inArray(s.customers.id, createdCustomerIds))
      .orderBy(s.customers.id);

    // Caller tries to inject c2's id; helper must force c1.
    const rows = await listShipments(scopedByCustomer(
      { role: Role.CUSTOMER, customerId: c1.id },
      { customerId: c2.id }, // impersonation attempt
    ));
    assert.ok(rows.every((r) => r.customerId === c1.id),
      'caller-supplied customerId was overridden — no leakage to c2');
  });

  test('unmapped CUSTOMER (deny-all sentinel) sees zero rows', async () => {
    const rows = await listShipments(scopedByCustomer(
      { role: Role.CUSTOMER, customerId: null },
      {},
    ));
    assert.equal(rows.length, 0, 'deny-all sentinel returns zero rows');
  });

  test('ADMIN (non-CUSTOMER) passthrough sees all seeded shipments', async () => {
    const rows = await listShipments(scopedByCustomer(
      { role: Role.ADMIN, customerId: undefined },
      {},
    ));
    // We seeded 3 shipments across 2 customers; ADMIN sees all of them.
    // (There may be other shipments in the DB from prior runs/seeds, so we
    // check the specific seeded ids are present rather than asserting an
    // exact count.)
    for (const id of createdShipmentIds) {
      assert.ok(rows.some((r) => r.id === id), `shipment ${id} visible to ADMIN`);
    }
  });
});
