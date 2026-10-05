/**
 * Card 365 — Hàng Lẻ: Lô hàng hiển thị ở Tổng Quan nhưng không thấy ở Chi Tiết.
 *
 * The two Hàng Lẻ workboards disagree for LCL lots: `listCusShipmentWorkspace`
 * (Tổng quan lô hàng) takes its rows FROM shipments, while
 * `listCusShipmentContainers` (Chi tiết lô hàng) takes them FROM
 * shipment_containers INNER JOIN shipments. LCL lots own ZERO container rows
 * (the codebase invariant "LCL is forbidden from owning containers" —
 * cus-shipment-workspace-writes.service.ts; ensureShipmentFulfillmentsInTx
 * rejects LCL + containers), so the INNER JOIN drops every LCL lot on the
 * Chi Tiết side only, under every filter combination.
 *
 * Red-first: the AC1 parity assertion below FAILS at HEAD (the detail list
 * returns no row for the LCL lot) and passes once the detail query also emits
 * a lot-level row for container-less LCL lots. FCL behavior is pinned
 * unchanged: one row per container, and container-less FCL lots stay off the
 * container workboard.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import {
  listCusShipmentContainers,
  listCusShipmentWorkspace,
} from '../services/cus-shipment-workspace.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdFulfillmentIds: number[] = [];

let customerId: number;
let containerTypeId: number;
let adminActor: AuthUser;

/** Letters-only tag — cargoRankSql() regex-matches standalone digit runs in
 *  container-type codes/names, and seeded blNumbers flow through cargo-row
 *  projections; digits there once flipped sibling assertions (see the
 *  lettersTag note in cus-shipment-workspace.test.ts). */
function lettersTag(length = 8): string {
  let tag = '';
  while (tag.length < length) tag += Math.random().toString(36).slice(2).replace(/[0-9]/g, '');
  return tag.slice(0, length);
}

const marker = `PAR${lettersTag(8)}`;
/** The LCL lot's expected delivery date — the date both surfaces filter on. */
const EDD = '2026-10-07';
const OFF_DAY = '2026-11-07';

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

type ShipmentRow = typeof s.shipments.$inferSelect;
type ContainerRow = typeof s.shipmentContainers.$inferSelect;

let lclLot: ShipmentRow;
let fclLot: ShipmentRow;
let fclContainer: ContainerRow;
let fclBare: ShipmentRow;
let legacyLcl: ShipmentRow;
let legacyLclContainer: ContainerRow;

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Card365 KH ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  customerId = customer.id;
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `40HC${lettersTag()}`,
    name: `Card365 ct ${lettersTag(6)}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  containerTypeId = containerType.id;
  const [unit] = await db.insert(s.businessUnits).values({
    name: `Card365 unit ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdBusinessUnitIds.push(unit.id);
  adminActor = {
    userId: 0,
    username: 'card365-test-admin',
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };

  // The reported lot: LCL, entered, scheduled on EDD, NO container rows —
  // exactly the intake shape (LCL lots are forbidden from owning containers).
  lclLot = await seedShipment({
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    expectedDeliveryDate: EDD,
    blNumber: `${marker}-LCL`,
  });
  // Its lot-level allocation (the LCL_SHIPMENT fulfillment every LCL lot
  // decomposes into) carries the planned carrier — the Phân xe column source.
  await seedFulfillment(lclLot.id, null, {
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    plannedCarrierType: 'OWN',
    plannedVehiclePlateNumber: `365${lettersTag(4)}`,
  });

  // FCL controls: one lot WITH its container (rows must stay unchanged), one
  // container-less lot (must stay off the container workboard — pinned).
  fclLot = await seedShipment({
    cargoMode: 'FCL',
    tradeDirection: 'EXPORT',
    expectedDeliveryDate: EDD,
    bookingRef: `${marker}-FCL`,
  });
  fclContainer = await seedContainer(fclLot.id, { containerNumber: `FCL${lettersTag(8)}` });
  fclBare = await seedShipment({
    cargoMode: 'FCL',
    tradeDirection: 'EXPORT',
    expectedDeliveryDate: EDD,
    bookingRef: `${marker}-BARE`,
  });

  // Legacy shape the existing suite seeds: an LCL lot that owns a container
  // row. It must keep rendering exactly its container row — no extra lot row.
  legacyLcl = await seedShipment({
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    expectedDeliveryDate: EDD,
    blNumber: `${marker}-LEG`,
  });
  legacyLclContainer = await seedContainer(legacyLcl.id, { containerNumber: `LEG${lettersTag(8)}` });
});

after(async () => {
  if (createdFulfillmentIds.length) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
  }
  if (createdContainerIds.length) {
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdContainerIds));
  }
  if (createdShipmentIds.length) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
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

