/**
 * FB-091 — LCL "Kho lấy" projection on the dispatch master-plan list.
 *
 * The master plan's Cảng nâng column shows the lot's `pickup_warehouse_site_id`
 * for an LCL row (a containerless lot has no container port pair). The list
 * projection read the lot's `operational_site_id` only, so the warehouse name
 * never left the database and the grid could only print its container
 * placeholder. This pins the join, both list query variants (paged and
 * `includeDispatchSummary`), and the null case for a lot that has not chosen a
 * warehouse yet.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { listShipmentsPaginated } from '../services/shipment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdSiteIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkSite(customerId: number, name: string, siteType: 'FACTORY' | 'WAREHOUSE') {
  // A short_name is what every operational surface renders (SITE_OPERATIONAL_NAME
  // authority); give this one a distinct short name so the assertion proves the
  // short-name authority rather than the full-name fallback.
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `FB091${siteType === 'FACTORY' ? 'F' : 'W'}${suffix.slice(-5)}`,
    name: `${name} đầy đủ`,
    shortName: name,
    siteType,
    address: `Địa chỉ FB-091 ${suffix}`,
    isActive: true,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

describe('shipment list — LCL site projection (FB-091)', () => {
  after(async () => {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdSiteIds.length > 0) {
      await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  });

  test('projects the pickup warehouse and the delivery point for an LCL lot, and null for an unset warehouse', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `FB091 customer ${suffix}` })
      .returning();
    createdCustomerIds.push(customer.id);
    const warehouse = await mkSite(customer.id, `Kho lấy ${suffix}`, 'WAREHOUSE');
    const delivery = await mkSite(customer.id, `Điểm trả ${suffix}`, 'FACTORY');

    const [withSites, withoutWarehouse, fclLot] = await db.insert(s.shipments).values([
      {
        customerId: customer.id,
        blNumber: `FB091-BL-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-08-20',
        pickupWarehouseSiteId: warehouse.id,
        operationalSiteId: delivery.id,
        packageCount: 5,
        packageType: 'PALLET',
        cargoWeightKg: '1922.00',
        cargoVolumeCbm: '4.000',
      },
      {
        customerId: customer.id,
        blNumber: `FB091-BL2-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-08-21',
        operationalSiteId: delivery.id,
      },
      {
        // The second operational_sites join must not leak onto an FCL row: FCL
        // reads its lift/drop ports from containers, never from this column.
        customerId: customer.id,
        blNumber: `FB091-BL3-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-08-22',
        operationalSiteId: delivery.id,
      },
    ]).returning();
    createdShipmentIds.push(withSites.id, withoutWarehouse.id, fclLot.id);

    // Both list query variants must agree: the plain page query and the
    // transaction variant that `includeDispatchSummary` uses.
    for (const options of [{ page: 1, limit: 20 }, { page: 1, limit: 20, includeDispatchSummary: true }]) {
      const result = await listShipmentsPaginated({ customerId: customer.id, ...options });
      const row = result.items.find((item) => item.id === withSites.id);
      assert.ok(row, `LCL lot is listed (includeDispatchSummary=${Boolean(options.includeDispatchSummary)})`);
      // Short-name authority, not the stored full name.
      assert.equal(row.pickupWarehouseSiteName, `Kho lấy ${suffix}`);
      assert.equal(row.factoryName, `Điểm trả ${suffix}`);
      // The CUS cargo fields the grid composes its cargo lines from ride the
      // same row (they come from the shipment columns, not a new join).
      assert.equal(row.cargoMode, 'LCL');
      assert.equal(row.packageCount, 5);
      assert.equal(row.packageType, 'PALLET');
      assert.equal(row.cargoWeightKg, '1922.00');
      assert.equal(row.cargoVolumeCbm, '4.000');

      const unset = result.items.find((item) => item.id === withoutWarehouse.id);
      assert.ok(unset, 'the lot without a warehouse is listed too');
      assert.equal(unset.pickupWarehouseSiteName, null);

      const fcl = result.items.find((item) => item.id === fclLot.id);
      assert.ok(fcl, 'the FCL lot is listed too');
      assert.equal(fcl.pickupWarehouseSiteName, null);
    }
  });
});