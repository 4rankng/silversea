/**
 * CUS shipment workspace projection — integration test for the Phase 3
 * decision-gated contract additions:
 *   OQ1 (SPLIT notes): `customerNotes` + `operationalNotes` projected from DB.
 *   OQ2 (AGGREGATE cargo): Col4 `weightKg`/`volumeCbm` summed across the
 *     shipment's containers, falling back to the shipment-level figure when
 *     there are no containers or no per-container values (historical rows).
 *   OQ3 (vehicle-assigned): the operational summary still surfaces
 *     `assignedContainers` as the "phân xe" numerator.
 *
 * Hits the real Postgres DB on the dev port and cleans up every seeded row in
 * `after` (reverse-FK order) so repeated runs stay hermetic.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { listCusShipmentWorkspace } from '../services/cus-shipment-workspace.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdContainerTypeIds: number[] = [];

let customerId: number;
let containerTypeId: number;
let adminActor: AuthUser;

async function seedContainerType() {
  const [row] = await db.insert(s.containerTypes).values({
    // code is UNIQUE; random suffix avoids cross-run collisions.
    code: `40HC${Math.random().toString(16).slice(2, 10)}`,
    name: `CusWs ct ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(row.id);
  return row;
}

async function seedCustomer() {
  const [row] = await db.insert(s.customers).values({
    name: `CusWs customer ${suffix}`,
  }).returning();
  createdCustomerIds.push(row.id);
  return row;
}

async function seedShipment(overrides: Partial<typeof s.shipments.$inferInsert> = {}) {
  const [row] = await db.insert(s.shipments).values({
    customerId,
    version: 1,
    status: 'PENDING_DATE',
    ...overrides,
  }).returning();
  createdShipmentIds.push(row.id);
  return row;
}

async function seedContainer(
  shipmentId: number,
  overrides: Partial<typeof s.shipmentContainers.$inferInsert> = {},
) {
  const [row] = await db.insert(s.shipmentContainers).values({
    shipmentId,
    containerTypeId,
    ...overrides,
  }).returning();
  createdContainerIds.push(row.id);
  return row;
}

before(async () => {
  customerId = (await seedCustomer()).id;
  containerTypeId = (await seedContainerType()).id;
  adminActor = {
    userId: 0,
    username: 'cus-ws-test-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };
});

after(async () => {
  // Reverse-FK order: containers → shipments → catalog → customer.
  if (createdContainerIds.length) {
    await db.delete(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.id, createdContainerIds));
  }
  if (createdShipmentIds.length) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdContainerTypeIds.length) {
    await db.delete(s.containerTypes)
      .where(inArray(s.containerTypes.id, createdContainerTypeIds));
  }
  if (createdCustomerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  await client.end();
});

async function findItem(shipmentId: number) {
  const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, adminActor);
  return response.items.find((item) => item.id === shipmentId);
}

describe('CUS shipment workspace projection — OQ1 split notes', () => {
  test('projects customerNotes and operationalNotes as separate fields', async () => {
    const shipment = await seedShipment({
      customerNotes: 'Giao đúng giờ cho khách',
      operationalNotes: 'Cần điều xe nội bộ sớm',
    });

    const item = await findItem(shipment.id);
    assert.ok(item, 'seeded shipment should appear in the workspace list');
    assert.equal(item!.customerNotes, 'Giao đúng giờ cho khách');
    assert.equal(item!.operationalNotes, 'Cần điều xe nội bộ sớm');
  });

  test('trims and nulls empty notes', async () => {
    const shipment = await seedShipment({
      customerNotes: '   ',
      operationalNotes: null,
    });

    const item = await findItem(shipment.id);
    assert.ok(item);
    assert.equal(item!.customerNotes, null);
    assert.equal(item!.operationalNotes, null);
  });
});

describe('CUS shipment workspace projection — OQ2 aggregated cargo', () => {
  test('sums per-container weight and volume across containers', async () => {
    const shipment = await seedShipment({
      // Shipment-level figures present but must be OVERRIDDEN by the container sum.
      cargoWeightKg: '9999.99',
      cargoVolumeCbm: '8888.888',
    });
    await seedContainer(shipment.id, { cargoWeightKg: '1000.50', cargoVolumeCbm: '33.333' });
    await seedContainer(shipment.id, { cargoWeightKg: '2000.25', cargoVolumeCbm: '16.667' });

    const item = await findItem(shipment.id);
    assert.ok(item);
    // 1000.50 + 2000.25 = 3000.75 (scale 2)
    assert.equal(item!.weightKg, '3000.75');
    // 33.333 + 16.667 = 50.000 (scale 3)
    assert.equal(item!.volumeCbm, '50.000');
  });

  test('falls back to shipment-level cargo when there are no containers', async () => {
    const shipment = await seedShipment({
      cargoWeightKg: '500.00',
      cargoVolumeCbm: '12.500',
    });

    const item = await findItem(shipment.id);
    assert.ok(item);
    assert.equal(item!.weightKg, '500.00');
    assert.equal(item!.volumeCbm, '12.500');
  });

  test('falls back to shipment-level cargo when all per-container values are null', async () => {
    const shipment = await seedShipment({
      cargoWeightKg: '120.00',
      cargoVolumeCbm: '4.250',
    });
    await seedContainer(shipment.id, { cargoWeightKg: null, cargoVolumeCbm: null });
    await seedContainer(shipment.id, { cargoWeightKg: null, cargoVolumeCbm: null });

    const item = await findItem(shipment.id);
    assert.ok(item);
    assert.equal(item!.weightKg, '120.00');
    assert.equal(item!.volumeCbm, '4.250');
  });

  test('returns null cargo when neither containers nor shipment-level figures exist', async () => {
    const shipment = await seedShipment();
    await seedContainer(shipment.id, { cargoWeightKg: null, cargoVolumeCbm: null });

    const item = await findItem(shipment.id);
    assert.ok(item);
    assert.equal(item!.weightKg, null);
    assert.equal(item!.volumeCbm, null);
  });
});

describe('CUS shipment workspace projection — OQ3 vehicle-assigned numerator', () => {
  test('operational summary always surfaces assignedContainers as a non-negative integer', async () => {
    const shipment = await seedShipment();

    const item = await findItem(shipment.id);
    assert.ok(item);
    assert.equal(Number.isInteger(item!.operational.assignedContainers), true);
    assert.ok(item!.operational.assignedContainers >= 0);
    // totalContainers drives the readiness gate; assignedContainers is its subset.
    assert.ok(item!.operational.assignedContainers <= item!.operational.totalContainers);
  });
});
