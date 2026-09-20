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
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { calculateCheckDigit } from '@tingting/shared';
import { Role, shipmentCusContainerLineUpdateSchema, shipmentCusContainerQuerySchema, shipmentCusWorkspaceQuerySchema } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { getCusShipmentWorkspaceDetail, listCusShipmentContainers, listCusShipmentWorkspace, updateCusShipmentContainerLine } from '../services/cus-shipment-workspace.service';
import { ApiError } from '../errors';
import { createShipment, updateShipment } from '../services/shipment.service';
import { requestShipmentDelete } from '../services/shipment-governance.service';

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
const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdPortIds: number[] = [];
const createdFactoryIds: number[] = [];

let customerId: number;
let containerTypeId: number;
let containerType20Id: number;
let responsibleUnitId: number;
let adminActor: AuthUser;
let cusActor: AuthUser;
let accountantActor: AuthUser;

/** Random letters-only tag. cargoRankSql() regex-matches standalone '20'/'40'
 *  in container-type codes AND names, so fixture randomness must never carry
 *  digit runs — a hex suffix containing a standalone '40' once made a 20DC row
 *  also rank as 20 and flipped the priority-queue assertions. */
function lettersTag(length = 8): string {
  let tag = '';
  while (tag.length < length) tag += Math.random().toString(36).slice(2).replace(/[0-9]/g, '');
  return tag.slice(0, length);
}

async function seedContainerType() {
  const [row] = await db.insert(s.containerTypes).values({
    // code is UNIQUE; letters-only tag avoids cross-run collisions AND the
    // size-regex misfires described above.
    code: `40HC${lettersTag()}`,
    name: `CusWs ct ${lettersTag(6)}`,
  }).returning();
  createdContainerTypeIds.push(row.id);
  return row;
}

async function seedContainerType20() {
  const [row] = await db.insert(s.containerTypes).values({
    code: `20DC${lettersTag()}`,
    name: `CusWs ct20 ${lettersTag(6)}`,
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

/** Lift/dropoff completeness authority is the container's own port columns
 * (same columns the create form writes); snapshot fallbacks must be
 * explicitly PORT-typed. Seeds a port pair for container fixtures. */
async function seedLiftDropPorts() {
  const [liftPort] = await db.insert(s.ports).values({
    code: `LP${lettersTag(6)}`,
    name: `Cảng nâng ${suffix}`.slice(0, 255),
  }).returning();
  const [dropPort] = await db.insert(s.ports).values({
    code: `DP${lettersTag(6)}`,
    name: `Cảng hạ ${suffix}`.slice(0, 255),
  }).returning();
  createdPortIds.push(liftPort.id, dropPort.id);
  return { liftPortId: liftPort.id, dropPortId: dropPort.id };
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
  accountantActor = {
    userId: 0,
    username: 'cus-ws-test-accountant',
    email: null,
    fullName: null,
    role: Role.ACCOUNTANT,
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
  // Reverse-FK order: trips → fulfillments/declarations → containers →
  // shipments → catalog → customer.
  if (createdTripIds.length) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdTruckIds.length) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
  }
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
  if (createdFactoryIds.length) {
    await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdFactoryIds));
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
  if (createdPortIds.length) {
    await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
  }
  await client.end();
});

async function findItem(shipmentId: number) {
  const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, adminActor);
  return response.items.find((item) => item.id === shipmentId);
}

describe('CUS workspace ad-hoc list filter (20260917_12, §6.12)', () => {
  test('isAdHoc=true returns only the lệnh chạy ngoài rows', async () => {
    const adhoc = await seedShipment({ isAdHoc: true, blNumber: `WS-ADHOC-${Date.now()}` });
    const normal = await seedShipment({ isAdHoc: false, blNumber: `WS-NORMAL-${Date.now()}` });

    const response = await listCusShipmentWorkspace(
      { page: 1, limit: 100, isAdHoc: 'true' } as never,
      adminActor,
    );
    const ids = response.items.map((item) => item.id);
    assert.ok(ids.includes(adhoc.id), 'ad-hoc lot must be returned');
    assert.ok(!ids.includes(normal.id), 'normal lot must be excluded');
  });

  test('absent filter returns both lots (no implicit ad-hoc narrowing)', async () => {
    const adhoc = await seedShipment({ isAdHoc: true, blNumber: `WS-ADHOC2-${Date.now()}` });
    const normal = await seedShipment({ blNumber: `WS-NORMAL2-${Date.now()}` });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, adminActor);
    const ids = response.items.map((item) => item.id);
    assert.ok(ids.includes(adhoc.id) && ids.includes(normal.id));
  });
});

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

  test('preserves typed line breaks in note fields through update + readback (card 20260914_35)', async () => {
    const shipment = await seedShipment({ customerNotes: 'đầu' });

    // The Ghi chú dialog saves through updateShipment — the write path must
    // carry the typed breaks verbatim (no whitespace-collapse on note fields).
    const twoLineCustomer = '- 123\n- ABC';
    await updateShipment(shipment.id, {
      expectedVersion: shipment.version,
      customerNotes: twoLineCustomer,
      operationalNotes: 'giao xong\nchụp ảnh biên bản',
    });

    const item = await findItem(shipment.id);
    assert.ok(item);
    assert.equal(item!.customerNotes, twoLineCustomer);
    assert.equal(item!.operationalNotes, 'giao xong\nchụp ảnh biên bản');
  });

  test('LCL lots read SCHEDULED from closingAt/plannedReturnAt alone (card 20260914_35 rework)', async () => {
    const importLot = await seedShipment({ cargoMode: 'LCL', tradeDirection: 'IMPORT', plannedReturnAt: new Date('2026-09-22T01:15:00.000Z') });
    const exportLot = await seedShipment({ cargoMode: 'LCL', tradeDirection: 'EXPORT', closingAt: new Date('2026-09-21T13:03:00.000Z') });

    const importItem = await findItem(importLot.id);
    const exportItem = await findItem(exportLot.id);
    assert.ok(importItem && exportItem);
    assert.equal(importItem!.operational.scheduleReadiness, 'SCHEDULED');
    assert.equal(exportItem!.operational.scheduleReadiness, 'SCHEDULED');
  });

  test('LCL lots with no schedule fields at all stay WAITING_DATE (empty-case preserved)', async () => {
    const bare = await seedShipment({ cargoMode: 'LCL', tradeDirection: 'IMPORT' });

    const item = await findItem(bare.id);
    assert.ok(item);
    assert.equal(item!.operational.scheduleReadiness, 'WAITING_DATE');
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
      bookingRef: `BOOK-EXP-1-${suffix}`,
    });
    const importShipment = await seedShipment({
      tradeDirection: 'IMPORT',
      blNumber: `BILL-IMP-1-${suffix}`,
    });
    // Direction unknown — a lone bill still renders.
    const undirectedShipment = await seedShipment({
      blNumber: `BILL-NA-1-${suffix}`,
    });
    // Only the secondary number present — the cell still shows what exists.
    const bookingOnly = await seedShipment({
      tradeDirection: 'EXPORT',
      bookingRef: `BOOK-ONLY-1-${suffix}`,
    });

    const exportItem = await findItem(exportShipment.id);
    const importItem = await findItem(importShipment.id);
    const undirectedItem = await findItem(undirectedShipment.id);
    const bookingOnlyItem = await findItem(bookingOnly.id);

    assert.equal(exportItem!.billOrBookNumber, `BOOK-EXP-1-${suffix}`);
    assert.equal(importItem!.billOrBookNumber, `BILL-IMP-1-${suffix}`);
    assert.equal(undirectedItem!.billOrBookNumber, `BILL-NA-1-${suffix}`);
    assert.equal(bookingOnlyItem!.billOrBookNumber, `BOOK-ONLY-1-${suffix}`);
  });

  test('flat container rows mirror the same direction-aware number', async () => {
    const exportShipment = await seedShipment({
      tradeDirection: 'EXPORT',
      bookingRef: `BOOK-FLAT-1-${suffix}`,
    });
    await seedContainer(exportShipment.id, { containerNumber: 'FLAT-EXP-1' });

    const response = await listCusShipmentContainers({ page: 1, limit: 100 }, adminActor);
    const row = response.items.find((item) => item.shipmentId === exportShipment.id);
    assert.ok(row);
    assert.equal(row.billOrBookNumber, `BOOK-FLAT-1-${suffix}`);
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
    // Run-unique reference: the update path now 409s on duplicates against
    // other ACTIVE shipments, so a hardcoded literal would collide with any
    // stale row from an earlier run and wedge the suite.
    const reference = `BILL-PAD-${suffix}`;
    const updated = await updateShipment(shipment.id, {
      expectedVersion: shipment.version,
      blNumber: `  ${reference}  `,
    });
    assert.equal(updated.blNumber, reference);
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

describe('CUS shipment workspace projection — own-fleet plate sync', () => {
  test('projects the dispatch allocation plate before an OWN trip exists', async () => {
    const marker = Math.random().toString(16).slice(2, 8).toUpperCase();
    const shipment = await seedShipment({
      blNumber: `OWN-PLATE-${marker}`,
      expectedDeliveryDate: '2026-08-20',
      cargoMode: 'FCL',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `OWN-${marker}`,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    // The dispatch allocation is authoritative before a real trip is created.
    // OWN must read the same fulfillment snapshot fallback that EXTERNAL uses.
    await seedFulfillment(shipment.id, container.id, {
      plannedCarrierType: 'OWN',
      plannedVehiclePlateNumber: '15C-491.72',
    });

    const overview = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const overviewItem = overview.items.find((item) => item.id === shipment.id);
    assert.ok(overviewItem);
    assert.deepEqual(overviewItem.carrierAssignments, [{ carrierName: 'SilverSea', plateNumber: '15C-491.72' }]);
    assert.equal(overviewItem.operational.vehicleReadiness, 'READY');

    const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.deepEqual(detail.summary.carrierAssignments, [{ carrierName: 'SilverSea', plateNumber: '15C-491.72' }]);
    assert.equal(detail.containers.find((line) => line.id === container.id)?.plateNumber, '15C-491.72');

    const flat = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    assert.equal(flat.items.find((line) => line.id === container.id)?.plateNumber, '15C-491.72');
  });
});

describe('CUS shipment workspace projection — container classification', () => {
  test('projects the fulfillment-owned classification and preserves canonical unplanned fallbacks', async () => {
    const marker = Math.random().toString(16).slice(2, 7).toUpperCase();
    const shipment = await seedShipment({ cargoMode: 'FCL', blNumber: `CLASS-${marker}` });
    const container = await seedContainer(shipment.id, { containerNumber: `CLASS-${marker}` });
    await seedFulfillment(shipment.id, container.id, { dispatchClassification: 'DOUBLE' });
    const unplannedFcl = await seedShipment({ cargoMode: 'FCL', blNumber: `SINGLE-${marker}` });
    const unplannedFclContainer = await seedContainer(unplannedFcl.id, { containerNumber: `SINGLE-${marker}` });
    const unplannedLcl = await seedShipment({ cargoMode: 'LCL', blNumber: `LCL-${marker}` });
    const unplannedLclContainer = await seedContainer(unplannedLcl.id, { containerNumber: `LCL-${marker}` });

    const response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: marker }, cusActor);
    const row = response.items.find((item) => item.id === container.id);

    assert.ok(row);
    assert.equal(row.classification, 'DOUBLE');
    assert.equal(response.items.find((item) => item.id === unplannedFclContainer.id)?.classification, 'SINGLE');
    assert.equal(response.items.find((item) => item.id === unplannedLclContainer.id)?.classification, 'LCL');
  });

  test('CUS call: FCL shipment created with isCombined=true defaults classification to COMBINED, isCombined=false to SINGLE', async () => {
    const marker = Math.random().toString(16).slice(2, 7).toUpperCase();

    // CUS creates combined shipment
    const combinedShipment = await seedShipment({
      cargoMode: 'FCL',
      bookingRef: `BOOK-COMB-${marker}`,
      isCombined: true,
    });
    const combinedContainer = await seedContainer(combinedShipment.id, { containerNumber: `COMB-${marker}` });
    // In actual flow, fulfillment is seeded/created
    await seedFulfillment(combinedShipment.id, combinedContainer.id, {
      dispatchClassification: combinedShipment.isCombined ? 'COMBINED' : 'SINGLE',
    });

    // CUS creates single shipment
    const singleShipment = await seedShipment({
      cargoMode: 'FCL',
      bookingRef: `BOOK-SING-${marker}`,
      isCombined: false,
    });
    const singleContainer = await seedContainer(singleShipment.id, { containerNumber: `SING-${marker}` });
    await seedFulfillment(singleShipment.id, singleContainer.id, {
      dispatchClassification: singleShipment.isCombined ? 'COMBINED' : 'SINGLE',
    });

    const response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: marker }, cusActor);
    const combRow = response.items.find((item) => item.id === combinedContainer.id);
    const singRow = response.items.find((item) => item.id === singleContainer.id);

    assert.ok(combRow);
    assert.equal(combRow.isCombined, true);
    assert.equal(combRow.classification, 'COMBINED');

    assert.ok(singRow);
    assert.equal(singRow.isCombined, false);
    assert.equal(singRow.classification, 'SINGLE');
  });

  test('CUS call: updating shipment isCombined synchronizes unassigned FCL fulfillments to COMBINED or SINGLE', async () => {
    const marker = Math.random().toString(16).slice(2, 7).toUpperCase();
    const shipment = await seedShipment({ cargoMode: 'FCL', bookingRef: `SYNC-${marker}`, isCombined: false });
    const container = await seedContainer(shipment.id, { containerNumber: `SYNC-${marker}` });
    await seedFulfillment(shipment.id, container.id, { dispatchClassification: 'SINGLE' });

    // Initial check: isCombined = false, classification = SINGLE
    let response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: marker }, cusActor);
    let row = response.items.find((item) => item.id === container.id);
    assert.ok(row);
    assert.equal(row.isCombined, false);
    assert.equal(row.classification, 'SINGLE');

    // CUS updates shipment isCombined to true
    await updateShipment(shipment.id, {
      expectedVersion: shipment.version,
      isCombined: true,
      updatedBy: cusActor.userId,
    }, cusActor);

    response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: marker }, cusActor);
    row = response.items.find((item) => item.id === container.id);
    assert.ok(row);
    assert.equal(row.isCombined, true);
    assert.equal(row.classification, 'COMBINED');

    // CUS updates shipment isCombined back to false
    const [freshShipment] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    await updateShipment(shipment.id, {
      expectedVersion: freshShipment.version,
      isCombined: false,
      updatedBy: cusActor.userId,
    }, cusActor);

    response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: marker }, cusActor);
    row = response.items.find((item) => item.id === container.id);
    assert.ok(row);
    assert.equal(row.isCombined, false);
    assert.equal(row.classification, 'SINGLE');
  });
});

