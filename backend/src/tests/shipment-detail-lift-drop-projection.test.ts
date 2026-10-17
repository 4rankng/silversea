/**
 * FB-107 — the lot detail's Nâng / Hạ payload fields.
 *
 * The detail page showed the dormant `pickup_location` / `delivery_location`
 * columns (every form-created lot leaves both empty, so both read '—'). It now
 * resolves the lot's two REAL operating points through the shared
 * `resolveLiftDropPoints` rule, which needs two facts the detail payload did
 * not carry: the LCL warehouse site (name + type, from
 * `shipments.pickup_warehouse_site_id`) and each FCL container's Cảng nâng /
 * Cảng hạ display names. This pins both joins — short-name authority, the
 * ad-hoc raw name as the fallback, and null when nothing was picked — plus the
 * portal projection (`toCustomerShipmentDetail`), whose "Chi tiết lô hàng"
 * screen resolves the same rule for the customer and so must carry the same
 * facts.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { getShipmentDetail } from '../services/shipment-detail-reads.service';
import { toCustomerShipmentDetail } from '../routes/portal/index';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdSiteIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdPortIds: number[] = [];

describe('shipment detail — lift/drop projection (FB-107)', () => {
  after(async () => {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdPortIds.length > 0) {
      await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
    }
    if (createdSiteIds.length > 0) {
      await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  });

  test('projects the LCL warehouse name + type, and null when the lot never picked one', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `FB107 customer ${suffix}` })
      .returning();
    createdCustomerIds.push(customer.id);
    // A distinct short_name proves the short-name authority rather than the
    // full-name fallback every operational surface uses.
    const [warehouse] = await db.insert(s.operationalSites).values({
      customerId: customer.id,
      code: `FB107W${suffix.slice(-5)}`,
      name: `Kho lấy hàng đầy đủ ${suffix}`,
      shortName: `Kho lấy ${suffix}`,
      siteType: 'WAREHOUSE',
      address: `Địa chỉ FB-107 ${suffix}`,
      isActive: true,
    }).returning();
    createdSiteIds.push(warehouse.id);

    const [withWarehouse, withoutWarehouse] = await db.insert(s.shipments).values([
      {
        customerId: customer.id,
        blNumber: `FB107-A-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-21',
        pickupWarehouseSiteId: warehouse.id,
        packageCount: 3,
        packageType: 'PALLET',
        cargoWeightKg: '900.00',
      },
      {
        customerId: customer.id,
        // EXPORT lots carry a booking reference, never a B/L (the
        // shipments_document_reference_direction_check enforces the split).
        bookingRef: `FB107-B-${suffix.slice(-8)}`,
        tradeDirection: 'EXPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-22',
        packageCount: 2,
        packageType: 'PALLET',
        cargoWeightKg: '450.00',
      },
    ]).returning();
    createdShipmentIds.push(withWarehouse.id, withoutWarehouse.id);

    const detail = await getShipmentDetail(withWarehouse.id);
    assert.equal(detail.shipment.pickupWarehouseSiteName, `Kho lấy ${suffix}`);
    assert.equal(detail.shipment.pickupWarehouseSiteType, 'WAREHOUSE');

    const unset = await getShipmentDetail(withoutWarehouse.id);
    assert.equal(unset.shipment.pickupWarehouseSiteName, null);
    assert.equal(unset.shipment.pickupWarehouseSiteType, null);
  });

  test('projects Cảng nâng / Cảng hạ names onto each container, raw text standing in for a missing catalog row', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `FB107 ports customer ${suffix}` })
      .returning();
    createdCustomerIds.push(customer.id);
    const ports = await db.insert(s.ports).values([
      { name: `Cảng nâng đầy đủ ${suffix}`, shortName: `Nâng ${suffix.slice(-5)}` },
      { name: `Cảng hạ đầy đủ ${suffix}` },
    ]).returning();
    createdPortIds.push(...ports.map((port) => port.id));

    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      blNumber: `FB107-FCL-${suffix.slice(-8)}`,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH',
      expectedDeliveryDate: '2026-10-23',
    }).returning();
    createdShipmentIds.push(shipment.id);

    await db.insert(s.shipmentContainers).values([
      {
        shipmentId: shipment.id,
        containerNumber: `FB107${suffix.slice(-7).toUpperCase()}`,
        pickupPortId: ports[0].id,
        dropoffPortId: ports[1].id,
      },
      // Lệnh chạy ngoài: no catalog port, only the typed name — the detail
      // must still name the side instead of reading '—'.
      {
        shipmentId: shipment.id,
        containerNumber: `FB107R${suffix.slice(-6).toUpperCase()}`,
        rawPickupPortName: `Bãi tự nhập ${suffix}`,
      },
    ]);

    const detail = await getShipmentDetail(shipment.id);
    // The container list is newest-first (created_at desc), so identify rows by
    // their number instead of by position.
    const catalogRow = detail.containers.find((row) => row.pickupPortId === ports[0].id);
    const rawRow = detail.containers.find((row) => row.rawPickupPortName != null);
    assert.equal(catalogRow?.pickupPortName, `Nâng ${suffix.slice(-5)}`);
    assert.equal(catalogRow?.dropoffPortName, `Cảng hạ đầy đủ ${suffix}`);
    assert.equal(rawRow?.pickupPortName, `Bãi tự nhập ${suffix}`);
    assert.equal(rawRow?.dropoffPortName, null);
  });

  test('the portal projection carries every lift/drop fact its Nâng / Hạ rows resolve', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `FB107 portal customer ${suffix}` })
      .returning();
    createdCustomerIds.push(customer.id);
    const [warehouse, factory] = await db.insert(s.operationalSites).values([
      {
        customerId: customer.id,
        code: `FB107PW${suffix.slice(-5)}`,
        name: `Kho portal đầy đủ ${suffix}`,
        shortName: `Kho lấy ${suffix}`,
        siteType: 'WAREHOUSE',
        address: `Địa chỉ FB-107 ${suffix}`,
        isActive: true,
      },
      {
        customerId: customer.id,
        code: `FB107PF${suffix.slice(-5)}`,
        name: `Nhà máy portal đầy đủ ${suffix}`,
        shortName: `Nhà máy ${suffix}`,
        siteType: 'FACTORY',
        address: `Địa chỉ FB-107 ${suffix}`,
        isActive: true,
      },
    ]).returning();
    createdSiteIds.push(warehouse.id, factory.id);
    const [port] = await db.insert(s.ports).values({
      name: `Cảng portal đầy đủ ${suffix}`,
      shortName: `Nâng ${suffix.slice(-5)}`,
    }).returning();
    createdPortIds.push(port.id);

    const [lcl, fcl] = await db.insert(s.shipments).values([
      {
        customerId: customer.id,
        bookingRef: `FB107P-LCL-${suffix.slice(-8)}`,
        tradeDirection: 'EXPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-24',
        pickupWarehouseSiteId: warehouse.id,
        operationalSiteId: factory.id,
        pickupLocation: `Nâng gõ tay ${suffix}`,
        deliveryLocation: `Hạ gõ tay ${suffix}`,
        packageCount: 1,
        packageType: 'PALLET',
        cargoWeightKg: '100.00',
      },
      {
        customerId: customer.id,
        blNumber: `FB107P-FCL-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-25',
        factoryName: `Nhà máy gõ tay ${suffix}`,
        packageCount: 1,
        packageType: 'CONTAINER',
        cargoWeightKg: '200.00',
      },
    ]).returning();
    createdShipmentIds.push(lcl.id, fcl.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: fcl.id,
      containerNumber: `FB107P${suffix.slice(-7).toUpperCase()}`,
      pickupPortId: port.id,
      // Lệnh chạy ngoài on one side: the typed name must ride the portal too.
      rawDropoffPortName: `Hạ gõ tay ${suffix}`,
    });

    const lclPortal = toCustomerShipmentDetail(await getShipmentDetail(lcl.id));
    assert.equal(lclPortal.shipment.cargoMode, 'LCL');
    assert.equal(lclPortal.shipment.tradeDirection, 'EXPORT');
    assert.equal(lclPortal.shipment.pickupWarehouseSiteName, `Kho lấy ${suffix}`);
    assert.equal(lclPortal.shipment.effectiveFactoryName, `Nhà máy ${suffix}`);
    assert.equal(lclPortal.shipment.factoryName, null);
    assert.equal(lclPortal.shipment.pickupLocation, `Nâng gõ tay ${suffix}`);
    assert.equal(lclPortal.shipment.deliveryLocation, `Hạ gõ tay ${suffix}`);

    const fclPortal = toCustomerShipmentDetail(await getShipmentDetail(fcl.id));
    assert.equal(fclPortal.shipment.factoryName, `Nhà máy gõ tay ${suffix}`);
    assert.equal(fclPortal.containers.length, 1);
    assert.equal(fclPortal.containers[0].pickupPortName, `Nâng ${suffix.slice(-5)}`);
    assert.equal(fclPortal.containers[0].dropoffPortName, `Hạ gõ tay ${suffix}`);
  });
});
