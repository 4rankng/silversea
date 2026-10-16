/**
 * Card 161026232339 — CUS "Chi tiết lô hàng": the flat row must carry the LCL
 * lot's billing facts (DEV SPEC Hàng lẻ §II.3.1).
 *
 * The frontend cell is pure projection: `ShipmentContainerLedger` prints
 * "Lô hàng lẻ | Thu: Xe 3.5T | Trả: Xe 10T" and the two-line phân xe cell
 * (BKS thực / BKS báo khách) straight off the row. This suite pins the WIRE:
 *
 *   AC1  revVehicleClassCode / costVehicleClassCode resolve from
 *        vehicle_size_classes (Thu khách / Trả ĐV) in one batched lookup.
 *   AC2  actualTruckNo (BKS thực) + billingTruckNo (BKS báo khách) ride the
 *        lot-level row; FCL container rows carry the same four keys as null so
 *        the schema stays one shape (AC4).
 *   AC3  the quick edit's endpoint (`updateLclGroupTruck` — the same service
 *        behind POST /api/shipments/lcl/truck) lands, and the very next read
 *        returns the saved plate: that read is the refetch the ledger relies on.
 *   AC5  absent values are null on the wire (the cell renders `—`), never
 *        undefined or ''.
 *
 * Fixtures use unique codes/suffixes and clean up every row they create.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { listCusShipmentContainers } from '../services/cus-shipment-workspace.service';
import { updateLclGroupTruck } from '../services/lcl-grouping.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdVehicleClassIds: number[] = [];

let customerId: number;
let containerTypeId: number;
let adminActor: AuthUser;
let lotCostClassId: number;
let lotRevClassId: number;

/** Letters-only tag — cargoRankSql() regex-matches standalone digit runs in
 *  container-type codes/names and seeded blNumbers flow through the same row
 *  projections, so a stray digit run can flip sibling sort assertions. */
function lettersTag(length = 8): string {
  let tag = '';
  while (tag.length < length) tag += Math.random().toString(36).slice(2).replace(/[0-9]/g, '');
  return tag.slice(0, length);
}

const marker = `LFR${lettersTag(8)}`;
const EDD = '2026-10-08';

type ShipmentRow = typeof s.shipments.$inferSelect;
type ContainerRow = typeof s.shipmentContainers.$inferSelect;

let lotWithClasses: ShipmentRow;
let lotWithoutClasses: ShipmentRow;
let fclLot: ShipmentRow;
let fclContainer: ContainerRow;

async function seedShipment(overrides: Partial<typeof s.shipments.$inferInsert> = {}) {
  const [row] = await db.insert(s.shipments).values({
    customerId,
    responsibleUnitId: createdBusinessUnitIds[0],
    version: 1,
    status: 'PENDING_DATE',
    ...overrides,
  }).returning();
  createdShipmentIds.push(row.id);
  return row;
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Card1610 KH ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  customerId = customer.id;
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `40HC${lettersTag()}`,
    name: `Card1610 ct ${lettersTag(6)}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  containerTypeId = containerType.id;
  const [unit] = await db.insert(s.businessUnits).values({
    name: `Card1610 unit ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdBusinessUnitIds.push(unit.id);
  // The FB-090 catalog is seeded, but these fixtures own their own classes so
  // the assertion can name the exact code it expects and clean up after itself.
  const classRows = await db.insert(s.vehicleSizeClasses).values([
    { code: `3.5T-${lettersTag(6)}`, name: `Xe 3.5T ${suffix}`, sortOrder: 900 },
    { code: `10T-${lettersTag(6)}`, name: `Xe 10T ${suffix}`, sortOrder: 901 },
  ]).returning();
  for (const row of classRows) createdVehicleClassIds.push(row.id);
  lotRevClassId = classRows[0].id;
  lotCostClassId = classRows[1].id;

  adminActor = {
    userId: 0,
    username: 'card1610-test-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };

  const idemSuffix = lettersTag(6);
  lotWithClasses = await seedShipment({
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    expectedDeliveryDate: EDD,
    blNumber: `${marker}-A`,
    actualTruckNo: `15C-111.11`,
    billingTruckNo: `15C-999.99`,
    revVehicleClassId: lotRevClassId,
    costVehicleClassId: lotCostClassId,
    // Distinct per run: the marker isolates the page, but a leftover row from a
    // crashed run must never be the row this suite asserts on.
    customerNotes: `card1610 ${idemSuffix}`,
  });
  lotWithoutClasses = await seedShipment({
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    expectedDeliveryDate: EDD,
    blNumber: `${marker}-B`,
    customerNotes: `card1610 ${idemSuffix}`,
  });

  fclLot = await seedShipment({
    cargoMode: 'FCL',
    tradeDirection: 'EXPORT',
    expectedDeliveryDate: EDD,
    bookingRef: `${marker}-FCL`,
    actualTruckNo: `29H-222.22`,
    billingTruckNo: `29H-999.99`,
    customerNotes: `card1610 ${idemSuffix}`,
  });
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: fclLot.id,
    containerTypeId,
    containerNumber: `FCL${lettersTag(8)}`,
  }).returning();
  createdContainerIds.push(container.id);
  fclContainer = container;
});