describe('CUS shipment workspace projection — inline edit authority', () => {
  test('keeps schedule and notes inline-editable after dispatch while the shipment is unlocked', async () => {
    const shipment = await seedShipment({
      status: 'IN_TRANSIT',
      bookingRef: `BOOK-RAW-01-${suffix}`,
      closingAt: new Date('2026-08-20T01:00:00.000Z'),
      customerNotes: 'Ghi chú khách hàng',
    });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, cusActor);
    const item = response.items.find((candidate) => candidate.id === shipment.id);

    assert.ok(item);
    assert.equal(item.operational.transportDateEditable, true);
    assert.equal(item.raw.bookingRef, `BOOK-RAW-01-${suffix}`);
    assert.equal(item.raw.closingAt, '2026-08-20T01:00:00.000Z');
    assert.equal(item.fieldAccess.closingAt.mode, 'DIRECT');
    assert.equal(item.fieldAccess.customerNotes.mode, 'DIRECT');
    assert.equal(item.fieldAccess.factoryName.mode, 'DIRECT');
  });

  test('workboard schedule and notes quick-edit opens to admin and dispatcher on unlocked lots', async () => {
    const dispatcherActor: AuthUser = {
      userId: 0,
      username: 'cus-ws-test-dispatcher',
      email: null,
      fullName: null,
      role: Role.DISPATCHER,
    };
    const shipment = await seedShipment({
      status: 'IN_TRANSIT',
      bookingRef: `BOOK-RAW-02-${suffix}`,
      closingAt: new Date('2026-08-20T01:00:00.000Z'),
      customerNotes: 'Ghi chú khách hàng',
    });

    for (const actor of [adminActor, dispatcherActor]) {
      const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, actor);
      const item = response.items.find((candidate) => candidate.id === shipment.id);
      assert.ok(item, `${actor.role} sees the shipment on the workboard`);
      assert.equal(item.operational.transportDateEditable, true, `${actor.role} schedule/notes trigger enabled`);
      for (const key of ['closingAt', 'plannedReturnAt', 'customerNotes', 'operationalNotes'] as const) {
        assert.equal(item.fieldAccess[key].mode, 'DIRECT', `${actor.role} ${key} opens the quick-edit modal`);
      }
    }
  });

  test('accounting lock still closes schedule and notes quick-edit for every opened role', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const dispatcherActor: AuthUser = {
      userId: 0,
      username: 'cus-ws-test-dispatcher',
      email: null,
      fullName: null,
      role: Role.DISPATCHER,
    };
    const lockedShipment = await seedShipment({
      blNumber: `RAW-LOCK-${marker}`,
      cargoMode: 'FCL',
    });
    // Real billing document — the accounting-lock FK to billing_documents is
    // live, sentinel ids violate it.
    assert.ok(lockedShipment.customerId != null, 'fixture shipment carries a customer');
    const [lockDoc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: lockedShipment.customerId,
      entityName: `RAW lock doc ${marker}`,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      totalInclVat: '0',
    }).returning();
    await db.insert(s.shipmentAccountingLocks).values({
      shipmentId: lockedShipment.id,
      billingDocumentId: lockDoc.id,
      billingDocumentVersion: 1,
      billingPeriodSnapshot: {
        rangeFrom: '2026-08-01',
        rangeTo: '2026-08-31',
        issuedAt: '2026-09-01T00:00:00.000Z',
      },
      shipmentVersionAtLock: lockedShipment.version,
      reason: 'Schedule/notes quick-edit stays closed while the lot is locked',
      activatedBy: cusActor.userId,
    });
    try {
      for (const actor of [cusActor, adminActor, dispatcherActor]) {
        const response = await listCusShipmentWorkspace({ page: 1, limit: 100 }, actor);
        const item = response.items.find((candidate) => candidate.id === lockedShipment.id);
        assert.ok(item, `${actor.role} sees the locked shipment`);
        assert.equal(item.operational.transportDateEditable, false, `${actor.role} trigger disabled while locked`);
        for (const key of ['closingAt', 'plannedReturnAt', 'customerNotes', 'operationalNotes'] as const) {
          assert.equal(item.fieldAccess[key].mode, 'READ_ONLY', `${actor.role} ${key} closed while locked`);
        }
      }
    } finally {
      await db.delete(s.shipmentAccountingLocks)
        .where(eq(s.shipmentAccountingLocks.shipmentId, lockedShipment.id));
      await db.delete(s.billingDocuments).where(eq(s.billingDocuments.id, lockDoc.id));
    }
  });

  // TODO/20260911_3 BUG3: CUS creates the lot before the container numbers
  // arrive, then supplements them the next day. The save must be DIRECT —
  // no approval request, no pending row — as long as dispatch has not
  // attached a live trip to the container yet (that denial is a separate,
  // retained operational gate, pinned by TC_UNAS_03).
  test('CUS supplements a placeholder container number directly with no approval request', async () => {
    const marker = Math.random().toString(16).slice(2, 8).replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10));
    const prefix = `MSKU${marker}`;
    const validNumber = `${prefix}${calculateCheckDigit(prefix)}`;
    const shipment = await seedShipment({
      blNumber: `WS-SUPP-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'DISPATCHED',
    });
    const container = await seedContainer(shipment.id, { containerNumber: null });
    const fulfillment = await seedFulfillment(shipment.id, container.id);
    void fulfillment;

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        containerNumber: validNumber,
      },
      actor: cusActor,
    });
    assert.equal(result.line.raw.containerNumber, validNumber);

    const [stored] = await db.select({ containerNumber: s.shipmentContainers.containerNumber })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.id, container.id))
      .limit(1);
    assert.equal(stored?.containerNumber, validNumber);

    // Direct apply: no change-request row was ever opened for this shipment.
    const requestRows = await db.select({ id: s.shipmentChangeRequests.id })
      .from(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.shipmentId, shipment.id));
    assert.equal(requestRows.length, 0);
  });

  test('completed lot rejects the workspace container edit with the terminal-lot guard', async () => {
    // Guard-consistency regression: the dispatch plan save already 409s on
    // terminal lots; the CUS container-line save used to accept the same
    // write on a COMPLETED shipment.
    const marker = String(Date.now()).slice(-6);
    const prefix = `MSKU${marker}`;
    const validNumber = `${prefix}${calculateCheckDigit(prefix)}`;
    const shipment = await seedShipment({
      blNumber: `WS-TERM-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'COMPLETED',
    });
    const container = await seedContainer(shipment.id, { containerNumber: null });
    await seedFulfillment(shipment.id, container.id);

    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: {
          expectedShipmentVersion: shipment.version,
          containerNumber: validNumber,
        },
        actor: cusActor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Lô hàng đã kết thúc/);
        return true;
      },
    );

    const [stored] = await db.select({ containerNumber: s.shipmentContainers.containerNumber })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.id, container.id))
      .limit(1);
    assert.equal(stored?.containerNumber, null);
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
    // Future-dated on purpose: this test asserts plain field projection, not
    // run-date behavior.
    const appointmentA = new Date('2099-08-20T08:00:00Z');
    const shipmentA = await seedShipment({ blNumber: `FLATA${suffix}`, expectedDeliveryDate: '2026-08-21' });
    const shipmentB = await seedShipment({ bookingRef: `FLATB${suffix}` });
    await seedContainer(shipmentA.id, {
      containerNumber: `FLA${suffix}1`,
      customerAppointmentAt: appointmentA,
    });
    await seedContainer(shipmentA.id, { containerNumber: `FLA${suffix}2` });
    await seedContainer(shipmentB.id, { containerNumber: `FLB${suffix}1` });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix }, cusActor);

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
    assert.equal(rowA1.dispatchStatus, 'AWAITING_VEHICLE');
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
    assert.ok(response.filterOptions.customers.some((c) => c.id === customerId),
      'seeded customer is offered in the filter options');

    // Date filter now uses container appointment date (not shipment date).
    // Container A1 has appointment in 2099, A2 has no appointment (falls back
    // to shipment expectedDeliveryDate 2026-08-21).
    const shipmentDispatchDate = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: suffix,
      transportDateFrom: '2026-08-21',
      transportDateTo: '2026-08-21',
    }, cusActor);
    assert.deepEqual(
      shipmentDispatchDate.items.filter((row) => row.shipmentId === shipmentA.id).map((row) => row.id),
      [rowA2.id],
    );
  });

  test('past-run-date container fields stay DIRECT for CUS (approval flow removed 2026-09-10)', async () => {
    const shipment = await seedShipment({ blNumber: `CUTOFF${suffix}` });
    const pastAppointment = new Date('2020-01-01T08:00:00Z');
    const futureAppointment = new Date('2099-01-01T08:00:00Z');
    await seedContainer(shipment.id, { containerNumber: `CUTOFF${suffix}PAST`, customerAppointmentAt: pastAppointment });
    await seedContainer(shipment.id, { containerNumber: `CUTOFF${suffix}FUTURE`, customerAppointmentAt: futureAppointment });

    const response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: suffix }, cusActor);
    const past = response.items.find((row) => row.containerNumber === `CUTOFF${suffix}PAST`);
    const future = response.items.find((row) => row.containerNumber === `CUTOFF${suffix}FUTURE`);
    assert.ok(past);
    assert.ok(future);

    for (const key of ['containerNumber', 'routeId', 'liftSiteId', 'dropoffSiteId'] as const) {
      assert.equal(past.fieldAccess[key].mode, 'DIRECT', `past.fieldAccess.${key}`);
    }
    for (const key of ['containerNumber', 'routeId', 'liftSiteId', 'dropoffSiteId'] as const) {
      assert.equal(future.fieldAccess[key].mode, 'DIRECT', `future.fieldAccess.${key}`);
    }
    for (const row of [past, future]) {
      assert.equal(row.routeEditable, true);
      assert.equal(row.liftSiteEditable, true);
      assert.equal(row.dropoffSiteEditable, true);
    }
    // Fields outside the plan's scope (route/container-number/pickup-drop-off)
    // keep their existing trip-based gate, unaffected by the date cutoff.
    assert.equal(past.fieldAccess.containerTypeId.mode, 'DIRECT');
    assert.equal(past.fieldAccess.cargoWeightKg.mode, 'DIRECT');
  });

  test('SISPROD-CUS-ACCESS CUS and DISPATCHER keep linked-trip identity writable but route/ports read-only', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const dispatcherActor: AuthUser = {
      userId: 0,
      username: 'cus-ws-test-dispatcher',
      email: null,
      fullName: null,
      role: Role.DISPATCHER,
    };
    // Tripped lot: fulfillment + CREATED trip so the line reports hasTrip.
    const trippedShipment = await seedShipment({
      blNumber: `DSP-TRIP-${marker}`,
      cargoMode: 'FCL',
      status: 'DISPATCHED',
    });
    const trippedContainer = await seedContainer(trippedShipment.id, { containerNumber: `DSP${marker}T` });
    const fulfillment = await seedFulfillment(trippedShipment.id, trippedContainer.id);
    const route = await seedRoute();
    const [trip] = await db.insert(s.trips).values({
      tripCode: `TRP-DSP-${marker}`,
      customerId,
      routeId: route.id,
      departureDate: '2026-09-01',
      fulfillmentId: fulfillment.id,
      status: 'CREATED',
    }).returning();
    createdTripIds.push(trip.id);

    const dispatcherView = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker },
      dispatcherActor,
    );
    const trippedRow = dispatcherView.items.find((row) => row.containerNumber === `DSP${marker}T`);
    assert.ok(trippedRow);
    // Container number is identity, not an operational parameter: điều vận
    // fills numbers left blank at intake even after the lot is assigned, so
    // the field saves directly with no approval step — trip or not.
    assert.equal(trippedRow.fieldAccess.containerNumber.mode, 'DIRECT');
    // Route/ports stay on the generic trip split for dispatch — only the
    // identity field opened.
    assert.equal(trippedRow.fieldAccess.routeId.mode, 'READ_ONLY');
    assert.equal(trippedRow.fieldAccess.liftSiteId.mode, 'READ_ONLY');
    assert.equal(trippedRow.fieldAccess.dropoffSiteId.mode, 'READ_ONLY');

    // CUS sees the same operational restriction as the authoritative writer.
    // The old DIRECT override advertised route/port edits that always fail
    // the linked-trip guard; container-number identity remains writable.
    const cusView = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker },
      cusActor,
    );
    const cusRow = cusView.items.find((row) => row.containerNumber === `DSP${marker}T`);
    assert.ok(cusRow);
    assert.equal(cusRow.fieldAccess.containerNumber.mode, 'DIRECT');
    const cusDetail = await getCusShipmentWorkspaceDetail(trippedShipment.id, cusActor);
    const cusLine = cusDetail.containers.find((line) => line.id === trippedContainer.id);
    assert.ok(cusLine);
    assert.equal(cusLine.fieldAccess.containerNumber.mode, 'DIRECT');
    for (const key of ['routeId', 'liftSiteId', 'dropoffSiteId'] as const) {
      assert.equal(cusRow.fieldAccess[key].mode, 'READ_ONLY', `list ${key}`);
      assert.equal(cusLine.fieldAccess[key].mode, 'READ_ONLY', `detail ${key}`);
      assert.match(cusLine.fieldAccess[key].reason, /chuyến thực tế/);
    }
    for (const key of ['routeEditable', 'liftSiteEditable', 'dropoffSiteEditable'] as const) {
      assert.equal(cusRow[key], false, `list ${key}`);
      assert.equal(cusLine.permissions[key], false, `detail ${key}`);
    }

    const accountantView = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker },
      accountantActor,
    );
    const accountantRow = accountantView.items.find((row) => row.containerNumber === `DSP${marker}T`);
    assert.ok(accountantRow);
    assert.equal(accountantRow.fieldAccess.containerNumber.mode, 'READ_ONLY');

    // An active accounting lock still closes the field for điều vận — the
    // direct branch is pre-lock only. Lock cleanup runs in finally: after()
    // has no lock sweep and the FK would block the shipment delete.
    const lockedShipment = await seedShipment({
      blNumber: `DSP-LOCK-${marker}`,
      cargoMode: 'FCL',
    });
    await seedContainer(lockedShipment.id, { containerNumber: `DSP${marker}L` });
    // Real billing document — the accounting-lock FK to billing_documents is
    // live (shipment-children FK wave), sentinel ids violate it.
    assert.ok(lockedShipment.customerId != null, 'fixture shipment carries a customer');
    const [lockDoc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: lockedShipment.customerId,
      entityName: `DSP lock doc ${marker}`,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      totalInclVat: '0',
    }).returning();
    await db.insert(s.shipmentAccountingLocks).values({
      shipmentId: lockedShipment.id,
      billingDocumentId: lockDoc.id,
      billingDocumentVersion: 1,
      billingPeriodSnapshot: {
        rangeFrom: '2026-08-01',
        rangeTo: '2026-08-31',
        issuedAt: '2026-09-01T00:00:00.000Z',
      },
      shipmentVersionAtLock: lockedShipment.version,
      reason: 'Dispatcher container-number fieldAccess matrix test',
      activatedBy: cusActor.userId,
    });
    try {
      const lockedView = await listCusShipmentContainers(
        { page: 1, limit: 20, searchSuffix: marker },
        dispatcherActor,
      );
      const lockedRow = lockedView.items.find((row) => row.containerNumber === `DSP${marker}L`);
      assert.ok(lockedRow);
      assert.equal(lockedRow.fieldAccess.containerNumber.mode, 'READ_ONLY');
      const cusLockedView = await listCusShipmentContainers(
        { page: 1, limit: 20, searchSuffix: marker },
        cusActor,
      );
      const cusLockedRow = cusLockedView.items.find((row) => row.containerNumber === `DSP${marker}L`);
      assert.ok(cusLockedRow);
      for (const key of ['containerNumber', 'routeId', 'liftSiteId', 'dropoffSiteId'] as const) {
        assert.equal(cusLockedRow.fieldAccess[key].mode, 'READ_ONLY', `locked CUS ${key}`);
      }
    } finally {
      await db.delete(s.shipmentAccountingLocks)
        .where(eq(s.shipmentAccountingLocks.shipmentId, lockedShipment.id));
      await db.delete(s.billingDocuments).where(eq(s.billingDocuments.id, lockDoc.id));
    }
  });

  test('searches a container suffix and returns only the matching container row', async () => {
    const shipment = await seedShipment({ blNumber: `NOSUFFIX${suffix}` });
    // Run-unique container numbers: a crashed earlier run left an active
    // fixture pair behind, and hardcoded numbers made the leftover match the
    // suffix search forever after.
    await seedContainer(shipment.id, { containerNumber: `CONTAINER-${suffix}-ZX9Q` });
    await seedContainer(shipment.id, { containerNumber: `CONTAINER-${suffix}-OTHER` });

    const response = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: `${suffix}-ZX9Q` }, cusActor);

    assert.equal(response.total, 1);
    assert.equal(response.items.length, 1);
    assert.equal(response.items[0]?.containerNumber, `CONTAINER-${suffix}-ZX9Q`);
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

  test('sorts container rows by the requested column key server-side', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const shipmentA = await seedShipment({ blNumber: `SRT-A-${marker}` });
    const shipmentB = await seedShipment({ blNumber: `SRT-B-${marker}` });
    await seedContainer(shipmentA.id, { containerNumber: `SRT-C3-${marker}` });
    await seedContainer(shipmentA.id, { containerNumber: `SRT-A1-${marker}` });
    await seedContainer(shipmentB.id, { containerNumber: `SRT-B2-${marker}` });

    const asc = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker, sortBy: 'containerNumber', sortDir: 'asc' },
      cusActor,
    );
    const desc = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker, sortBy: 'containerNumber', sortDir: 'desc' },
      cusActor,
    );

    assert.deepEqual(asc.items.map((row) => row.containerNumber), [`SRT-A1-${marker}`, `SRT-B2-${marker}`, `SRT-C3-${marker}`]);
    assert.deepEqual(desc.items.map((row) => row.containerNumber), [`SRT-C3-${marker}`, `SRT-B2-${marker}`, `SRT-A1-${marker}`]);
  });

  test('carrier-name sort keys on the displayed short name, not the legal name', async () => {
    // Display prefers shortName (shortName?.trim() || name); the sort SQL must
    // agree, or rows order by a name the operator never sees. Legal-name order
    // (A before Zê) is the INVERSE of short-name order here, so the assertion
    // fails against a legal-name sort.
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const carrierLegalA = await seedCustomer({ name: `CusWs Vận tải A ${marker}`, shortName: `ZZZ${marker}` });
    const carrierLegalZ = await seedCustomer({ name: `CusWs Vận tải Zê ${marker}`, shortName: `AAA${marker}` });
    const shipment = await seedShipment({ blNumber: `SRT-N-${marker}` });
    const containerLegalA = await seedContainer(shipment.id, { containerNumber: `SRT-NA-${marker}` });
    const containerLegalZ = await seedContainer(shipment.id, { containerNumber: `SRT-NZ-${marker}` });
    await seedFulfillment(shipment.id, containerLegalA.id, { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: carrierLegalA.id });
    await seedFulfillment(shipment.id, containerLegalZ.id, { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: carrierLegalZ.id });

    const rows = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker, sortBy: 'carrierName', sortDir: 'asc' },
      cusActor,
    );

    assert.deepEqual(rows.items.map((row) => row.carrierName), [`AAA${marker}`, `ZZZ${marker}`]);
  });

  test('sorts by dispatch status rank through the fulfillment projection', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const shipment = await seedShipment({ blNumber: `DISP-A-${marker}` });
    const planned = await seedContainer(shipment.id, { containerNumber: `DISP-P-${marker}` });
    await seedContainer(shipment.id, { containerNumber: `DISP-U-${marker}` });
    // A planned carrier makes DISP-P rank PLANNED; DISP-U stays UNASSIGNED, so
    // desc order must place the planned container first.
    await seedFulfillment(shipment.id, planned.id, { plannedCarrierType: 'EXTERNAL' });

    const desc = await listCusShipmentContainers(
      { page: 1, limit: 20, searchSuffix: marker, sortBy: 'dispatchStatus', sortDir: 'desc' },
      cusActor,
    );

    assert.deepEqual(desc.items.map((row) => row.containerNumber), [`DISP-P-${marker}`, `DISP-U-${marker}`]);
  });

  test('container query schema whitelists sort keys and directions', () => {
    assert.equal(shipmentCusContainerQuerySchema.safeParse({ sortBy: 'containerNumber', sortDir: 'desc' }).success, true);
    assert.equal(shipmentCusContainerQuerySchema.safeParse({ sortBy: 'nope' }).success, false);
    assert.equal(shipmentCusContainerQuerySchema.safeParse({ sortDir: 'sideways' }).success, false);
  });

  test('customer filters span all customers — no actor scoping', async () => {
    const outsideCustomer = await seedCustomer({ name: `CusWs outside customer ${suffix}` });
    const outsideShipment = await seedShipment({ customerId: outsideCustomer.id, blNumber: `OUTSIDE${suffix}` });
    await seedContainer(outsideShipment.id, { containerNumber: `OUTSIDE${suffix}` });

    const all = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: `OUTSIDE${suffix}` }, cusActor);
    const outsideFilter = await listCusShipmentContainers({ page: 1, limit: 100, customerId: outsideCustomer.id }, cusActor);

    assert.equal(all.total, 1);
    assert.equal(all.items[0]!.customerId, outsideCustomer.id);
    assert.ok(all.filterOptions.customers.some((c) => c.id === outsideCustomer.id));
    assert.equal(outsideFilter.total, 1);
    assert.equal(outsideFilter.items.length, 1);
  });

  test('shows unit-less shipments — no clerk unit scope', async () => {
    const ghost = await seedShipment({ responsibleUnitId: null, blNumber: `GHOST${suffix}` });
    await seedContainer(ghost.id, { containerNumber: `GHOST${suffix}` });

    const flat = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: `GHOST${suffix}` }, cusActor);
    const list = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: `GHOST${suffix}` }, cusActor);

    assert.equal(flat.total, 1);
    assert.ok(list.items.some((item) => item.id === ghost.id), 'unit-less lot is listed');
  });

  test('does not advertise schedule editing to a read-only role', async () => {
    const shipment = await seedShipment({ blNumber: `FLATRO${suffix}` });
    await seedContainer(shipment.id, { containerNumber: `FLATRO${suffix}1` });

    const response = await listCusShipmentContainers({ page: 1, limit: 100 }, accountantActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);

    assert.ok(row);
    assert.equal(row.scheduleEditable, false);
    assert.equal(row.shipmentScheduleEditable, false);
    assert.equal(row.shipmentNotesEditable, false);
    assert.equal(row.customerAppointmentEditable, false);
  });

  test('sorts the overview by workspace column keys server-side', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const later = await seedShipment({ blNumber: `OVS-A-${marker}`, expectedDeliveryDate: '2026-08-02' });
    const earlier = await seedShipment({ blNumber: `OVS-B-${marker}`, expectedDeliveryDate: '2026-08-01' });

    const asc = await listCusShipmentWorkspace(
      { page: 1, limit: 20, searchSuffix: marker, sortBy: 'transportDate', sortDir: 'asc' },
      cusActor,
    );
    const desc = await listCusShipmentWorkspace(
      { page: 1, limit: 20, searchSuffix: marker, sortBy: 'transportDate', sortDir: 'desc' },
      cusActor,
    );

    assert.deepEqual(asc.items.map((item) => item.id), [earlier.id, later.id]);
    assert.deepEqual(desc.items.map((item) => item.id), [later.id, earlier.id]);
  });

  test('overview query schema whitelists its own sort keys, disjoint from the container enum', () => {
    assert.equal(shipmentCusWorkspaceQuerySchema.safeParse({ sortBy: 'transportDate' }).success, true);
    assert.equal(shipmentCusWorkspaceQuerySchema.safeParse({ sortBy: 'containerNumber' }).success, false);
    assert.equal(shipmentCusWorkspaceQuerySchema.safeParse({ sortDir: 'up' }).success, false);
  });

  test('allows a CUS write to a shipment in another business unit', async () => {
    const [outsideUnit] = await db.insert(s.businessUnits).values({
      name: `CusWs outside unit ${suffix}`,
      status: 'ACTIVE',
    }).returning();
    createdBusinessUnitIds.push(outsideUnit.id);
    const hiddenShipment = await seedShipment({
      responsibleUnitId: outsideUnit.id,
      blNumber: `HIDDEN${suffix}`,
    });
    const hiddenContainer = await seedContainer(hiddenShipment.id, {
      containerNumber: `HID${suffix}`.slice(0, 50),
    });

    const renamed = 'MSKU1234565';
    const updated = await updateCusShipmentContainerLine({
      shipmentId: hiddenShipment.id,
      containerId: hiddenContainer.id,
      input: { expectedShipmentVersion: hiddenShipment.version, containerNumber: renamed },
      actor: cusActor,
    });
    assert.ok(updated, 'cross-unit write now succeeds without clerk scope');
  });

  test('allows a CUS delete-request against a shipment in another business unit', async () => {
    const [outsideUnit] = await db.insert(s.businessUnits).values({
      name: `CusWs outside-delete unit ${suffix}`,
      status: 'ACTIVE',
    }).returning();
    createdBusinessUnitIds.push(outsideUnit.id);
    const hiddenShipment = await seedShipment({
      responsibleUnitId: outsideUnit.id,
      blNumber: `HIDDENDEL${suffix}`,
    });

    const decision = await requestShipmentDelete({
      shipmentId: hiddenShipment.id,
      version: hiddenShipment.version,
      reason: 'Delete request without unit assignment',
      actor: cusActor,
    });
    assert.ok(decision, 'cross-unit delete request now succeeds without clerk scope');
  });
});

