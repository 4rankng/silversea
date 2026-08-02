import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import type { AuthUser } from '../middleware/auth';
import {
  listOperationalSitesForIntake,
  submitShipmentForDispatch,
} from '../services/shipment-intake.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const userIds: number[] = [];
const routeIds: number[] = [];
const portIds: number[] = [];
const siteIds: number[] = [];
const containerTypeIds: number[] = [];
const idempotencyKeys: string[] = [];

async function actor(role: Role): Promise<AuthUser> {
  const [row] = await db.insert(s.users).values({
    username: `intake-${role}-${suffix}-${userIds.length}`,
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
  const [customer] = await db.insert(s.customers).values({ name: `Intake customer ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Intake route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const ports = await db.insert(s.ports).values([
    { name: `Pickup port ${suffix}-${portIds.length}` },
    { name: `Drop port ${suffix}-${portIds.length + 1}` },
  ]).returning();
  portIds.push(...ports.map((row) => row.id));
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `SITE-${suffix}-${siteIds.length}`,
    name: `Factory ${suffix}`,
    siteType: 'FACTORY',
    address: 'Khu công nghiệp thử nghiệm',
    googleMapsUrl: 'https://maps.google.com/testing',
    contactName: 'Người liên hệ riêng',
    contactPhone: '0900000000',
    liftFeeInvoiceName: 'Công ty xuất hóa đơn nâng hạ',
    liftFeeInvoiceAddress: 'Địa chỉ xuất hóa đơn',
    liftFeeTaxCode: '0101234567',
    strictRules: 'Gọi trước khi vào kho',
  }).returning();
  const [warehouse] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `WAREHOUSE-${suffix}-${siteIds.length}`,
    name: `Warehouse ${suffix}`,
    siteType: 'WAREHOUSE',
    address: 'Kho thử nghiệm',
  }).returning();
  siteIds.push(site.id, warehouse.id);
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `T${containerTypeIds.length}${suffix.slice(-6)}`.slice(0, 20),
    name: `Container type ${suffix}-${containerTypeIds.length}`,
  }).returning();
  containerTypeIds.push(containerType.id);
  return { customer, route, ports, site, warehouse, containerType };
}

describe('shipment intake submission', () => {
  test('returns billing identity to ACCOUNTANT without private operational contacts', async () => {
    const accountant = await actor(Role.ACCOUNTANT);
    const ref = await references();

    const sitesForBilling = await listOperationalSitesForIntake(ref.customer.id, accountant);
    const factory = sitesForBilling.find((site) => site.id === ref.site.id);

    assert.ok(factory);
    assert.equal(factory.liftFeeInvoiceName, 'Công ty xuất hóa đơn nâng hạ');
    assert.equal(factory.liftFeeTaxCode, '0101234567');
    assert.equal('contactName' in factory, false);
    assert.equal('contactPhone' in factory, false);
    assert.equal('strictRules' in factory, false);
    assert.equal('googleMapsUrl' in factory, false);
  });

  test('atomically moves a complete FCL draft to the dispatch queue and replays once', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      bookingRef: `BOOK-${suffix}`,
      operationalSiteId: ref.site.id,
      shipmentCode: `INTAKE-FCL-${suffix}`,
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: ref.containerType.id,
      containerNumber: 'MSCU6639871',
      shippingLineName: 'MSC',
      pickupPortId: ref.ports[0]!.id,
      dropoffPortId: ref.ports[1]!.id,
      createdBy: admin.userId,
    });
    const key = `submit-fcl-${suffix}`;
    idempotencyKeys.push(key);
    const command = {
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
      priority: 'URGENT' as const,
    };

    const [left, right] = await Promise.all([
      submitShipmentForDispatch(command),
      submitShipmentForDispatch(command),
    ]);
    assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
    assert.equal(left.result.shipment.status, 'NEW');
    assert.equal(left.result.handoff.status, 'UNSEEN');
    assert.equal(left.result.handoff.handoffVersion, shipment.version + 1);
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('keeps an incomplete draft unchanged and creates no handoff', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      bookingRef: `BOOK-INCOMPLETE-${suffix}`,
      operationalSiteId: ref.site.id,
      shipmentCode: `INTAKE-INCOMPLETE-${suffix}`,
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `submit-incomplete-${suffix}`;
    idempotencyKeys.push(key);
    await assert.rejects(
      submitShipmentForDispatch({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: key,
        actor: admin,
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 409,
    );
    const [unchanged] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    assert.equal(unchanged.status, 'NEW');
    assert.equal(unchanged.version, shipment.version);
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 0);
  });

  test('moves a complete LCL draft with factory, pickup warehouse and planned delivery into one handoff', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      bookingRef: `BOOK-LCL-POSITIVE-${suffix}`,
      operationalSiteId: ref.site.id,
      pickupWarehouseSiteId: ref.warehouse.id,
      packageType: 'Pallet',
      packageCount: 12,
      cargoWeightKg: '1250',
      cargoVolumeCbm: '8.5',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `INTAKE-LCL-POSITIVE-${suffix}`,
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `submit-lcl-positive-${suffix}`;
    idempotencyKeys.push(key);
    const result = await submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
    });
    assert.equal(result.result.shipment.status, 'NEW');
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('denies ACCOUNTANT and an unscoped CLERK without mutation', async () => {
    const accountant = await actor(Role.ACCOUNTANT);
    const clerk = await actor(Role.CLERK);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      bookingRef: `BOOK-LCL-${suffix}`,
      operationalSiteId: ref.site.id,
      pickupWarehouseSiteId: ref.warehouse.id,
      packageType: 'Pallet',
      packageCount: 1,
      cargoWeightKg: '100',
      cargoVolumeCbm: '1.5',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `INTAKE-LCL-${suffix}`,
    }).returning();
    shipmentIds.push(shipment.id);

    for (const [currentActor, expectedStatus, label] of [
      [accountant, 403, 'accountant'],
      [clerk, 404, 'clerk'],
    ] as const) {
      const key = `submit-${label}-${suffix}`;
      idempotencyKeys.push(key);
      await assert.rejects(
        submitShipmentForDispatch({
          shipmentId: shipment.id,
          expectedVersion: shipment.version,
          idempotencyKey: key,
          actor: currentActor,
        }),
        (error: unknown) => error instanceof ApiError && error.statusCode === expectedStatus,
      );
    }
    const [unchanged] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    assert.equal(unchanged.status, 'NEW');
  });
});

after(async () => {
  try {
    if (idempotencyKeys.length) await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (siteIds.length) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, siteIds));
    if (containerTypeIds.length) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
    if (portIds.length) await db.delete(s.ports).where(inArray(s.ports.id, portIds));
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