after(async () => {
  if (createdContainerIds.length) {
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdContainerIds));
  }
  if (createdShipmentIds.length) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdVehicleClassIds.length) {
    await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, createdVehicleClassIds));
  }
  if (createdContainerTypeIds.length) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
  }
  if (createdBusinessUnitIds.length) {
    await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
  }
  if (createdCustomerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  await client.end();
});

const filters = { page: 1, limit: 100, searchSuffix: marker } as const;

describe('Card 161026232339 — the LCL lot flat row carries its billing facts', () => {
  test('AC1: the chosen cước classes resolve to their vehicle_size_classes codes', async () => {
    const detail = await listCusShipmentContainers({ ...filters }, adminActor);
    const row = detail.items.find((item) => item.shipmentId === lotWithClasses.id);
    assert.ok(row, 'the LCL lot appears on the container workboard as a lot-level row');
    assert.equal(row.isLotLevel, true);

    const [revClass] = await db.select({ code: s.vehicleSizeClasses.code })
      .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, lotRevClassId));
    const [costClass] = await db.select({ code: s.vehicleSizeClasses.code })
      .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, lotCostClassId));
    assert.equal(row.revVehicleClassCode, revClass.code, 'Thu: Xe <code> renders from the rev class');
    assert.equal(row.costVehicleClassCode, costClass.code, 'Trả: Xe <code> renders from the cost class');
    // The BLOCKER at HEAD: neither key existed, so the cell could only print a
    // hard-coded "Không có container". Both are now present on the wire.
    assert.ok('revVehicleClassCode' in row && 'costVehicleClassCode' in row);
  });

  test('AC2/AC5: BKS thực + BKS báo khách ride the lot row, absent values as null', async () => {
    const detail = await listCusShipmentContainers({ ...filters }, adminActor);
    const withClasses = detail.items.find((item) => item.shipmentId === lotWithClasses.id)!;
    assert.equal(withClasses.actualTruckNo, '15C-111.11');
    assert.equal(withClasses.billingTruckNo, '15C-999.99');

    const withoutClasses = detail.items.find((item) => item.shipmentId === lotWithoutClasses.id)!;
    assert.equal(withoutClasses.actualTruckNo, null, 'never undefined/empty — the cell renders —');
    assert.equal(withoutClasses.billingTruckNo, null);
    assert.equal(withoutClasses.revVehicleClassCode, null, 'a lot with no chosen class keeps a null code');
    assert.equal(withoutClasses.costVehicleClassCode, null);
  });

  test('AC3: the quick edit lands through updateLclGroupTruck and the next read returns it', async () => {
    await updateLclGroupTruck(
      { shipmentId: lotWithClasses.id, billingTruckNo: '15C-777.77' },
      { userId: 1, role: Role.ADMIN, actorName: 'card1610 test' },
    );
    const detail = await listCusShipmentContainers({ ...filters }, adminActor);
    const row = detail.items.find((item) => item.shipmentId === lotWithClasses.id)!;
    assert.equal(row.billingTruckNo, '15C-777.77', 'the reloaded row carries the saved billing plate');
    assert.equal(row.actualTruckNo, '15C-111.11', 'the actual plate is untouched by a billing-only edit');
  });

  test('AC4: FCL container rows keep their shape — same four keys, all null', async () => {
    const detail = await listCusShipmentContainers({ ...filters }, adminActor);
    const row = detail.items.find((item) => item.id === fclContainer.id);
    assert.ok(row, 'the FCL container row is unchanged');
    assert.notEqual(row.isLotLevel, true);
    assert.equal(row.containerNumber, fclContainer.containerNumber);
    assert.equal(row.revVehicleClassCode, null);
    assert.equal(row.costVehicleClassCode, null);
    // The FCL lot owns no LCL group truck: its shipment-level plates are not
    // what this column reads, so the container row's own plate stays null.
    assert.equal(row.plateNumber, null);
  });
});
