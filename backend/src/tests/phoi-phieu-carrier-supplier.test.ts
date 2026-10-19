/**
 * Card 181026183500 — phoi-phieu board rows must resolve `carrierSupplierId`
 * for BOTH external-carrier shapes, so the expense drawer ("Bên thực chi" =
 * Nhà cung cấp) can default the trip's carrier NCC:
 *
 *  - 'SUPPLIER': external_entity_id IS the suppliers.id (direct reference).
 *  - 'CUSTOMER': external_entity_id is a customers.id whose
 *    `linked_supplier_id` is the carrier supplier — the shape every current
 *    writer emits (trip-create / dispatch-planning-commands). Before this fix
 *    the derivation only handled 'SUPPLIER', so `carrierSupplierId` was null
 *    for every real external-carrier trip and the drawer's NCC default was
 *    dead on the Kiểm soát phơi phiếu surface (QA card 181026183500).
 *
 * A tombstoned carrier customer must still resolve to null (manual pick),
 * matching the FB-061 soft-delete policy of the board's name chain.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { listPhoiPhieuRows } from '../services/phoi-phieu-control.service';

const suffix = `c18500-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}

/** Trip + shipment skeleton; the carrier block is the caller's. The customer
 *  row is created here so the CUSTOMER shape can reference its id directly. */
async function mkCarrierFixture(opts: {
  customerName: string;
  linkedSupplierId: number | null;
  customerDeleted?: boolean;
  externalEntityType: 'CUSTOMER' | 'SUPPLIER';
  externalEntityId?: number;
  tripCodeSuffix: string;
}) {
  const [customer] = await db.insert(s.customers).values({
    name: opts.customerName,
    ...(opts.linkedSupplierId != null ? { linkedSupplierId: opts.linkedSupplierId } : {}),
    ...(opts.customerDeleted ? { deletedAt: new Date() } : {}),
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C18500 route ${suffix}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: '2026-10-16', bookingRef: `C18500-${opts.tripCodeSuffix}`,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-C18500-${opts.tripCodeSuffix}-${suffix}`, departureDate: '2026-10-16', status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id, tripCode: s.trips.tripCode });
  track(s.trips, trip.id);
  const [carrierInfo] = await db.insert(s.tripCarrierInfo).values({
    tripId: trip.id, carrierType: 'EXTERNAL',
    externalEntityType: opts.externalEntityType,
    externalEntityId: opts.externalEntityType === 'CUSTOMER' ? customer.id : opts.externalEntityId!,
  }).returning({ id: s.tripCarrierInfo.id });
  track(s.tripCarrierInfo, carrierInfo.id);
  return { trip, shipment, customer };
}

after(async () => {
  try {
    for (const { table, id } of cleanup) {
      await db.delete(table).where(eq(table.id, id));
    }
  } catch {
    // tolerance
  }
  await disconnectRedis();
});

describe('card 181026183500 — carrierSupplierId for the NCC default', () => {
  test('CUSTOMER shape resolves the linked carrier supplier by id', async () => {
    const [supplier] = await db.insert(s.suppliers).values({
      name: `C18500 Nhà xe Linked ${suffix}`, types: ['CARRIER'], status: 'ACTIVE',
    }).returning({ id: s.suppliers.id, name: s.suppliers.name });
    track(s.suppliers, supplier.id);

    // Customer name deliberately differs from the supplier name: the drawer
    // must match the catalog by ID, never by name.
    const { trip } = await mkCarrierFixture({
      customerName: `C18500 Khách nhà xe (tên khác NCC) ${suffix}`,
      linkedSupplierId: supplier.id,
      externalEntityType: 'CUSTOMER',
      tripCodeSuffix: 'cust',
    });

    const rows = await listPhoiPhieuRows({ search: trip.tripCode! });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.carrierSupplierId, supplier.id, 'linked supplier id rides the row');
    assert.match(rows[0]!.carrierName ?? '', /C18500 Khách nhà xe/);
  });

  test('SUPPLIER shape keeps the direct external_entity_id resolution', async () => {
    const [supplier] = await db.insert(s.suppliers).values({
      name: `C18500 Nhà xe Trực tiếp ${suffix}`, types: ['CARRIER'], status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    track(s.suppliers, supplier.id);

    const { trip } = await mkCarrierFixture({
      customerName: `C18500 lô khách thường ${suffix}`,
      linkedSupplierId: null,
      externalEntityType: 'SUPPLIER',
      externalEntityId: supplier.id,
      tripCodeSuffix: 'sup',
    });

    const rows = await listPhoiPhieuRows({ search: trip.tripCode! });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.carrierSupplierId, supplier.id);
    assert.match(rows[0]!.carrierName ?? '', /C18500 Nhà xe Trực tiếp/);
  });

  test('tombstoned carrier customer resolves to null — manual pick, no stale NCC', async () => {
    const [supplier] = await db.insert(s.suppliers).values({
      name: `C18500 Nhà xe Tombstone ${suffix}`, types: ['CARRIER'], status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    track(s.suppliers, supplier.id);

    const { trip } = await mkCarrierFixture({
      customerName: `C18500 Khách đã xóa ${suffix}`,
      linkedSupplierId: supplier.id,
      customerDeleted: true,
      externalEntityType: 'CUSTOMER',
      tripCodeSuffix: 'tomb',
    });

    const rows = await listPhoiPhieuRows({ search: trip.tripCode! });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.carrierSupplierId, null);
    assert.match(rows[0]!.carrierName ?? '', /không còn trong danh mục/);
  });
});
