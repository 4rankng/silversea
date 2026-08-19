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
import { getCusShipmentWorkspaceDetail, listCusShipmentContainers, listCusShipmentWorkspace } from '../services/cus-shipment-workspace.service';
import { createShipment, updateShipment } from '../services/shipment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdRouteIds: number[] = [];
const createdUserIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdDeclarationIds: number[] = [];
const createdFulfillmentIds: number[] = [];

let customerId: number;
let containerTypeId: number;
let containerType20Id: number;
let responsibleUnitId: number;
let adminActor: AuthUser;
let cusActor: AuthUser;

async function seedContainerType() {
  const [row] = await db.insert(s.containerTypes).values({
    // code is UNIQUE; random suffix avoids cross-run collisions.
    code: `40HC${Math.random().toString(16).slice(2, 10)}`,
    name: `CusWs ct ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(row.id);
  return row;
}

async function seedContainerType20() {
  const [row] = await db.insert(s.containerTypes).values({
    code: `20DC${Math.random().toString(16).slice(2, 10)}`,
    name: `CusWs ct20 ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(row.id);
  return row;
}

async function seedDeclaration(shipmentId: number) {
  const [row] = await db.insert(s.shipmentDeclarations).values({
    shipmentId,
    declarationNumber: `DECL${Math.random().toString(16).slice(2, 8)}`,
  }).returning();
  createdDeclarationIds.push(row.id);
  return row;
}

async function seedFulfillment(
  shipmentId: number,
  shipmentContainerId: number | null,
  overrides: Partial<typeof s.shipmentFulfillments.$inferInsert> = {},
) {
  const [row] = await db.insert(s.shipmentFulfillments).values({
    shipmentId,
    shipmentContainerId,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    sourceShipmentVersion: 1,
    siteSnapshot: {
      pickupWarehouse: { id: 1, name: 'Kho A' },
      deliverySite: { id: 2, name: 'Cảng B' },
    },
    ...overrides,
  }).returning();
  createdFulfillmentIds.push(row.id);
  return row;
}

async function seedCustomer(overrides: Partial<typeof s.customers.$inferInsert> = {}) {
  const [row] = await db.insert(s.customers).values({
    name: `CusWs customer ${suffix}`,
    ...overrides,
  }).returning();
  createdCustomerIds.push(row.id);
  return row;
}

async function seedRoute() {
  const [row] = await db.insert(s.routes).values({ name: `CusWs route ${suffix}` }).returning();
  createdRouteIds.push(row.id);
  return row;
}

async function seedShipment(overrides: Partial<typeof s.shipments.$inferInsert> = {}) {
  const [row] = await db.insert(s.shipments).values({
    customerId,
    responsibleUnitId,
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
  containerType20Id = (await seedContainerType20()).id;
  // Provision the CUS actor like production: a real user row with unit +
  // customer links, and shipments seeded under that unit, so list scope
  // (unit + customer) matches the write scope the service enforces.
  const [unit] = await db.insert(s.businessUnits).values({
    name: `CusWs unit ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdBusinessUnitIds.push(unit.id);
  responsibleUnitId = unit.id;
  const [cusUser] = await db.insert(s.users).values({
    username: `cus-ws-${suffix}`,
    passwordHash: 'test-only',
    role: 'CUS',
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(cusUser.id);
  await db.insert(s.userBusinessUnitLinks).values({ userId: cusUser.id, businessUnitId: unit.id });
  await db.insert(s.userCustomerLinks).values({ userId: cusUser.id, customerId });
  adminActor = {
    userId: 0,
    username: 'cus-ws-test-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };
  cusActor = {
    userId: cusUser.id,
    username: 'cus-ws-test-cus',
    email: null,
    fullName: null,
    role: Role.CUS,
    customerId,
    customerIds: [customerId],
  };
});

after(async () => {
  // Reverse-FK order: fulfillments/declarations → containers → shipments →
  // catalog → customer.
  if (createdFulfillmentIds.length) {
    await db.delete(s.shipmentFulfillments)
      .where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
  }
  if (createdDeclarationIds.length) {
    await db.delete(s.shipmentDeclarations)
      .where(inArray(s.shipmentDeclarations.id, createdDeclarationIds));
  }
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
  if (createdRouteIds.length) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  // User links → user → unit (links first: both FK-reference the user/unit).
  if (createdUserIds.length) {
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
    await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  if (createdBusinessUnitIds.length) {
    await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
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

describe('CUS shipment workspace projection — Chứng từ direction display', () => {
  test('EXPORT shows the booking number; IMPORT shows the bill number', async () => {
    // The document-reference invariant (one reference per shipment) means the
    // cell just mirrors the stored reference for each direction.
    const exportShipment = await seedShipment({
      tradeDirection: 'EXPORT',
      bookingRef: 'BOOK-EXP-1',
    });
    const importShipment = await seedShipment({
      tradeDirection: 'IMPORT',
      blNumber: 'BILL-IMP-1',
    });
    // Direction unknown — a lone bill still renders.
    const undirectedShipment = await seedShipment({
      blNumber: 'BILL-NA-1',
    });
    // Only the secondary number present — the cell still shows what exists.
    const bookingOnly = await seedShipment({
      tradeDirection: 'EXPORT',
      bookingRef: 'BOOK-ONLY-1',
    });

    const exportItem = await findItem(exportShipment.id);
    const importItem = await findItem(importShipment.id);
    const undirectedItem = await findItem(undirectedShipment.id);
    const bookingOnlyItem = await findItem(bookingOnly.id);

    assert.equal(exportItem!.billOrBookNumber, 'BOOK-EXP-1');
    assert.equal(importItem!.billOrBookNumber, 'BILL-IMP-1');
    assert.equal(undirectedItem!.billOrBookNumber, 'BILL-NA-1');
    assert.equal(bookingOnlyItem!.billOrBookNumber, 'BOOK-ONLY-1');
  });

  test('flat container rows mirror the same direction-aware number', async () => {
    const exportShipment = await seedShipment({
      tradeDirection: 'EXPORT',
      bookingRef: 'BOOK-FLAT-1',
    });
    await seedContainer(exportShipment.id, { containerNumber: 'FLAT-EXP-1' });

    const response = await listCusShipmentContainers({ page: 1, limit: 100 }, adminActor);
    const row = response.items.find((item) => item.shipmentId === exportShipment.id);
    assert.ok(row);
    assert.equal(row.billOrBookNumber, 'BOOK-FLAT-1');
  });
});

describe('Shipment document references — whitespace normalization', () => {
  test('create collapses empty-string refs to null instead of hitting the direction CHECK', async () => {
    // ''/'   ' pass the trim-aware assertions but would violate the
    // NULL-aware DB CHECK with a 500 if written verbatim.
    const shipment = await createShipment({ customerId, tradeDirection: 'EXPORT', bookingRef: '   ', blNumber: '' });
    createdShipmentIds.push(shipment.id);
    assert.equal(shipment.bookingRef, null);
    assert.equal(shipment.blNumber, null);
  });

  test('update trims surrounding whitespace and stores the clean value', async () => {
    const shipment = await seedShipment({ tradeDirection: 'IMPORT' });
    const updated = await updateShipment(shipment.id, {
      expectedVersion: shipment.version,
      blNumber: '  BILL-PAD-1  ',
    });
    assert.equal(updated.blNumber, 'BILL-PAD-1');
  });
});

describe('CUS shipment workspace projection — OQ2 aggregated cargo', () => {
  test('sums per-container weight and volume across containers', async () => {
    const shipment = await seedShipment({
      cargoMode: 'FCL',
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
    assert.equal(item!.status, 'PENDING_DATE');
    assert.equal(item!.cargoMode, 'FCL');
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

describe('CUS shipment workspace projection — inline edit authority', () => {
  test('keeps schedule and notes inline-editable after dispatch while the shipment is unlocked', async () => {
    const shipment = await seedShipment({
      status: 'PENDING_EXPENSE_APPROVAL',
      bookingRef: 'BOOK-RAW-01',
      closingAt: new Date('2026-08-20T01:00:00.000Z'),
      customerNotes: 'Ghi chú khách hàng',
    });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, cusActor);
    const item = response.items.find((candidate) => candidate.id === shipment.id);

    assert.ok(item);
    assert.equal(item.operational.transportDateEditable, true);
    assert.equal(item.raw.bookingRef, 'BOOK-RAW-01');
    assert.equal(item.raw.closingAt, '2026-08-20T01:00:00.000Z');
    assert.equal(item.fieldAccess.closingAt.mode, 'DIRECT');
    assert.equal(item.fieldAccess.customerNotes.mode, 'DIRECT');
    assert.equal(item.fieldAccess.factoryName.mode, 'REQUEST');
    assert.match(item.fieldAccess.factoryName.reason, /Điều vận/i);
  });
});

test('workspace detail returns safe route selectors for the route authority', async () => {
  const route = await seedRoute();
  const shipment = await seedShipment({ routeId: route.id });
  const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
  assert.deepEqual(detail.selectors.routes.find((item) => item.id === route.id), {
    id: route.id,
    name: route.name,
    label: route.name,
  });
});

describe('CUS container-flat projection', () => {
  test('flattens every container of every shipment with shipment context and operational fields', async () => {
    const appointmentA = new Date('2026-08-20T08:00:00Z');
    const shipmentA = await seedShipment({ blNumber: `FLATA${suffix}`, expectedDeliveryDate: '2026-08-21' });
    const shipmentB = await seedShipment({ bookingRef: `FLATB${suffix}` });
    await seedContainer(shipmentA.id, {
      containerNumber: `FLA${suffix}1`,
      customerAppointmentAt: appointmentA,
    });
    await seedContainer(shipmentA.id, { containerNumber: `FLA${suffix}2` });
    await seedContainer(shipmentB.id, { containerNumber: `FLB${suffix}1` });

    const response = await listCusShipmentContainers({ page: 1, limit: 100 }, cusActor);

    const rows = response.items.filter((row) => row.shipmentId === shipmentA.id || row.shipmentId === shipmentB.id);
    assert.equal(rows.length, 3);

    const rowA1 = rows.find((row) => row.id != null && row.containerNumber === `FLA${suffix}1`);
    assert.ok(rowA1);
    assert.equal(rowA1.shipmentId, shipmentA.id);
    assert.equal(rowA1.ordinal, 1);
    assert.equal(rowA1.billOrBookNumber, `FLATA${suffix}`);
    assert.equal(rowA1.customerName, `CusWs customer ${suffix}`);
    assert.equal(rowA1.customerId, customerId);
    assert.equal(rowA1.shipmentVersion, shipmentA.version);
    assert.equal(rowA1.containerTypeLabel != null, true);
    assert.equal(rowA1.raw.containerNumber, `FLA${suffix}1`);
    assert.equal(rowA1.fieldAccess.containerNumber.mode, 'DIRECT');
    assert.equal(rowA1.shipmentFieldAccess.customerNotes.mode, 'DIRECT');
    assert.equal(rowA1.dispatchStatus, 'UNASSIGNED');
    assert.equal(rowA1.scheduleEditable, true);
    assert.equal(rowA1.customerAppointmentEditable, true);
    // ISO datetime projected verbatim for the đóng/trả column.
    assert.equal(rowA1.customerAppointmentAt, appointmentA.toISOString());
    assert.equal(rowA1.transportDate, '2026-08-21');
    // Unassigned containers carry no carrier/plate yet.
    assert.equal(rowA1.carrierName, null);
    assert.equal(rowA1.plateNumber, null);

    const rowA2 = rows.find((row) => row.containerNumber === `FLA${suffix}2`);
    assert.ok(rowA2);
    assert.equal(rowA2.ordinal, 2);
    assert.equal(rowA2.customerAppointmentAt, null);

    const rowB1 = rows.find((row) => row.containerNumber === `FLB${suffix}1`);
    assert.ok(rowB1);
    assert.equal(rowB1.shipmentId, shipmentB.id);
    assert.equal(rowB1.billOrBookNumber, `FLATB${suffix}`);

    // Pagination envelope is container-authoritative, matching one row per container.
    assert.ok(response.total >= 3);
    assert.ok(response.totalPages >= 1);
    assert.ok(response.items.every((row) => typeof row.id === 'number'));
    assert.deepEqual(response.filterOptions.customers, [{ id: customerId, name: `CusWs customer ${suffix}` }]);

    const shipmentDispatchDate = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      transportDateFrom: '2026-08-21',
      transportDateTo: '2026-08-21',
    }, cusActor);
    assert.deepEqual(
      shipmentDispatchDate.items.filter((row) => row.shipmentId === shipmentA.id).map((row) => row.id),
      [rowA1.id, rowA2.id],
    );
  });

  test('searches a container suffix and returns only the matching container row', async () => {
    const shipment = await seedShipment({ blNumber: `NOSUFFIX${suffix}` });
    await seedContainer(shipment.id, { containerNumber: 'CONTAINER-ZX9Q' });
    await seedContainer(shipment.id, { containerNumber: 'CONTAINER-OTHER' });

    const response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: 'ZX9Q' }, cusActor);

    assert.equal(response.total, 1);
    assert.equal(response.items.length, 1);
    assert.equal(response.items[0]?.containerNumber, 'CONTAINER-ZX9Q');
  });

  test('paginates container rows rather than shipment rows without overlap', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const shipmentA = await seedShipment({ blNumber: `PAGE-A-${marker}` });
    const shipmentB = await seedShipment({ blNumber: `PAGE-B-${marker}` });
    await seedContainer(shipmentA.id, { containerNumber: `PAGE-A1-${marker}` });
    await seedContainer(shipmentA.id, { containerNumber: `PAGE-A2-${marker}` });
    await seedContainer(shipmentB.id, { containerNumber: `PAGE-B1-${marker}` });

    const first = await listCusShipmentContainers({ page: 1, limit: 2, searchSuffix: marker }, cusActor);
    const second = await listCusShipmentContainers({ page: 2, limit: 2, searchSuffix: marker }, cusActor);

    assert.equal(first.total, 3);
    assert.equal(first.totalPages, 2);
    assert.equal(first.items.length, 2);
    assert.equal(second.total, 3);
    assert.equal(second.items.length, 1);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 3);
  });

  test('keeps customer filters and options inside the actor customer scope', async () => {
    const outsideCustomer = await seedCustomer({ name: `CusWs outside customer ${suffix}` });
    const outsideShipment = await seedShipment({ customerId: outsideCustomer.id, blNumber: `OUTSIDE${suffix}` });
    await seedContainer(outsideShipment.id, { containerNumber: `OUTSIDE${suffix}` });

    const scoped = await listCusShipmentContainers({ page: 1, limit: 100 }, cusActor);
    const outsideFilter = await listCusShipmentContainers({ page: 1, limit: 100, customerId: outsideCustomer.id }, cusActor);

    assert.deepEqual(scoped.filterOptions.customers, [{ id: customerId, name: `CusWs customer ${suffix}` }]);
    assert.equal(scoped.items.some((row) => row.customerId === outsideCustomer.id), false);
    assert.equal(outsideFilter.total, 0);
    assert.equal(outsideFilter.items.length, 0);
  });

  test('hides shipments outside the clerk unit scope even when the customer matches', async () => {
    // Regression: a shipment whose customer is linked to the CUS user but has
    // no responsible unit (legacy rows) used to appear in the workspace lists
    // while every write/detail on it 404'd (`assertClerkCanAccessShipment`
    // requires the unit match). List scope must equal write scope.
    const ghost = await seedShipment({ responsibleUnitId: null, blNumber: `GHOST${suffix}` });
    await seedContainer(ghost.id, { containerNumber: `GHOST${suffix}` });

    const flat = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: `GHOST${suffix}` }, cusActor);
    const list = await listCusShipmentWorkspace({ page: 1, limit: 100 }, cusActor);

    assert.equal(flat.total, 0);
    assert.equal(list.items.some((item) => item.id === ghost.id), false);
  });

  test('does not advertise schedule editing to a read-only role', async () => {
    const shipment = await seedShipment({ blNumber: `FLATRO${suffix}` });
    await seedContainer(shipment.id, { containerNumber: `FLATRO${suffix}1` });

    const response = await listCusShipmentContainers({ page: 1, limit: 100 }, adminActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);

    assert.ok(row);
    assert.equal(row.scheduleEditable, false);
    assert.equal(row.shipmentScheduleEditable, false);
    assert.equal(row.shipmentNotesEditable, false);
    assert.equal(row.customerAppointmentEditable, false);
  });
});

describe('Overview operational priority ordering', () => {
  test('unscheduled lots sort first, newest first; scheduled follow by delivery date', async () => {
    const base = Date.now();
    const schedOld = await seedShipment({ blNumber: `ORDSO${suffix}`, expectedDeliveryDate: '2026-07-01', createdAt: new Date(base - 86400000 * 2) });
    const schedNew = await seedShipment({ blNumber: `ORDSN${suffix}`, expectedDeliveryDate: '2026-08-18', createdAt: new Date(base - 86400000) });
    const unschedNew = await seedShipment({ blNumber: `ORDUN${suffix}`, createdAt: new Date(base) });
    const unschedOld = await seedShipment({ blNumber: `ORDUO${suffix}`, createdAt: new Date(base - 86400000 * 3) });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, cusActor);
    const pos = (id: number) => response.items.findIndex((item) => item.id === id);

    assert.ok(pos(unschedNew.id) < pos(unschedOld.id), 'newest unscheduled first within queue');
    assert.ok(pos(unschedOld.id) < pos(schedNew.id), 'unscheduled queue before scheduled');
    assert.ok(pos(schedNew.id) < pos(schedOld.id), 'scheduled by delivery date newest-to-oldest');
  });

  test('same-date ties rank Cont 20 before Cont 40 before Lẻ/unknown', async () => {
    const date = '2026-08-19';
    const route = await seedRoute();
    const mk = async (bl: string, mode: 'FCL' | 'LCL', typeIds: number[], n: number) => {
      const shipment = await seedShipment({ blNumber: `${bl}${suffix}`, expectedDeliveryDate: date, cargoMode: mode, routeId: route.id });
      for (let i = 0; i < n; i += 1) {
        await seedContainer(shipment.id, {
          containerNumber: `${bl}-${i}-${suffix}`.slice(0, 50),
          containerTypeId: typeIds[i % typeIds.length],
        });
      }
      return shipment;
    };
    const cont40 = await mk('RANK40A', 'FCL', [containerTypeId], 1);
    const cont20 = await mk('RANK20A', 'FCL', [containerType20Id], 1);
    const mixed = await mk('RANKMIXA', 'FCL', [containerTypeId, containerType20Id], 2);
    const lcl = await mk('RANKLCLA', 'LCL', [], 0);
    const unknown = await seedShipment({ blNumber: `RANKUNKA${suffix}`, expectedDeliveryDate: date });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, cusActor);
    const rank = (id: number) => response.items.findIndex((item) => item.id === id);

    assert.ok(rank(cont20.id) >= 0 && rank(mixed.id) >= 0);
    assert.ok(rank(cont20.id) < rank(cont40.id), 'Cont 20 before Cont 40');
    assert.ok(rank(mixed.id) < rank(cont40.id), 'mixed 20/40 lot ranks as Cont 20');
    assert.ok(rank(cont40.id) < rank(lcl.id), 'other Cont before Lẻ');
    assert.ok(rank(lcl.id) < rank(unknown.id), 'Lẻ before unknown');
  });
});

describe('Container workboard "Chưa cập nhật" completeness', () => {
  test('projects informationStatus and the exact applicable missing fields on a real FCL row', async () => {
    const shipment = await seedShipment({ blNumber: `MISSY${suffix}`, expectedDeliveryDate: '2026-08-20', cargoMode: 'FCL' });
    await seedContainer(shipment.id, { containerNumber: `MSY${suffix}1`.slice(0, 50) });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    assert.equal(row.informationStatus, 'MISSING');
    const codes = row.missingFields.map((field) => field.code);
    // Applicable and absent: direction, declaration, route, shipping line,
    // sites, appointment, carrier (date exists, none assigned).
    assert.ok(codes.includes('DIRECTION'));
    assert.ok(codes.includes('DECLARATION'));
    assert.ok(codes.includes('ROUTE'));
    assert.ok(codes.includes('SHIPPING_LINE'));
    assert.ok(codes.includes('LIFT_SITE'));
    assert.ok(codes.includes('DROPOFF_SITE'));
    assert.ok(codes.includes('APPOINTMENT'));
    assert.ok(codes.includes('CARRIER'));
    // Present, so not flagged: bill number, transport date, container number,
    // container type (seedContainer defaults it);
    // BKS not applicable because no external carrier is selected yet.
    assert.equal(codes.includes('BILL_BOOKING'), false);
    assert.equal(codes.includes('TRANSPORT_DATE'), false);
    assert.equal(codes.includes('CONTAINER_NUMBER'), false);
    assert.equal(codes.includes('CONTAINER_TYPE'), false);
    assert.equal(codes.includes('BKS'), false);
  });

  test('a fully-filled FCL row projects COMPLETE with empty missingFields', async () => {
    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `DONE${suffix}`,
      expectedDeliveryDate: '2026-08-20',
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: route.id,
      shippingLineName: 'Maersk',
    });
    await seedDeclaration(shipment.id);
    const container = await seedContainer(shipment.id, {
      containerNumber: `DON${suffix}1`.slice(0, 50),
      containerTypeId,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    await seedFulfillment(shipment.id, container.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-123.45',
    });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    assert.equal(row.informationStatus, 'COMPLETE');
    assert.deepEqual(row.missingFields, []);
  });

  test('informationStatus=MISSING returns only incomplete FCL rows with count parity', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const incomplete = await seedShipment({ blNumber: `MI-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    await seedContainer(incomplete.id, { containerNumber: `MI-${marker}`.slice(0, 50) });

    const completeRoute = await seedRoute();
    const complete = await seedShipment({
      blNumber: `MC-${marker}`,
      expectedDeliveryDate: '2026-08-20',
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: completeRoute.id,
      shippingLineName: 'Maersk',
    });
    await seedDeclaration(complete.id);
    const completeContainer = await seedContainer(complete.id, {
      containerNumber: `MC-${marker}`.slice(0, 50),
      containerTypeId,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    await seedFulfillment(complete.id, completeContainer.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-123.45',
    });

    // LCL lot with a physical container row: outside the FCL filter by design.
    const lcl = await seedShipment({ blNumber: `ML-${marker}`, cargoMode: 'LCL', expectedDeliveryDate: '2026-08-20' });
    await seedContainer(lcl.id, { containerNumber: `ML-${marker}`.slice(0, 50) });

    const response = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      informationStatus: 'MISSING',
    }, cusActor);

    assert.ok(response.items.some((row) => row.shipmentId === incomplete.id));
    assert.equal(response.items.some((row) => row.shipmentId === complete.id), false);
    assert.equal(response.items.some((row) => row.shipmentId === lcl.id), false);
    assert.equal(response.total, response.items.length, 'count query agrees with item query');
    assert.ok(response.items.every((row) => row.informationStatus === 'MISSING'));
  });

  test('carrier is not a missing field before a transport date exists', async () => {
    // Everything present except the transport date and the carrier: the
    // vehicle stage is staged behind the date, so only TRANSPORT_DATE flags.
    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `NODATE${suffix}`,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: route.id,
      shippingLineName: 'Maersk',
    });
    await seedDeclaration(shipment.id);
    const container = await seedContainer(shipment.id, {
      containerNumber: `NOD${suffix}1`.slice(0, 50),
      containerTypeId,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    await seedFulfillment(shipment.id, container.id, {});

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    const codes = row.missingFields.map((field) => field.code);
    assert.deepEqual(codes, ['TRANSPORT_DATE']);
  });

  test('BKS stays inapplicable for an own-fleet carrier', async () => {
    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `OWNBKS${suffix}`,
      expectedDeliveryDate: '2026-08-20',
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: route.id,
      shippingLineName: 'Maersk',
    });
    await seedDeclaration(shipment.id);
    const container = await seedContainer(shipment.id, {
      containerNumber: `OWN${suffix}1`.slice(0, 50),
      containerTypeId,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    // OWN planned carrier with no plate: the plate comes from the dispatch
    // trip, so BKS must not flag.
    await seedFulfillment(shipment.id, container.id, { plannedCarrierType: 'OWN' });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    const codes = row.missingFields.map((field) => field.code);
    assert.equal(codes.includes('BKS'), false);
    assert.equal(codes.includes('CARRIER'), false);
  });
});
