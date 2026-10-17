/**
 * FB-105 §3 — Kế hoạch Chi tiết Xe must carry the LCL lot's own lift/drop
 * inputs.
 *
 * The Nâng hàng / Trả hàng cells used to read `ports.pickupPortName` /
 * `dropoffPortName`, which come from `shipment_containers` — so an LCL lot
 * (never has a container) read '—' on both sides. The row now projects
 * `liftDrop`: the frozen "Kho (CFS/Cảng)" intake site plus the lot's stored
 * free-text lift/drop points, which back a side whose catalog site was never
 * picked. The direction swap itself lives on the client (liftDropPoints.ts),
 * pinned by DetailedPlanGrid.test.tsx / MasterPlanGrid.lcl-display.test.tsx —
 * this suite pins the wire facts those helpers need.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { listDispatchDetailPlanRows } from '../services/dispatch-planning-detail-plan-read.service';
import { operationalSiteSnapshot } from '../services/shipment-fulfillment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const actor = { userId: 1, role: Role.ADMIN } as AuthUser;

const created = {
  customers: [] as number[],
  sites: [] as number[],
  shipments: [] as number[],
  fulfillments: [] as number[],
};

async function mkSite(customerId: number, name: string, siteType: 'FACTORY' | 'WAREHOUSE') {
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `FB105${siteType === 'FACTORY' ? 'F' : 'W'}${suffix.slice(-5)}${created.sites.length}`,
    // Short name is what every operational surface renders; distinct from the
    // full name so the assertion proves the short-name authority.
    name: `${name} đầy đủ`,
    shortName: name,
    siteType,
    address: `Địa chỉ FB-105 ${suffix}`,
    isActive: true,
  }).returning();
  created.sites.push(site.id);
  return site;
}

/** An LCL lot + its ONE LCL_SHIPMENT fulfillment. The snapshot is built by the
 *  same `operationalSiteSnapshot` builder `loadSiteSnapshot` uses, so the
 *  fixture cannot drift from the intake wiring. */
async function mkLclLot(args: {
  customerId: number;
  blNumber: string | null;
  bookingRef?: string | null;
  tradeDirection: 'IMPORT' | 'EXPORT';
  factory: typeof s.operationalSites.$inferSelect | null;
  warehouse: typeof s.operationalSites.$inferSelect | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    blNumber: args.blNumber,
    bookingRef: args.bookingRef ?? null,
    tradeDirection: args.tradeDirection,
    cargoMode: 'LCL',
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: '2026-10-20',
    operationalSiteId: args.factory?.id ?? null,
    pickupWarehouseSiteId: args.warehouse?.id ?? null,
    pickupLocation: args.pickupLocation ?? null,
    deliveryLocation: args.deliveryLocation ?? null,
    packageCount: 5,
    packageType: 'PALLET',
  }).returning();
  created.shipments.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    sourceShipmentVersion: shipment.version,
    dispatchClassification: 'LCL',
    siteSnapshot: {
      deliverySite: args.factory ? operationalSiteSnapshot(args.factory) : null,
      pickupWarehouse: args.warehouse ? operationalSiteSnapshot(args.warehouse) : null,
    },
  }).returning();
  created.fulfillments.push(fulfillment.id);
  return { shipment, fulfillment };
}

describe('FB-105 §3 — detail plan rows carry the LCL lift/drop inputs', () => {
  after(async () => {
    if (created.fulfillments.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, created.fulfillments));
    }
    if (created.shipments.length > 0) {
      await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipments));
    }
    if (created.sites.length > 0) {
      await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, created.sites));
    }
    if (created.customers.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, created.customers));
    }
  });

  test('projects the frozen warehouse name and the stored lift/drop text', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `FB105 customer ${suffix}` })
      .returning();
    created.customers.push(customer.id);
    const warehouse = await mkSite(customer.id, `Kho CFS ${suffix.slice(-5)}`, 'WAREHOUSE');
    const factory = await mkSite(customer.id, `Nhà máy ${suffix.slice(-5)}`, 'FACTORY');

    const withSites = await mkLclLot({
      customerId: customer.id,
      blNumber: null,
      // shipments_document_reference_direction_check: an EXPORT lot carries the
      // booking reference and NEVER a bill number.
      bookingRef: `FB105-BOOK1-${suffix.slice(-6)}`,
      tradeDirection: 'EXPORT',
      factory,
      warehouse,
      // Stored free text rides along even when both sites are picked: the
      // client prefers the sites (resolveLiftDropPoints), the wire keeps both.
      pickupLocation: 'Nhà máy gõ tay',
      deliveryLocation: 'Kho gõ tay',
    });
    const storedOnly = await mkLclLot({
      customerId: customer.id,
      blNumber: `FB105-BL2-${suffix.slice(-6)}`,
      bookingRef: null,
      tradeDirection: 'IMPORT',
      factory: null,
      warehouse: null,
      pickupLocation: 'Kho CFS gõ tay',
      deliveryLocation: 'Nhà máy gõ tay',
    });

    const page = await listDispatchDetailPlanRows({
      actor,
      page: 1,
      limit: 50,
      customerId: customer.id,
    });
    const official = page.items.find((item) => item.shipmentId === withSites.shipment.id);
    assert.ok(official, 'the LCL lot with both sites is on the detail plan');
    assert.equal(official.cargoMode, 'LCL');
    assert.equal(official.docs.tradeDirection, 'EXPORT');
    // The warehouse half — the cell can only name it if the wire carries it.
    assert.equal(official.liftDrop?.warehouseName, `Kho CFS ${suffix.slice(-5)}`);
    assert.equal(official.liftDrop?.liftFallback, 'Nhà máy gõ tay');
    assert.equal(official.liftDrop?.dropFallback, 'Kho gõ tay');
    // The factory half already rode the row (customerRoute.factoryName).
    assert.equal(official.customerRoute.factoryName, `Nhà máy ${suffix.slice(-5)}`);
    // An LCL lot has no container, so the port pair stays null — the cells must
    // never fall back to it.
    assert.equal(official.ports.pickupPortName, null);
    assert.equal(official.ports.dropoffPortName, null);

    const typed = page.items.find((item) => item.shipmentId === storedOnly.shipment.id);
    assert.ok(typed, 'the LCL lot with typed-only points is on the detail plan too');
    assert.equal(typed.liftDrop?.warehouseName, null);
    assert.equal(typed.liftDrop?.liftFallback, 'Kho CFS gõ tay');
    assert.equal(typed.liftDrop?.dropFallback, 'Nhà máy gõ tay');
    assert.equal(typed.customerRoute.factoryName, null);
  });
});
