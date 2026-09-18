import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { OperationalSiteType, Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import type { AuthUser } from '../middleware/auth';
import {
  assignShipmentCarriers,
  createOperationalSiteForIntake,
  listOperationalSitesForAdmin,
  listOperationalSitesForIntake,
  submitShipmentForDispatch,
  updateOperationalSiteForAdmin,
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
    routeId: route.id,
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
    code: `20GP${containerTypeIds.length}${suffix.slice(-6)}`.slice(0, 20),
    name: `Container 20 feet ${suffix}-${containerTypeIds.length}`,
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

  test('allows DISPATCHER to load and add customer operational sites from intake', async () => {
    const dispatcher = await actor(Role.DISPATCHER);
    const ref = await references();

    const existing = await listOperationalSitesForIntake(ref.customer.id, dispatcher);
    assert.ok(existing.some((site) => site.id === ref.site.id));
    assert.ok(existing.some((site) => site.id === ref.warehouse.id));

    const created = await createOperationalSiteForIntake({
      customerId: ref.customer.id,
      code: `DISPATCHER-${suffix}-${siteIds.length}`,
      name: 'Bãi giao nhận Điều vận',
      siteType: OperationalSiteType.WAREHOUSE,
      address: 'KCN Sóng Thần, Bình Dương',
    }, dispatcher);
    siteIds.push(created.id);
    assert.equal(created.name, 'Bãi giao nhận Điều vận');
  });

  test('preserves a curated operational-site short name when a legacy intake update omits it', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const curatedShortName = `NM ngắn ${suffix}`;
    await db.update(s.operationalSites).set({ shortName: curatedShortName })
      .where(eq(s.operationalSites.id, ref.site.id));

    const updated = await createOperationalSiteForIntake({
      customerId: ref.customer.id,
      code: ref.site.code,
      name: `Nhà máy tên pháp lý mới ${suffix}`,
      siteType: ref.site.siteType as OperationalSiteType,
      routeId: ref.route.id,
      address: ref.site.address,
    }, admin);

    assert.equal(updated.shortName, curatedShortName);
    const [persisted] = await db.select({ shortName: s.operationalSites.shortName })
      .from(s.operationalSites).where(eq(s.operationalSites.id, ref.site.id));
    assert.equal(persisted?.shortName, curatedShortName);
  });

  test('20260916_5 ruling (a): an LCL lô takes one lô-unit carrier allocation', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      shipmentCode: `INTAKE-LCL-R5-${suffix}`,
      status: 'READY_FOR_DISPATCH',
    }).returning();
    shipmentIds.push(shipment.id);

    // RED at HEAD: the LCL branch rejected every allocation outright
    // ('Gán nhà xe theo số lượng 20/40 chỉ áp dụng cho lô FCL.').
    const owned = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      actor: admin,
      carrierAllocations: [{ carrierType: 'OWN', count20: 1, count40: 0 }],
    });
    assert.equal(owned.assignments[0]?.plannedCarrierType, 'OWN');

    // Over-allocating a second unit stays blocked (20260916_5 ruling (a):
    // demand = 1 lô, per-carrier groups still apply).
    // Over-allocation: two units against the 1-lô quota → 409.
    await assert.rejects(
      () => assignShipmentCarriers({
        shipmentId: shipment.id,
        expectedVersion: shipment.version + 1,
        actor: admin,
        carrierAllocations: [{ carrierType: 'OWN', count20: 1, count40: 1 }],
      }),
      /chỉ nhận đúng 1/,
    );
  });

  test('reassigns exact per-container carriers while ready and before any order is issued', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [carrier] = await db.insert(s.customers).values({
      name: `Carrier ${suffix}-${customerIds.length}`,
      isCarrier: true,
      status: 'ACTIVE',
    }).returning();
    customerIds.push(carrier.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      shipmentCode: `INTAKE-ASSIGN-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      routeId: ref.route.id,
      operationalSiteId: ref.site.id,
      containerTypeId: ref.containerType.id,
      containerNumber: 'MSCU6639872',
      createdBy: admin.userId,
    });

    const owned = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      actor: admin,
      carrierAllocations: [{ carrierType: 'OWN', count20: 1, count40: 0 }],
    });
    assert.equal(owned.assignments[0]?.plannedCarrierType, 'OWN');

    const external = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: owned.shipment.version,
      actor: admin,
      carrierAllocations: [{
        carrierType: 'EXTERNAL',
        externalCarrierId: carrier.id,
        count20: 1,
        count40: 0,
      }],
    });
    assert.equal(external.assignments[0]?.plannedCarrierType, 'EXTERNAL');
    assert.equal(external.assignments[0]?.plannedExternalCarrierId, carrier.id);
  });

  test('allowPartial saves under-allocation as DISPATCHER, rejects overflow, and clears uncovered carriers', async () => {
    const dispatcher = await actor(Role.DISPATCHER);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      shipmentCode: `INTAKE-PARTIAL-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: dispatcher.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values([
      { shipmentId: shipment.id, containerTypeId: ref.containerType.id, containerNumber: 'PART0000001', createdBy: dispatcher.userId },
      { shipmentId: shipment.id, containerTypeId: ref.containerType.id, containerNumber: 'PART0000002', createdBy: dispatcher.userId },
    ]);

    // Partial: allocate 1 of 2 → allowed, second container unassigned.
    const partial = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      actor: dispatcher,
      carrierAllocations: [{ carrierType: 'OWN', count20: 1, count40: 0 }],
      allowPartial: true,
    });
    const carriersAfterPartial = await db.select({
      containerId: s.shipmentFulfillments.shipmentContainerId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
    }).from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    const assigned = carriersAfterPartial.filter((row) => row.plannedCarrierType != null);
    const cleared = carriersAfterPartial.filter((row) => row.plannedCarrierType == null);
    assert.equal(assigned.length, 1);
    assert.equal(cleared.length, 1);

    // Overflow: request 3 when the shipment only has 2 containers → 409.
    await assert.rejects(
      () => assignShipmentCarriers({
        shipmentId: shipment.id,
        expectedVersion: partial.shipment.version,
        actor: dispatcher,
        carrierAllocations: [{ carrierType: 'OWN', count20: 3, count40: 0 }],
        allowPartial: true,
      }),
      (err: unknown) => err instanceof ApiError && err.statusCode === 409,
    );

    // Zeroing out the allocation clears the previous carrier too.
    const emptied = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: partial.shipment.version,
      actor: dispatcher,
      carrierAllocations: [],
      allowPartial: true,
    });
    assert.equal(emptied.shipment.version, partial.shipment.version + 1);
  });

  test('TC-DV-DISPATCH-043: assigns carriers separately per appointment date, allowing same carrier across different dates', async () => {
    const dispatcher = await actor(Role.DISPATCHER);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      shipmentCode: `INTAKE-DATES-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-09-10T08:00:00.000Z'),
      createdBy: dispatcher.userId,
    }).returning();
    shipmentIds.push(shipment.id);

    const [contDay1, contDay2] = await db.insert(s.shipmentContainers).values([
      {
        shipmentId: shipment.id,
        containerTypeId: ref.containerType.id, // 20'
        containerNumber: 'DATE0000001',
        customerAppointmentAt: new Date('2026-09-10T08:00:00.000Z'),
        createdBy: dispatcher.userId,
      },
      {
        shipmentId: shipment.id,
        containerTypeId: ref.containerType.id, // 20'
        containerNumber: 'DATE0000002',
        customerAppointmentAt: new Date('2026-09-11T08:00:00.000Z'),
        createdBy: dispatcher.userId,
      },
    ]).returning();

    // Assign SilverSea (OWN) for both dates: day 1 (1x20') and day 2 (1x20')
    const assigned = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      actor: dispatcher,
      carrierAllocations: [
        { appointmentDate: '2026-09-10', carrierType: 'OWN', count20: 1, count40: 0 },
        { appointmentDate: '2026-09-11', carrierType: 'OWN', count20: 1, count40: 0 },
      ],
      allowPartial: true,
    });

    assert.equal(assigned.shipment.version, shipment.version + 1);

    const fulfillments = await db.select({
      containerId: s.shipmentFulfillments.shipmentContainerId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
    }).from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));

    assert.equal(fulfillments.length, 2);
    const f1 = fulfillments.find((f) => f.containerId === contDay1.id);
    const f2 = fulfillments.find((f) => f.containerId === contDay2.id);
    assert.equal(f1?.plannedCarrierType, 'OWN');
    assert.equal(f2?.plannedCarrierType, 'OWN');

    // Duplicate within the SAME date must be rejected
    await assert.rejects(
      () => assignShipmentCarriers({
        shipmentId: shipment.id,
        expectedVersion: assigned.shipment.version,
        actor: dispatcher,
        carrierAllocations: [
          { appointmentDate: '2026-09-10', carrierType: 'OWN', count20: 1, count40: 0 },
          { appointmentDate: '2026-09-10', carrierType: 'OWN', count20: 1, count40: 0 },
        ],
        allowPartial: true,
      }),
      (err: unknown) => err instanceof ApiError && err.statusCode === 409,
    );
  });

  test('submits a complete FCL draft with a route independent from its factory and replays once', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [containerRoute] = await db.insert(s.routes)
      .values({ name: `Independent intake route ${suffix}-${routeIds.length}` })
      .returning({ id: s.routes.id });
    routeIds.push(containerRoute.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: null,
      cargoMode: 'FCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-${suffix}`,
      operationalSiteId: ref.site.id,
      shipmentCode: `INTAKE-FCL-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      routeId: containerRoute.id,
      operationalSiteId: ref.site.id,
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
      carrierAllocations: [{ carrierType: 'OWN' as const, count20: 1, count40: 0 }],
    };

    const [left, right] = await Promise.all([
      submitShipmentForDispatch(command),
      submitShipmentForDispatch(command),
    ]);
    assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
    assert.equal(left.result.shipment.status, 'READY_FOR_DISPATCH');
    assert.equal(left.result.handoff.status, 'UNSEEN');
    assert.equal(left.result.handoff.handoffVersion, shipment.version + 1);
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('rejects FCL intake without a per-container factory', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      bookingRef: `BOOK-OPTIONAL-${suffix}`,
      shipmentCode: `INTAKE-FCL-OPTIONAL-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      routeId: ref.route.id,
      containerTypeId: ref.containerType.id,
      containerNumber: 'MSCU6639874',
      pickupPortId: ref.ports[0]!.id,
      dropoffPortId: ref.ports[1]!.id,
      createdBy: admin.userId,
    });
    const key = `submit-fcl-optional-${suffix}`;
    idempotencyKeys.push(key);

    await assert.rejects(() => submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: key,
      actor: admin,
    }), /Mỗi container cần đủ nhà máy/);
    const fulfillments = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    assert.equal(fulfillments.length, 0);
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
    assert.equal(unchanged.status, 'PENDING_DATE');
    assert.equal(unchanged.version, shipment.version);
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 0);
  });

  test('rejects dispatch when the import or export direction is missing', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'FCL',
      bookingRef: `BOOK-NO-DIRECTION-${suffix}`,
      operationalSiteId: ref.site.id,
      shipmentCode: `INTAKE-NO-DIRECTION-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      routeId: ref.route.id,
      containerTypeId: ref.containerType.id,
      containerNumber: 'MSCU6639873',
      shippingLineName: 'MSC',
      pickupPortId: ref.ports[0]!.id,
      dropoffPortId: ref.ports[1]!.id,
      createdBy: admin.userId,
    });
    const key = `submit-no-direction-${suffix}`;
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
        && error.message === 'Vui lòng chọn hình thức nhập khẩu hoặc xuất khẩu.',
    );
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
      tradeDirection: 'IMPORT',
      blNumber: `BL-LCL-POSITIVE-${suffix}`,
      operationalSiteId: ref.site.id,
      pickupWarehouseSiteId: ref.warehouse.id,
      packageType: 'Pallet',
      packageCount: 12,
      cargoWeightKg: '1250',
      cargoVolumeCbm: '8.5',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `INTAKE-LCL-POSITIVE-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
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
    assert.equal(result.result.shipment.status, 'READY_FOR_DISPATCH');
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 1);
  });

  test('an ad-hoc LCL lot with a raw route submits for dispatch without a catalog route', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    // Lệnh chạy ngoài stores the entered free route instead of a catalog
    // routeId — MasterDataNhaMay §4.4: dispatch must not be blocked just
    // because the customer/route is not in the catalog.
    const [shipment] = await db.insert(s.shipments).values({
      isAdHoc: true,
      rawCustomerName: `Khách chạy ngoài ${suffix}`,
      rawRouteName: `Tuyến riêng ${suffix}`,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-LCL-ADHOC-${suffix}`,
      pickupWarehouseSiteId: ref.warehouse.id,
      packageType: 'Pallet',
      packageCount: 5,
      cargoWeightKg: '300',
      cargoVolumeCbm: '2.4',
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `INTAKE-LCL-ADHOC-ROUTE-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `submit-lcl-adhoc-route-${suffix}`;
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

  test('an ad-hoc LCL lot with no route information at all still cannot submit for dispatch', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      isAdHoc: true,
      rawCustomerName: `Khách chạy ngoài ${suffix}`,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-LCL-ADHOC-NR-${suffix}`,
      pickupWarehouseSiteId: ref.warehouse.id,
      packageType: 'Pallet',
      packageCount: 5,
      expectedDeliveryDate: '2026-08-03',
      shipmentCode: `INTAKE-LCL-ADHOC-NOROUTE-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: admin.userId,
    }).returning();
    shipmentIds.push(shipment.id);
    const key = `submit-lcl-adhoc-noroute-${suffix}`;
    idempotencyKeys.push(key);
    // The raw-route allowance is narrow: without routeId AND without a raw
    // route the lô has no destination information, so dispatch stays blocked.
    await assert.rejects(
      submitShipmentForDispatch({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: key,
        actor: admin,
      }),
      (error: unknown) => error instanceof ApiError
        && error.statusCode === 409
        && error.message === 'Vui lòng chọn tuyến đường trước khi gửi điều phối.',
    );
    const handoffs = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(handoffs.length, 0);
  });

  test('denies ACCOUNTANT but allows an unscoped CLERK to submit for dispatch', async () => {
    const accountant = await actor(Role.ACCOUNTANT);
    const clerk = await actor(Role.CUS);
    const ref = await references();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: ref.customer.id,
      routeId: ref.route.id,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: `BL-LCL-DENY-${suffix}`,
      operationalSiteId: ref.site.id,
      pickupWarehouseSiteId: ref.warehouse.id,
      packageType: 'Pallet',
      packageCount: 1,
      cargoWeightKg: '100',
      cargoVolumeCbm: '1.5',
      expectedDeliveryDate: '2026-08-03',
      // Distinct from the LCL lô-unit test's code above — this suite shares
      // one suffix, so any reuse collides on shipments_shipment_code_unique.
      shipmentCode: `INTAKE-LCL-DENY-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
    }).returning();
    shipmentIds.push(shipment.id);

    // ACCOUNTANT stays blocked by the role gate (403 fires before readiness checks).
    const accountantKey = `submit-accountant-${suffix}`;
    idempotencyKeys.push(accountantKey);
    await assert.rejects(
      submitShipmentForDispatch({
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        idempotencyKey: accountantKey,
        actor: accountant,
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 403,
    );

    // CLERK has no assignment scope anymore — submit succeeds like any staff role.
    const clerkKey = `submit-clerk-${suffix}`;
    idempotencyKeys.push(clerkKey);
    const clerkResult = await submitShipmentForDispatch({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      idempotencyKey: clerkKey,
      actor: clerk,
    });
    assert.ok(clerkResult.result.shipment, 'clerk submit succeeds');
  });
});

describe('operational site admin maintenance', () => {
  test('limits the master-data list and updates to ADMIN and MANAGER', async () => {
    const clerk = await actor(Role.CUS);
    await assert.rejects(
      () => listOperationalSitesForAdmin(clerk),
      (err: unknown) => err instanceof ApiError && err.statusCode === 403,
    );
    const ref = await references();
    await assert.rejects(
      () => updateOperationalSiteForAdmin(ref.site.id, { expectedVersion: ref.site.version }, clerk),
      (err: unknown) => err instanceof ApiError && err.statusCode === 403,
    );
  });

  test('lists every live site with its customer, including deactivated rows', async () => {
    const manager = await actor(Role.MANAGER);
    const ref = await references();
    await db.update(s.operationalSites)
      .set({ isActive: false })
      .where(eq(s.operationalSites.id, ref.warehouse.id));

    const rows = await listOperationalSitesForAdmin(manager);
    const factory = rows.find((row) => row.id === ref.site.id);
    const warehouse = rows.find((row) => row.id === ref.warehouse.id);
    assert.ok(factory);
    assert.equal(factory.customerName, ref.customer.name);
    assert.equal(factory.routeName, ref.route.name);
    assert.equal(factory.isActive, true);
    assert.ok(warehouse);
    assert.equal(warehouse.isActive, false);
  });

  test('applies a version-checked partial update and bumps the row version', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();

    const updated = await updateOperationalSiteForAdmin(ref.site.id, {
      expectedVersion: ref.site.version,
      name: 'Nhà máy mới',
      contactPhone: '0912345678',
      strictRules: null,
    }, admin);
    assert.equal(updated.name, 'Nhà máy mới');
    assert.equal(updated.contactPhone, '0912345678');
    assert.equal(updated.strictRules, null);
    assert.equal(updated.version, ref.site.version + 1);

    // Stale expectedVersion must conflict instead of silently overwriting.
    await assert.rejects(
      () => updateOperationalSiteForAdmin(ref.site.id, { expectedVersion: ref.site.version, name: 'Lần thứ hai' }, admin),
      (err: unknown) => err instanceof ApiError && err.statusCode === 409,
    );
  });

  test('keeps the FACTORY route invariant on merged updates', async () => {
    const admin = await actor(Role.ADMIN);
    const ref = await references();

    await assert.rejects(
      () => updateOperationalSiteForAdmin(ref.site.id, { expectedVersion: ref.site.version, routeId: null }, admin),
      (err: unknown) => err instanceof ApiError && err.statusCode === 409,
    );
    await assert.rejects(
      () => updateOperationalSiteForAdmin(ref.warehouse.id, { expectedVersion: ref.warehouse.version, routeId: ref.route.id }, admin),
      (err: unknown) => err instanceof ApiError && err.statusCode === 409,
    );
  });

  // Trilogy gap F7 / MDN-7 — MasterDataNhaMay.md §3.3: nhà máy bị vô hiệu hoá
  // (`is_active = false`) không được xuất hiện trong dropdown tạo lô. Backend
  // service đã filter ở shipment-intake.service.ts:289; test này chặn hồi quy.
  test('MDN-7: hides inactive factories from intake listing (trilogy F7)', async () => {
    const cus = await actor(Role.CUS);
    const ref = await references();

    // Create a second FACTORY for the same customer, then deactivate it.
    const [inactiveFactory] = await db.insert(s.operationalSites).values({
      customerId: ref.customer.id,
      code: `INACTIVE-${suffix}-${siteIds.length}`,
      name: `Factory đã vô hiệu hoá ${suffix}`,
      siteType: 'FACTORY',
      routeId: ref.route.id,
      address: 'KCN cũ đã ngừng hoạt động',
    }).returning();
    siteIds.push(inactiveFactory.id);
    await db.update(s.operationalSites)
      .set({ isActive: false })
      .where(eq(s.operationalSites.id, inactiveFactory.id));

    const items = await listOperationalSitesForIntake(ref.customer.id, cus);

    // Active factory from references() must be present.
    assert.ok(
      items.some((site) => site.id === ref.site.id),
      'active factory should appear in intake listing',
    );
    // Inactive factory must NOT be present (MasterDataNhaMay.md §3.3).
    assert.equal(
      items.some((site) => site.id === inactiveFactory.id),
      false,
      'inactive factory must be hidden from intake listing',
    );
    // Admin endpoint is the only path that returns deactivated rows (so admin
    // can re-enable them) — keep the two endpoints separated by intent.
    const admin = await actor(Role.ADMIN);
    const adminRows = await listOperationalSitesForAdmin(admin);
    assert.ok(
      adminRows.some((row) => row.id === inactiveFactory.id && row.isActive === false),
      'admin endpoint keeps deactivated rows visible for re-enable',
    );
  });
});

after(async () => {
  try {
    if (idempotencyKeys.length) await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
    if (shipmentIds.length) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
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
