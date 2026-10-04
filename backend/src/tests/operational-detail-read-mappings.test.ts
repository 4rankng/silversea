import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { getTripById } from '../services/trip-queries.service';
import { listShipmentContainers } from '../services/shipment-containers.service';
import { getShipmentDetail } from '../services/shipment-detail-reads.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const supplierIds: number[] = [];

test('container read and shipment detail carry known catalog labels and retain untyped rows', async () => {
  const [customer] = await db.select().from(s.customers).limit(1);
  const [containerType] = await db.select().from(s.containerTypes).limit(1);
  assert.ok(customer); assert.ok(containerType);
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `DTL-${suffix}`, blNumber: `QA-DTL-${suffix}`,
    customerId: customer.id, status: 'NEW', cargoMode: 'FCL',
  }).returning();
  shipmentIds.push(shipment.id);
  const containers = await db.insert(s.shipmentContainers).values([
    { shipmentId: shipment.id, containerTypeId: containerType.id, createdAt: new Date('2026-10-01T01:00:00Z') },
    { shipmentId: shipment.id, containerTypeId: null, createdAt: new Date('2026-10-01T02:00:00Z') },
  ]).returning();
  const rows = await listShipmentContainers(shipment.id);
  assert.deepEqual(rows.map(row => row.id), [containers[1].id, containers[0].id]);
  const known = rows.find(row => row.id === containers[0].id)!;
  assert.equal('containerTypeName' in known ? known.containerTypeName : undefined, containerType.name);
  assert.equal('containerTypeCode' in known ? known.containerTypeCode : undefined, containerType.code);
  const unknown = rows.find(row => row.id === containers[1].id)!;
  assert.equal('containerTypeName' in unknown ? unknown.containerTypeName : undefined, null);
  const detail = await getShipmentDetail(shipment.id);
  const detailKnown = detail.containers.find(row => row.id === containers[0].id)!;
  assert.equal('containerTypeCode' in detailKnown ? detailKnown.containerTypeCode : undefined, containerType.code);
  assert.equal(detail.containers.length, 2);
});

test('trip detail carries the established external carrier alias while retaining the original entity field', async () => {
  const [customer] = await db.select().from(s.customers).limit(1);
  const [carrier] = await db.select().from(s.customers).where(eq(s.customers.isCarrier, true)).limit(1);
  const [route] = await db.select().from(s.routes).limit(1);
  const [cargo] = await db.select().from(s.cargoTypes).limit(1);
  assert.ok(customer); assert.ok(carrier); assert.ok(route); assert.ok(cargo);
  for (const externalEntityId of [carrier.id, null]) {
    const trip = await insertTripComposite(db, {
      tripCode: `DTL-${suffix}-${tripIds.length}`, customerId: customer.id, routeId: route.id,
      cargoTypeId: cargo.id, departureDate: '2026-10-01', status: 'CREATED',
      carrierType: externalEntityId == null ? 'OWN' : 'EXTERNAL',
      externalEntityId, externalEntityType: externalEntityId == null ? null : 'CUSTOMER',
    });
    tripIds.push(trip.id);
    const detail = await getTripById(trip.id);
    assert.equal('externalEntityId' in detail ? detail.externalEntityId : undefined, externalEntityId);
    assert.equal('externalCarrierId' in detail ? detail.externalCarrierId : undefined, externalEntityId);
  }
});

test('supplier-backed detail resolves linked customer identity and retains historical supplier name when unlinked', async () => {
  const suppliers = await db.select().from(s.suppliers);
  const customers = await db.select().from(s.customers);
  let supplier = suppliers.find(row => row.linkedCustomerId != null && row.linkedCustomerId !== row.id
    && customers.some(c => c.id === row.id)
    && customers.some(c => c.id === row.linkedCustomerId && c.isCarrier && c.status === 'ACTIVE' && !c.deletedAt));
  if (!supplier) {
    // Clean isolated seed IDs need not collide as the long-lived app catalog does.
    // Exercise the retained namespace boundary with an owned supplier linked to
    // an existing active carrier, colliding with a different existing customer.
    const carrier = customers.find(row => row.isCarrier && row.status === 'ACTIVE' && !row.deletedAt);
    assert.ok(carrier);
    const collision = customers.find(row => row.id !== carrier.id && !suppliers.some(value => value.id === row.id));
    assert.ok(collision, 'seed must provide distinct customer namespaces for an owned collision fixture');
    [supplier] = await db.insert(s.suppliers).values({ id: collision.id, name: carrier.name, linkedCustomerId: carrier.id }).returning();
    supplierIds.push(supplier.id);
    // A hand-claimed native id never moves suppliers_id_seq. On a clean
    // migrate + one-pass-seed catalog the sequence sits exactly at max(id)
    // (seed allocates supplier and customer ids in lockstep from 1), so the
    // claimed id equals the next nextval and the DEFAULT-id insert below
    // re-mints it — 23505 duplicate key on suppliers_pkey. Realign past the
    // claimed id, never rewinding a sequence that has run ahead on a
    // long-lived database, so the inserts below always allocate fresh ids.
    await db.execute(sql`SELECT setval(pg_get_serial_sequence('suppliers', 'id'), GREATEST((SELECT max(id) FROM suppliers), COALESCE(pg_sequence_last_value(pg_get_serial_sequence('suppliers', 'id')), 0)))`);
  }
  const linked = customers.find(row => row.id === supplier.linkedCustomerId)!;
  const [route] = await db.select().from(s.routes).limit(1);
  const [cargo] = await db.select().from(s.cargoTypes).limit(1);
  assert.ok(route); assert.ok(cargo);
  const [unlinked] = await db.insert(s.suppliers).values({ name: `QA unlinked carrier ${suffix}`, shortName: `QA unlinked ${suffix}` }).returning();
  const [dangling] = await db.insert(s.suppliers).values({ name: `QA dangling carrier ${suffix}`, linkedCustomerId: 2147483647 }).returning();
  supplierIds.push(unlinked.id, dangling.id);
  for (const carrier of [supplier, unlinked, dangling]) {
    const trip = await insertTripComposite(db, {
      tripCode: `DTL-SUP-${suffix}-${tripIds.length}`, customerId: customers[0].id,
      routeId: route.id, cargoTypeId: cargo.id, departureDate: '2026-10-01', status: 'CREATED',
      carrierType: 'EXTERNAL', externalEntityId: carrier.id, externalEntityType: 'SUPPLIER',
    });
    tripIds.push(trip.id);
    const detail = await getTripById(trip.id);
    assert.equal('externalEntityId' in detail ? detail.externalEntityId : undefined, carrier.id);
    assert.equal('externalEntityType' in detail ? detail.externalEntityType : undefined, 'SUPPLIER');
    assert.equal('externalCarrierId' in detail ? detail.externalCarrierId : undefined, carrier.id === supplier.id ? linked.id : null);
    assert.equal('externalCarrierName' in detail ? detail.externalCarrierName : undefined,
      carrier.id === supplier.id ? (linked.shortName?.trim() || linked.name) : (carrier.shortName?.trim() || carrier.name));
  }
});

after(async () => {
  try {
    if (tripIds.length) {
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    }
    if (supplierIds.length) await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
    if (shipmentIds.length) {
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
  } finally { await client.end(); }
});