describe('Card 365 — LCL lot parity between Tổng quan and Chi tiết workboards', () => {
  test('AC1/AC2: the same LCL lot shows on BOTH lists under equal filters, as a recognizable lot row', async () => {
    const filters = { page: 1, limit: 100, searchSuffix: marker };
    const overview = await listCusShipmentWorkspace(filters, adminActor);
    const detail = await listCusShipmentContainers(filters, adminActor);

    assert.ok(
      overview.items.some((item) => item.id === lclLot.id),
      'Tổng quan shows the LCL lot (the reported behavior)',
    );

    // ── RED AT HEAD: the detail list carries no row for a container-less LCL
    //    lot, so this lookup returns undefined and the test fails here. ──
    const lclRow = detail.items.find((row) => row.shipmentId === lclLot.id);
    assert.ok(lclRow, 'Chi tiết shows the same LCL lot (RED at HEAD — the INNER JOIN on shipment_containers drops it)');

    // AC2 — the row is recognizable as the lot.
    assert.equal(lclRow.id, -lclLot.id, 'lot rows carry -shipmentId as their workboard identity');
    assert.equal(lclRow.isLotLevel, true);
    assert.equal(lclRow.classification, 'LCL');
    assert.equal(lclRow.transportDate, EDD, "the lot's transport date is its expected delivery date");
    assert.equal(lclRow.containerNumber, null);
    assert.equal(lclRow.containerTypeLabel, null);
    assert.equal(lclRow.billOrBookNumber, `${marker}-LCL`);
    assert.equal(lclRow.direction, 'IMPORT');
    // Lot-level allocation feeds the Phân xe column (planned identity).
    assert.equal(lclRow.carrierName, 'SilverSea');
    assert.equal(lclRow.dispatchStatus, 'PLANNED');
    assert.equal(lclRow.ordinal, 1);
  });

  test('AC1: date filters agree — the lot appears on both lists on its EDD and leaves both off-day', async () => {
    const onDay = { page: 1, limit: 100, searchSuffix: marker, transportDateFrom: EDD, transportDateTo: EDD };
    const overview = await listCusShipmentWorkspace(onDay, adminActor);
    const detail = await listCusShipmentContainers(onDay, adminActor);
    assert.ok(overview.items.some((item) => item.id === lclLot.id), 'overview admits the lot on its EDD');
    assert.ok(detail.items.some((row) => row.shipmentId === lclLot.id), 'detail admits the lot on its EDD');

    const offDay = { page: 1, limit: 100, searchSuffix: marker, transportDateFrom: OFF_DAY, transportDateTo: OFF_DAY };
    const overviewOff = await listCusShipmentWorkspace(offDay, adminActor);
    const detailOff = await listCusShipmentContainers(offDay, adminActor);
    assert.ok(!overviewOff.items.some((item) => item.id === lclLot.id), 'overview drops the lot off-day');
    assert.ok(!detailOff.items.some((row) => row.shipmentId === lclLot.id), 'detail drops the lot off-day');
  });

  test('AC3: FCL rows are unchanged — one row per container; container-less FCL stays off the workboard', async () => {
    const filters = { page: 1, limit: 100, searchSuffix: marker };
    const overview = await listCusShipmentWorkspace(filters, adminActor);
    const detail = await listCusShipmentContainers(filters, adminActor);

    assert.ok(overview.items.some((item) => item.id === fclBare.id), 'overview still shows the container-less FCL lot');

    const fclRows = detail.items.filter((row) => row.shipmentId === fclLot.id);
    assert.equal(fclRows.length, 1, 'the FCL lot renders exactly its container row');
    assert.equal(fclRows[0].id, fclContainer.id, 'container rows keep their real container id');
    assert.notEqual(fclRows[0].isLotLevel, true, 'container rows are not lot rows');

    assert.ok(
      !detail.items.some((row) => row.shipmentId === fclBare.id),
      'container-less FCL lots stay hidden on the container workboard (pinned current behavior)',
    );
  });

  test('legacy LCL lot WITH a container keeps exactly its container row — no extra lot row', async () => {
    const filters = { page: 1, limit: 100, searchSuffix: marker };
    const detail = await listCusShipmentContainers(filters, adminActor);
    const rows = detail.items.filter((row) => row.shipmentId === legacyLcl.id);
    assert.equal(rows.length, 1, 'one row per container — never a duplicate lot row');
    assert.equal(rows[0].id, legacyLclContainer.id);
  });

  test('informationStatus=MISSING keeps excluding LCL lot rows (the triage is FCL-container scoped)', async () => {
    const missing = await listCusShipmentContainers(
      { page: 1, limit: 100, searchSuffix: marker, informationStatus: 'MISSING' },
      adminActor,
    );
    assert.ok(
      !missing.items.some((row) => row.shipmentId === lclLot.id),
      'lot rows never enter the MISSING triage queue',
    );
  });
});
