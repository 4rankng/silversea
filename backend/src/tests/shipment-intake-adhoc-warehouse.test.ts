import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import type { AuthUser } from '../middleware/auth';
import { submitShipmentForDispatch } from '../services/shipment-intake.service';

/**
 * FB-105 (card 171026115800) — Kho (CFS/Cảng) lấy hàng cho lệnh chạy ngoài.
 *
 * Spec §2: hàng lẻ bắt buộc cả Nhà máy và Kho, "trừ khi tích 'Lệnh chạy
 * ngoài'". The create form waives its required checks on the `isAdHoc` flag,
 * but `assertReferenceIsActive` used to key the dispatch-submit waiver on
 * `customerId == null` alone — an ad-hoc lot that still carries a catalog
 * customer passed the form and then 409'd here with "Vui lòng chọn kho lấy
 * hàng.". These cases pin the waiver to `isAdHoc` while keeping the
 * non-ad-hoc + catalog-customer path strict (by design) and preserving the
 * legacy `customerId == null` waiver unchanged.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const userIds: number[] = [];
const routeIds: number[] = [];
const idempotencyKeys: string[] = [];

async function actor(role: Role): Promise<AuthUser> {
  const [row] = await db.insert(s.users).values({
    username: `adhoc-wh-${role}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning();
  userIds.push(row.id);
  return {
    userId: row.id,
    username: row.username,
    email: null,
    fullName: null,
    role,
  };
}

async function references() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Kho ad-hoc customer ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `Kho ad-hoc route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  return { customer, route };
}

describe('FB-105 warehouse point required check — ad-hoc waiver', () => {
  test('ad-hoc + catalog customer + no warehouse point submits without the 409', async () => {
    // The defect: 'Lệnh chạy ngoài' ticked WITH a catalog customer selected.
    // The form waived Kho on isAdHoc; dispatch submit must waive it on the
    // same key instead of 409'ing on customerId != null.
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      isAdHoc: true,
      customerId: ref.customer.id,
      rawRouteName: `Tuyến chạy ngoài ${suffix}`,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-FB105-ADHOC-CUST-${suffix}`,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `FB105-ADHOC-CUST-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `fb105-adhoc-cust-${suffix}`;
    idempotencyKeys.push(key);

    const result = await submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
    });
    assert.equal(result.result.shipment.status, 'READY_FOR_DISPATCH');
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('non-ad-hoc + catalog customer + no warehouse point is still 409', async () => {
    // Strict by design: a catalog customer's lô lẻ must carry the Kho point
    // (catalog site id OR typed text). Do NOT relax this path.
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-FB105-STRICT-${suffix}`,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `FB105-STRICT-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `fb105-strict-${suffix}`;
    idempotencyKeys.push(key);

    await assert.rejects(
      submitShipmentForDispatch({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: key,
        actor: admin,
      }),
      (error: unknown) => error instanceof ApiError
        && error.statusCode === 409
        && error.message === 'Vui lòng chọn kho lấy hàng.',
    );
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 0);
  });

  test('non-ad-hoc + catalog customer: EXPORT typed Kho text satisfies via deliveryLocation', async () => {
    // Text-OR-id contract, direction-aware: hàng Xuất hạ tại Kho
    // (`delivery_location`), so typed text there satisfies the check without
    // a catalog warehouse site id.
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      bookingRef: `BOOK-FB105-EXP-TEXT-${suffix}`,
      deliveryLocation: `Kho CFS hạ hàng ${suffix}`,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `FB105-EXP-TEXT-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `fb105-exp-text-${suffix}`;
    idempotencyKeys.push(key);

    const result = await submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
    });
    assert.equal(result.result.shipment.status, 'READY_FOR_DISPATCH');
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('non-ad-hoc + catalog customer: EXPORT reads deliveryLocation, not pickupLocation', async () => {
    // Pins the direction ternary: for hàng Xuất the Kho point is the DROP
    // side. Typed text in pickupLocation (the Nâng side) must NOT satisfy it.
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      bookingRef: `BOOK-FB105-EXP-WRONG-${suffix}`,
      pickupLocation: `Kho CFS lấy hàng ${suffix}`,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `FB105-EXP-WRONG-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `fb105-exp-wrong-${suffix}`;
    idempotencyKeys.push(key);

    await assert.rejects(
      submitShipmentForDispatch({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: key,
        actor: admin,
      }),
      (error: unknown) => error instanceof ApiError
        && error.statusCode === 409
        && error.message === 'Vui lòng chọn kho lấy hàng.',
    );
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 0);
  });

  test('ad-hoc + no catalog customer (legacy walk-in) stays waived', async () => {
    const admin = await actor(Role.ADMIN);
    const [shipment] = await db.insert(s.shipments).values({
      isAdHoc: true,
      rawCustomerName: `Khách chạy ngoài ${suffix}`,
      rawRouteName: `Tuyến riêng ${suffix}`,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-FB105-ADHOC-LEGACY-${suffix}`,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `FB105-ADHOC-LEGACY-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `fb105-adhoc-legacy-${suffix}`;
    idempotencyKeys.push(key);

    const result = await submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
    });
    assert.equal(result.result.shipment.status, 'READY_FOR_DISPATCH');
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('non-ad-hoc + no catalog customer keeps the pre-existing legacy waiver', async () => {
    // `customerId == null` rows predate the Kho catalog and stay waived
    // regardless of the flag — the FB-105 change must not tighten them.
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      routeId: ref.route.id,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-FB105-LEGACY-${suffix}`,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `FB105-LEGACY-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `fb105-legacy-${suffix}`;
    idempotencyKeys.push(key);

    const result = await submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
    });
    assert.equal(result.result.shipment.status, 'READY_FOR_DISPATCH');
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });
});

after(async () => {
  try {
    if (idempotencyKeys.length) await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
    if (shipmentIds.length) {
      await db.delete(s.trips).where(inArray(s.trips.shipmentId, shipmentIds));
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } finally {
    await disconnectRedis();
    await client.end();
  }
});