describe('Overview operational priority ordering', () => {
  test('unscheduled lots sort first, newest first; scheduled follow by delivery date', async () => {
    const base = Date.now();
    const schedOld = await seedShipment({ blNumber: `ORDSO${suffix}`, expectedDeliveryDate: '2026-07-01', createdAt: new Date(base - 86400000 * 2) });
    const schedNew = await seedShipment({ blNumber: `ORDSN${suffix}`, expectedDeliveryDate: '2026-08-18', createdAt: new Date(base - 86400000) });
    const unschedNew = await seedShipment({ blNumber: `ORDUN${suffix}`, createdAt: new Date(base) });
    const unschedOld = await seedShipment({ blNumber: `ORDUO${suffix}`, createdAt: new Date(base - 86400000 * 3) });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: suffix }, cusActor);
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
    const [named20Type] = await db.insert(s.containerTypes).values({
      code: `DRYSMALL${Math.random().toString(16).slice(2, 8)}`,
      name: `20'DC ${suffix}`,
    }).returning();
    createdContainerTypeIds.push(named20Type.id);
    const named20 = await mk('RANK20N', 'FCL', [named20Type.id], 1);
    const mixed = await mk('RANKMIXA', 'FCL', [containerTypeId, containerType20Id], 2);
    const lcl = await mk('RANKLCLA', 'LCL', [], 0);
    const unknown = await seedShipment({ blNumber: `RANKUNKA${suffix}`, expectedDeliveryDate: date });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: suffix }, cusActor);
    const rank = (id: number) => response.items.findIndex((item) => item.id === id);

    assert.ok(rank(cont20.id) >= 0 && rank(mixed.id) >= 0);
    assert.ok(rank(cont20.id) < rank(cont40.id), 'Cont 20 before Cont 40');
    assert.ok(rank(named20.id) < rank(cont40.id), '20-foot name ranks before Cont 40 even when code has no size prefix');
    assert.ok(rank(mixed.id) < rank(cont40.id), 'mixed 20/40 lot ranks as Cont 20');
    assert.ok(rank(cont40.id) < rank(lcl.id), 'other Cont before Lẻ');
    assert.ok(rank(lcl.id) < rank(unknown.id), 'Lẻ before unknown');
  });

  test('keeps operational priority stable across overview pages', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const route = await seedRoute();
    const base = Date.now();
    const unscheduledNew = await seedShipment({ blNumber: `PAGE-UN-${marker}`, createdAt: new Date(base) });
    const unscheduledOld = await seedShipment({ blNumber: `PAGE-UO-${marker}`, createdAt: new Date(base - 86400000) });
    const cont20 = await seedShipment({ blNumber: `PAGE-20-${marker}`, expectedDeliveryDate: '2026-08-19', cargoMode: 'FCL', routeId: route.id });
    const cont40 = await seedShipment({ blNumber: `PAGE-40-${marker}`, expectedDeliveryDate: '2026-08-19', cargoMode: 'FCL', routeId: route.id });
    const lcl = await seedShipment({ blNumber: `PAGE-LCL-${marker}`, expectedDeliveryDate: '2026-08-19', cargoMode: 'LCL', routeId: route.id });
    await seedContainer(cont20.id, { containerNumber: `PAGE20-${marker}`, containerTypeId: containerType20Id });
    await seedContainer(cont40.id, { containerNumber: `PAGE40-${marker}`, containerTypeId });

    const pages = await Promise.all([1, 2, 3].map((page) => listCusShipmentWorkspace({
      page,
      limit: 2,
      searchSuffix: marker,
    }, cusActor)));
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));

    assert.deepEqual(ids, [unscheduledNew.id, unscheduledOld.id, cont20.id, cont40.id, lcl.id]);
    assert.deepEqual(pages.map((page) => page.total), [5, 5, 5]);
  });

  test('container workboard mirrors the overview priority queue per container row', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const route = await seedRoute();
    const base = Date.now();
    const schedOld = await seedShipment({ blNumber: `DSO-${marker}`, expectedDeliveryDate: '2026-07-01', cargoMode: 'FCL', createdAt: new Date(base - 86400000 * 2) });
    const schedNew = await seedShipment({ blNumber: `DSN-${marker}`, expectedDeliveryDate: '2026-08-18', cargoMode: 'FCL', createdAt: new Date(base - 86400000) });
    const cont20 = await seedShipment({ blNumber: `D20-${marker}`, expectedDeliveryDate: '2026-08-18', cargoMode: 'FCL', routeId: route.id });
    const cont40 = await seedShipment({ blNumber: `D40-${marker}`, expectedDeliveryDate: '2026-08-18', cargoMode: 'FCL', routeId: route.id });
    const lcl = await seedShipment({ blNumber: `DLC-${marker}`, expectedDeliveryDate: '2026-08-18', cargoMode: 'LCL' });
    const unschedNew = await seedShipment({ blNumber: `DUN-${marker}`, cargoMode: 'FCL', createdAt: new Date(base) });
    await seedContainer(schedOld.id, { containerNumber: `DSO-${marker}`.slice(0, 50) });
    await seedContainer(schedNew.id, { containerNumber: `DSN-${marker}`.slice(0, 50) });
    await seedContainer(cont20.id, { containerNumber: `D20-${marker}`.slice(0, 50), containerTypeId: containerType20Id });
    await seedContainer(cont40.id, { containerNumber: `D40-${marker}`.slice(0, 50), containerTypeId });
    await seedContainer(lcl.id, { containerNumber: `DLC-${marker}`.slice(0, 50), containerTypeId: null });
    await seedContainer(unschedNew.id, { containerNumber: `DUN-${marker}`.slice(0, 50) });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const ids = response.items.map((row) => row.shipmentId);

    assert.deepEqual(ids, [unschedNew.id, cont20.id, cont40.id, schedNew.id, lcl.id, schedOld.id]);
  });

  // ── SILVER L1 P3: factory-aware groups, multi-factory display, edit routing ──

  test('appointment groups preserve every distinct close/return datetime and factory (SILVER L1)', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const [factoryA] = await db.insert(s.operationalSites).values({
      customerId,
      code: `WS-FA-${marker}`,
      name: `Nhà máy A ${marker}`,
      shortName: `NM A ${marker}`,
      siteType: 'FACTORY',
      address: `Địa chỉ A ${marker}`,
      isActive: true,
    }).returning();
    const [factoryB] = await db.insert(s.operationalSites).values({
      customerId,
      code: `WS-FB-${marker}`,
      name: `Nhà máy B ${marker}`,
      shortName: `NM B ${marker}`,
      siteType: 'FACTORY',
      address: `Địa chỉ B ${marker}`,
      isActive: true,
    }).returning();

    const shipment = await seedShipment({
      blNumber: `WS-GROUP-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'PENDING_DATE',
    });
    // Two appointments at one factory on the same local date must remain two
    // separate dispatch lines; the third appointment exercises factory and
    // date ordering too.
    await seedContainer(shipment.id, {
      containerNumber: `WSGA-${marker}`,
      operationalSiteId: factoryA.id,
      customerAppointmentAt: new Date('2026-08-24T04:00:00.000Z'),
    });
    await seedContainer(shipment.id, {
      containerNumber: `WSGA2-${marker}`,
      operationalSiteId: factoryA.id,
      customerAppointmentAt: new Date('2026-08-24T10:00:00.000Z'),
    });
    await seedContainer(shipment.id, {
      containerNumber: `WSGB-${marker}`,
      operationalSiteId: factoryB.id,
      customerAppointmentAt: new Date('2026-08-25T20:00:00.000Z'),
    });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const item = response.items.find((row) => row.id === shipment.id);
    assert.ok(item, 'seeded shipment should appear in the CUS workspace list');

    assert.deepEqual(item.appointmentGroups.map((group) => ({
      at: group.at,
      localDate: group.localDate,
      factoryName: group.factoryName,
    })), [
      { at: '2026-08-24T04:00:00.000Z', localDate: '2026-08-24', factoryName: `NM A ${marker}` },
      { at: '2026-08-24T10:00:00.000Z', localDate: '2026-08-24', factoryName: `NM A ${marker}` },
      { at: '2026-08-25T20:00:00.000Z', localDate: '2026-08-26', factoryName: `NM B ${marker}` },
    ], 'groups must be keyed by appointment datetime + factory, earliest first');

    assert.deepEqual(item.effectiveFactoryNames, [`NM A ${marker}`, `NM B ${marker}`],
      'multi-factory lots show every distinct factory, never a false single factory');

    await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, [factoryA.id, factoryB.id]));
  });

  test('VID-CUS-01: inherited catalog factory agrees between overview and container detail', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const [factory] = await db.insert(s.operationalSites).values({
      customerId, code: `VID-FA-${marker}`, name: `Nhà máy ${marker}`,
      shortName: `NM ${marker}`, siteType: 'FACTORY', address: `Địa chỉ ${marker}`,
    }).returning();
    try {
      const shipment = await seedShipment({
        blNumber: `VID-FACTORY-${marker}`, operationalSiteId: factory.id, factoryName: null,
      });
      const container = await seedContainer(shipment.id, { operationalSiteId: null });
      const overview = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
      const flat = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
      assert.deepEqual(overview.items.find((row) => row.id === shipment.id)?.effectiveFactoryNames, [`NM ${marker}`]);
      assert.equal(flat.items.find((row) => row.id === container.id)?.factoryName, `NM ${marker}`);
    } finally {
      await db.delete(s.operationalSites).where(eq(s.operationalSites.id, factory.id));
    }
  });

  test('VID-CUS-10: filling a container number preserves port names when its fulfillment is created', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const [factory] = await db.insert(s.operationalSites).values({
      customerId, code: `VID-FP-${marker}`, name: `Nhà máy ${marker}`,
      shortName: `NM ${marker}`, siteType: 'FACTORY', address: `Địa chỉ ${marker}`,
    }).returning();
    const [liftPort, dropPort] = await db.insert(s.ports).values([
      { code: `VID-L-${marker}`, name: `Cảng nâng ${marker}` },
      { code: `VID-D-${marker}`, name: `Cảng hạ ${marker}` },
    ]).returning();
    createdPortIds.push(liftPort.id, dropPort.id);
    try {
      const route = await seedRoute();
      const shipment = await seedShipment({ blNumber: `VID-PORTS-${marker}`, cargoMode: 'FCL', tradeDirection: 'IMPORT', operationalSiteId: factory.id });
      const container = await seedContainer(shipment.id, { routeId: route.id, pickupPortId: liftPort.id, dropoffPortId: dropPort.id });
      const before = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
      assert.equal(before.items.find((row) => row.id === container.id)?.dropoffSite, dropPort.name);
      const updated = await updateCusShipmentContainerLine({
        shipmentId: shipment.id, containerId: container.id, actor: cusActor,
        input: { expectedShipmentVersion: shipment.version, containerNumber: 'MSCU1234566' },
      });
      assert.equal(updated.line.liftSite, liftPort.name);
      assert.equal(updated.line.dropoffSite, dropPort.name);
      const [stored] = await db.select().from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
      assert.equal(stored.pickupPortId, liftPort.id);
      assert.equal(stored.dropoffPortId, dropPort.id);
      const after = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
      assert.equal(after.items.find((row) => row.id === container.id)?.dropoffSite, dropPort.name);
    } finally {
      await db.delete(s.operationalSites).where(eq(s.operationalSites.id, factory.id));
    }
  });

  test('VID-CUS-11: full and suffix searches include padded historical references literally', async () => {
    const marker = Math.random().toString(16).slice(2, 10);
    const reference = `VID_LEGACY%${marker}`;
    const dated = await seedShipment({ blNumber: reference, expectedDeliveryDate: '2026-09-15' });
    const undated = await seedShipment({ blNumber: ` ${reference} ` });
    const unrelated = await seedShipment({ blNumber: `VIDXLEGACY-other-${marker}` });
    for (const shipment of [dated, undated, unrelated]) await seedContainer(shipment.id);
    for (const searchSuffix of [reference.toLowerCase(), marker.slice(-4), marker.slice(-5)]) {
      const query = { page: 1, limit: 100, searchSuffix };
      const overview = await listCusShipmentWorkspace(query, cusActor);
      const flat = await listCusShipmentContainers(query, cusActor);
      for (const shipment of [dated, undated]) {
        assert.ok(overview.items.some((row) => row.id === shipment.id));
        assert.ok(flat.items.some((row) => row.shipmentId === shipment.id));
      }
      if (searchSuffix === reference.toLowerCase()) {
        assert.ok(!overview.items.some((row) => row.id === unrelated.id));
        assert.ok(!flat.items.some((row) => row.shipmentId === unrelated.id));
      }
    }
  });

  test('legacy noon-UTC appointments group under their stored calendar date', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-NOON-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'PENDING_DATE',
      factoryName: `Nhà máy C ${marker}`,
    });
    await seedContainer(shipment.id, {
      containerNumber: `WSN1-${marker}`,
      customerAppointmentAt: new Date('2026-08-24T12:00:00.000Z'), // legacy date-only encoding
    });

    const response = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const item = response.items.find((row) => row.id === shipment.id);
    assert.ok(item);
    assert.equal(item.appointmentGroups.length, 1);
    assert.equal(item.appointmentGroups[0]!.localDate, '2026-08-24', 'noon-UTC stays on its stored date in +07');
    assert.equal(item.appointmentGroups[0]!.factoryName, `Nhà máy C ${marker}`,
      'no container site → shipment factory text is the group factory');
    assert.deepEqual(item.effectiveFactoryNames, [`Nhà máy C ${marker}`]);
  });

  test('CUS container boundary rejects malformed identifiers and another shipment row without partial writes', async () => {
    const shipment = await seedShipment({ cargoMode: 'FCL', status: 'PENDING_DATE' });
    const other = await seedShipment({ cargoMode: 'FCL', status: 'PENDING_DATE' });
    const container = await seedContainer(shipment.id);
    const foreign = await seedContainer(other.id);
    for (const containerNumber of ['ABC', 'MSKU1234567']) {
      await assert.rejects(() => updateCusShipmentContainerLine({
        shipmentId: shipment.id, containerId: container.id,
        input: { expectedShipmentVersion: shipment.version, containerNumber }, actor: cusActor,
      }), (error: unknown) => error instanceof ApiError && error.statusCode === 400);
    }
    await assert.rejects(() => updateCusShipmentContainerLine({
      shipmentId: shipment.id, containerId: foreign.id,
      input: { expectedShipmentVersion: shipment.version, containerNumber: 'MSKU1234565' }, actor: cusActor,
    }), (error: unknown) => error instanceof ApiError && error.statusCode === 404);
    const [row] = await db.select().from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    const [foreignRow] = await db.select().from(s.shipmentContainers).where(eq(s.shipmentContainers.id, foreign.id));
    const [parent] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    assert.equal(row.containerNumber, null);
    assert.equal(foreignRow.containerNumber, null);
    assert.equal(parent.version, shipment.version);
  });

  test('post-handoff container edits apply directly — approval workflow is parked (customer undecided 2026-09-08)', async () => {
    // Build ISO-6346-valid numbers (owner code + serial + computed check
    // digit) so the edit reaches the governance check instead of tripping
    // format validation.
    const marker = Math.random().toString(16).slice(2, 8);
    const digits = marker.replace(/\D/g, '').padEnd(7, '0').slice(0, 7);
    const originalStem = `WSRU${digits.slice(0, 6)}`; // 10 chars: 4-letter owner + 6-digit serial
    const originalNumber = `${originalStem}${calculateCheckDigit(originalStem)}`;
    const editedStem = `${originalStem.slice(0, 9)}${String((Number(originalStem.slice(9)) + 1) % 10)}`;
    const editedNumber = `${editedStem}${calculateCheckDigit(editedStem)}`;
    const shipment = await seedShipment({
      blNumber: `WS-ROUTE-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      // Left intake-editable territory (dispatched):
      status: 'DISPATCHED',
    });
    const container = await seedContainer(shipment.id, { containerNumber: originalNumber });
    await seedFulfillment(shipment.id, container.id);

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        containerNumber: editedNumber,
      },
      actor: cusActor,
    });
    assert.equal(result.line.containerNumber, editedNumber);
  });

  test('TC_UNAS_01 & TC_UNAS_02: ADMIN and MANAGER can update customerAppointmentAt on unassigned container even when shipment is DISPATCHED', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-UNAS-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'DISPATCHED',
    });
    const container = await seedContainer(shipment.id, { containerNumber: `UNAS-${marker}` });
    await seedFulfillment(shipment.id, container.id);

    // ADMIN updates appointment on unassigned container
    const adminResult = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        customerAppointmentAt: '2026-08-26T08:00:00.000Z',
      },
      actor: adminActor,
    });
    assert.equal(adminResult.line.customerAppointmentAt, '2026-08-26T08:00:00.000Z');

    // MANAGER updates appointment on unassigned container
    const managerActor: AuthUser = {
      userId: 0,
      username: 'cus-ws-test-manager',
      email: null,
      fullName: null,
      role: Role.MANAGER,
    };
    const managerResult = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: adminResult.line.shipmentVersion,
        customerAppointmentAt: '2026-08-27T09:00:00.000Z',
      },
      actor: managerActor,
    });
    assert.equal(managerResult.line.customerAppointmentAt, '2026-08-27T09:00:00.000Z');
  });

  test('TC_UNAS_03: when container has an assigned trip (tripId != null), updating schedule is blocked with clear message citing tripCode', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-TRIP-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'DISPATCHED',
    });
    const container = await seedContainer(shipment.id, { containerNumber: `TRP1-${marker}` });
    const fulfillment = await seedFulfillment(shipment.id, container.id);
    const route = await seedRoute();
    const [trip] = await db.insert(s.trips).values({
      tripCode: `TRP-TEST-${marker}`,
      customerId,
      routeId: route.id,
      departureDate: '2026-08-25',
      fulfillmentId: fulfillment.id,
      status: 'CREATED',
    }).returning();
    createdTripIds.push(trip.id);

    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: {
          expectedShipmentVersion: shipment.version,
          customerAppointmentAt: '2026-08-28T10:00:00.000Z',
        },
        actor: adminActor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Container đã gắn chuyến xe \(TRP-TEST-/);
        assert.match(error.message, /Vui lòng đổi lịch trên chuyến xe hoặc gỡ phân xe trước khi sửa/);
        return true;
      },
    );
  });

  test('pre-handoff container edits still save directly', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-PRE-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'PENDING_DATE',
    });
    const container = await seedContainer(shipment.id, { containerNumber: `WSP1-${marker}` });

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        customerAppointmentAt: '2026-08-25T04:00:00.000Z',
      },
      actor: cusActor,
    });
    assert.equal(result.line.customerAppointmentAt, '2026-08-25T04:00:00.000Z');
  });

  test('CUS can plan and clear an internal-fleet plate alongside the OWN carrier', async () => {
    // Customer ask (Cap_nhat_UI_va_logic 1.3): CUS fills/edits SilverSea
    // vehicle info too — the planned plate is a hint, the dispatch trip
    // remains the confirming source.
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-OWN-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'PENDING_DATE',
    });
    const container = await seedContainer(shipment.id, { containerNumber: `WSOWN${marker}`.slice(0, 20) });

    const saved = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plateNumber: '15C-123.45',
      },
      actor: cusActor,
    });
    assert.equal(saved.line.carrierType, 'OWN');
    assert.equal(saved.line.plateNumber, '15C-123.45');

    const cleared = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: saved.line.shipmentVersion,
        plateNumber: null,
      },
      actor: cusActor,
    });
    assert.equal(cleared.line.carrierType, 'OWN');
    assert.equal(cleared.line.plateNumber, null);

    // The read contract must agree with the write path: an OWN line reports a
    // plan-able plate (DIRECT + plateEditable), never the legacy "internal
    // plate comes only from the dispatch order" READ_ONLY.
    const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    const line = detail.containers.find((row) => row.id === container.id);
    assert.equal(line?.fieldAccess.plateNumber.mode, 'DIRECT');
    assert.equal(line?.permissions.plateEditable, true);
  });

  test('vehicle-only writes succeed on an appointment-bearing READY lot', async () => {
    // Regression: the last-appointment guard tested `derivedTransportDate == null`,
    // which is TRUE for `undefined` — and derived is undefined whenever the input
    // did not touch appointments. Every vehicle-only (or other non-schedule)
    // write on an appointment-bearing READY_FOR_DISPATCH lot therefore 409'd
    // with a misleading "cannot delete the last appointment" error.
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const shipment = await seedShipment({
      blNumber: `WS-RDY-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-20',
      status: 'READY_FOR_DISPATCH',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `WSRDY${marker}`.slice(0, 20),
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });

    const saved = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plateNumber: '15C-777.88',
      },
      actor: cusActor,
    });
    assert.equal(saved.line.carrierType, 'OWN');
    assert.equal(saved.line.plateNumber, '15C-777.88');

    // Actually clearing the lot's last appointment on a READY lot must still 409.
    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: {
          expectedShipmentVersion: saved.line.shipmentVersion,
          customerAppointmentAt: null,
        },
        actor: cusActor,
      }),
      /Không thể xóa lịch hẹn cuối cùng/,
    );
  });

  test('route save repairs a legacy unclassified shipment that already has a container', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const route = await seedRoute();
    const [liftPort] = await db.insert(s.ports).values({
      code: `LGCUP${marker}`,
      name: `CusWs cảng nâng legacy ${marker}`,
    }).returning();
    const [dropPort] = await db.insert(s.ports).values({
      code: `LGCDN${marker}`,
      name: `CusWs cảng hạ legacy ${marker}`,
    }).returning();
    createdPortIds.push(liftPort.id, dropPort.id);
    const shipment = await seedShipment({
      blNumber: `WS-LEGACY-${marker}`,
      cargoMode: null,
      status: 'PENDING_DATE',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `WSLEG${marker}`.slice(0, 20),
    });

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        routeId: route.id,
        liftSiteId: liftPort.id,
        dropoffSiteId: dropPort.id,
      },
      actor: cusActor,
    });

    assert.equal(result.line.routeId, route.id);
    assert.equal(result.line.liftSiteId, liftPort.id);
    assert.equal(result.line.dropoffSiteId, dropPort.id);
    assert.equal(result.line.shipmentVersion, shipment.version + 1);

    const [persistedShipment] = await db.select({ cargoMode: s.shipments.cargoMode })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id));
    assert.equal(persistedShipment?.cargoMode, 'FCL');

    const [fulfillment] = await db.select({
      id: s.shipmentFulfillments.id,
      cargoMode: s.shipmentFulfillments.cargoMode,
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
    }).from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    assert.equal(fulfillment?.cargoMode, 'FCL');
    assert.equal(fulfillment?.shipmentContainerId, container.id);
    const snapshotJson = JSON.stringify(fulfillment?.siteSnapshot ?? {});
    assert.ok(snapshotJson.includes(String(liftPort.id)), 'lift site missing from the fulfillment site snapshot');
    assert.ok(snapshotJson.includes(String(dropPort.id)), 'drop site missing from the fulfillment site snapshot');
    if (fulfillment) createdFulfillmentIds.push(fulfillment.id);
  });

  test('explicit LCL shipment with a stray container is rejected, not repaired to FCL', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-LCL-${marker}`,
      cargoMode: 'LCL',
      status: 'PENDING_DATE',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `WSLCL${marker}`.slice(0, 20),
    });

    await assert.rejects(
      updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: {
          expectedShipmentVersion: shipment.version,
        },
        actor: cusActor,
      }),
      /Lô hàng lẻ không được tạo container giả\.|Tác vụ thực hiện hiện có không khớp/,
    );

    const [persisted] = await db.select({ cargoMode: s.shipments.cargoMode })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id));
    assert.equal(persisted?.cargoMode, 'LCL');
    const fulfillments = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    assert.equal(fulfillments.length, 0);
  });

  test('no-op lift/drop port save does not bump shipment version', async () => {
    // Regression: previously, saving lift/drop ports with the same values still
    // bumped the shipment's version (and the fulfillment's version), which made
    // the next identical save 409-conflict and rendered the CUS route editor
    // ("Hình sửa hành trình") useless for any port that the user re-saved.
    const marker = Math.random().toString(16).slice(2, 8);
    const [liftPort] = await db.insert(s.ports).values({
      code: `LIFT${marker}`,
      name: `CusWs cảng nâng ${marker}`,
    }).returning();
    const [dropPort] = await db.insert(s.ports).values({
      code: `DROP${marker}`,
      name: `CusWs cảng hạ ${marker}`,
    }).returning();
    createdPortIds.push(liftPort.id, dropPort.id);
    const shipment = await seedShipment({
      blNumber: `WS-PORTS-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'PENDING_DATE',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `WSPORTS${marker}`.slice(0, 20),
      pickupPortId: liftPort.id,
      dropoffPortId: dropPort.id,
    });
    const startVersion = shipment.version;
    const baselineDetail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    const baselineLine = baselineDetail.containers.find((line) => line.id === container.id);
    assert.ok(baselineLine);
    assert.equal(baselineLine.liftSiteId, liftPort.id);
    assert.equal(baselineLine.dropoffSiteId, dropPort.id);

    const noopResult = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: startVersion,
        liftSiteId: liftPort.id,
        dropoffSiteId: dropPort.id,
      },
      actor: cusActor,
    });
    assert.equal(noopResult.line.shipmentVersion, startVersion,
      'no-op save must keep the shipment version stable for the next edit');

    // And the follow-up identical save must still succeed (not 409), proving
    // the version is no longer bumped by re-sending the same lift/drop ports.
    const followupResult = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: startVersion,
        liftSiteId: liftPort.id,
        dropoffSiteId: dropPort.id,
      },
      actor: cusActor,
    });
    assert.equal(followupResult.line.shipmentVersion, startVersion);
  });

  test('actual lift/drop port change still bumps the shipment version', async () => {
    // Counterpart to the no-op regression: a real port change must still bump
    // the version so the optimistic-concurrency gate works for other clients.
    const marker = Math.random().toString(16).slice(2, 8);
    const [liftPortA] = await db.insert(s.ports).values({
      code: `LFA${marker}`,
      name: `CusWs cảng nâng A ${marker}`,
    }).returning();
    const [liftPortB] = await db.insert(s.ports).values({
      code: `LFB${marker}`,
      name: `CusWs cảng nâng B ${marker}`,
    }).returning();
    createdPortIds.push(liftPortA.id, liftPortB.id);
    const shipment = await seedShipment({
      blNumber: `WS-PORTBUMP-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'PENDING_DATE',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `WSPB${marker}`.slice(0, 20),
      pickupPortId: liftPortA.id,
    });
    const startVersion = shipment.version;

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: startVersion,
        liftSiteId: liftPortB.id,
      },
      actor: cusActor,
    });
    assert.equal(result.line.shipmentVersion, startVersion + 1,
      'real port change must still bump shipment version once');
    assert.equal(result.line.liftSiteId, liftPortB.id);
  });

  test('allows a post-handoff port edit when the submitted route is unchanged', async () => {
    // The route editor submits routeId, liftSiteId, and dropoffSiteId together.
    // An unchanged routeId must not turn the port edit into anything special —
    // the approval workflow is parked (customer undecided 2026-09-08), so all
    // post-handoff container edits apply directly.
    const marker = Math.random().toString(16).slice(2, 8);
    const route = await seedRoute();
    const [liftPortA] = await db.insert(s.ports).values({
      code: `PHA${marker}`,
      name: `CusWs post-handoff A ${marker}`,
    }).returning();
    const [liftPortB] = await db.insert(s.ports).values({
      code: `PHB${marker}`,
      name: `CusWs post-handoff B ${marker}`,
    }).returning();
    createdPortIds.push(liftPortA.id, liftPortB.id);
    const shipment = await seedShipment({
      blNumber: `WS-POST-HANDOFF-${marker}`,
      cargoMode: 'FCL',
      status: 'IN_TRANSIT',
      routeId: route.id,
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `WSPH${marker}`.slice(0, 20),
      routeId: route.id,
      pickupPortId: liftPortA.id,
    });

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        routeId: route.id,
        liftSiteId: liftPortB.id,
        dropoffSiteId: liftPortB.id,
      },
      actor: cusActor,
    });

    assert.equal(result.line.shipmentVersion, shipment.version + 1);
    assert.equal(result.line.routeId, route.id);
    assert.equal(result.line.liftSiteId, liftPortB.id);
    assert.equal(result.line.dropoffSiteId, liftPortB.id);
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
    // sites, appointment. Carrier is gated by the container appointment; a
    // shipment-level date must not make an FCL container dispatch-ready.
    assert.ok(codes.includes('DIRECTION'));
    assert.ok(codes.includes('DECLARATION'));
    assert.ok(codes.includes('ROUTE'));
    assert.ok(codes.includes('SHIPPING_LINE'));
    assert.ok(codes.includes('LIFT_SITE'));
    assert.ok(codes.includes('DROPOFF_SITE'));
    assert.ok(codes.includes('APPOINTMENT'));
    assert.equal(codes.includes('CARRIER'), false);
    // Present, so not flagged: bill number, container number, container type
    // (seedContainer defaults it). The old shipment-level date is ignored for
    // FCL, therefore the missing container appointment also yields
    // TRANSPORT_DATE.
    // BKS not applicable because no external carrier is selected yet.
    assert.equal(codes.includes('BILL_BOOKING'), false);
    assert.equal(codes.includes('TRANSPORT_DATE'), true);
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
    const { liftPortId, dropPortId } = await seedLiftDropPorts();
    const container = await seedContainer(shipment.id, {
      containerNumber: `DON${suffix}1`.slice(0, 50),
      routeId: route.id,
      containerTypeId,
      pickupPortId: liftPortId,
      dropoffPortId: dropPortId,
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

  test('container ports clear LIFT_SITE/DROPOFF_SITE even when the snapshot halves are empty', async () => {
    const [liftPort] = await db.insert(s.ports).values({
      code: `LPRT${lettersTag(5)}`,
      name: `Cảng nâng thử ${suffix}`.slice(0, 255),
    }).returning();
    const [dropPort] = await db.insert(s.ports).values({
      code: `DPRT${lettersTag(5)}`,
      name: `Cảng hạ thử ${suffix}`.slice(0, 255),
    }).returning();
    createdPortIds.push(liftPort.id, dropPort.id);

    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `PORT${suffix}`.slice(0, 100),
      expectedDeliveryDate: '2026-08-20',
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: route.id,
      shippingLineName: 'Maersk',
    });
    await seedDeclaration(shipment.id);
    const container = await seedContainer(shipment.id, {
      containerNumber: `PRT${suffix}1`.slice(0, 50),
      routeId: route.id,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
      pickupPortId: liftPort.id,
      dropoffPortId: dropPort.id,
    });
    // Legacy decomposed row: the snapshot never received its halves, exactly
    // like FCL fulfillments created before the port columns became the
    // authority. The row displays the port names, so its status must not
    // flag "Chưa cập nhật điểm nhận/trả hàng" for them.
    await seedFulfillment(shipment.id, container.id, {
      siteSnapshot: {},
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-777.77',
    });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    assert.equal(row.liftSite, `Cảng nâng thử ${suffix}`.slice(0, 255));
    assert.equal(row.dropoffSite, `Cảng hạ thử ${suffix}`.slice(0, 255));
    assert.equal(row.informationStatus, 'COMPLETE');
    assert.deepEqual(row.missingFields, []);

    // SQL twin agreement: the "Chưa cập nhật" queue must not select this row.
    const missingQueue = await listCusShipmentContainers(
      { page: 1, limit: 100, informationStatus: 'MISSING', searchSuffix: suffix.slice(-5) },
      cusActor,
    );
    assert.equal(missingQueue.items.some((candidate) => candidate.shipmentId === shipment.id), false);
  });

  test('projects the container shipping-line fallback used by completeness filtering', async () => {
    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `LINE${suffix}`,
      expectedDeliveryDate: '2026-08-20',
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: route.id,
      shippingLineName: null,
    });
    await seedDeclaration(shipment.id);
    const { liftPortId, dropPortId } = await seedLiftDropPorts();
    const container = await seedContainer(shipment.id, {
      containerNumber: `LIN${suffix}1`.slice(0, 50),
      routeId: route.id,
      containerTypeId,
      pickupPortId: liftPortId,
      dropoffPortId: dropPortId,
      shippingLineName: 'ONE',
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    await seedFulfillment(shipment.id, container.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-123.45',
    });

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    assert.equal(row.shippingLineName, 'ONE');
    assert.equal(row.informationStatus, 'COMPLETE');
    assert.equal(row.missingFields.some((field) => field.code === 'SHIPPING_LINE'), false);
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
    const { liftPortId, dropPortId } = await seedLiftDropPorts();
    const completeContainer = await seedContainer(complete.id, {
      containerNumber: `MC-${marker}`.slice(0, 50),
      routeId: completeRoute.id,
      containerTypeId,
      pickupPortId: liftPortId,
      dropoffPortId: dropPortId,
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

  test('dispatchStatus splits rows by active carrier presence with count parity', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    const assigned = await seedShipment({ blNumber: `DA-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const assignedContainer = await seedContainer(assigned.id, { containerNumber: `DA-${marker}`.slice(0, 50) });
    await seedFulfillment(assigned.id, assignedContainer.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-123.45',
    });

    const unassigned = await seedShipment({ blNumber: `CH-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    await seedContainer(unassigned.id, { containerNumber: `CH-${marker}`.slice(0, 50) });

    // A canceled trip must not count as an assignment: without a planned
    // carrier the row stays in the legacy carrier-absence filter.
    const canceled = await seedShipment({ blNumber: `CX-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const canceledContainer = await seedContainer(canceled.id, { containerNumber: `CX-${marker}`.slice(0, 50) });
    const canceledFulfillment = await seedFulfillment(canceled.id, canceledContainer.id);
    const canceledTrip = await insertTripComposite(db, {
      fulfillmentId: canceledFulfillment.id,
      customerId,
      routeId: (await seedRoute()).id,
      status: 'CANCELED',
      carrierType: 'OWN',
      departureDate: '2026-08-20',
    });
    createdTripIds.push(canceledTrip.id);

    const unassignedResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'UNASSIGNED',
    }, cusActor);
    assert.ok(unassignedResponse.items.some((row) => row.shipmentId === unassigned.id));
    assert.ok(unassignedResponse.items.some((row) => row.shipmentId === canceled.id), 'canceled trip falls back to the carrier-absence filter');
    assert.equal(unassignedResponse.items.some((row) => row.shipmentId === assigned.id), false);
    assert.equal(unassignedResponse.total, unassignedResponse.items.length, 'count query agrees with item query');
    // Vehicle-less rows badge "Chờ phân xe"; the plate-bearing allocated row
    // moved out of that population — it badges "Đã phân xe" (PLANNED).
    assert.ok(unassignedResponse.items.every((row) => row.dispatchStatus === 'AWAITING_VEHICLE'));

    const assignedResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'ASSIGNED',
    }, cusActor);
    assert.ok(assignedResponse.items.some((row) => row.shipmentId === assigned.id));
    assert.equal(assignedResponse.items.some((row) => row.shipmentId === unassigned.id), false);
    assert.equal(assignedResponse.items.some((row) => row.shipmentId === canceled.id), false);
    assert.equal(assignedResponse.total, assignedResponse.items.length, 'count query agrees with item query');
    assert.ok(assignedResponse.items.every((row) => row.dispatchStatus === 'PLANNED'));
  });

  test('dispatchStatus record statuses filter by the badge derivation', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');

    // COMPLETED badge: an executed trip that finished.
    const done = await seedShipment({ blNumber: `HT-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const doneContainer = await seedContainer(done.id, { containerNumber: `HT-${marker}`.slice(0, 50) });
    const doneFulfillment = await seedFulfillment(done.id, doneContainer.id);
    const doneTrip = await insertTripComposite(db, {
      fulfillmentId: doneFulfillment.id,
      customerId,
      routeId: (await seedRoute()).id,
      status: 'COMPLETED',
      carrierType: 'OWN',
      departureDate: '2026-08-20',
    });
    createdTripIds.push(doneTrip.id);

    // Pre-trip rows: carrier planned without a trip, and a no-carrier row —
    // both badge "Chờ phân xe" (AWAITING_VEHICLE).
    const planned = await seedShipment({ blNumber: `PX-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const plannedContainer = await seedContainer(planned.id, { containerNumber: `PX-${marker}`.slice(0, 50) });
    await seedFulfillment(planned.id, plannedContainer.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-777.77',
    });

    const unassigned = await seedShipment({ blNumber: `CX-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    await seedContainer(unassigned.id, { containerNumber: `CX-${marker}`.slice(0, 50) });

    const completedResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'COMPLETED',
    }, cusActor);
    assert.ok(completedResponse.items.some((row) => row.shipmentId === done.id));
    assert.equal(completedResponse.items.some((row) => row.shipmentId === planned.id), false);
    assert.equal(completedResponse.items.some((row) => row.shipmentId === unassigned.id), false);
    assert.equal(completedResponse.total, completedResponse.items.length, 'count query agrees with item query');
    assert.ok(completedResponse.items.every((row) => row.dispatchStatus === 'COMPLETED'));

    // AWAITING_VEHICLE excludes both the COMPLETED row and the plate-bearing
    // allocated row — record-status granularity goes beyond the ASSIGNED
    // split, and an allocated vehicle is no longer "Chờ phân xe".
    const awaitingResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'AWAITING_VEHICLE',
    }, cusActor);
    assert.equal(awaitingResponse.items.some((row) => row.shipmentId === planned.id), false, 'an allocated plate is Đã phân xe, not Chờ phân xe');
    assert.ok(awaitingResponse.items.some((row) => row.shipmentId === unassigned.id));
    assert.equal(awaitingResponse.items.some((row) => row.shipmentId === done.id), false);
    assert.equal(awaitingResponse.total, awaitingResponse.items.length, 'count query agrees with item query');
    assert.ok(awaitingResponse.items.every((row) => row.dispatchStatus === 'AWAITING_VEHICLE'));

    const plannedResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'PLANNED',
    }, cusActor);
    assert.ok(plannedResponse.items.some((row) => row.shipmentId === planned.id), 'allocated plate lands in the Đã phân xe filter');
    assert.equal(plannedResponse.items.some((row) => row.shipmentId === done.id), false);
    assert.equal(plannedResponse.items.some((row) => row.shipmentId === unassigned.id), false);
    assert.equal(plannedResponse.total, plannedResponse.items.length, 'count query agrees with item query');
    assert.ok(plannedResponse.items.every((row) => row.dispatchStatus === 'PLANNED'));
  });

  test('dispatchStatus reads Đã tạo chuyến only while the appointment date is missing', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');

    // CREATED trip that already has its ngày đóng/trả: it is waiting on the
    // vehicle, not on "Đã tạo chuyến".
    const dated = await seedShipment({ blNumber: `DC-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const datedContainer = await seedContainer(dated.id, {
      containerNumber: `DC-${marker}`.slice(0, 50),
      customerAppointmentAt: new Date('2026-08-20T02:00:00.000Z'),
    });
    const datedFulfillment = await seedFulfillment(dated.id, datedContainer.id);
    const datedTrip = await insertTripComposite(db, {
      fulfillmentId: datedFulfillment.id,
      customerId,
      routeId: (await seedRoute()).id,
      status: 'CREATED',
      carrierType: 'OWN',
      departureDate: '2026-08-20',
    });
    createdTripIds.push(datedTrip.id);

    // CREATED trip still missing the date: the only true "Đã tạo chuyến".
    const undated = await seedShipment({ blNumber: `TC-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const undatedContainer = await seedContainer(undated.id, { containerNumber: `TC-${marker}`.slice(0, 50) });
    const undatedFulfillment = await seedFulfillment(undated.id, undatedContainer.id);
    const undatedTrip = await insertTripComposite(db, {
      fulfillmentId: undatedFulfillment.id,
      customerId,
      routeId: (await seedRoute()).id,
      status: 'CREATED',
      carrierType: 'OWN',
      departureDate: '2026-08-20',
    });
    createdTripIds.push(undatedTrip.id);

    const createdResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'CREATED',
    }, cusActor);
    assert.ok(createdResponse.items.some((row) => row.shipmentId === undated.id));
    assert.equal(createdResponse.items.some((row) => row.shipmentId === dated.id), false, 'a CREATED trip with its appointment is not Đã tạo chuyến');
    assert.equal(createdResponse.total, createdResponse.items.length, 'count query agrees with item query');
    assert.ok(createdResponse.items.every((row) => row.dispatchStatus === 'CREATED'));

    const awaitingResponse = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'AWAITING_VEHICLE',
    }, cusActor);
    assert.ok(awaitingResponse.items.some((row) => row.shipmentId === dated.id));
    assert.equal(awaitingResponse.items.some((row) => row.shipmentId === undated.id), false);
    assert.equal(awaitingResponse.total, awaitingResponse.items.length, 'count query agrees with item query');
    assert.ok(awaitingResponse.items.every((row) => row.dispatchStatus === 'AWAITING_VEHICLE'));
  });

  test('dispatchStatus reads Đã phân xe once a vehicle is on the line', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');

    // Bug regression (customer report 2026-09-08): a container whose Phân xe
    // column already shows a plate must not badge "Chờ phân xe".
    // Case 1 — allocation only (planned plate, no trip issued yet).
    const allocationOnly = await seedShipment({ blNumber: `AO-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const allocationOnlyContainer = await seedContainer(allocationOnly.id, {
      containerNumber: `AO-${marker}`.slice(0, 50),
      customerAppointmentAt: new Date('2026-08-20T02:00:00.000Z'),
    });
    await seedFulfillment(allocationOnly.id, allocationOnlyContainer.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedVehiclePlateNumber: '29C-888.88',
    });

    // Case 2 — an issued OWN trip whose truck carries the plate: trip
    // resources are status-only now. With no planned allocation the line
    // reads "Chờ phân xe" — dispatch shows "Chưa phân nhà xe, CUS sẽ bổ
    // sung" for the exact same state, and the two workspaces must agree.
    const ownTruck = await seedShipment({ blNumber: `OT-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const ownTruckContainer = await seedContainer(ownTruck.id, {
      containerNumber: `OT-${marker}`.slice(0, 50),
      customerAppointmentAt: new Date('2026-02-20T02:00:00.000Z'),
    });
    const ownTruckFulfillment = await seedFulfillment(ownTruck.id, ownTruckContainer.id);
    const [truck] = await db.insert(s.trucks).values({ licensePlate: `15C-${marker}` }).returning();
    createdTruckIds.push(truck!.id);
    const ownTruckTrip = await insertTripComposite(db, {
      fulfillmentId: ownTruckFulfillment.id,
      customerId,
      routeId: (await seedRoute()).id,
      status: 'CREATED',
      carrierType: 'OWN',
      truckId: truck!.id,
      departureDate: '2026-08-20',
    });
    createdTripIds.push(ownTruckTrip.id);

    // Case 3 — the date alone never satisfies "Đã phân xe": a trip with the
    // ngày đóng/trả set but no truck and no planned plate stays "Chờ phân xe".
    const noVehicle = await seedShipment({ blNumber: `NV-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const noVehicleContainer = await seedContainer(noVehicle.id, {
      containerNumber: `NV-${marker}`.slice(0, 50),
      customerAppointmentAt: new Date('2026-08-20T02:00:00.000Z'),
    });
    const noVehicleFulfillment = await seedFulfillment(noVehicle.id, noVehicleContainer.id);
    const noVehicleTrip = await insertTripComposite(db, {
      fulfillmentId: noVehicleFulfillment.id,
      customerId,
      routeId: (await seedRoute()).id,
      status: 'CREATED',
      carrierType: 'OWN',
      departureDate: '2026-08-20',
    });
    createdTripIds.push(noVehicleTrip.id);

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const rowsByShipment = new Map(response.items.map((row) => [row.shipmentId, row]));
    assert.equal(rowsByShipment.get(allocationOnly.id)?.dispatchStatus, 'PLANNED', 'a planned plate without a trip is Đã phân xe');
    assert.equal(rowsByShipment.get(ownTruck.id)?.dispatchStatus, 'AWAITING_VEHICLE', 'a trip without a planned allocation stays Chờ phân xe — dispatch reads the same state as Chưa phân nhà xe');
    assert.equal(rowsByShipment.get(noVehicle.id)?.dispatchStatus, 'AWAITING_VEHICLE', 'date without a vehicle stays Chờ phân xe');

    // The plate the Phân xe column shows is exactly the plate that moved the
    // badge — badge and column can never disagree. Trip resources surface
    // nowhere as current identity: the trip's truck is not the planned value.
    assert.equal(rowsByShipment.get(allocationOnly.id)?.plateNumber, '29C-888.88');
    assert.equal(rowsByShipment.get(ownTruck.id)?.plateNumber, null);

    const plannedFilter = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'PLANNED',
    }, cusActor);
    assert.ok(plannedFilter.items.some((row) => row.shipmentId === allocationOnly.id));
    assert.equal(plannedFilter.items.some((row) => row.shipmentId === ownTruck.id), false);
    assert.equal(plannedFilter.items.some((row) => row.shipmentId === noVehicle.id), false);
    assert.ok(plannedFilter.items.every((row) => row.dispatchStatus === 'PLANNED'));

    const awaitingFilter = await listCusShipmentContainers({
      page: 1,
      limit: 100,
      searchSuffix: marker,
      dispatchStatus: 'AWAITING_VEHICLE',
    }, cusActor);
    assert.ok(awaitingFilter.items.some((row) => row.shipmentId === noVehicle.id));
    assert.ok(awaitingFilter.items.some((row) => row.shipmentId === ownTruck.id));
    assert.equal(awaitingFilter.items.some((row) => row.shipmentId === allocationOnly.id), false);

    // Plan-vs-execution counters: the planned allocation IS the current
    // assignment, so the CUS counter agrees with dispatch's reading. A
    // trip-only OWN row (no plan) is not counted; a plan-only OWN row with a
    // plate is assigned-by-plan.
    const planOnlyOwn = await seedShipment({ blNumber: `PO-${marker}`, cargoMode: 'FCL', expectedDeliveryDate: '2026-08-20' });
    const planOnlyOwnContainer = await seedContainer(planOnlyOwn.id, {
      containerNumber: `PO-${marker}`.slice(0, 50),
      customerAppointmentAt: new Date('2026-08-20T02:00:00.000Z'),
    });
    await seedFulfillment(planOnlyOwn.id, planOnlyOwnContainer.id, {
      plannedCarrierType: 'OWN',
      plannedVehiclePlateNumber: '15C-777.77',
    });

    const counterBoard = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const countersById = new Map(counterBoard.items.map((item) => [item.id, item]));
    assert.equal(countersById.get(ownTruck.id)?.operational.assignedContainers, 0, 'trip-only OWN is execution, not assignment — counter stays 0');
    assert.equal(countersById.get(planOnlyOwn.id)?.operational.assignedContainers, 1, 'plan-only OWN with a plate counts as assigned-by-plan');
  });

  test('FCL carrier readiness follows the container appointment, not the shipment date', async () => {
    // The container appointment exists, while the shipment-level date does
    // not. FCL therefore requires the carrier and must not flag the root date.
    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `NODATE${suffix}`,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      routeId: route.id,
      shippingLineName: 'Maersk',
    });
    await seedDeclaration(shipment.id);
    const { liftPortId, dropPortId } = await seedLiftDropPorts();
    const container = await seedContainer(shipment.id, {
      containerNumber: `NOD${suffix}1`.slice(0, 50),
      routeId: route.id,
      containerTypeId,
      pickupPortId: liftPortId,
      dropoffPortId: dropPortId,
      customerAppointmentAt: new Date('2026-08-20T02:00:00Z'),
    });
    await seedFulfillment(shipment.id, container.id, {});

    const response = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: suffix.slice(-5) }, cusActor);
    const row = response.items.find((candidate) => candidate.shipmentId === shipment.id);
    assert.ok(row);
    const codes = row.missingFields.map((field) => field.code);
    assert.deepEqual(codes, ['CARRIER']);
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
      routeId: route.id,
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

describe('LCL delivery date — create persistence and workspace projection', () => {
  test('an LCL lot created with a primary delivery date keeps and shows it without container rows', async () => {
    const marker = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');

    const deliveryDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    // Same shape the Tạo lô hàng LCL flow submits (buildShipmentRootPayload):
    // LCL keeps a shipment-level delivery date; no container rows exist.
    const shipment = await createShipment({
      customerId,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `LCLDATE-${marker}`,
      expectedDeliveryDate: deliveryDate,
      packageCount: 10,
      packageType: 'QA Carton',
      cargoWeightKg: '100',
      cargoVolumeCbm: '2',
    });
    createdShipmentIds.push(shipment.id);

    // Root row keeps the entered date and reads dispatch-ready by date.
    assert.equal(shipment.expectedDeliveryDate, deliveryDate);
    assert.equal(shipment.status, 'READY_FOR_DISPATCH');

    // Overview shows the date — never "Chưa chốt ngày".
    const board = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const item = board.items.find((row) => row.id === shipment.id);
    assert.ok(item, 'LCL lot appears in the overview');
    assert.equal(item!.transportDate, deliveryDate);
    assert.equal(item!.operational.scheduleReadiness, 'SCHEDULED');

    // Detail summary agrees with the overview.
    const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(detail.summary.transportDate, deliveryDate);
    assert.equal(detail.summary.operational.scheduleReadiness, 'SCHEDULED');

    // The dated LCL lot opens the dispatch handoff — the master plan's rows
    // inner-join dispatchHandoffs, so no handoff row means no dispatch path.
    const [handoff] = await db.select({ id: s.dispatchHandoffs.id })
      .from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.ok(handoff, 'dated LCL create opens the dispatch handoff');

    // Before any allocation the LCL lot shows genuine waiting states — never
    // "Không áp dụng điều xe" (transport applies to LCL with zero containers).
    assert.equal(item!.operational.vehicleReadiness, 'WAITING_CARRIER');

    // Allocating the lot-level LCL fulfillment (no container row) surfaces
    // the carrier chip and READY readiness in overview + detail alike.
    await seedFulfillment(shipment.id, null, {
      fulfillmentType: 'LCL_SHIPMENT',
      cargoMode: 'LCL',
      dispatchClassification: 'LCL',
      plannedCarrierType: 'OWN',
      plannedVehiclePlateNumber: '15C-555.55',
    });
    const boardAfter = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const itemAfter = boardAfter.items.find((row) => row.id === shipment.id);
    assert.ok(itemAfter, 'LCL lot still listed after allocation');
    assert.equal(itemAfter!.operational.vehicleReadiness, 'READY');
    assert.deepEqual(itemAfter!.carrierAssignments, [{ carrierName: 'SilverSea', plateNumber: '15C-555.55' }]);

    const detailAfter = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(detailAfter.summary.operational.vehicleReadiness, 'READY');
    assert.deepEqual(detailAfter.summary.carrierAssignments, [{ carrierName: 'SilverSea', plateNumber: '15C-555.55' }]);
  });
});

describe('Container appointment removal — drawer clear persistence', () => {
  // The drawer's Xóa hẹn sends { customerAppointmentAt: null } through the
  // line-update endpoint. HEAD behavior pins what QA's "clear never saves"
  // report should read on a fresh build: a legitimate clear persists, and the
  // one guarded case rejects with an explanatory message.
  test('clearing an appointment on a partially dated PENDING_DATE lot persists as unscheduled', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-09-20',
      status: 'PENDING_DATE',
    });
    const dated = await seedContainer(shipment.id, {
      containerNumber: `CLRA${marker}`,
      customerAppointmentAt: new Date('2026-09-20T01:00:00.000Z'),
    });
    // Second container without an appointment keeps the lot pre-dispatch, so
    // the READY_FOR_DISPATCH clear guard below does not apply here.
    await seedContainer(shipment.id, { containerNumber: `CLRB${marker}` });
    await seedFulfillment(shipment.id, dated.id);

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: dated.id,
      input: {
        expectedShipmentVersion: shipment.version,
        customerAppointmentAt: null,
      },
      actor: cusActor,
    });

    assert.equal(result.line.customerAppointmentAt, null);

    const [stored] = await db.select({ customerAppointmentAt: s.shipmentContainers.customerAppointmentAt })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.id, dated.id))
      .limit(1);
    assert.equal(stored?.customerAppointmentAt, null);

    // Root projection follows the containers: no dated container left → no
    // transport date, and the lot never left the pre-dispatch state.
    const [root] = await db.select({
      expectedDeliveryDate: s.shipments.expectedDeliveryDate,
      status: s.shipments.status,
    }).from(s.shipments)
      .where(eq(s.shipments.id, shipment.id))
      .limit(1);
    assert.equal(root?.expectedDeliveryDate, null);
    assert.equal(root?.status, 'PENDING_DATE');

    const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(detail.containers.find((row) => row.id === dated.id)?.customerAppointmentAt, null);
  });

  test('clearing the only dated appointment on a READY_FOR_DISPATCH lot is rejected with an explanation', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-09-20',
      status: 'READY_FOR_DISPATCH',
    });
    const dated = await seedContainer(shipment.id, {
      containerNumber: `CLRR${marker}`,
      customerAppointmentAt: new Date('2026-09-20T01:00:00.000Z'),
    });
    await seedFulfillment(shipment.id, dated.id);

    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: dated.id,
        input: {
          expectedShipmentVersion: shipment.version,
          customerAppointmentAt: null,
        },
        actor: cusActor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Không thể xóa lịch hẹn cuối cùng/);
        return true;
      },
    );

    // Rejection keeps the appointment — the drawer stays dirty and explains why.
    const [stored] = await db.select({ customerAppointmentAt: s.shipmentContainers.customerAppointmentAt })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.id, dated.id))
      .limit(1);
    assert.ok(stored?.customerAppointmentAt);
  });

  test('line-update wire contract accepts the null clear and the offset-bearing set', () => {
    // Drawer save path: localDateTimeToIso produces the offset-bearing form;
    // Xóa hẹn produces null. Both must keep parsing or the drawer clear dies.
    const clear = shipmentCusContainerLineUpdateSchema.safeParse({
      expectedShipmentVersion: 1,
      customerAppointmentAt: null,
    });
    assert.equal(clear.success, true);

    const set = shipmentCusContainerLineUpdateSchema.safeParse({
      expectedShipmentVersion: 1,
      customerAppointmentAt: '2026-09-20T08:00:00+07:00',
    });
    assert.equal(set.success, true);
  });
});

describe('Linked-trip guard is value-aware (container number is identity, not an operational edit)', () => {
  // 2026-09-13 CUS repro: a number-only save on an assigned nonterminal
  // container was rejected by the linked-trip guard because the guard keyed
  // on field PRESENCE — and the CUS container dialog submits the full spec
  // set on every save. The guard now fires only when a guarded field's
  // VALUE actually changes; the number write itself stays validated
  // (format + in-lot duplicates) and never disturbs trip linkage.

  let numberSeq = 0;
  function validContainerNumber(): string {
    // ISO 6346 owner+serial must total 10 chars before the check digit; the
    // per-call sequence keeps every generated number unique within the lot.
    numberSeq += 1;
    const base = `QATU${String(1000000 + numberSeq).slice(1)}`;
    return `${base}${calculateCheckDigit(base)}`;
  }

  async function seedAssignedLot(args: { status?: 'DISPATCHED' | 'COMPLETED' | 'READY_FOR_DISPATCH' } = {}) {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-NUM-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: args.status ?? 'DISPATCHED',
    });
    const container = await seedContainer(shipment.id); // unnumbered by default
    const fulfillment = await seedFulfillment(shipment.id, container.id);
    return { marker, shipment, container, fulfillment };
  }

  async function attachTrip(fulfillmentId: number, marker: string) {
    const route = await seedRoute();
    const [trip] = await db.insert(s.trips).values({
      tripCode: `TRP-NUM-${marker}`,
      customerId,
      routeId: route.id,
      departureDate: '2026-08-25',
      fulfillmentId,
      status: 'CREATED',
    }).returning();
    createdTripIds.push(trip.id);
    return trip;
  }

  test('a number-only add on an assigned nonterminal container saves without the linked-trip guard', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot();
    const trip = await attachTrip(fulfillment.id, marker);
    const nextNumber = validContainerNumber();

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, containerNumber: nextNumber },
      actor: adminActor,
    });
    assert.equal(result.line.containerNumber, nextNumber);

    // Schedule/carrier/vehicle/trip linkage untouched: the fulfillment's
    // planned block and the trip row are exactly what they were.
    const [fulfillmentAfter] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal(fulfillmentAfter.version, fulfillment.version);
    assert.equal(fulfillmentAfter.plannedCarrierType, null);
    assert.equal(fulfillmentAfter.plannedVehiclePlateNumber, null);
    const [tripAfter] = await db.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, trip.id));
    assert.equal(tripAfter.status, 'CREATED');



    // Visible after reload through the CUS projection.
    const flat = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, cusActor);
    const flatRow = flat.items.find((item) => item.id === container.id);
    assert.equal(flatRow?.containerNumber, nextNumber);
  });

  test('a rejected CUS container-line correction writes nothing (partial-write rollback)', async () => {
    const { shipment, container } = await seedAssignedLot();

    const readRow = () => Promise.all([
      db.select({
        number: s.shipmentContainers.containerNumber,
        type: s.shipmentContainers.containerTypeId,
      }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id)),
      db.select({ version: s.shipments.version }).from(s.shipments).where(eq(s.shipments.id, shipment.id)),
    ]);
    const before = await readRow();

    // 'ABC' trips the shared ISO 6346 gate before any write happens.
    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: { expectedShipmentVersion: shipment.version, containerNumber: 'ABC' },
        actor: adminActor,
      }),
      (error: { statusCode?: number }) => error.statusCode === 400,
    );

    // Row byte-identical: no version bump, no partial field writes.
    const after = await readRow();
    assert.deepEqual(after, before);
  });
  test('the CUS dialog full-form echo (number + unchanged type/weight/volume) saves on a tripped row', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot();
    await attachTrip(fulfillment.id, marker);
    const nextNumber = validContainerNumber();

    // Mirrors the container dialog's save: every spec field rides the wire
    // even when only the number changed. The echoes match the seeded values
    // (default type, no weight/volume), so the value-aware guard stays cold.
    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        containerNumber: nextNumber,
        containerTypeId,
        cargoWeightKg: null,
        cargoVolumeCbm: null,
      },
      actor: adminActor,
    });
    assert.equal(result.line.containerNumber, nextNumber);
  });

  test('a real container-type change on a tripped row still follows the linked-trip workflow', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot();
    await attachTrip(fulfillment.id, marker);

    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: { expectedShipmentVersion: shipment.version, containerTypeId: containerType20Id },
        actor: adminActor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Container đã gắn chuyến xe \(TRP-NUM-/);
        return true;
      },
    );
  });

  test('SISPROD-CUS-ACCESS linked-trip CUS route and port changes still reject with no partial write', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot();
    await attachTrip(fulfillment.id, marker);
    const route = await seedRoute();
    const ports = await seedLiftDropPorts();
    const readState = () => Promise.all([
      db.select({
        routeId: s.shipmentContainers.routeId,
        pickupPortId: s.shipmentContainers.pickupPortId,
        dropoffPortId: s.shipmentContainers.dropoffPortId,
      }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id)),
      db.select({ version: s.shipments.version }).from(s.shipments).where(eq(s.shipments.id, shipment.id)),
    ]);
    const before = await readState();
    for (const update of [{ routeId: route.id }, { liftSiteId: ports.liftPortId }, { dropoffSiteId: ports.dropPortId }]) {
      await assert.rejects(
        () => updateCusShipmentContainerLine({
          shipmentId: shipment.id,
          containerId: container.id,
          input: { expectedShipmentVersion: shipment.version, ...update },
          actor: cusActor,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /Container đã gắn chuyến xe \(TRP-NUM-/);
          return true;
        },
      );
      assert.deepEqual(await readState(), before);
    }
  });

  test('a same-value appointment echo does not trip the guard on a tripped row', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot();
    await attachTrip(fulfillment.id, marker);
    const sameInstant = '2026-08-24T02:00:00.000Z';
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: new Date(sameInstant) })
      .where(eq(s.shipmentContainers.id, container.id));

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, customerAppointmentAt: sameInstant },
      actor: adminActor,
    });
    assert.equal(result.line.customerAppointmentAt, sameInstant);
  });

  test('terminal lots still refuse the number add with the terminal-lot message', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot({ status: 'COMPLETED' });
    await attachTrip(fulfillment.id, marker);

    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: container.id,
        input: { expectedShipmentVersion: shipment.version, containerNumber: validContainerNumber() },
        actor: adminActor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Lô hàng đã kết thúc/);
        return true;
      },
    );
  });

  test('a multi-container lot updates only the intended row; in-lot duplicate numbers still reject', async () => {
    const { marker, shipment, container, fulfillment } = await seedAssignedLot();
    await attachTrip(fulfillment.id, marker);
    const siblingNumber = validContainerNumber();
    const sibling = await seedContainer(shipment.id, { containerNumber: siblingNumber });
    await seedFulfillment(shipment.id, sibling.id);

    // The intended row: the unnumbered, tripped container takes the number.
    const targetNumber = validContainerNumber();
    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, containerNumber: targetNumber },
      actor: adminActor,
    });
    assert.equal(result.line.containerNumber, targetNumber);
    const [siblingAfter] = await db.select({ containerNumber: s.shipmentContainers.containerNumber })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.id, sibling.id));
    assert.equal(siblingAfter.containerNumber, siblingNumber);

    // Writing the sibling's number onto another row is a 400 duplicate —
    // the number edit kept its own validation. (Ride the post-save version:
    // the first number write bumped the shipment.)
    const third = await seedContainer(shipment.id);
    await seedFulfillment(shipment.id, third.id);
    await assert.rejects(
      () => updateCusShipmentContainerLine({
        shipmentId: shipment.id,
        containerId: third.id,
        input: { expectedShipmentVersion: result.line.shipmentVersion, containerNumber: siblingNumber },
        actor: adminActor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /đã tồn tại trong lô hàng/);
        return true;
      },
    );
  });

  test('an unnumbered unassigned container keeps saving numbers directly', async () => {
    const marker = Math.random().toString(16).slice(2, 8);
    const shipment = await seedShipment({
      blNumber: `WS-NUM-FREE-${marker}`,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-24',
      status: 'READY_FOR_DISPATCH',
    });
    const container = await seedContainer(shipment.id);
    await seedFulfillment(shipment.id, container.id);
    const nextNumber = validContainerNumber();

    const result = await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, containerNumber: nextNumber },
      actor: adminActor,
    });
    assert.equal(result.line.containerNumber, nextNumber);
  });
});

describe('container line vehicle plate clear (20260916_6)', () => {
  const createdVehicleIds: number[] = [];

  async function seedCarrierVehicle() {
    const carrier = await seedCustomer({
      name: `Nhà xe clear ${suffix}`.slice(0, 255),
      isCarrier: true,
      status: 'ACTIVE',
    });
    const [vehicle] = await db.insert(s.carrierFleetVehicles).values({
      carrierId: carrier.id,
      licensePlate: `30K-${suffix.slice(-3).toUpperCase()}.99`,
      normalizedPlate: `30K${suffix.slice(-3).toUpperCase()}99`,
      isActive: true,
    }).returning();
    createdVehicleIds.push(vehicle.id);
    return { carrier, vehicle };
  }

  async function seedExternalPlateRow() {
    const { carrier, vehicle } = await seedCarrierVehicle();
    const route = await seedRoute();
    const shipment = await seedShipment({
      blNumber: `PCL${lettersTag(5)}`.slice(0, 100),
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-20',
      tradeDirection: 'IMPORT',
      routeId: route.id,
      shippingLineName: 'Maersk',
    });
    const container = await seedContainer(shipment.id, {
      containerNumber: `PCL${lettersTag(4)}1`.slice(0, 50),
      routeId: route.id,
      containerTypeId,
    });
    const fulfillment = await seedFulfillment(shipment.id, container.id, {
      plannedCarrierType: 'EXTERNAL',
      plannedExternalCarrierId: carrier.id,
      plannedExternalCarrierVehicleId: vehicle.id,
      plannedVehiclePlateNumber: vehicle.licensePlate,
    });
    return { carrier, vehicle, shipment, container, fulfillment };
  }

  test('clearVehicle removes the planned plate and vehicle while keeping the external carrier', async () => {
    const { carrier, shipment, container, fulfillment } = await seedExternalPlateRow();

    await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: {
        expectedShipmentVersion: shipment.version,
        carrierType: 'EXTERNAL',
        externalCarrierId: carrier.id,
        clearVehicle: true,
      },
      actor: cusActor,
    });

    const [after] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal(after.plannedVehiclePlateNumber, null, 'plate must be cleared, not fall back to the vehicle plate');
    assert.equal(after.plannedExternalCarrierVehicleId, null, 'vehicle selection must be cleared');
    assert.equal(after.plannedExternalCarrierId, carrier.id, 'the external carrier itself stays');
  });

  test('clearVehicle cannot ride along with a vehicle selection or an inline new carrier', () => {
    const base = { expectedShipmentVersion: 1, carrierType: 'EXTERNAL' as const };
    const withVehicle = shipmentCusContainerLineUpdateSchema.safeParse({
      ...base, clearVehicle: true, externalCarrierVehicleId: 5,
    });
    assert.equal(withVehicle.success, false);
    const withInline = shipmentCusContainerLineUpdateSchema.safeParse({
      ...base, clearVehicle: true, newExternalCarrier: { name: 'Nhà xe mới', plateNumber: '30K-001.99' },
    });
    assert.equal(withInline.success, false);
  });

  test.after(async () => {
    for (const id of createdVehicleIds) {
      await db.delete(s.carrierFleetVehicles).where(eq(s.carrierFleetVehicles.id, id)).catch(() => {});
    }
  });
});

// UI-CD-12: factory identity is container-owned. A successful edit must change
// the same source displayed by CUS, dispatch, and later driver jobs.
describe('FCL workspace factory source editing', () => {
  async function factory(overrides: Partial<typeof s.operationalSites.$inferInsert> = {}) {
    const [row] = await db.insert(s.operationalSites).values({
      customerId, code: `WSF-${lettersTag()}`, name: `Factory ${lettersTag()}`,
      shortName: `NM ${lettersTag()}`, address: 'KCN test', siteType: 'FACTORY',
      ...overrides,
    }).returning();
    createdFactoryIds.push(row.id);
    return row;
  }

  test('replaces the effective factory only on the selected container, including snapshot and readback', async () => {
    const first = await factory();
    const factoryRoute = await seedRoute();
    const second = await factory({ routeId: factoryRoute.id });
    const shipment = await seedShipment({ cargoMode: 'FCL', operationalSiteId: first.id, blNumber: `WSFACT-${lettersTag()}` });
    const selected = await seedContainer(shipment.id);
    const sibling = await seedContainer(shipment.id, { operationalSiteId: first.id });
    const fulfillment = await seedFulfillment(shipment.id, selected.id);
    await seedFulfillment(shipment.id, sibling.id);
    const before = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(before.containers[0].operationalSiteId, first.id);
    assert.equal(before.containers[0].fieldAccess.operationalSiteId.mode, 'DIRECT');
    const result = await updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: selected.id,
      input: { expectedShipmentVersion: shipment.version, operationalSiteId: second.id }, actor: cusActor });
    assert.equal(result.line.operationalSiteId, second.id);
    assert.equal(result.line.routeId, factoryRoute.id);
    assert.equal(result.line.shipmentVersion, shipment.version + 1);
    const after = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(after.containers.find(row => row.id === selected.id)?.operationalSiteId, second.id);
    assert.equal(after.containers.find(row => row.id === sibling.id)?.operationalSiteId, first.id);
    const flat = await listCusShipmentContainers({ page: 1, limit: 20, searchSuffix: shipment.blNumber! }, cusActor);
    assert.equal(flat.items.find(row => row.id === selected.id)?.factoryName, second.shortName);
    assert.equal(flat.items.find(row => row.id === selected.id)?.fieldAccess.operationalSiteId.mode, 'DIRECT');
    const [saved] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    const snapshot = saved.siteSnapshot as { deliverySite: { id: number; contactPhone: string | null }; pickupWarehouse: { name: string } };
    assert.equal(snapshot.deliverySite.id, second.id);
    assert.equal(snapshot.deliverySite.contactPhone, second.contactPhone);
    assert.equal(snapshot.pickupWarehouse.name, 'Kho A');
    await assert.rejects(() => updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: selected.id,
      input: { expectedShipmentVersion: shipment.version, operationalSiteId: first.id }, actor: cusActor }),
    (error: unknown) => error instanceof ApiError && error.statusCode === 409);
    const unchanged = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(unchanged.containers.find(row => row.id === selected.id)?.operationalSiteId, second.id);
  });

  test('rejects foreign, inactive, deleted and warehouse choices atomically; selector lists scoped active factories', async () => {
    const valid = await factory();
    const foreignCustomer = await seedCustomer({ name: `WS factory foreign ${lettersTag()}` });
    const invalid = [await factory({ customerId: foreignCustomer.id }), await factory({ isActive: false }),
      await factory({ deletedAt: new Date() }), await factory({ siteType: 'WAREHOUSE' })];
    const shipment = await seedShipment({ cargoMode: 'FCL', operationalSiteId: valid.id });
    const container = await seedContainer(shipment.id);
    await seedFulfillment(shipment.id, container.id);
    for (const choice of invalid) {
      await assert.rejects(() => updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
        input: { expectedShipmentVersion: shipment.version, operationalSiteId: choice.id }, actor: cusActor }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 409);
    }
    const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
    assert.equal(detail.containers[0].operationalSiteId, valid.id);
    assert.equal(detail.containers[0].shipmentVersion, shipment.version);
    assert.ok(detail.selectors.operationalSites.some(site => site.id === valid.id));
    for (const choice of invalid) assert.ok(!detail.selectors.operationalSites.some(site => site.id === choice.id));
  });

  test('combined factory and port edits retain the factory snapshot; null restores the inherited factory', async () => {
    const inherited = await factory();
    const selected = await factory();
    const shipment = await seedShipment({ cargoMode: 'FCL', operationalSiteId: inherited.id });
    const container = await seedContainer(shipment.id);
    const fulfillment = await seedFulfillment(shipment.id, container.id);
    const { dropPortId } = await seedLiftDropPorts();
    const changed = await updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, operationalSiteId: selected.id, dropoffSiteId: dropPortId }, actor: cusActor });
    assert.equal(changed.line.operationalSiteId, selected.id);
    assert.equal(changed.line.dropoffSiteId, dropPortId);
    const [after] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal((after.siteSnapshot as { deliverySite: { id: number } }).deliverySite.id, selected.id);
    const reset = await updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
      input: { expectedShipmentVersion: changed.line.shipmentVersion, operationalSiteId: null }, actor: cusActor });
    assert.equal(reset.line.operationalSiteId, inherited.id);
    assert.equal(reset.line.dropoffSiteId, dropPortId);
    const [stored] = await db.select().from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    assert.equal(stored.operationalSiteId, null);
    const [afterReset] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal((afterReset.siteSnapshot as { deliverySite: { id: number } }).deliverySite.id, inherited.id);
    await db.update(s.shipmentContainers).set({ operationalSiteId: inherited.id }).where(eq(s.shipmentContainers.id, container.id));
    const cleared = await updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
      input: { expectedShipmentVersion: reset.line.shipmentVersion, operationalSiteId: null }, actor: cusActor });
    assert.equal(cleared.line.operationalSiteId, inherited.id);
    const [clearedRow] = await db.select().from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    assert.equal(clearedRow.operationalSiteId, null, 'an equal explicit override must still be cleared');
  });

  test('preserves an unchanged historical factory and blocks changes once a real trip exists', async () => {
    const historical = await factory({ isActive: false });
    const next = await factory();
    const shipment = await seedShipment({ cargoMode: 'FCL', operationalSiteId: historical.id });
    const container = await seedContainer(shipment.id);
    const fulfillment = await seedFulfillment(shipment.id, container.id);
    const route = await seedRoute();
    const [trip] = await db.insert(s.trips).values({ customerId, routeId: route.id, departureDate: '2026-09-17',
      fulfillmentId: fulfillment.id, status: 'CREATED', tripCode: `WSF-${lettersTag()}` }).returning();
    createdTripIds.push(trip.id);
    const noChange = await updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, operationalSiteId: historical.id }, actor: cusActor });
    assert.equal(noChange.line.operationalSiteId, historical.id);
    assert.equal(noChange.line.shipmentVersion, shipment.version);
    assert.equal(noChange.line.fieldAccess.operationalSiteId.mode, 'READ_ONLY');
    await assert.rejects(() => updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, operationalSiteId: next.id }, actor: cusActor }),
    (error: unknown) => error instanceof ApiError && error.statusCode === 409 && error.message.includes('chuyến xe'));
  });

  test('preserves accounting locks and role boundaries for factory edits', async () => {
    const first = await factory();
    const next = await factory();
    const shipment = await seedShipment({ cargoMode: 'FCL', operationalSiteId: first.id });
    const container = await seedContainer(shipment.id);
    await seedFulfillment(shipment.id, container.id);
    await assert.rejects(() => updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
      input: { expectedShipmentVersion: shipment.version, operationalSiteId: next.id }, actor: accountantActor }),
    (error: unknown) => error instanceof ApiError && error.statusCode === 403);
    // Real billing document — the accounting-lock FK to billing_documents is
    // live (shipment-children FK wave), sentinel ids violate it.
    assert.ok(shipment.customerId != null, 'fixture shipment carries a customer');
    const [lockDoc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: shipment.customerId,
      entityName: `UI-CD-12 lock doc ${suffix}`, rangeFrom: '2026-09-01', rangeTo: '2026-09-30',
      totalInclVat: '0',
    }).returning();
    await db.insert(s.shipmentAccountingLocks).values({ shipmentId: shipment.id,
      billingDocumentId: lockDoc.id, billingDocumentVersion: 1,
      billingPeriodSnapshot: { rangeFrom: '2026-09-01', rangeTo: '2026-09-30', issuedAt: '2026-09-17T00:00:00.000Z' },
      shipmentVersionAtLock: shipment.version, reason: 'UI-CD-12 regression', activatedBy: cusActor.userId });
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipment.id, cusActor);
      assert.equal(detail.containers[0].fieldAccess.operationalSiteId.mode, 'READ_ONLY');
      await assert.rejects(() => updateCusShipmentContainerLine({ shipmentId: shipment.id, containerId: container.id,
        input: { expectedShipmentVersion: shipment.version, operationalSiteId: next.id }, actor: cusActor }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 409);
    } finally {
      await db.delete(s.shipmentAccountingLocks).where(eq(s.shipmentAccountingLocks.shipmentId, shipment.id));
      await db.delete(s.billingDocuments).where(eq(s.billingDocuments.id, lockDoc.id));
    }
  });
});
